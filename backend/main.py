"""AROK Monitor — FastAPI app.

Dual-serving strategy: serves frontend/dist/ when the React build is
present, falls back to legacy index.html during incremental migration.
Run: uvicorn main:app --host 127.0.0.1 --port 8420
"""
import asyncio
import os
import secrets
import sys
import threading
from urllib.parse import urlsplit

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import ai
import autostart
import claude_connect
import cleanup
import control
import db
import hardware
import licensing
import monitor
import netsec
import optimizer
import sensors
import upgrade
import updater

app = FastAPI(title="AROK Monitor", version="2.2.3")

_stop = threading.Event()


# ---------- Local-origin security ----------
# The server binds to 127.0.0.1, but a browser on the same machine can still
# be tricked into sending requests here (cross-site POSTs from a malicious
# page, DNS rebinding). Two layers of defence:
#   1. Every HTTP request must carry a localhost Host header (and, when a
#      browser sends one, a localhost Origin). This defeats DNS rebinding.
#   2. Every state-changing /api call must present the per-session token.
#      The UI fetches it from GET /api/token — same-origin pages can read it,
#      cross-origin pages cannot (we never send CORS headers).
API_TOKEN = secrets.token_hex(16)
_ALLOWED_HOSTNAMES = {"127.0.0.1", "localhost", "::1"}
_TOKEN_EXEMPT = {
    "/api/desktop/show",     # second-launch window raise: local process, no UI token
    "/api/upgrade/receive",  # reference webhook: the license key itself is Ed25519-verified
}


def _host_only(value: str) -> str:
    """Strip the port from a Host header value ('127.0.0.1:8420' → '127.0.0.1')."""
    host = (value or "").strip()
    if host.startswith("["):  # IPv6 literal, e.g. [::1]:8420
        return host.partition("]")[0].lstrip("[")
    return host.rsplit(":", 1)[0] if ":" in host else host


@app.middleware("http")
async def _local_only(request: Request, call_next):
    if _host_only(request.headers.get("host", "")) not in _ALLOWED_HOSTNAMES:
        return JSONResponse({"detail": "forbidden host"}, status_code=403)
    origin = request.headers.get("origin")
    if origin and origin != "null":
        if (urlsplit(origin).hostname or "") not in _ALLOWED_HOSTNAMES:
            return JSONResponse({"detail": "forbidden origin"}, status_code=403)
    path = request.url.path
    if (
        request.method in ("POST", "PUT", "PATCH", "DELETE")
        and path.startswith("/api/")
        and path not in _TOKEN_EXEMPT
        and request.headers.get("x-arok-token") != API_TOKEN
    ):
        return JSONResponse({"detail": "missing or invalid session token"}, status_code=401)
    return await call_next(request)


@app.get("/api/token")
def api_token():
    """Per-session token for state-changing calls (rotates on every server start)."""
    return {"token": API_TOKEN}


@app.on_event("startup")
def _startup():
    db.init()
    # reload persisted alert thresholds (saved from the Settings tab)
    for metric in list(monitor.ABS_THRESHOLDS):
        v = db.get_setting(f"thr_{metric}")
        if v:
            try:
                monitor.ABS_THRESHOLDS[metric] = float(v)
            except ValueError:
                pass
    # reload persisted runtime settings (editable from the Settings tab)
    dm = db.get_setting("demo_mode")
    if dm is not None:
        control.DEMO_MODE = (dm == "1")
    si = db.get_setting("sample_interval")
    if si:
        try:
            monitor.SAMPLE_INTERVAL = int(si)
        except ValueError:
            pass
    zt = db.get_setting("z_threshold")
    if zt:
        try:
            monitor.Z_THRESHOLD = float(zt)
        except ValueError:
            pass
    t = threading.Thread(target=monitor.sampler_loop, args=(_stop,), daemon=True)
    t.start()
    threading.Thread(target=optimizer.detector_loop, args=(_stop,), daemon=True).start()
    # Quiet auto-updater: stages verified installers in the background when
    # the auto_update pref is on; the UI shows a relaunch pill when ready.
    threading.Thread(
        target=updater.auto_update_loop,
        args=(_stop, lambda: get_pref("auto_update")),
        daemon=True,
    ).start()


