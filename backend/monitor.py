"""AROK Monitor — metric sampling and anomaly detection.

Detection is fully deterministic (LLM narrator pattern): z-score over a
rolling window PLUS an absolute-threshold safety net so flat baselines
still trigger (v3 bugfix).
"""
import statistics
import threading
import time
from collections import deque

import psutil

import db

SAMPLE_INTERVAL = 3  # seconds
WINDOW = 60          # samples in rolling window for z-score

# Absolute-threshold safety net (percent / counts)
ABS_THRESHOLDS = {
    "cpu": 90.0,
    "mem": 90.0,
    "disk": 95.0,
}
Z_THRESHOLD = 3.0

_history = {k: deque(maxlen=WINDOW) for k in ("cpu", "mem", "disk")}
_last_net = None
_latest = {}
_lock = threading.Lock()


def snapshot() -> dict:
    global _last_net
    cpu = psutil.cpu_percent(interval=None)
    mem = psutil.virtual_memory().percent
    try:
        disk = psutil.disk_usage("/").percent
    except Exception:
        disk = 0.0
    net = psutil.net_io_counters()
    now = time.time()
    if _last_net is None:
        sent_rate = recv_rate = 0.0
    else:
        dt = max(now - _last_net[0], 1e-6)
        sent_rate = max(0.0, (net.bytes_sent - _last_net[1]) / dt)
        recv_rate = max(0.0, (net.bytes_recv - _last_net[2]) / dt)
    _last_net = (now, net.bytes_sent, net.bytes_recv)
    return {
        "ts": now,
        "cpu": cpu,
        "mem": mem,
        "disk": disk,
        "net_sent": sent_rate,
        "net_recv": recv_rate,
        "proc_count": len(psutil.pids()),
    }


def detect_anomalies(snap: dict):
    """Deterministic detection: z-score + absolute threshold safety net."""
    alerts = []
    for metric in ("cpu", "mem", "disk"):
        value = snap[metric]
        hist = _history[metric]

        # absolute-threshold safety net (catches flat-baseline cases)
        if value >= ABS_THRESHOLDS[metric]:
            alerts.append(("critical", metric, f"{metric.upper()} at {value:.1f}% — above absolute threshold {ABS_THRESHOLDS[metric]:.0f}%", value))
        elif len(hist) >= 12:
            mean = statistics.fmean(hist)
            stdev = statistics.pstdev(hist)
            if stdev > 0.5:  # ignore near-flat baselines for z-score
                z = (value - mean) / stdev
                if z >= Z_THRESHOLD:
                    alerts.append(("warning", metric, f"{metric.upper()} spiked to {value:.1f}% (z={z:.1f}, baseline {mean:.1f}%)", value))
        hist.append(value)
    return alerts


# Capture a process snapshot every Nth sample (~every 15s at 3s interval) so the
# Analytics drill-down can show what was driving utilization at a past moment,
# without bloating the DB on every tick.
SNAPSHOT_EVERY = 5


def _proc_snapshot_payload(limit: int = 20):
    procs = top_processes(limit)
    return [
        {
            "pid": p.get("pid"),
            "name": p.get("name"),
            "cpu": round(p.get("cpu_percent") or 0.0, 1),
            "mem": round(p.get("memory_percent") or 0.0, 1),
        }
        for p in procs
    ]


def sampler_loop(stop: threading.Event):
    psutil.cpu_percent(interval=None)  # prime
    tick = 0
    while not stop.is_set():
        snap = snapshot()
        with _lock:
            _latest.clear()
            _latest.update(snap)
        db.insert_metric(snap)
        for severity, metric, message, value in detect_anomalies(snap):
            db.insert_alert(severity, metric, message, value)
        if tick % SNAPSHOT_EVERY == 0:
            try:
                db.insert_proc_snapshot(snap["ts"], _proc_snapshot_payload())
            except Exception:
                pass
        tick += 1
        stop.wait(SAMPLE_INTERVAL)


def latest() -> dict:
    with _lock:
        return dict(_latest) if _latest else snapshot()


def top_processes(limit: int = 25):
    procs = []
    for p in psutil.process_iter(["pid", "name", "username", "cpu_percent", "memory_percent", "status"]):
        try:
            procs.append(p.info)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    procs.sort(key=lambda x: (x.get("cpu_percent") or 0, x.get("memory_percent") or 0), reverse=True)
    return procs[:limit]


def connections(limit: int = 50):
    conns = []
    try:
        raw = psutil.net_connections(kind="inet")
    except Exception:
        raw = []
    for c in raw[:limit * 2]:
        try:
            conns.append({
                "fd": c.fd,
                "pid": c.pid,
                "proc": psutil.Process(c.pid).name() if c.pid else None,
                "laddr": f"{c.laddr.ip}:{c.laddr.port}" if c.laddr else "",
                "raddr": f"{c.raddr.ip}:{c.raddr.port}" if c.raddr else "",
                "status": c.status,
            })
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
        if len(conns) >= limit:
            break
    return conns


def services():
    """Windows services via psutil; graceful empty list elsewhere."""
    out = []
    if hasattr(psutil, "win_service_iter"):
        try:
            for s in psutil.win_service_iter():
                try:
                    out.append({
                        "name": s.name(),
                        "display_name": s.display_name(),
                        "status": s.status(),
                        "start_type": s.start_type(),
                    })
                except Exception:
                    continue
        except Exception:
            pass
    return out


# ---------- drill-down detail ----------

def detail(metric: str) -> dict:
    """Rich per-metric detail for the dashboard drill-down modals."""
    if metric == "cpu":
        freq = None
        try:
            f = psutil.cpu_freq()
            freq = f._asdict() if f else None
        except Exception:
            pass
        return {
            "percpu": psutil.cpu_percent(percpu=True),
            "freq": freq,
            "cores_physical": psutil.cpu_count(logical=False),
            "cores_logical": psutil.cpu_count(),
            "stats": psutil.cpu_stats()._asdict(),
            "top": top_processes(8),
        }
    if metric == "mem":
        procs = top_processes(40)
        procs.sort(key=lambda p: p.get("memory_percent") or 0, reverse=True)
        return {
            "virtual": psutil.virtual_memory()._asdict(),
            "swap": psutil.swap_memory()._asdict(),
            "top": procs[:8],
        }
    if metric == "disk":
        parts = []
        for p in psutil.disk_partitions(all=False):
            try:
                u = psutil.disk_usage(p.mountpoint)
                parts.append({
                    "device": p.device, "mount": p.mountpoint, "fstype": p.fstype,
                    "total": u.total, "used": u.used, "free": u.free, "percent": u.percent,
                })
            except Exception:
                continue
        io = None
        try:
            i = psutil.disk_io_counters()
            io = i._asdict() if i else None
        except Exception:
            pass
        return {"partitions": parts, "io": io}
    if metric == "net":
        try:
            nics = {k: v._asdict() for k, v in psutil.net_io_counters(pernic=True).items()}
        except Exception:
            nics = {}
        return {"nics": nics, "connection_count": len(connections(500))}
    if metric == "proc":
        by_status = {}
        for p in psutil.process_iter(["status"]):
            try:
                s = p.info["status"] or "unknown"
                by_status[s] = by_status.get(s, 0) + 1
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        return {"total": len(psutil.pids()), "by_status": by_status, "top": top_processes(8)}
    return {}
