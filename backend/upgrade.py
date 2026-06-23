"""AROK Monitor — in-app license upgrade flow.

Browser-based checkout: AROK opens the purchase page with a session token
embedded in the URL. The purchase server issues a signed license and POSTs
it back via /api/upgrade/receive (or the client polls /api/upgrade/status).
In demo mode a key is synthesised locally after a brief delay so the full
UX can be shown without a live server.

Endpoints (wired in main.py):
  POST /api/upgrade/start              → {token, url, status}
  GET  /api/upgrade/status/{token}     → {status, license?}
  POST /api/upgrade/receive            → reference server webhook
  POST /api/upgrade/cancel/{token}
"""
import json
import os
import secrets
import threading
import time
import webbrowser

import db

CHECKOUT_URL = os.environ.get("AROK_CHECKOUT_URL", "https://arok.ai/upgrade")
DEMO = os.environ.get("AROK_DEMO", "1") == "1"

_sessions: dict[str, dict] = {}
_lock = threading.Lock()


def start_session(name: str = "", email: str = "") -> dict:
    """Open the browser to checkout and return a session token to poll."""
    token = secrets.token_urlsafe(24)
    with _lock:
        _sessions[token] = {
            "token": token,
            "status": "pending",
            "started": time.time(),
            "key": None,
        }
    url = f"{CHECKOUT_URL}?session={token}"
    if name:
        url += f"&name={name}"
    if email:
        url += f"&email={email}"
    webbrowser.open(url)
    db.log_event("upgrade", f"session started token={token[:8]}…")
    if DEMO:
        # Simulate the server delivering a key after ~6 seconds for demo UX.
        threading.Thread(target=_demo_issue_after, args=(token, 6), daemon=True).start()
    return {"token": token, "url": url, "status": "pending"}


def poll_session(token: str) -> dict:
    """Poll upgrade status. Auto-activates once a key arrives."""
    with _lock:
        s = dict(_sessions.get(token) or {})
    if not s:
        return {"status": "unknown", "token": token}
    if s["status"] in ("activated", "failed", "cancelled"):
        return {"status": s["status"], "token": token}
    if s["status"] == "issued" and s.get("key"):
        import licensing
        result = licensing.activate(s["key"])
        if result.get("licensed"):
            _set_status(token, "activated")
            db.log_event("upgrade", f"license auto-activated token={token[:8]}…")
            return {"status": "activated", "license": result}
        # Demo fallback: synthetic activation when no real pub-key is set up.
        if DEMO:
            synth = {
                "licensed": True, "reason": "demo",
                "name": "AROK Pro User", "email": "demo@arok.ai", "expires": None,
            }
            _set_status(token, "activated")
            db.log_event("upgrade", "demo upgrade activated (synthetic)")
            return {"status": "activated", "license": synth}
        _set_status(token, "failed")
        return {"status": "failed", "detail": result.get("reason", "activation failed")}
    return {"status": s["status"], "token": token}


def receive_license(token: str, key: str) -> dict:
    """Called by the purchase server webhook when a license is ready."""
    with _lock:
        if token not in _sessions:
            return {"ok": False, "detail": "unknown session"}
        _sessions[token]["status"] = "issued"
        _sessions[token]["key"] = key
    db.log_event("upgrade", f"license received token={token[:8]}…")
    return {"ok": True}


def cancel_session(token: str) -> dict:
    _set_status(token, "cancelled")
    return {"ok": True}


def _set_status(token: str, status: str):
    with _lock:
        if token in _sessions:
            _sessions[token]["status"] = status


def _demo_issue_after(token: str, delay: float):
    time.sleep(delay)
    receive_license(token, _demo_placeholder_key())


def _demo_placeholder_key() -> str:
    """A structurally-valid placeholder key for the demo UX.
    It won't pass Ed25519 verification unless a real keypair is present,
    so the synthetic activation path in poll_session() handles it gracefully."""
    import base64
    payload = base64.urlsafe_b64encode(json.dumps({
        "name": "AROK Pro User",
        "email": "demo@arok.ai",
        "expires": None,
        "tier": "pro",
    }).encode()).rstrip(b"=").decode()
    sig = base64.urlsafe_b64encode(b"DEMO_SIGNATURE").rstrip(b"=").decode()
    return f"{payload}.{sig}"