@app.on_event("shutdown")
def _shutdown():
    _stop.set()


# ---------- API ----------

@app.get("/api/stats")
def stats():
    return monitor.latest()


@app.websocket("/ws/stats")
async def ws_stats(ws: WebSocket):
    """Live stats stream — the UI falls back to polling if unavailable."""
    await ws.accept()
    try:
        while True:
            await ws.send_json(monitor.latest())
            await asyncio.sleep(2)
    except (WebSocketDisconnect, RuntimeError):
        pass


@app.get("/api/detail/{metric}")
def detail(metric: str):
    return monitor.detail(metric)


@app.get("/api/processes")
def processes(limit: int = 25):
    return monitor.top_processes(limit)


@app.get("/api/network")
def network(limit: int = 50):
    return monitor.connections(limit)


@app.get("/api/network/assess")
def network_assess(limit: int = 100):
    """Risk-scored connections + suspicious count + safe-list state."""
    return netsec.assess(monitor.connections(limit))


@app.get("/api/network/safelist")
def network_safelist():
    return {"safe": netsec.safe_list()}


class NetFlagReq(BaseModel):
    proc: str | None = None
    ip: str
    note: str = ""


@app.post("/api/network/flag-safe")
def network_flag_safe(req: NetFlagReq):
    return netsec.flag_safe(req.proc, req.ip, req.note)


class NetUnflagReq(BaseModel):
    key: str


@app.post("/api/network/unflag")
def network_unflag(req: NetUnflagReq):
    return netsec.unflag_safe(req.key)


@app.get("/api/network/investigate/{ip}")
def network_investigate(ip: str):
    """Deep-dive on a remote IP: reverse DNS, service guess, all local peers."""
    return netsec.investigate(ip)


@app.get("/api/services")
def services():
    return monitor.services()


@app.get("/api/analytics")
def analytics(seconds: int = 3600):
    return db.recent_metrics(seconds)


@app.get("/api/snapshot")
def snapshot(ts: float, resource: str = "cpu"):
    """Process snapshot nearest `ts`, sorted by the clicked resource (cpu|mem)."""
    snap = db.nearest_proc_snapshot(ts)
    if not snap:
        return {"ts": ts, "found": False, "resource": resource, "procs": []}
    key = "mem" if resource == "mem" else "cpu"
    procs = sorted(snap["procs"], key=lambda p: p.get(key) or 0, reverse=True)
    return {"ts": snap["ts"], "found": True, "resource": resource, "procs": procs}


@app.get("/api/hardware")
def hardware_inventory():
    return hardware.inventory()


@app.get("/api/sensors")
def sensors_state():
    """CPU temperature + SMART disk health (best-effort; see sensors.py)."""
    return {**sensors.read(), "findings": sensors.findings()}


# ---------- Cleanup tab ----------
@app.post("/api/cleanup/restore-point")
def cleanup_restore_point():
    return cleanup.create_restore_point()


@app.get("/api/cleanup/tron")
def cleanup_tron_info():
    return cleanup.tron_info()


class TronVerifyReq(BaseModel):
    path: str
    sha256: str


@app.post("/api/cleanup/tron/verify")
def cleanup_tron_verify(req: TronVerifyReq):
    return cleanup.verify_file_sha256(req.path, req.sha256)


class TronLaunchReq(BaseModel):
    path: str
    make_restore_point: bool = True


@app.post("/api/cleanup/tron/launch")
def cleanup_tron_launch(req: TronLaunchReq):
    return cleanup.launch_tron(req.path, req.make_restore_point)


@app.get("/api/cleanup/registry/scan")
def cleanup_registry_scan():
    return cleanup.registry_scan()


class RegistryCleanReq(BaseModel):
    ids: list[str]
    issues: list[dict]


@app.post("/api/cleanup/registry/clean")
def cleanup_registry_clean(req: RegistryCleanReq):
    return cleanup.registry_clean(req.ids, req.issues)


@app.get("/api/cleanup/temp/scan")
def cleanup_temp_scan():
    return cleanup.temp_scan()


@app.post("/api/cleanup/temp/clean")
def cleanup_temp_clean():
    return cleanup.temp_clean()


@app.get("/api/alerts")
def alerts(limit: int = 100):
    return db.recent_alerts(limit)


