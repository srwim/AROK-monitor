"""AROK Monitor - optimization engine.

Deterministic recommendation rules over live system state (LLM narrator
pattern: the AI never decides what to optimize, it only narrates).
Execution goes through the demo-safe control plane. Gaming mode stops a
known-safe list of background services + switches the power plan, records
what it changed, and restores everything on exit.
"""
import json
import os
import subprocess
import sys

import psutil

import control
import db
import monitor

IS_WINDOWS = sys.platform == "win32"
SELF_PID = os.getpid()

# never recommend killing these
CRITICAL_PROCS = {
    "system", "system idle process", "idle", "registry", "memory compression",
    "csrss.exe", "wininit.exe", "winlogon.exe", "services.exe", "lsass.exe",
    "svchost.exe", "smss.exe", "dwm.exe", "explorer.exe", "fontdrvhost.exe",
    "sihost.exe", "taskhostw.exe", "ctfmon.exe", "conhost.exe",
    "python.exe", "pythonw.exe", "uvicorn", "python3", "arok.exe",
}

# services safe to stop when idle / gaming (windows)
IDLE_SAFE_SERVICES = {
    "SysMain": "Superfetch prefetching - safe to stop, frees RAM and disk I/O",
    "WSearch": "Windows Search indexing - safe to stop while gaming/working",
    "DiagTrack": "Connected User Experiences telemetry - safe to stop",
    "Spooler": "Print Spooler - safe to stop if not printing",
    "Fax": "Fax service - rarely needed",
    "MapsBroker": "Downloaded Maps Manager - rarely needed",
    "WMPNetworkSvc": "Media Player network sharing - rarely needed",
    "DoSvc": "Delivery Optimization (Windows Update P2P) - safe to pause",
}

GAMING_EXTRA_PROCS = {"onedrive.exe", "teams.exe", "ms-teams.exe", "slack.exe", "skype.exe"}


# ---------- recommendations ----------

def recommendations() -> list:
    recs = []
    latest = monitor.latest()
    procs = monitor.top_processes(40)
    svcs = {s["name"]: s for s in monitor.services()}

    # 1. memory pressure -> close top non-critical memory consumers
    if latest.get("mem", 0) >= 60:
        hogs = [
            p for p in sorted(procs, key=lambda x: x.get("memory_percent") or 0, reverse=True)
            if (p.get("memory_percent") or 0) >= 2.0
            and (p.get("name") or "").lower() not in CRITICAL_PROCS
            and p["pid"] != SELF_PID
        ][:3]
        for p in hogs:
            recs.append({
                "id": f"kill-mem-{p['pid']}",
                "title": f"Close {p['name']} (PID {p['pid']})",
                "detail": f"Using {p['memory_percent']:.1f}% of RAM while memory pressure is {latest['mem']:.0f}%.",
                "impact": f"frees ~{p['memory_percent']:.1f}% RAM",
                "action": {"type": "kill", "pid": p["pid"]},
            })

    # 2. sustained CPU hog (non-critical)
    for p in procs:
        if (p.get("cpu_percent") or 0) >= 25 and (p.get("name") or "").lower() not in CRITICAL_PROCS and p["pid"] != SELF_PID:
            recs.append({
                "id": f"kill-cpu-{p['pid']}",
                "title": f"Close {p['name']} (PID {p['pid']})",
                "detail": f"Consuming {p['cpu_percent']:.0f}% CPU in the background.",
                "impact": f"frees ~{p['cpu_percent']:.0f}% CPU",
                "action": {"type": "kill", "pid": p["pid"]},
            })
            break  # one CPU rec at a time

    # 3. disk pressure -> purge AROK history older than 24h
    if latest.get("disk", 0) >= 90:
        recs.append({
            "id": "purge-db",
            "title": "Purge monitoring history older than 24h",
            "detail": f"Disk at {latest['disk']:.1f}% - reclaim space from AROK's own metric/event history.",
            "impact": "reclaims disk space",
            "action": {"type": "purge", "older_than_seconds": 86400},
        })

    # 4. idle-safe services currently running
    for name, why in IDLE_SAFE_SERVICES.items():
        s = svcs.get(name)
        if s and s.get("status") == "running":
            recs.append({
                "id": f"svc-{name}",
                "title": f"Stop service: {s.get('display_name') or name}",
                "detail": why,
                "impact": "frees RAM / disk I/O",
                "action": {"type": "service_stop", "name": name},
            })

    # 5. demo fallback so the button is demonstrable on a quiet system
    if not recs:
        recs.append({
            "id": "purge-db-light",
            "title": "Compact monitoring database",
            "detail": "System is healthy - housekeeping only: purge metric history older than 7 days and VACUUM.",
            "impact": "small disk reclaim",
            "action": {"type": "purge", "older_than_seconds": 604800},
        })
    return recs


