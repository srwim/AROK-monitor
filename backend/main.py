"""AROK Monitor — FastAPI app.

Dual-serving strategy: serves frontend/dist/ when the React build is
present, falls back to legacy index.html during incremental migration.
Run: uvicorn main:app --host 127.0.0.1 --port 8420
"""
import asyncio
import os
import sys
import threading

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import ai
import claude_connect
import cleanup
import control
import db
import hardware
import licensing
import monitor
import optimizer
import upgrade
import updater

app = FastAPI(title="AROK Monitor", version="1.0.0")

_stop = threading.Event()


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
    t = threading.Thread(target=monitor.sampler_loop, args=(_stop,), daemon=True)
    t.start()
    threading.Thread(target=optimizer.detector_loop, args=(_stop,), daemon=True).start()


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


@app.get("/api/ai/config")
def ai_config():
    return ai.get_config()


@app.post("/api/ai/config")
def ai_config_set(req: AiConfigReq):
    return ai.set_config(req.enabled, req.local_enabled, req.api_enabled, req.api_key)


@app.post("/api/ai/download")
def ai_download():
    return ai.start_download()


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
}


def get_pref(key: str) -> bool:
    return db.get_setting(f"pref_{key}", PREF_DEFAULTS.get(key, "0")) == "1"


@app.get("/api/settings")
def get_settings():
    return {
        "demo_mode": control.DEMO_MODE,
        "version": updater.DISPLAY_VERSION,
        "ai_engine": ai.engine_name(),
        "sample_interval": monitor.SAMPLE_INTERVAL,
        "abs_thresholds": monitor.ABS_THRESHOLDS,
        "z_threshold": monitor.Z_THRESHOLD,
        "prefs": {k: get_pref(k) for k in PREF_DEFAULTS},
        "desktop": getattr(app.state, "desktop", False),
    }


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
