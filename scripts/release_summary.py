#!/usr/bin/env python3
"""Generate a one-line commit summary from the staged diff.

Used by the release helper: after `git add -A`, this inspects
`git diff --cached` and prints a compact human summary like

    UI, backend + packaging updates (14 files, +312/-88)

Purely descriptive — for a hand-written summary just type over it when the
release script offers it.
"""
from __future__ import annotations

import subprocess
import sys

# path prefix -> human area label (first match wins, order matters)
AREAS: list[tuple[str, str]] = [
    ("frontend/src/tabs/", "UI"),
    ("frontend/src/components/", "UI"),
    ("frontend/", "frontend"),
    ("backend/", "backend"),
    ("upgrades-pipeline/", "affiliate pipeline"),
    (".github/", "CI"),
    ("installer.iss", "packaging"),
    ("make_installer", "packaging"),
    ("scripts/", "tooling"),
    ("docs/", "docs"),
    ("README", "docs"),
    ("CONTRIBUTING", "docs"),
]


def _git(*args: str) -> str:
    return subprocess.run(["git", *args], capture_output=True, text=True).stdout


def main() -> int:
    files = [f for f in _git("diff", "--cached", "--name-only").splitlines() if f.strip()]
    if not files:
        print("release")
        return 0

    areas: list[str] = []
    for f in files:
        label = "misc"
        for prefix, name in AREAS:
            if f.startswith(prefix):
                label = name
                break
        if label not in areas:
            areas.append(label)

    # +adds/-dels across the staged diff
    adds = dels = 0
    for line in _git("diff", "--cached", "--numstat").splitlines():
        parts = line.split("\t")
        if len(parts) >= 2:
            try:
                adds += int(parts[0])
                dels += int(parts[1])
            except ValueError:
                pass  # binary files show '-'

    shown = areas[:3]
    if len(shown) > 1:
        area_str = ", ".join(shown[:-1]) + " + " + shown[-1]
    else:
        area_str = shown[0]
    extra = f", +{adds}/-{dels}" if (adds or dels) else ""
    n = len(files)
    print(f"{area_str} updates ({n} file{'s' if n != 1 else ''}{extra})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
