"""Open Icecat product-image lookup — tier 2 of the thumbnail resolution.

Thumbnail tiers for a build component:
  1. a manually curated image URL in the manifest (highest priority)
  2. Open Icecat, looked up by brand + manufacturer part number (this module)
  3. nothing -> the app renders a category icon

This module is INERT unless ICECAT_SHOPNAME is set (your free Open Icecat
username). Without credentials, ``image_for`` returns None so the build falls
straight through to the category icon. It never raises.

Auth: pass your Open Icecat username as the shopname plus an API token — the
recommended method. (The legacy static app_key needs IP allow-listing and a
Full Icecat plan, so it won't work from CI.) Generate a free API token at
My Icecat > Access Tokens (https://icecat.biz/myIcecat/accessTokens) and store
GitHub Actions secrets ICECAT_SHOPNAME (your username) and ICECAT_API_TOKEN. A
Content token (ICECAT_CONTENT_TOKEN) is optional — only Full Icecat media needs
it; open-catalog images are public.

Response shape (Icecat LIVE JSON): ``data.Image.{Pic500x500,LowPic,HighPic,
ThumbPic}``. We prefer the 500px image, then 200px, then original, then the
first Gallery entry. Verify against a real response on the first authenticated
run — an unexpected shape just yields None (a safe miss), never an error.
"""
from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request

SHOPNAME = os.environ.get("ICECAT_SHOPNAME", "")
API_TOKEN = os.environ.get("ICECAT_API_TOKEN", "")          # recommended (header auth)
CONTENT_TOKEN = os.environ.get("ICECAT_CONTENT_TOKEN", "")  # optional, Full Icecat media
APP_KEY = os.environ.get("ICECAT_APP_KEY", "")              # legacy; needs IP whitelisting
_BASE = "https://live.icecat.biz/api"

# Preferred image size order: 500px is a good card thumbnail; fall back down.
_SIZES = ("Pic500x500", "LowPic", "HighPic", "ThumbPic")

# Never let a credential ride along in a committed image URL. Open-catalog images
# are token-free, but Full Icecat media can carry a content_token — strip any such
# param so a secret can never leak into the manifest.
_TOKEN_PARAMS = frozenset({"content_token", "api_token", "app_key", "apikey", "token"})


def _clean(url: str | None) -> str | None:
    """Drop any token-like query params from an image URL (defense in depth)."""
    if not url or "?" not in url:
        return url
    base, _, query = url.partition("?")
    kept = [kv for kv in query.split("&") if kv.split("=", 1)[0].lower() not in _TOKEN_PARAMS]
    return base + ("?" + "&".join(kept) if kept else "")


def _pick(image: dict) -> str | None:
    for key in _SIZES:
        url = image.get(key)
        if url:
            return _clean(url)
    return None


def image_for(brand: str, mpn: str, lang: str = "EN") -> str | None:
    """Open Icecat image URL for a brand + MPN, or None.

    Returns None on missing credentials, an unknown product, an Icecat error
    payload, or any network/parse failure — the caller then falls back to the
    category icon.
    """
    if not (SHOPNAME and brand and mpn and (API_TOKEN or APP_KEY)):
        return None
    params = {
        "lang": lang,
        "shopname": SHOPNAME,
        "Brand": brand,
        "ProductCode": mpn,
        "content": "image,gallery",
    }
    if APP_KEY:  # legacy query-param auth (needs IP whitelisting)
        params["app_key"] = APP_KEY
    req = urllib.request.Request(
        f"{_BASE}?{urllib.parse.urlencode(params)}",
        headers={"User-Agent": "AROK-Monitor"},
    )
    if API_TOKEN:  # recommended header auth, replaces app_key
        req.add_header("Api-Token", API_TOKEN)
    if CONTENT_TOKEN:
        req.add_header("Content-Token", CONTENT_TOKEN)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read())
        if not isinstance(data, dict):
            return None
        # Icecat error payloads carry an "Error"/"Message" (e.g. 403 needs app_key).
        if data.get("Error") or data.get("Message"):
            return None
        d = data.get("data", data)
        if not isinstance(d, dict):
            return None
        image = d.get("Image")
        url = _pick(image) if isinstance(image, dict) else None
        if url:
            return url
        gallery = d.get("Gallery") or []
        if gallery and isinstance(gallery[0], dict):
            return _pick(gallery[0])
        return None
    except Exception:
        # Any network, decode, or unexpected-shape error -> a safe miss (icon).
        return None


if __name__ == "__main__":
    import sys
    b, m = (sys.argv[1:3] + ["", ""])[:2]
    print(image_for(b, m) or "(no image / credentials not set)")
