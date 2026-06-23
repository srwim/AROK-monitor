"""AROK Monitor - offline license verification (Ed25519).

Key format:  base64url(payload-json) . base64url(signature)
Payload:     {"name": ..., "email": ..., "expires": "YYYY-MM-DD" | null, "tier": "pro"}

Fully offline: the app ships only the PUBLIC key; licenses are signed
with the private key via generate_license.py (never distributed).
Unlicensed installs keep working in demo/trial mode - verification only
gates the "licensed" badge (and whatever the product later locks).
"""
import base64
import datetime
import json
import os
import sys

import db


def _crypto():
    """Lazy import: a missing cryptography lib degrades licensing
    gracefully ("licensing unavailable") instead of crashing the app."""
    try:
        from cryptography.exceptions import InvalidSignature
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        return InvalidSignature, Ed25519PublicKey
    except ImportError:
        return None, None


def _pub_path() -> str:
    here = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.environ.get("AROK_LICENSE_PUB", os.path.join(here, "license_pub.hex"))


def _public_key():
    _, Ed25519PublicKey = _crypto()
    if Ed25519PublicKey is None:
        return None
    p = _pub_path()
    if not os.path.exists(p):
        return None
    raw = bytes.fromhex(open(p).read().strip())
    return Ed25519PublicKey.from_public_bytes(raw)


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def verify(key: str) -> dict:
    """Verify a license key string. Returns {valid, reason, payload}."""
    InvalidSignature, Ed25519PublicKey = _crypto()
    if Ed25519PublicKey is None:
        return {"valid": False, "reason": "licensing unavailable (cryptography not installed)", "payload": None}
    pub = _public_key()
    if pub is None:
        return {"valid": False, "reason": "no public key installed", "payload": None}
    try:
        payload_b64, sig_b64 = key.strip().split(".")
        payload_raw = _b64d(payload_b64)
        pub.verify(_b64d(sig_b64), payload_raw)
        payload = json.loads(payload_raw)
    except InvalidSignature:
        return {"valid": False, "reason": "invalid signature", "payload": None}
    except Exception:
        return {"valid": False, "reason": "malformed key", "payload": None}
    exp = payload.get("expires")
    if exp:
        try:
            if datetime.date.fromisoformat(exp) < datetime.date.today():
                return {"valid": False, "reason": f"expired {exp}", "payload": payload}
        except ValueError:
            return {"valid": False, "reason": "bad expiry date", "payload": payload}
    return {"valid": True, "reason": "ok", "payload": payload}


def activate(key: str) -> dict:
    r = verify(key)
    if r["valid"]:
        db.set_setting("license_key", key.strip())
        db.log_event("license", f"activated for {r['payload'].get('name', '?')}")
    return status() if r["valid"] else {**status(), "reason": r["reason"]}


def deactivate():
    db.set_setting("license_key", "")
    db.log_event("license", "deactivated")
    return status()


def status() -> dict:
    key = db.get_setting("license_key", "")
    if not key:
        return {"licensed": False, "reason": "no license installed", "name": None, "email": None, "expires": None}
    r = verify(key)
    p = r.get("payload") or {}
    return {
        "licensed": r["valid"],
        "reason": r["reason"],
        "name": p.get("name"),
        "email": p.get("email"),
        "expires": p.get("expires"),
    }
