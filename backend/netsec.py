"""AROK Monitor — network connection intelligence.

Deterministic risk scoring for live network connections (LLM-narrator rule:
detection is 100% here, the model only ever narrates). Each external
connection is scored 0–100 from transparent, explainable heuristics; anything
at or above SUSPICIOUS_SCORE is surfaced as a finding unless the user has
flagged that endpoint safe.

Signals (each contributes points + a human reason):
  * remote port reputation — known RAT/backdoor/mining/IRC ports score high;
    plain web ports (80/443) score nothing.
  * process location — an executable running from Temp/AppData/Downloads is a
    classic malware tell; system-path processes are trusted.
  * process identity — unnamed/unknown owning process on an external socket.
  * listener exposure — LISTENing on 0.0.0.0 (all interfaces) on a non-standard
    port is an inbound-exposure risk.
  * address class — established links to public IPs are the ones worth judging;
    loopback/LAN are ignored.

Safe-list: the user can flag an endpoint (keyed by process + remote IP) as
safe. Safe endpoints are excluded from findings and recorded in a separate
"safe connections" log (a settings-backed JSON store — no schema change).
Nothing here raises; every failure degrades to "no signal".
"""
from __future__ import annotations

import ipaddress
import json
import os
import socket
import threading
import time

import db

SUSPICIOUS_SCORE = 50           # >= this => a finding (unless flagged safe)
_SAFE_KEY = "netsec_safelist"   # settings key: JSON {key: {proc, ip, flaggedAt}}

# Remote-port reputation. Ports commonly used by remote-access trojans,
# botnets, cryptominers and IRC C2. Not exhaustive — a signal, not a verdict.
_BAD_PORTS: dict[int, str] = {
    23: "Telnet (unencrypted remote shell)",
    445: "SMB exposed to a public host",
    1080: "SOCKS proxy (common malware relay)",
    1337: "port 1337 (common backdoor)",
    3389: "RDP exposed to a public host",
    4444: "port 4444 (Metasploit/RAT default)",
    4899: "Radmin remote-control",
    5555: "port 5555 (ADB/backdoor)",
    6660: "IRC (botnet C2)", 6661: "IRC (botnet C2)", 6662: "IRC (botnet C2)",
    6663: "IRC (botnet C2)", 6664: "IRC (botnet C2)", 6665: "IRC (botnet C2)",
    6666: "IRC (botnet C2)", 6667: "IRC (botnet C2)", 6668: "IRC (botnet C2)",
    6669: "IRC (botnet C2)",
    3333: "port 3333 (mining pool)", 4028: "cryptominer API",
    5900: "VNC remote desktop",
    9001: "Tor relay port", 9030: "Tor directory port",
    31337: "port 31337 (elite/backdoor)",
}
# Standard, expected outbound ports — explicitly zero-risk.
_GOOD_PORTS = {80, 443, 53, 123, 993, 995, 587, 465, 22}

# Process executable path fragments that indicate a non-system binary.
_RISKY_PATH_HINTS = ("\\temp\\", "\\tmp\\", "\\appdata\\local\\temp\\",
                     "\\downloads\\", "\\windows\\temp\\", "/tmp/")


def _addr_parts(addr: str) -> tuple[str, int | None]:
    """Split 'ip:port' (IPv4/IPv6) into (ip, port)."""
    if not addr:
        return "", None
    host, _, port = addr.rpartition(":")
    if host.startswith("[") and host.endswith("]"):
        host = host[1:-1]
    try:
        return host, int(port)
    except ValueError:
        return addr, None


def _is_public(ip: str) -> bool:
    try:
        a = ipaddress.ip_address(ip)
        return not (a.is_private or a.is_loopback or a.is_link_local
                    or a.is_multicast or a.is_reserved or a.is_unspecified)
    except ValueError:
        return False


def endpoint_key(proc: str | None, raddr_ip: str) -> str:
    """Stable identity for the safe-list: process + remote host (ports rotate)."""
    return f"{(proc or '?').lower()}|{raddr_ip}"


# ---------- safe-list ----------

