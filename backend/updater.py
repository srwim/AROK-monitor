"""AROK Monitor - self-update via GitHub Releases.

Two layers:
  * check()  - compare the running version against the latest release tag.
  * Auto-update ("relaunch to update"): a background loop checks periodically,
    downloads the installer asset to LOCALAPPDATA\\AROK\\updates, verifies it
    against the release's .sha256 sidecar, and marks it "ready". The UI shows
    a quiet relaunch pill; apply_update() runs the installer /VERYSILENT and
    relaunches the new build. The installer is per-user, so no UAC appears.

Safety properties: downloads come only from the release's own asset URLs
(HTTPS, api.github.com metadata), the hash must match the published sidecar
(when present), and nothing installs until the user clicks relaunch.
"""
import hashlib
import json
import os
import subprocess
import sys
import threading
import time
import urllib.request

VERSION = "1.6.0"
DISPLAY_VERSION = "v1.6.0"
REPO = os.environ.get("AROK_REPO", "srwim/AROK-monitor")

CHECK_INTERVAL = 6 * 3600      # steady-state re-check cadence (seconds)
# Launch burst: check almost immediately, then back off exponentially until
# reaching the steady-state interval. Users see the pill within seconds of
# launching when an update exists, without hammering the API afterwards.
CHECK_SCHEDULE = (5, 30, 120, 600, 2700)

_lock = threading.Lock()
_state: dict = {
    "phase": "idle",           # idle | checking | downloading | ready | error | applying
    "current": VERSION,
    "latest": None,
    "progress": 0.0,           # download progress 0..1
    "staged_path": None,
    "error": None,
}


def _updates_dir() -> str:
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    path = os.path.join(base, "AROK", "updates")
    os.makedirs(path, exist_ok=True)
    return path


def status() -> dict:
    with _lock:
        return dict(_state)


def _set(**kw) -> None:
    with _lock:
        _state.update(kw)


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


# ---------------------------------------------------------------------------
# Auto-update: download + verify + stage + apply
# ---------------------------------------------------------------------------

def _release_assets() -> tuple[str, str | None, str | None]:
    """(latest_tag, exe_url, sha256_url) for the latest release."""
    url = f"https://api.github.com/repos/{REPO}/releases/latest"
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": f"AROK-Monitor/{VERSION}",
    })
    with urllib.request.urlopen(req, timeout=15) as r:
        data = json.loads(r.read())
    exe_url = sha_url = None
    for a in data.get("assets", []) or []:
        name = (a.get("name") or "").lower()
        if name.endswith(".exe") and not exe_url:
            exe_url = a.get("browser_download_url")
        elif name.endswith(".sha256") and not sha_url:
            sha_url = a.get("browser_download_url")
    return data.get("tag_name", ""), exe_url, sha_url


def _download(url: str, dest: str) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": f"AROK-Monitor/{VERSION}"})
    with urllib.request.urlopen(req, timeout=60) as r, open(dest, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        done = 0
        while True:
            chunk = r.read(1 << 18)
            if not chunk:
                break
            f.write(chunk)
            done += len(chunk)
            if total:
                _set(progress=round(done / total, 3))


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download_update() -> dict:
    """Check for a newer release and stage its verified installer. Blocking —
    run from the background thread (or an explicit endpoint call)."""
    if status()["phase"] in ("downloading", "ready", "applying"):
        return status()
    _set(phase="checking", error=None, progress=0.0)
    try:
        latest, exe_url, sha_url = _release_assets()
        _set(latest=latest)
        if not latest or _parse(latest) <= _parse(VERSION):
            # Up to date: clear previously staged installers so a stale
            # download can never resurface the relaunch pill.
            try:
                for f in os.listdir(_updates_dir()):
                    if f.endswith((".exe", ".part", ".cmd")):
                        os.remove(os.path.join(_updates_dir(), f))
            except Exception:
                pass
            _set(phase="idle", staged_path=None)
            return status()
        if not exe_url:
            _set(phase="error", error="release has no installer asset")
            return status()

        dest = os.path.join(_updates_dir(), f"AROK-Setup-{latest.lstrip('vV')}.exe")
        if not os.path.exists(dest):
            _set(phase="downloading")
            _download(exe_url, dest + ".part")
            os.replace(dest + ".part", dest)

        # Verify against the published sidecar when the release ships one.
        if sha_url:
            with urllib.request.urlopen(urllib.request.Request(
                sha_url, headers={"User-Agent": f"AROK-Monitor/{VERSION}"}), timeout=30) as r:
                expected = r.read().decode("ascii", "ignore").split()[0].strip().lower()
            if _sha256(dest) != expected:
                os.remove(dest)
                _set(phase="error", error="checksum mismatch — download discarded")
                return status()

        _set(phase="ready", staged_path=dest, progress=1.0)
    except Exception as e:
        _set(phase="error", error=str(e))
    return status()


def apply_update() -> dict:
    """Run the staged installer silently and relaunch. The caller (main.py)
    schedules process exit right after this returns ok."""
    st = status()
    if st["phase"] != "ready" or not st["staged_path"] or not os.path.exists(st["staged_path"]):
        return {"ok": False, "detail": "no update staged"}
    installer = st["staged_path"]
    _set(phase="applying")
    try:
        log = os.path.join(_updates_dir(), "install.log")
        flags = f'/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /FORCECLOSEAPPLICATIONS /LOG="{log}"'
        lines = ["@echo off", "timeout /t 2 /nobreak >nul"]
        if getattr(sys, "frozen", False):
            exe = sys.executable
            # /DIR pins the install to wherever THIS build actually runs from.
            # Without it, a custom install dir (or a per-user vs per-machine
            # registry mismatch) makes silent setup install to a fresh default
            # location while the old copy keeps launching — the "still on the
            # old version after relaunch" bug.
            lines.append(f'"{installer}" {flags} /DIR="{os.path.dirname(exe)}"')
            lines.append(f'start "" "{exe}"')
        else:
            lines.append(f'"{installer}" {flags}')
        # A real script file avoids cmd /c quote-mangling with nested quotes,
        # and /LOG means a silent failure is never invisible again.
        script = os.path.join(_updates_dir(), "apply_update.cmd")
        with open(script, "w", encoding="ascii", errors="replace") as f:
            f.write("\r\n".join(lines) + "\r\n")
        subprocess.Popen(
            ["cmd", "/c", script],
            creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
            close_fds=True,
        )
        return {"ok": True}
    except Exception as e:
        _set(phase="error", error=str(e))
        return {"ok": False, "detail": str(e)}


def auto_update_loop(stop, enabled) -> None:
    """Background loop: periodically stage updates when auto-update is on.
    `stop` is a threading.Event; `enabled` is a callable returning bool.
    Checks follow CHECK_SCHEDULE (fast at launch, exponential backoff), then
    settle into CHECK_INTERVAL."""
    def _tick() -> None:
        try:
            if enabled():
                download_update()
        except Exception:
            pass

    for delay in CHECK_SCHEDULE:
        if stop.wait(delay):
            return
        _tick()
    while not stop.is_set():
        if stop.wait(CHECK_INTERVAL):
            return
        _tick()
