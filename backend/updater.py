"""AROK Monitor - self-update check via GitHub Releases.

Compares the running version against the latest release tag. The UI
offers the release download link; installation stays a user action
(installer exe from the release page) - simple and safe.
"""
import json
import os
import urllib.request

VERSION = "1.1.1"
DISPLAY_VERSION = "v1.1.1"
REPO = os.environ.get("AROK_REPO", "srwim/AROK-monitor")


def _parse(v: str) -> tuple:
    v = v.strip().lstrip("vV").split("-")[0]
    try:
        return tuple(int(x) for x in v.split("."))
    except ValueError:
        return (0,)


def check() -> dict:
    url = f"https://api.github.com/repos/{REPO}/releases/latest"
    try:
        req = urllib.request.Request(url, headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": f"AROK-Monitor/{VERSION}",
        })
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
        latest = data.get("tag_name", "")
        # Prefer linking straight to the installer .exe asset if present.
        asset_url = None
        for a in data.get("assets", []) or []:
            name = (a.get("name") or "").lower()
            if name.endswith(".exe"):
                asset_url = a.get("browser_download_url")
                break
        return {
            "current": VERSION,
            "latest": latest,
            "update_available": _parse(latest) > _parse(VERSION),
            "url": data.get("html_url"),
            "asset_url": asset_url,
            "notes": (data.get("body") or "")[:500],
            "error": None,
        }
    except Exception as e:
        return {"current": VERSION, "latest": None, "update_available": False, "url": None, "asset_url": None, "notes": None, "error": str(e)}