def _load_safe() -> dict:
    try:
        return json.loads(db.get_setting(_SAFE_KEY) or "{}")
    except Exception:
        return {}


def _save_safe(d: dict) -> None:
    db.set_setting(_SAFE_KEY, json.dumps(d))


def flag_safe(proc: str | None, ip: str, note: str = "") -> dict:
    safe = _load_safe()
    key = endpoint_key(proc, ip)
    safe[key] = {"proc": proc or "?", "ip": ip, "note": note,
                 "flaggedAt": time.time()}
    _save_safe(safe)
    db.log_event("netsec", f"flagged safe: {proc or '?'} -> {ip}"
                 + (f" ({note})" if note else ""))
    return {"ok": True, "key": key}


def unflag_safe(key: str) -> dict:
    safe = _load_safe()
    removed = safe.pop(key, None)
    if removed is not None:
        _save_safe(safe)
        db.log_event("netsec", f"un-flagged: {removed.get('proc','?')} -> {removed.get('ip','?')}")
    return {"ok": removed is not None}


def safe_list() -> list[dict]:
    return sorted(_load_safe().values(), key=lambda e: e.get("flaggedAt", 0), reverse=True)


# ---------- scoring ----------

def _proc_path(pid: int | None) -> str:
    if not pid:
        return ""
    try:
        import psutil
        return (psutil.Process(pid).exe() or "").lower()
    except Exception:
        return ""


def _score(conn: dict) -> tuple[int, list[str]]:
    """Return (risk 0..100, reasons) for one raw connection dict."""
    reasons: list[str] = []
    score = 0
    raddr_ip, raddr_port = _addr_parts(conn.get("raddr", ""))
    laddr_ip, laddr_port = _addr_parts(conn.get("laddr", ""))
    status = conn.get("status", "")
    proc = conn.get("proc")

    # Inbound exposure: listening on all interfaces on a non-standard port.
    if status == "LISTEN" and laddr_ip in ("0.0.0.0", "::") and laddr_port not in _GOOD_PORTS:
        if laddr_port in _BAD_PORTS:
            score += 60
            reasons.append(f"Listening on all interfaces — {_BAD_PORTS[laddr_port]}")
        elif laddr_port and laddr_port < 49152:
            score += 20
            reasons.append(f"Listening on all interfaces (port {laddr_port})")

    # Established/outbound risk only matters for public remote hosts.
    if raddr_ip and _is_public(raddr_ip):
        if raddr_port in _BAD_PORTS:
            score += 50
            reasons.append(f"Remote {raddr_port}: {_BAD_PORTS[raddr_port]}")
        elif raddr_port and raddr_port not in _GOOD_PORTS and raddr_port >= 1024:
            score += 10
            reasons.append(f"Uncommon remote port {raddr_port}")

        path = _proc_path(conn.get("pid"))
        if path and any(h in path for h in _RISKY_PATH_HINTS):
            score += 40
            reasons.append("Process runs from a temp/download folder")
        if not proc:
            score += 20
            reasons.append("Unknown owning process")

    return min(score, 100), reasons


def _severity(score: int) -> str:
    if score >= 75:
        return "critical"
    if score >= SUSPICIOUS_SCORE:
        return "warn"
    return "info"


def assess(conns: list[dict]) -> dict:
    """Enrich raw connections with risk scoring and safe-list state.

    Returns {connections, suspicious, safeCount, threshold}. Each connection
    gains: risk, severity, reasons[], safe(bool), key.
    """
    safe = _load_safe()
    out: list[dict] = []
    suspicious = 0
    safe_seen = 0
    for c in conns:
        raddr_ip, _ = _addr_parts(c.get("raddr", ""))
        key = endpoint_key(c.get("proc"), raddr_ip) if raddr_ip else ""
        is_safe = key in safe
        score, reasons = _score(c)
        if is_safe:
            safe_seen += 1
        elif score >= SUSPICIOUS_SCORE:
            suspicious += 1
        out.append({
            **c,
            "risk": score,
            "severity": _severity(score),
            "reasons": reasons,
            "safe": is_safe,
            "key": key,
        })
    # Highest risk first, then established over listening/other.
    out.sort(key=lambda c: (c["safe"], -c["risk"], c.get("status") != "ESTABLISHED"))
    return {
        "connections": out,
        "suspicious": suspicious,
        "safeCount": safe_seen,
        "threshold": SUSPICIOUS_SCORE,
    }