@app.post("/api/alerts/{alert_id}/ack")
def ack(alert_id: int):
    db.ack_alert(alert_id)
    return {"ok": True}


@app.post("/api/alerts/clear")
def clear_all_alerts():
    n = db.clear_all_alerts()
    return {"ok": True, "cleared": n}


@app.delete("/api/alerts/{alert_id}")
def clear_alert(alert_id: int):
    n = db.clear_alert(alert_id)
    return {"ok": bool(n), "cleared": n}


@app.get("/api/events")
def events(limit: int = 200):
    return db.recent_events(limit)


@app.get("/api/insights")
def insights():
    latest = monitor.latest()
    recent = db.recent_alerts(20)
    history = db.recent_metrics(900)
    recs = optimizer.recommendations()
    out = ai.narrate_system(latest, recent, history, recs)
    out["recommendations"] = recs
    # Deterministic sensor findings (hot CPU, failing/worn disks) join the
    # narrator's findings list — detection stays outside the model.
    sensor_msgs = [f["message"] for f in sensors.findings()]
    if sensor_msgs:
        out["findings"] = list(out.get("findings") or []) + sensor_msgs
    return out


class OptimizeReq(BaseModel):
    ids: list[str] | None = None


@app.post("/api/optimize")
def optimize(req: OptimizeReq):
    return optimizer.run(req.ids)


@app.get("/api/gaming")
def gaming():
    return {**optimizer.gaming_status(), **optimizer.auto_status()}


class GamingReq(BaseModel):
    enabled: bool | None = None
    auto: bool | None = None


@app.post("/api/gaming")
def gaming_set(req: GamingReq):
    out = {}
    if req.auto is not None:
        out = optimizer.set_auto(req.auto)
    if req.enabled is not None:
        out = optimizer.set_gaming(req.enabled)
    return {**optimizer.gaming_status(), **optimizer.auto_status(), **out}


class AiConfigReq(BaseModel):
    enabled: bool | None = None
    local_enabled: bool | None = None
    api_enabled: bool | None = None
    api_key: str | None = None
    model_url: str | None = None
    chat_enabled: bool | None = None


@app.get("/api/ai/config")
def ai_config():
    return ai.get_config()


@app.post("/api/ai/config")
def ai_config_set(req: AiConfigReq):
    return ai.set_config(req.enabled, req.local_enabled, req.api_enabled, req.api_key, req.model_url, req.chat_enabled)


@app.post("/api/ai/download")
def ai_download():
    return ai.start_download()


class AiModelReq(BaseModel):
    model_id: str


@app.post("/api/ai/select-model")
def ai_select_model(req: AiModelReq):
    return ai.select_model(req.model_id)


class AiLocalPathReq(BaseModel):
    path: str


@app.post("/api/ai/local-path")
def ai_local_path(req: AiLocalPathReq):
    return ai.set_local_model_path(req.path)


class AiChatReq(BaseModel):
    message: str
    history: list[dict] | None = None


@app.post("/api/ai/chat")
def ai_chat(req: AiChatReq):
    return ai.chat(req.message, req.history)


class KillReq(BaseModel):
    pid: int


@app.post("/api/control/kill")
def kill(req: KillReq):
    return control.kill_process(req.pid)


class ServiceReq(BaseModel):
    name: str
    action: str


@app.post("/api/control/service")
def service(req: ServiceReq):
    return control.service_action(req.name, req.action)


class BlockReq(BaseModel):
    ip: str


@app.post("/api/control/block-ip")
def block_ip(req: BlockReq):
    return control.block_ip(req.ip)


class PurgeReq(BaseModel):
    older_than_seconds: int = 0


@app.post("/api/purge")
def purge(req: PurgeReq):
    return db.purge(req.older_than_seconds)


@app.get("/api/license")
def license_status():
    return licensing.status()


class LicenseReq(BaseModel):
    key: str


@app.post("/api/license")
def license_activate(req: LicenseReq):
    if not req.key.strip():
        return licensing.deactivate()
    return licensing.activate(req.key)


@app.get("/api/update/check")
def update_check():
    return updater.check()


@app.get("/api/update/status")
def update_status():
    return updater.status()


