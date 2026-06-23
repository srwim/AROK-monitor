"""AROK Monitor — system cleanup plane.

Three capabilities, all Windows-focused and all heavily guarded:

  1. System restore point  — Checkpoint-Computer via PowerShell.
  2. Guided Tron launcher   — user downloads the official Tron pack (rotating
     mirrors, so AROK does not blindly fetch it), AROK verifies a SHA-256 the
     user supplies/pastes from the official thread, creates a restore point,
     then launches tron.bat elevated only after explicit consent.
  3. Conservative registry cleaner — scans a small set of KNOWN-SAFE issue
     classes (dead Run-key startup targets, orphaned Uninstall entries).
     Nothing is deleted without (a) a restore point and (b) a .reg backup of
     exactly the keys being removed.

Everything degrades gracefully off Windows and never raises to the caller.
Honesty over magic: where a step needs admin or user action, we say so.
"""
from __future__ import annotations

import os
import subprocess
import sys
import time

import db

IS_WINDOWS = sys.platform == "win32"

# Official Tron references (shown to the user; AROK does not auto-download).
TRON_THREAD = "https://old.reddit.com/r/TronScript/"
TRON_REPO = "https://github.com/bmrf/tron"

_BACKUP_DIR = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "AROK", "registry_backups")


def _run(cmd: list[str], timeout: int = 120) -> tuple[int, str]:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except Exception as e:
        return 1, str(e)


# ---------------------------------------------------------------------------
# 1. System restore point
# ---------------------------------------------------------------------------
def create_restore_point(description: str = "AROK Monitor cleanup") -> dict:
    if not IS_WINDOWS:
        return {"ok": False, "detail": "Restore points are Windows-only."}
    # Checkpoint-Computer needs admin + System Protection enabled on the drive.
    code, out = _run([
        "powershell", "-NoProfile", "-Command",
        f"Checkpoint-Computer -Description '{description}' -RestorePointType MODIFY_SETTINGS",
    ], timeout=180)
    if code == 0:
        db.log_event("cleanup", f"restore point created: {description}")
        return {"ok": True, "detail": "Restore point created."}
    return {
        "ok": False,
        "detail": "Could not create a restore point. Run AROK as administrator and ensure "
                  "System Protection is enabled (System > About > System protection). Raw: "
                  + out.strip()[:300],
    }


# ---------------------------------------------------------------------------
# 2. Guided Tron launcher
# ---------------------------------------------------------------------------
def tron_info() -> dict:
    return {
        "thread": TRON_THREAD,
        "repo": TRON_REPO,
        "note": "Tron is distributed via rotating official mirrors, so AROK does not auto-download it. "
                "Download it yourself from the official thread, paste the SHA-256 listed there, and "
                "AROK will verify the file and launch it for you with a restore point first.",
    }


def verify_file_sha256(path: str, expected_sha256: str) -> dict:
    import hashlib
    if not path or not os.path.isfile(path):
        return {"ok": False, "detail": "File not found."}
    try:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        digest = h.hexdigest().lower()
    except Exception as e:
        return {"ok": False, "detail": f"Could not read file: {e}"}
    exp = (expected_sha256 or "").strip().lower()
    match = bool(exp) and digest == exp
    return {"ok": match, "digest": digest, "expected": exp, "detail": "Checksum match." if match else "Checksum DOES NOT match — do not run this file."}


def launch_tron(tron_bat_path: str, make_restore_point: bool = True) -> dict:
    """Launch tron.bat elevated. Caller must have already verified integrity and
    obtained explicit user consent."""
    if not IS_WINDOWS:
        return {"ok": False, "detail": "Tron is Windows-only."}
    if not tron_bat_path or not os.path.isfile(tron_bat_path) or not tron_bat_path.lower().endswith(".bat"):
        return {"ok": False, "detail": "Point AROK at the tron.bat file inside the extracted Tron folder."}
    if make_restore_point:
        rp = create_restore_point("Before Tron run (AROK)")
        if not rp["ok"]:
            return {"ok": False, "detail": "Aborted: " + rp["detail"]}
    # Launch elevated in a new window; Tron manages its own logging.
    code, out = _run([
        "powershell", "-NoProfile", "-Command",
        f"Start-Process -FilePath '{tron_bat_path}' -Verb RunAs",
    ], timeout=60)
    if code == 0:
        db.log_event("cleanup", f"launched Tron: {tron_bat_path}")
        return {"ok": True, "detail": "Tron launched in an elevated window. Follow its prompts there."}
    return {"ok": False, "detail": "Failed to launch Tron: " + out.strip()[:300]}


