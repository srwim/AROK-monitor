#!/usr/bin/env python3
"""Bump the AROK version everywhere it lives, in one command.

Usage:
    python scripts/bump_version.py patch          # 1.2.0 -> 1.2.1
    python scripts/bump_version.py minor          # 1.2.0 -> 1.3.0
    python scripts/bump_version.py major          # 1.2.0 -> 2.0.0
    python scripts/bump_version.py 1.4.2          # explicit version

Updates: backend/updater.py (source of truth), backend/main.py,
installer.iss, make_installer.bat, frontend/package.json,
frontend/package-lock.json, and CLAUDE.md if present (local-only file).

Then prints the release commands. The README badge needs no bumping — it
reads the latest GitHub release automatically once the tag is pushed and
the release workflow publishes.
"""
from __future__ import annotations

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


# (path, [templates]) — {v} is substituted with old/new version. Each template
# must match at least once with the OLD version or we abort (drift guard).
TARGETS: list[tuple[str, list[str], bool]] = [
    ("backend/updater.py", ['VERSION = "{v}"', 'DISPLAY_VERSION = "v{v}"'], True),
    ("backend/main.py", ['version="{v}"'], True),
    ("installer.iss", ['#define AppVersion "{v}"', '#define AppVersionDisplay "v{v}"'], True),
    ("make_installer.bat", ["AROK-Setup-{v}.exe"], True),
    ("frontend/package.json", ['"version": "{v}"'], True),
    ("frontend/package-lock.json", ['"version": "{v}"'], True),
    ("CLAUDE.md", ["Current version: **{v}**"], False),  # local-only, optional
]


def main() -> int:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    cur = current_version()
    new = next_version(cur, sys.argv[1])
    print(f"{cur} -> {new}\n")

    for rel, templates, required in TARGETS:
        path = ROOT / rel
        if not path.exists():
            if required:
                sys.exit(f"missing file: {rel}")
            print(f"  skip  {rel} (not present)")
            continue
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
