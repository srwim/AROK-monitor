#!/usr/bin/env python3
"""Bump the AROK version everywhere it lives, in one command.

Usage:
    python scripts/bump_version.py patch          # 1.2.0 -> 1.2.1
    python scripts/bump_version.py minor          # 1.2.0 -> 1.3.0
    python scripts/bump_version.py major          # 1.2.0 -> 2.0.0
    python scripts/bump_version.py 1.4.2          # explicit version

Updates: backend/updater.py (source of truth), backend/main.py, installer.iss,
make_installer.bat, frontend/package.json, frontend/package-lock.json, and
CLAUDE.md if present (local-only file). The npm files are edited JSON-aware, so
only the *root* package version changes — a dependency that happens to share the
version is never touched.

After bumping it runs a drift scan: it walks the tree for any lingering copy of
the OLD version and warns, so a version hiding in a new/split file can't silently
ship stale. The README badge needs no bumping — it reads the latest GitHub
release once the tag is pushed and the release workflow publishes.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def current_version() -> str:
    m = re.search(r'^VERSION = "(\d+\.\d+\.\d+)"', (ROOT / "backend/updater.py").read_text(encoding="utf-8"), re.M)
    if not m:
        sys.exit("Could not read current version from backend/updater.py")
    return m.group(1)


def next_version(cur: str, arg: str) -> str:
    if re.fullmatch(r"\d+\.\d+\.\d+", arg):
        return arg
    major, minor, patch = map(int, cur.split("."))
    try:
        return {
            "major": f"{major + 1}.0.0",
            "minor": f"{major}.{minor + 1}.0",
            "patch": f"{major}.{minor}.{patch + 1}",
        }[arg]
    except KeyError:
        sys.exit(f"Unknown argument {arg!r} — use major|minor|patch|X.Y.Z")


# (path, [templates], required) — {v} is substituted with old/new. Each required
# template must match at least once with the OLD version or we abort (drift guard).
TARGETS: list[tuple[str, list[str], bool]] = [
    ("backend/updater.py", ['VERSION = "{v}"', 'DISPLAY_VERSION = "v{v}"'], True),
    ("backend/main.py", ['version="{v}"'], True),
    ("installer.iss", ['#define AppVersion "{v}"', '#define AppVersionDisplay "v{v}"'], True),
    ("make_installer.bat", ["AROK-Setup-{v}.exe"], True),
    ("CLAUDE.md", ["Current version: **{v}**"], False),  # local-only, optional
]

# npm files: bump only the root package version, JSON-aware.
NPM_FILES = ["frontend/package.json", "frontend/package-lock.json"]

# Dirs/suffixes the drift scan skips (build artifacts, vendored deps, binaries).
SKIP_DIRS = {".git", ".venv", "venv", "node_modules", "dist", "installer_out", "models", "__pycache__"}
SKIP_SUFFIX = {".png", ".ico", ".jpg", ".jpeg", ".gif", ".mp4", ".bmp", ".exe", ".gguf", ".db", ".pyc"}


def bump_text(rel: str, templates: list[str], required: bool, cur: str, new: str) -> None:
    path = ROOT / rel
    if not path.exists():
        if required:
            sys.exit(f"missing file: {rel}")
        print(f"  skip  {rel} (not present)")
        return
    text = path.read_text(encoding="utf-8")
    replaced = 0
    for tpl in templates:
        old_s, new_s = tpl.format(v=cur), tpl.format(v=new)
        n = text.count(old_s)
        if n == 0 and required:
            sys.exit(f"drift: {old_s!r} not found in {rel} — fix manually, then re-run")
        text = text.replace(old_s, new_s)
        replaced += n
    path.write_text(text, encoding="utf-8", newline="")
    print(f"  ok    {rel} ({replaced} replacement{'s' if replaced != 1 else ''})")


def bump_npm(rel: str, cur: str, new: str) -> None:
    path = ROOT / rel
    if not path.exists():
        sys.exit(f"missing file: {rel}")
    data = json.loads(path.read_text(encoding="utf-8"))
    changed = 0
    if data.get("version") == cur:
        data["version"] = new
        changed += 1
    pkgs = data.get("packages")
    if isinstance(pkgs, dict) and isinstance(pkgs.get(""), dict) and pkgs[""].get("version") == cur:
        pkgs[""]["version"] = new
        changed += 1
    if changed == 0:
        sys.exit(f"drift: root version {cur} not found in {rel} — fix manually, then re-run")
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="")
    print(f"  ok    {rel} (root version, {changed} field{'s' if changed != 1 else ''})")


def drift_scan(cur: str) -> list[str]:
    """Every tracked, non-artifact file that still contains the OLD version.

    Prunes heavy/vendored dirs from the walk (not just after) so it stays fast.
    """
    hits: list[str] = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            p = Path(dirpath) / fn
            if p.suffix.lower() in SKIP_SUFFIX:
                continue
            try:
                if cur in p.read_text(encoding="utf-8"):
                    hits.append(p.relative_to(ROOT).as_posix())
            except (UnicodeDecodeError, OSError):
                continue
    return hits


def main() -> int:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    cur = current_version()
    new = next_version(cur, sys.argv[1])
    print(f"{cur} -> {new}\n")

    for rel, templates, required in TARGETS:
        bump_text(rel, templates, required, cur, new)
    for rel in NPM_FILES:
        bump_npm(rel, cur, new)

    # Safety net: nothing should still hold the old version (covers new/split files).
    stale = [f for f in drift_scan(cur) if f != "scripts/bump_version.py"]
    if stale:
        print("\n  WARNING: the OLD version still appears in:")
        for f in stale:
            print(f"    - {f}")
        print("  If any of these is a real version string, add it to bump_version.py"
              " (TARGETS) and re-run; changelogs/history referencing the old version are fine.")
    else:
        print("\n  drift scan: no stale copies of the old version remain.")

    print(f"""
Done. Release with:

  git add -A
  git commit -m "v{new}: <summary>"
  git pull --rebase
  git push
  git tag v{new}
  git push origin v{new}

The tag push triggers the release build; the README badge picks up the new
release automatically once it's published.""")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