@app.post("/api/update/download")
def update_download():
    """Kick off a check+download in the background; poll /api/update/status."""
    threading.Thread(target=updater.download_update, daemon=True).start()
    return updater.status()


@app.post("/api/update/apply")
def update_apply():
    """Run the staged installer silently and relaunch into the new version."""
    out = updater.apply_update()
    if out.get("ok"):
        db.log_event("update", f"applying staged update (from {updater.DISPLAY_VERSION})")
        # Give the response time to flush, then exit so the installer can
        # replace our files. SQLite is crash-safe; the installer relaunches us.
        threading.Timer(1.5, lambda: os._exit(0)).start()
    return out


# ---------- In-app upgrade ----------

class UpgradeStartReq(BaseModel):
    name: str | None = None
    email: str | None = None


@app.post("/api/upgrade/start")
def upgrade_start(req: UpgradeStartReq):
    return upgrade.start_session(req.name or "", req.email or "")


@app.get("/api/upgrade/status/{token}")
def upgrade_status(token: str):
    return upgrade.poll_session(token)


class UpgradeReceiveReq(BaseModel):
    token: str
    key: str


@app.post("/api/upgrade/receive")
def upgrade_receive(req: UpgradeReceiveReq):
    """Purchase server webhook — delivers the signed license key to AROK."""
    return upgrade.receive_license(req.token, req.key)


@app.post("/api/upgrade/cancel/{token}")
def upgrade_cancel(token: str):
    return upgrade.cancel_session(token)


# ---------- Anthropic cloud connect ----------

@app.post("/api/ai/connect/open")
def ai_connect_open():
    return claude_connect.open_console()


@app.get("/api/ai/connect")
def ai_connect_status():
    return claude_connect.get_connection()


class CloudConnectReq(BaseModel):
    key: str


@app.post("/api/ai/connect")
def ai_connect_set(req: CloudConnectReq):
    return claude_connect.validate_and_connect(req.key)


@app.delete("/api/ai/connect")
def ai_disconnect():
    return claude_connect.disconnect()


class ModelParamsReq(BaseModel):
    model: str | None = None
    max_tokens: int | None = None
    temperature: float | None = None


@app.post("/api/ai/model")
def ai_set_model(req: ModelParamsReq):
    return claude_connect.set_model_params(
        req.model or "",
        req.max_tokens or 0,
        req.temperature if req.temperature is not None else -1.0,
    )


PREF_DEFAULTS = {
    "close_to_tray": "1",     # closing the window keeps AROK monitoring in the tray
    "low_power_tray": "1",    # 30s sampling while in the tray (just logging)
    "auto_update": "1",       # stage updates in the background; user applies via relaunch
}


def get_pref(key: str) -> bool:
    return db.get_setting(f"pref_{key}", PREF_DEFAULTS.get(key, "0")) == "1"


def _ai_engine_mode() -> str:
    cfg = ai.get_config()
    if not cfg["enabled"]:
        return "off"
    if cfg["local_enabled"]:
        return "local"
    if cfg["api_enabled"]:
        return "cloud"
    return "template"


@app.get("/api/settings")
def get_settings():
    return {
        "demo_mode": control.DEMO_MODE,
        "version": updater.DISPLAY_VERSION,
        "ai_engine": ai.engine_name(),
        "ai_engine_mode": _ai_engine_mode(),
        "sample_interval": monitor.SAMPLE_INTERVAL,
        "abs_thresholds": monitor.ABS_THRESHOLDS,
        "z_threshold": monitor.Z_THRESHOLD,
        "prefs": {k: get_pref(k) for k in PREF_DEFAULTS},
        "desktop": getattr(app.state, "desktop", False),
        "autostart": autostart.get(),
    }


class RuntimeReq(BaseModel):
    demo_mode: bool | None = None
    sample_interval: int | None = None
    z_threshold: float | None = None
    ai_engine: str | None = None  # off | template | local | cloud


