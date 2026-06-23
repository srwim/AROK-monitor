"""AROK Monitor — SQLite persistence layer.

Stores rolling metric snapshots, alerts, and event logs.
VACUUM is run OUTSIDE any transaction (v3 bugfix).
"""
import json
import os
import sqlite3
import sys
import threading
import time


def _default_db_path() -> str:
    if getattr(sys, "frozen", False):
        # packaged app: install dir may be read-only — use per-user app data
        base = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "AROK")
        os.makedirs(base, exist_ok=True)
        return os.path.join(base, "arok.db")
    return os.path.join(os.path.dirname(__file__), "arok.db")


DB_PATH = os.environ.get("AROK_DB", _default_db_path())
_lock = threading.Lock()


def _conn():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init():
    with _lock, _conn() as c:
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS metrics (
                ts REAL NOT NULL,
                cpu REAL, mem REAL, disk REAL,
                net_sent REAL, net_recv REAL,
                proc_count INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_metrics_ts ON metrics(ts);
            CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts REAL NOT NULL,
                severity TEXT NOT NULL,
                metric TEXT NOT NULL,
                message TEXT NOT NULL,
                value REAL,
                acked INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts REAL NOT NULL,
                kind TEXT NOT NULL,
                detail TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            );
            CREATE TABLE IF NOT EXISTS proc_snapshots (
                ts REAL NOT NULL,
                data TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_proc_ts ON proc_snapshots(ts);
            """
        )


def insert_metric(snapshot: dict):
    with _lock, _conn() as c:
        c.execute(
            "INSERT INTO metrics (ts, cpu, mem, disk, net_sent, net_recv, proc_count) VALUES (?,?,?,?,?,?,?)",
            (
                snapshot["ts"], snapshot["cpu"], snapshot["mem"], snapshot["disk"],
                snapshot["net_sent"], snapshot["net_recv"], snapshot["proc_count"],
            ),
        )


def recent_metrics(seconds: int = 3600):
    cutoff = time.time() - seconds
    with _lock, _conn() as c:
        rows = c.execute("SELECT * FROM metrics WHERE ts >= ? ORDER BY ts", (cutoff,)).fetchall()
    return [dict(r) for r in rows]


def insert_alert(severity: str, metric: str, message: str, value: float):
    with _lock, _conn() as c:
        c.execute(
            "INSERT INTO alerts (ts, severity, metric, message, value) VALUES (?,?,?,?,?)",
            (time.time(), severity, metric, message, value),
        )


def recent_alerts(limit: int = 100):
    with _lock, _conn() as c:
        rows = c.execute("SELECT * FROM alerts ORDER BY ts DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) for r in rows]


def ack_alert(alert_id: int):
    with _lock, _conn() as c:
        c.execute("UPDATE alerts SET acked = 1 WHERE id = ?", (alert_id,))


def clear_alert(alert_id: int) -> int:
    """Remove a single alert. Returns rows deleted."""
    with _lock, _conn() as c:
        cur = c.execute("DELETE FROM alerts WHERE id = ?", (alert_id,))
        return cur.rowcount


def clear_all_alerts() -> int:
    """Remove every alert. Returns rows deleted."""
    with _lock, _conn() as c:
        cur = c.execute("DELETE FROM alerts")
        return cur.rowcount


def insert_proc_snapshot(ts: float, procs: list):
    """Store a point-in-time list of top processes (for Analytics drill-down)."""
    with _lock, _conn() as c:
        c.execute("INSERT INTO proc_snapshots (ts, data) VALUES (?,?)", (ts, json.dumps(procs)))


def nearest_proc_snapshot(ts: float, max_skew: float = 90.0):
    """Return the process snapshot closest to `ts` (within max_skew seconds)."""
    with _lock, _conn() as c:
        row = c.execute(
            "SELECT ts, data FROM proc_snapshots WHERE ABS(ts - ?) <= ? ORDER BY ABS(ts - ?) LIMIT 1",
            (ts, max_skew, ts),
        ).fetchone()
    if not row:
        return None
    return {"ts": row["ts"], "procs": json.loads(row["data"])}


def log_event(kind: str, detail: str):
    with _lock, _conn() as c:
        c.execute("INSERT INTO events (ts, kind, detail) VALUES (?,?,?)", (time.time(), kind, detail))


def recent_events(limit: int = 200):
    with _lock, _conn() as c:
        rows = c.execute("SELECT * FROM events ORDER BY ts DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) for r in rows]


def purge(older_than_seconds: int = 0):
    """Manual log purge. NOTE: VACUUM must run outside the transaction —
    sqlite3 auto-commits before VACUUM only if no transaction is open (v3 bugfix)."""
    cutoff = time.time() - older_than_seconds
    with _lock:
        with _conn() as c:
            cur = c.execute("DELETE FROM metrics WHERE ts < ?", (cutoff,))
            n1 = cur.rowcount
            cur = c.execute("DELETE FROM events WHERE ts < ?", (cutoff,))
            n2 = cur.rowcount
            c.execute("DELETE FROM proc_snapshots WHERE ts < ?", (cutoff,))
        # fresh connection, autocommit mode, no open transaction
        v = sqlite3.connect(DB_PATH)
        v.isolation_level = None
        v.execute("VACUUM")
        v.close()
    return {"metrics_purged": n1, "events_purged": n2}


def get_setting(key: str, default=None):
    with _lock, _conn() as c:
        row = c.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(key: str, value: str):
    with _lock, _conn() as c:
        c.execute(
            "INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