def run(ids=None) -> list:
    """Execute recommendations (all, or the given ids) via the control plane."""
    results = []
    for rec in recommendations():
        if ids is not None and rec["id"] not in ids:
            continue
        a = rec["action"]
        if a["type"] == "kill":
            r = control.kill_process(a["pid"])
        elif a["type"] == "service_stop":
            r = control.service_action(a["name"], "stop")
        elif a["type"] == "purge":
            p = db.purge(a["older_than_seconds"])
            r = {"ok": True, "detail": f"purged {p['metrics_purged']} metrics, {p['events_purged']} events"}
        else:
            r = {"ok": False, "detail": "unknown action"}
        db.log_event("optimize", f"{rec['title']}: {r.get('detail', '')}")
        results.append({"id": rec["id"], "title": rec["title"], **r})
    return results


# ---------- gaming mode ----------

def gaming_status() -> dict:
    return {
        "enabled": db.get_setting("gaming_mode", "0") == "1",
        "changes": json.loads(db.get_setting("gaming_changes", "[]")),
    }

def set_gaming(enable: bool) -> dict:
    if enable == (db.get_setting("gaming_mode", "0") == "1"):
        return gaming_status()
    changes = []
    if enable:
        svcs = {s["name"]: s for s in monitor.services()}
        stopped = []
        for name in IDLE_SAFE_SERVICES:
            s = svcs.get(name)
            if s and s.get("status") == "running":
                r = control.service_action(name, "stop")
                if r.get("ok"):
                    stopped.append(name)
                    changes.append(f"stopped service {name}")
        # background apps
        for p in psutil.process_iter(["pid", "name"]):
            try:
                if (p.info["name"] or "").lower() in GAMING_EXTRA_PROCS and p.info["pid"] != SELF_PID:
                    r = control.kill_process(p.info["pid"])
                    if r.get("ok"):
                        changes.append(f"closed {p.info['name']}")
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        r = _power_plan("high")
        if r.get("ok"):
            changes.append("power plan -> High performance")
        db.set_setting("gaming_restore", json.dumps(stopped))
        db.set_setting("gaming_mode", "1")
        db.log_event("gaming", "Gaming mode ON: " + ("; ".join(changes) or "nothing to change"))
    else:
        restore = json.loads(db.get_setting("gaming_restore", "[]"))
        for name in restore:
            r = control.service_action(name, "start")
            if r.get("ok"):
                changes.append(f"restarted service {name}")
        r = _power_plan("balanced")
        if r.get("ok"):
            changes.append("power plan -> Balanced")
        db.set_setting("gaming_restore", "[]")
        db.set_setting("gaming_mode", "0")
        db.log_event("gaming", "Gaming mode OFF: " + ("; ".join(changes) or "nothing to restore"))
    db.set_setting("gaming_changes", json.dumps(changes))
    return gaming_status()


_PLANS = {
    "high": "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c",
    "balanced": "381b4222-f694-41f0-9685-ff5bb260df2e",
}

def _power_plan(plan: str) -> dict:
    if control.DEMO_MODE:
        db.log_event("control", f"[demo] set power plan {plan}")
        return {"ok": True, "demo": True, "detail": f"Demo mode: would set power plan to {plan}"}
    if not IS_WINDOWS:
        return {"ok": False, "detail": "Power plans are Windows-only"}
    try:
        r = subprocess.run(["powercfg", "/setactive", _PLANS[plan]], capture_output=True, timeout=15)
        return {"ok": r.returncode == 0, "detail": f"power plan {plan}"}
    except Exception as e:
        return {"ok": False, "detail": str(e)}


