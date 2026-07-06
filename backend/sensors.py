"""AROK Monitor — temperature & disk-health sensors (best-effort).

Sources, tried in order; everything degrades gracefully and nothing raises:

  CPU temperature:
    1. LibreHardwareMonitorLib via pythonnet — accurate, per-core capable.
       Opt-in: drop LibreHardwareMonitorLib.dll next to this file (or set
       AROK_LHM_DLL) and `pip install pythonnet`. MPL-2.0 — include its
       license file if the DLL ships with the installer.
    2. WMI MSAcpi_ThermalZoneTemperature — coarse ACPI zone temperature.
       Works without extra deps but many boards don't expose it, and it may
       require an elevated process.
    3. None — the API reports cpu_temp unsupported; the UI should hide it.

  Disk health (SMART-backed, Windows 10+, no extra deps):
    PowerShell Get-PhysicalDisk (HealthStatus, media type) joined with
    Get-StorageReliabilityCounter (temperature, wear %). Falls back to an
    empty list when unavailable.

Feeds two consumers:
  * GET /api/sensors (main.py) — raw readings for the UI.
  * hardware.inventory() — boosts Upgrades-tab relevance scores: a hot CPU
    raises the cooler score, a Warning/Unhealthy or high-wear disk raises
    the storage score. Detection stays deterministic (LLM-narrator rule).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time

IS_WINDOWS = sys.platform == "win32"
CACHE_SECONDS = 10
_CREATE_NO_WINDOW = 0x08000000 if IS_WINDOWS else 0

_lock = threading.Lock()
_cache: dict = {"ts": 0.0, "data": None}

# Get-PhysicalDisk HealthStatus serializes as an int in some PS versions.
_HEALTH = {0: "Healthy", 1: "Warning", 2: "Unhealthy", 5: "Unknown"}
# MediaType can also arrive numeric.
_MEDIA = {0: "Unspecified", 3: "HDD", 4: "SSD", 5: "SCM"}


def _ps_json(cmd: str, timeout: int = 12) -> list | None:
    """Run a PowerShell snippet that ends in ConvertTo-Json; return a list."""
    if not IS_WINDOWS:
        return None
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", cmd],
            capture_output=True, text=True, timeout=timeout,
            creationflags=_CREATE_NO_WINDOW,
        )
        if out.returncode != 0 or not out.stdout.strip():
            return None
        data = json.loads(out.stdout)
        return data if isinstance(data, list) else [data]
    except Exception:
        return None


# ---------- CPU temperature ----------

_lhm_computer = None
_lhm_failed = False


def _cpu_temp_lhm() -> float | None:
    """LibreHardwareMonitor path. One-time init; permanently disabled on failure."""
    global _lhm_computer, _lhm_failed
    if _lhm_failed or not IS_WINDOWS:
        return None
    try:
        if _lhm_computer is None:
            dll = os.environ.get("AROK_LHM_DLL") or os.path.join(
                os.path.dirname(os.path.abspath(__file__)), "LibreHardwareMonitorLib.dll"
            )
            if not os.path.exists(dll):
                _lhm_failed = True
                return None
            import clr  # type: ignore  # pythonnet
            clr.AddReference(dll)
            from LibreHardwareMonitor import Hardware  # type: ignore
            comp = Hardware.Computer()
            comp.IsCpuEnabled = True
            comp.Open()
            _lhm_computer = comp
        temps: list[float] = []
        for hw in _lhm_computer.Hardware:
            hw.Update()
            for s in hw.Sensors:
                if str(s.SensorType) == "Temperature" and s.Value is not None:
                    temps.append(float(s.Value))
        valid = [t for t in temps if 0.0 < t < 120.0]
        return round(max(valid), 1) if valid else None
    except Exception:
        _lhm_failed = True
        return None


def _cpu_temp_wmi() -> float | None:
    """ACPI thermal zone (tenths of Kelvin). Coarse; unsupported on many boards."""
    if not IS_WINDOWS:
        return None
    try:
        import wmi  # type: ignore
        w = wmi.WMI(namespace="root\\wmi")
        zones = w.MSAcpi_ThermalZoneTemperature()
        temps = [
            (z.CurrentTemperature / 10.0) - 273.15
            for z in zones
            if getattr(z, "CurrentTemperature", None)
        ]
        valid = [t for t in temps if 0.0 < t < 120.0]
        return round(max(valid), 1) if valid else None
    except Exception:
        return None


# ---------- Disk health ----------

def _disks() -> list[dict]:
    disks = _ps_json(
        "Get-PhysicalDisk | Select-Object DeviceId,FriendlyName,MediaType,HealthStatus,Size | ConvertTo-Json"
    ) or []
    rel = _ps_json(
        "Get-PhysicalDisk | Get-StorageReliabilityCounter | Select-Object DeviceId,Temperature,Wear | ConvertTo-Json"
    ) or []
    relmap = {str(r.get("DeviceId")): r for r in rel}

    out: list[dict] = []
    for i, d in enumerate(disks):
        rid = str(d.get("DeviceId"))
        r = relmap.get(rid, {})
        base = d.get("FriendlyName") or f"Disk {rid}"
        # identical models are common (RAID pairs) — disambiguate by device id
        dup = sum(1 for x in disks if (x.get("FriendlyName") or "") == d.get("FriendlyName")) > 1
        health = d.get("HealthStatus")
        if isinstance(health, int):
            health = _HEALTH.get(health, "Unknown")
        media = d.get("MediaType")
        if isinstance(media, int):
            media = _MEDIA.get(media, "Unspecified")
        size = d.get("Size") or 0
        temp = r.get("Temperature")
        wear = r.get("Wear")
        out.append({
            "name": f"{base} (Disk {rid})" if dup else base,
            "media": media or "Unspecified",
            "health": health or "Unknown",
            "size_gb": round(size / (1024 ** 3)) if size else None,
            "temp_c": temp if temp not in (0, None) else None,  # 0 = not reported
            "wear_pct": wear if wear is not None else None,
        })
    return out


# ---------- Public API ----------

def read(force: bool = False) -> dict:
    """Cached snapshot of all sensors. Safe to call from any thread."""
    with _lock:
        now = time.time()
        if not force and _cache["data"] is not None and now - _cache["ts"] < CACHE_SECONDS:
            return _cache["data"]

        cpu_t = _cpu_temp_lhm()
        source = "lhm"
        if cpu_t is None:
            cpu_t = _cpu_temp_wmi()
            source = "wmi" if cpu_t is not None else "none"

        disks = _disks()
        # wear/temp counters require an elevated process; health does not.
        # Report elevation so the UI can explain missing values.
        elevated = False
        if IS_WINDOWS:
            try:
                import ctypes
                elevated = bool(ctypes.windll.shell32.IsUserAnAdmin())
            except Exception:
                pass
        data = {
            "ts": now,
            "cpu": {"temp_c": cpu_t, "source": source},
            "disks": disks,
            "elevated": elevated,
            "supported": {"cpu_temp": cpu_t is not None, "disk_health": bool(disks)},
        }
        _cache["ts"] = now
        _cache["data"] = data
        return data


def findings() -> list[dict]:
    """Deterministic sensor findings for narration / relevance boosts."""
    s = read()
    out: list[dict] = []
    t = (s.get("cpu") or {}).get("temp_c")
    if t is not None and t >= 85.0:
        out.append({"kind": "cpu_hot", "severity": "warn", "temp_c": t,
                    "message": f"CPU temperature is {t}°C — sustained high temps suggest a cooling problem."})
    for d in s.get("disks", []):
        if d["health"] not in ("Healthy", "Unknown"):
            out.append({"kind": "disk_health", "severity": "critical", "disk": d["name"],
                        "message": f"Drive '{d['name']}' reports {d['health']} — back up this disk now."})
        elif (d.get("wear_pct") or 0) >= 80:
            out.append({"kind": "disk_wear", "severity": "warn", "disk": d["name"],
                        "message": f"Drive '{d['name']}' is at {d['wear_pct']}% wear — plan a replacement."})
    return out