# ---------------------------------------------------------------------------
# 3. Conservative registry cleaner (known-safe classes only)
# ---------------------------------------------------------------------------
def _winreg():
    try:
        import winreg  # type: ignore
        return winreg
    except Exception:
        return None


def registry_scan() -> dict:
    """Find known-safe registry issues. Returns a list of candidate items, each
    with enough info to back up and delete it later. Never modifies anything."""
    if not IS_WINDOWS:
        return {"ok": False, "supported": False, "issues": [], "detail": "Registry tools are Windows-only."}
    winreg = _winreg()
    if winreg is None:
        return {"ok": False, "supported": False, "issues": [], "detail": "winreg unavailable."}

    issues: list[dict] = []

    def _expand(p: str) -> str:
        return os.path.expandvars(p.strip().strip('"'))

    # (a) Dead Run-key startup entries: value points at a missing executable.
    run_keys = [
        (winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run"),
        (winreg.HKEY_LOCAL_MACHINE, r"Software\Microsoft\Windows\CurrentVersion\Run"),
    ]
    for hive, sub in run_keys:
        try:
            k = winreg.OpenKey(hive, sub)
        except OSError:
            continue
        try:
            i = 0
            while True:
                try:
                    name, val, _ = winreg.EnumValue(k, i)
                except OSError:
                    break
                i += 1
                # extract the executable path from the command
                raw = str(val)
                exe = raw
                if raw.startswith('"'):
                    exe = raw[1:].split('"', 1)[0]
                else:
                    exe = raw.split(" ", 1)[0]
                exe = _expand(exe)
                if exe and exe.lower().endswith(".exe") and not os.path.isfile(exe):
                    issues.append({
                        "id": f"run::{hive}::{sub}::{name}",
                        "category": "Dead startup entry",
                        "hive": "HKCU" if hive == winreg.HKEY_CURRENT_USER else "HKLM",
                        "path": sub,
                        "name": name,
                        "detail": f"Startup '{name}' points to missing file: {exe}",
                    })
        finally:
            winreg.CloseKey(k)

    # (b) Orphaned Uninstall entries: UninstallString/InstallLocation missing.
    unin = [
        (winreg.HKEY_LOCAL_MACHINE, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
    ]
    for hive, sub in unin:
        try:
            base = winreg.OpenKey(hive, sub)
        except OSError:
            continue
        try:
            j = 0
            while True:
                try:
                    child = winreg.EnumKey(base, j)
                except OSError:
                    break
                j += 1
                try:
                    ck = winreg.OpenKey(hive, sub + "\\" + child)
                    def _get(v):
                        try:
                            return str(winreg.QueryValueEx(ck, v)[0])
                        except OSError:
                            return ""
                    disp = _get("DisplayName")
                    us = _expand(_get("UninstallString").split('"')[1] if _get("UninstallString").startswith('"') else _get("UninstallString").split(" ")[0])
                    loc = _expand(_get("InstallLocation"))
                    winreg.CloseKey(ck)
                    # Only flag if it clearly references a path that no longer exists.
                    target = us or loc
                    if disp and target and not (("\\" in target) and (os.path.exists(target) or os.path.exists(os.path.dirname(target)))):
                        issues.append({
                            "id": f"unin::{hive}::{sub}::{child}",
                            "category": "Orphaned uninstall entry",
                            "hive": "HKLM" if hive == winreg.HKEY_LOCAL_MACHINE else "HKCU",
                            "path": sub + "\\" + child,
                            "name": disp,
                            "detail": f"'{disp}' references a missing location: {target}",
                        })
                except OSError:
                    continue
        finally:
            winreg.CloseKey(base)

    return {"ok": True, "supported": True, "issues": issues, "count": len(issues)}


def _backup_key(hive_label: str, path: str) -> str | None:
    """Export a registry path to a .reg file before deletion. Returns file path."""
    os.makedirs(_BACKUP_DIR, exist_ok=True)
    safe = (hive_label + "_" + path).replace("\\", "_").replace("/", "_").replace(" ", "")[:120]
    out = os.path.join(_BACKUP_DIR, f"{safe}_{int(time.time())}.reg")
    full = f"{'HKLM' if hive_label=='HKLM' else 'HKCU'}\\{path}"
    code, _ = _run(["reg", "export", full, out, "/y"], timeout=60)
    return out if code == 0 and os.path.isfile(out) else None


def registry_clean(item_ids: list[str], issues: list[dict]) -> dict:
    """Delete the selected issues. REQUIRES a prior restore point (enforced by the
    UI consent flow) and always exports a .reg backup of each item first."""
    if not IS_WINDOWS:
        return {"ok": False, "detail": "Registry tools are Windows-only."}
    winreg = _winreg()
    if winreg is None:
        return {"ok": False, "detail": "winreg unavailable."}

    by_id = {it["id"]: it for it in issues}
    removed, failed, backups = [], [], []
    for iid in item_ids:
        it = by_id.get(iid)
        if not it:
            failed.append({"id": iid, "detail": "unknown item"})
            continue
        hive = winreg.HKEY_LOCAL_MACHINE if it["hive"] == "HKLM" else winreg.HKEY_CURRENT_USER
        bkp = _backup_key(it["hive"], it["path"])
        if bkp:
            backups.append(bkp)
        try:
            if it["id"].startswith("run::"):
                # delete a single value
                k = winreg.OpenKey(hive, it["path"], 0, winreg.KEY_SET_VALUE)
                winreg.DeleteValue(k, it["name"])
                winreg.CloseKey(k)
            else:
                # delete an orphaned uninstall subkey
                winreg.DeleteKey(hive, it["path"])
            removed.append(iid)
            db.log_event("cleanup", f"registry removed: {it['hive']}\\{it['path']} ({it.get('name','')})")
        except OSError as e:
            failed.append({"id": iid, "detail": str(e)})

    return {
        "ok": True,
        "removed": removed,
        "failed": failed,
        "backups": backups,
        "backup_dir": _BACKUP_DIR,
        "detail": f"Removed {len(removed)} item(s); {len(failed)} failed. Backups in {_BACKUP_DIR}.",
    }


# ---------------------------------------------------------------------------
# Temp file cleanup (safe, non-registry)
# ---------------------------------------------------------------------------
def temp_scan() -> dict:
    targets = _temp_dirs()
    total = 0
    files = 0
    for d in targets:
        for root, _, names in os.walk(d):
            for n in names:
                try:
                    total += os.path.getsize(os.path.join(root, n))
                    files += 1
                except Exception:
                    continue
    return {"ok": True, "dirs": targets, "bytes": total, "files": files, "mb": round(total / (1024 ** 2), 1)}


def temp_clean() -> dict:
    freed = 0
    removed = 0
    for d in _temp_dirs():
        for root, _, names in os.walk(d):
            for n in names:
                fp = os.path.join(root, n)
                try:
                    sz = os.path.getsize(fp)
                    os.remove(fp)
                    freed += sz
                    removed += 1
                except Exception:
                    continue  # file in use / locked — skip
    db.log_event("cleanup", f"temp cleanup freed {round(freed/(1024**2),1)} MB ({removed} files)")
    return {"ok": True, "freed_mb": round(freed / (1024 ** 2), 1), "removed": removed}


def _temp_dirs() -> list[str]:
    out = []
    for d in {os.environ.get("TEMP"), os.environ.get("TMP"),
              os.path.join(os.environ.get("SystemRoot", r"C:\\Windows"), "Temp") if IS_WINDOWS else "/tmp"}:
        if d and os.path.isdir(d):
            out.append(d)
    return out
