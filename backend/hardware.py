"""AROK Monitor — hardware inventory.

Best-effort detection of the machine's components so the Upgrades tab can:
  * show the user's CURRENT part next to each upgrade pick,
  * judge basic compatibility (e.g. DDR generation, socket hints),
  * rank which upgrades are most RELEVANT (weakest / most-utilized parts first).

Everything degrades gracefully: on non-Windows or when WMI is unavailable we
return whatever psutil/platform can tell us and leave the rest null. Nothing
here raises.
"""
from __future__ import annotations

import platform
import sys

import psutil

import db
import monitor
import sensors

IS_WINDOWS = sys.platform == "win32"


def _wmi():
    if not IS_WINDOWS:
        return None
    try:
        import wmi  # type: ignore
        return wmi.WMI()
    except Exception:
        return None


# SMBIOS memory type -> human label (Win32_PhysicalMemory.SMBIOSMemoryType)
_DDR = {20: "DDR", 21: "DDR2", 24: "DDR3", 26: "DDR4", 34: "DDR5", 35: "DDR5"}


def _cpu_info(c) -> dict:
    name = platform.processor() or ""
    if c is not None:
        try:
            cpus = c.Win32_Processor()
            if cpus:
                name = (cpus[0].Name or name).strip()
        except Exception:
            pass
    return {
        "name": name or "Unknown CPU",
        "cores_physical": psutil.cpu_count(logical=False),
        "cores_logical": psutil.cpu_count(logical=True),
    }


def _ram_info(c) -> dict:
    total_gb = round(psutil.virtual_memory().total / (1024 ** 3), 1)
    ddr = None
    speed = None
    if c is not None:
        try:
            mods = c.Win32_PhysicalMemory()
            if mods:
                t = getattr(mods[0], "SMBIOSMemoryType", None)
                ddr = _DDR.get(int(t)) if t is not None else None
                sp = getattr(mods[0], "Speed", None)
                speed = int(sp) if sp else None
        except Exception:
            pass
    return {"total_gb": total_gb, "type": ddr, "speed_mhz": speed}


def _gpu_info(c) -> dict:
    name = None
    if c is not None:
        try:
            gpus = c.Win32_VideoController()
            names = [g.Name.strip() for g in gpus if getattr(g, "Name", None)]
            # prefer a discrete GPU name over basic display adapters
            disc = [n for n in names if not any(k in n.lower() for k in ("basic", "microsoft"))]
            name = (disc or names or [None])[0]
        except Exception:
            pass
    return {"name": name or "Unknown GPU"}


def _disk_info() -> dict:
    total = 0
    try:
        for p in psutil.disk_partitions(all=False):
            try:
                total += psutil.disk_usage(p.mountpoint).total
            except Exception:
                continue
    except Exception:
        pass
    return {"total_gb": round(total / (1024 ** 3)) if total else None}


def _board_info(c) -> dict:
    if c is not None:
        try:
            b = c.Win32_BaseBoard()
            if b:
                return {"name": f"{(b[0].Manufacturer or '').strip()} {(b[0].Product or '').strip()}".strip() or None}
        except Exception:
            pass
    return {"name": None}


def _utilization() -> dict:
    """Recent peak/avg per resource (last hour) to drive relevance ranking."""
    rows = db.recent_metrics(3600)
    out = {"cpu": 0.0, "mem": 0.0, "disk": 0.0}
    if rows:
        for k in out:
            vals = [r[k] for r in rows if r.get(k) is not None]
            if vals:
                # blend of average and peak so a sustained-high part ranks up
                out[k] = round(0.5 * (sum(vals) / len(vals)) + 0.5 * max(vals), 1)
    else:
        latest = monitor.latest()
        for k in out:
            out[k] = round(latest.get(k, 0.0), 1)
    return out


def inventory() -> dict:
    """Full best-effort inventory. Maps to manifest categories where possible."""
    c = _wmi()
    cpu = _cpu_info(c)
    ram = _ram_info(c)
    gpu = _gpu_info(c)
    disk = _disk_info()
    board = _board_info(c)
    util = _utilization()

    # current part summary keyed by manifest category id
    current = {
        "cpu": cpu["name"],
        "gpu": gpu["name"],
        "ram": f"{ram['total_gb']} GB" + (f" {ram['type']}" if ram["type"] else "") + (f" @ {ram['speed_mhz']}MHz" if ram["speed_mhz"] else ""),
        "storage": f"{disk['total_gb']} GB total" if disk["total_gb"] else None,
        "motherboard": board["name"],
    }

    # relevance score per category (higher = more worth upgrading)
    relevance = {
        "cpu": util["cpu"],
        "gpu": max(util["cpu"], util["mem"]) * 0.6,  # no direct GPU metric; proxy
        "ram": util["mem"],
        "storage": util["disk"],
        "motherboard": 0.0,
        "psu": 0.0,
        "cooler": util["cpu"] * 0.4,
    }

    # sensor-driven boosts: a hot CPU makes the cooler relevant; a failing or
    # worn disk makes storage urgent. Detection is deterministic (sensors.py);
    # this only re-ranks what the Upgrades tab already shows.
    sens = sensors.read()
    cpu_temp = (sens.get("cpu") or {}).get("temp_c")
    if cpu_temp is not None:
        if cpu_temp >= 85.0:
            relevance["cooler"] = max(relevance["cooler"], 90.0)
        elif cpu_temp >= 75.0:
            relevance["cooler"] = max(relevance["cooler"], 60.0)
    disks = sens.get("disks", [])
    if any(d["health"] not in ("Healthy", "Unknown") for d in disks):
        relevance["storage"] = 100.0
    elif any((d.get("wear_pct") or 0) >= 80 for d in disks):
        relevance["storage"] = max(relevance["storage"], 85.0)

    return {
        "sensors": sens,
        "os": f"{platform.system()} {platform.release()}",
        "wmi": c is not None,
        "cpu": cpu,
        "ram": ram,
        "gpu": gpu,
        "disk": disk,
        "motherboard": board,
        "utilization": util,
        "current": current,
        "relevance": relevance,
    }