# ---------- automatic game detection ----------
# Auto mode: when enabled, AROK watches for a running game and engages
# gaming mode by itself (pausing unnecessary services), then restores
# everything ~30s after the game exits. Deterministic, like everything else.

GAME_PROCS = {
    # common titles / engines
    "csgo.exe", "cs2.exe", "dota2.exe", "valorant.exe", "valorant-win64-shipping.exe",
    "fortniteclient-win64-shipping.exe", "gta5.exe", "rdr2.exe", "cyberpunk2077.exe",
    "eldenring.exe", "witcher3.exe", "overwatch.exe", "league of legends.exe",
    "rocketleague.exe", "minecraft.exe", "javaw.exe", "factorio.exe", "stellaris.exe",
    "helldivers2.exe", "bg3.exe", "starfield.exe", "hogwartslegacy.exe", "palworld.exe",
}

NOT_GAMES = {
    # fullscreen apps that are definitely not games
    "explorer.exe", "chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "opera.exe",
    "vlc.exe", "wmplayer.exe", "netflix.exe", "spotify.exe", "powerpnt.exe",
    "arok.exe", "python.exe", "pythonw.exe", "code.exe", "devenv.exe",
    "dwm.exe", "searchhost.exe", "lockapp.exe", "applicationframehost.exe",
}

_detector_state = {"detected": None, "miss": 0}


def auto_status() -> dict:
    return {
        "auto": db.get_setting("gaming_auto", "0") == "1",
        "detected": _detector_state["detected"],
    }


def set_auto(enable: bool) -> dict:
    db.set_setting("gaming_auto", "1" if enable else "0")
    db.log_event("gaming", f"auto gaming mode {'enabled' if enable else 'disabled'}")
    if not enable and db.get_setting("gaming_auto_engaged", "0") == "1":
        set_gaming(False)
        db.set_setting("gaming_auto_engaged", "0")
        _detector_state["detected"] = None
    return {**gaming_status(), **auto_status()}


def _foreground_fullscreen_proc():
    """Windows heuristic: name of the foreground process if its window
    covers the whole primary screen. None elsewhere / on failure."""
    if not IS_WINDOWS:
        return None
    try:
        import ctypes
        from ctypes import wintypes
        u32 = ctypes.windll.user32
        hwnd = u32.GetForegroundWindow()
        if not hwnd:
            return None
        rect = wintypes.RECT()
        u32.GetWindowRect(hwnd, ctypes.byref(rect))
        sw, sh = u32.GetSystemMetrics(0), u32.GetSystemMetrics(1)
        if rect.right - rect.left >= sw and rect.bottom - rect.top >= sh:
            pid = wintypes.DWORD()
            u32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            if pid.value:
                return psutil.Process(pid.value).name()
    except Exception:
        pass
    return None


def detect_game():
    """Return a running game's process name, or None."""
    # known game processes
    for p in psutil.process_iter(["name"]):
        try:
            n = (p.info["name"] or "").lower()
            if n in GAME_PROCS:
                return p.info["name"]
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    # fullscreen foreground app that isn't a known non-game
    fg = _foreground_fullscreen_proc()
    if fg and fg.lower() not in NOT_GAMES and fg.lower() not in CRITICAL_PROCS:
        return fg
    return None


def detector_loop(stop):
    """Background watcher started by main.py."""
    while not stop.wait(10):
        try:
            if db.get_setting("gaming_auto", "0") != "1":
                continue
            game = detect_game()
            enabled = db.get_setting("gaming_mode", "0") == "1"
            if game:
                _detector_state["detected"] = game
                _detector_state["miss"] = 0
                if not enabled:
                    set_gaming(True)
                    db.set_setting("gaming_auto_engaged", "1")
                    db.log_event("gaming", f"auto-engaged: detected {game}")
            elif enabled and db.get_setting("gaming_auto_engaged", "0") == "1":
                _detector_state["miss"] += 1
                if _detector_state["miss"] >= 3:  # ~30s without the game
                    set_gaming(False)
                    db.set_setting("gaming_auto_engaged", "0")
                    db.log_event("gaming", "auto-restored: game exited")
                    _detector_state["detected"] = None
                    _detector_state["miss"] = 0
            else:
                _detector_state["detected"] = None
        except Exception as e:
            db.log_event("gaming", f"detector error: {e}")
