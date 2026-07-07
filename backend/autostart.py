"""AROK Monitor — run-on-startup toggle.

Uses the per-user Run key (HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run),
which needs no elevation and is trivially inspectable/removable by the user
(Task Manager → Startup apps). The registry is the single source of truth —
we never cache the state in the app database, so external changes (user
removes it in Task Manager) are always reflected.

Packaged builds register the AROK.exe path; running from source registers
run_desktop.bat as a best-effort dev convenience.
"""
from __future__ import annotations

import os
import sys

RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
VALUE_NAME = "AROK Monitor"

IS_WINDOWS = sys.platform == "win32"


def _launch_command() -> str:
    if getattr(sys, "frozen", False):
        return f'"{sys.executable}"'
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return f'"{os.path.join(root, "run_desktop.bat")}"'


def get() -> bool:
    """True if AROK is currently registered to run at startup."""
    if not IS_WINDOWS:
        return False
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
            winreg.QueryValueEx(key, VALUE_NAME)
        return True
    except Exception:
        return False


def set_enabled(enabled: bool) -> dict:
    """Add or remove the Run entry. Returns {ok, enabled, detail?}."""
    if not IS_WINDOWS:
        return {"ok": False, "enabled": False, "detail": "Windows only"}
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
            if enabled:
                winreg.SetValueEx(key, VALUE_NAME, 0, winreg.REG_SZ, _launch_command())
            else:
                try:
                    winreg.DeleteValue(key, VALUE_NAME)
                except FileNotFoundError:
                    pass
        return {"ok": True, "enabled": get()}
    except Exception as e:
        return {"ok": False, "enabled": get(), "detail": str(e)}