# ---------- investigation (drill-down on one remote IP) ----------

_PORT_NAMES = {
    22: "SSH", 25: "SMTP", 53: "DNS", 80: "HTTP", 110: "POP3", 123: "NTP",
    143: "IMAP", 443: "HTTPS", 445: "SMB", 465: "SMTPS", 587: "SMTP",
    993: "IMAPS", 995: "POP3S", 1433: "MSSQL", 3306: "MySQL", 3389: "RDP",
    5432: "PostgreSQL", 5900: "VNC", 6379: "Redis", 8080: "HTTP-alt",
    8443: "HTTPS-alt", 27017: "MongoDB",
}

_dns_lock = threading.Lock()
_dns_cache: dict[str, tuple[float, str | None]] = {}
_DNS_TTL = 900.0


def _rdns(ip: str) -> str | None:
    """Best-effort reverse DNS with a short cache; None on failure/timeout."""
    now = time.time()
    with _dns_lock:
        hit = _dns_cache.get(ip)
        if hit and now - hit[0] < _DNS_TTL:
            return hit[1]
    host = None
    try:
        socket.setdefaulttimeout(0.6)
        host = socket.gethostbyaddr(ip)[0]
    except Exception:
        host = None
    finally:
        socket.setdefaulttimeout(None)
    with _dns_lock:
        _dns_cache[ip] = (now, host)
    return host


def investigate(ip: str) -> dict:
    """Everything AROK can say about one remote IP without leaving the machine:
    reverse-DNS name, the services implied by its ports, its risk reasons, and
    every local process currently connected to it."""
    ip = (ip or "").strip()
    if ip.startswith("[") and ip.endswith("]"):
        ip = ip[1:-1]
    if not ip:
        return {"ok": False, "detail": "no ip"}
    import monitor  # local import avoids an import cycle at load
    host = _rdns(ip) if _is_public(ip) else None
    peers: list[dict] = []
    ports: set[int] = set()
    worst = 0
    reasons: list[str] = []
    for c in monitor.connections(400):
        r_ip, r_port = _addr_parts(c.get("raddr", ""))
        if r_ip != ip:
            continue
        if r_port is not None:
            ports.add(r_port)
        score, why = _score(c)
        if score > worst:
            worst, reasons = score, why
        peers.append({
            "proc": c.get("proc"), "pid": c.get("pid"),
            "laddr": c.get("laddr"), "raddr": c.get("raddr"),
            "status": c.get("status"),
        })
    services = sorted({_PORT_NAMES.get(p, f"port {p}") for p in ports})
    key = endpoint_key(peers[0]["proc"] if peers else None, ip)
    return {
        "ok": True,
        "ip": ip,
        "hostname": host,
        "public": _is_public(ip),
        "safe": key in _load_safe(),
        "risk": worst,
        "reasons": reasons,
        "services": services,
        "ports": sorted(ports),
        "connectionCount": len(peers),
        "processes": peers,
    }


def findings(conns: list[dict]) -> list[dict]:
    """Deterministic suspicious-connection findings for the alerts pipeline —
    one per unflagged endpoint at or above the threshold."""
    result = assess(conns)
    out: list[dict] = []
    seen: set[str] = set()
    for c in result["connections"]:
        if c["safe"] or c["risk"] < SUSPICIOUS_SCORE or c["key"] in seen:
            continue
        seen.add(c["key"])
        raddr = c.get("raddr", "?")
        out.append({
            "kind": "suspicious_connection",
            "severity": c["severity"],
            "risk": c["risk"],
            "key": c["key"],
            "message": f"{c.get('proc') or 'Unknown process'} → {raddr} "
                       f"(risk {c['risk']}): {'; '.join(c['reasons']) or 'flagged by heuristics'}",
        })
    return out