@app.post("/api/settings/runtime")
def set_runtime(req: RuntimeReq):
    if req.demo_mode is not None:
        control.DEMO_MODE = req.demo_mode
        db.set_setting("demo_mode", "1" if req.demo_mode else "0")
        db.log_event("settings", f"demo mode -> {'on' if req.demo_mode else 'off'}")
    if req.sample_interval is not None:
        v = max(1, min(60, int(req.sample_interval)))
        monitor.SAMPLE_INTERVAL = v
        db.set_setting("sample_interval", str(v))
        db.log_event("settings", f"sample interval -> {v}s")
    if req.z_threshold is not None:
        v = round(max(1.0, min(6.0, float(req.z_threshold))), 1)
        monitor.Z_THRESHOLD = v
        db.set_setting("z_threshold", str(v))
        db.log_event("settings", f"z-threshold -> {v}")
    if req.ai_engine is not None:
        eng = req.ai_engine
        if eng == "off":
            ai.set_config(enabled=False)
        elif eng == "template":
            ai.set_config(enabled=True, local_enabled=False, api_enabled=False)
        elif eng == "local":
            ai.set_config(enabled=True, local_enabled=True, api_enabled=False)
        elif eng == "cloud":
            ai.set_config(enabled=True, local_enabled=False, api_enabled=True)
        db.log_event("settings", f"ai engine -> {eng}")
    return get_settings()


class PrefReq(BaseModel):
    key: str
    value: bool


@app.post("/api/settings/pref")
def set_pref(req: PrefReq):
    if req.key not in PREF_DEFAULTS:
        return {"ok": False, "detail": "unknown preference"}
    db.set_setting(f"pref_{req.key}", "1" if req.value else "0")
    db.log_event("settings", f"pref {req.key} -> {'on' if req.value else 'off'}")
    return {"ok": True, "prefs": {k: get_pref(k) for k in PREF_DEFAULTS}}


class AutostartReq(BaseModel):
    enabled: bool


@app.post("/api/settings/autostart")
def set_autostart(req: AutostartReq):
    """Register/unregister AROK in the per-user Windows startup (Run key)."""
    out = autostart.set_enabled(req.enabled)
    if out.get("ok"):
        db.log_event("settings", f"run on startup -> {'on' if req.enabled else 'off'}")
    return out


class FileDialogReq(BaseModel):
    file_types: list[str] | None = None


@app.post("/api/dialog/open-file")
def open_file_dialog(req: FileDialogReq):
    """Native file-open dialog (desktop app only). Returns the chosen path."""
    fn = getattr(app.state, "pick_file", None)
    if not fn:
        return {"ok": False, "path": None, "detail": "file dialog only available in the desktop app"}
    path = fn(req.file_types)
    return {"ok": bool(path), "path": path}


@app.post("/api/desktop/show")
def desktop_show():
    """Raise the desktop window of the running instance (used by a second
    launch, and by the tray). No-op when not running as the desktop app."""
    fn = getattr(app.state, "show_window", None)
    if fn:
        fn()
        return {"ok": True}
    return {"ok": False, "detail": "not running as desktop app"}


class ThresholdReq(BaseModel):
    metric: str
    value: float


@app.post("/api/settings/threshold")
def set_threshold(req: ThresholdReq):
    if req.metric in monitor.ABS_THRESHOLDS:
        monitor.ABS_THRESHOLDS[req.metric] = req.value
        db.set_setting(f"thr_{req.metric}", str(req.value))
        return {"ok": True}
    return {"ok": False, "detail": "unknown metric"}


# ---------- Dual-serving frontend ----------

if getattr(sys, "frozen", False):
    # PyInstaller bundle: datas live next to the unpacked modules
    HERE = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    DIST = os.path.join(HERE, "frontend", "dist")
else:
    HERE = os.path.dirname(os.path.abspath(__file__))
    DIST = os.path.normpath(os.path.join(HERE, "..", "frontend", "dist"))
LEGACY = os.path.join(HERE, "index.html")

if os.path.isdir(DIST):
    # serve the entire build (index.html, assets/, favicon.ico, orb.png, …).
    # API + WebSocket routes are registered above, so they take precedence.
    app.mount("/", StaticFiles(directory=DIST, html=True), name="static")
else:
    @app.get("/")
    def index():
        if os.path.exists(LEGACY):
            return FileResponse(LEGACY)
        return HTMLResponse("<h1>AROK Monitor</h1><p>Frontend build not found. Run <code>npm run build</code> in frontend/.</p>")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8420)
