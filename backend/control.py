"""AROK Monitor — active control plane.

Kill processes, stop/start Windows services, block IPs via Windows Firewall.
Mode is LIVE by default: control actions execute for real. Set AROK_DEMO=1 to
fall back to demo mode, where actions are logged but not executed.
"""
import os
import subprocess
import sys

import psutil

import db

# Live by default (v1.0). Opt into the old simulated behaviour with AROK_DEMO=1.
DEMO_MODE = os.environ.get("AROK_DEMO", "0") == "1"
IS_WINDOWS = sys.platform == "win32"


def kill_process(pid: int) -> dict:
    if DEMO_MODE:
        db.log_event("control", f"[demo] kill process pid={pid}")
        return {"ok": True, "demo": True, "detail": f"Demo mode: would terminate PID {pid}"}
    try:
        p = psutil.Process(pid)
        name = p.name()
        p.terminate()
        try:
            p.wait(timeout=3)
        except psutil.TimeoutExpired:
            p.kill()
        db.log_event("control", f"killed process {name} (pid={pid})")
        return {"ok": True, "detail": f"Terminated {name} (PID {pid})"}
    except psutil.NoSuchProcess:
        return {"ok": False, "detail": f"PID {pid} not found"}
    except psutil.AccessDenied:
        return {"ok": False, "detail": f"Access denied terminating PID {pid} (run elevated)"}


def service_action(name: str, action: str) -> dict:
    if action not in ("start", "stop", "restart"):
        return {"ok": False, "detail": f"Unknown action {action}"}
    if DEMO_MODE:
        db.log_event("control", f"[demo] {action} service {name}")
        return {"ok": True, "demo": True, "detail": f"Demo mode: would {action} service '{name}'"}
    if not IS_WINDOWS:
        return {"ok": False, "detail": "Service control is Windows-only"}
    cmds = {"start": ["sc", "start", name], "stop": ["sc", "stop", name]}
    try:
        if action == "restart":
            subprocess.run(cmds["stop"], capture_output=True, timeout=30)
            r = subprocess.run(cmds["start"], capture_output=True, timeout=30)
        else:
            r = subprocess.run(cmds[action], capture_output=True, timeout=30)
        ok = r.returncode == 0
        db.log_event("control", f"{action} service {name}: {'ok' if ok else 'failed'}")
        return {"ok": ok, "detail": r.stdout.decode(errors="replace")[:500]}
    except Exception as e:
        return {"ok": False, "detail": str(e)}


def block_ip(ip: str) -> dict:
    if DEMO_MODE:
        db.log_event("control", f"[demo] block IP {ip}")
        return {"ok": True, "demo": True, "detail": f"Demo mode: would add firewall block rule for {ip}"}
    if not IS_WINDOWS:
        return {"ok": False, "detail": "Firewall control is Windows-only"}
    rule = f"AROK-Block-{ip}"
    try:
        r = subprocess.run(
            ["netsh", "advfirewall", "firewall", "add", "rule",
             f"name={rule}", "dir=in", "action=block", f"remoteip={ip}"],
            capture_output=True, timeout=30,
        )
        ok = r.returncode == 0
        db.log_event("control", f"block IP {ip}: {'ok' if ok else 'failed'}")
        return {"ok": ok, "detail": r.stdout.decode(errors="replace")[:500]}
    except Exception as e:
        return {"ok": False, "detail": str(e)}
