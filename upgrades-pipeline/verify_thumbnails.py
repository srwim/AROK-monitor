#!/usr/bin/env python3
"""Thumbnail-coverage report for the Hardware Upgrades builds.

For every distinct part in the featured builds, checks the parts catalog for a
brand + MPN and (when Icecat credentials are present) whether that pair actually
resolves to an Open Icecat image. Emits:

  * a Markdown table to the GitHub Step Summary and to ``thumbnail_report.md``
  * ``has_gaps`` / ``missing`` / ``ok`` counts to GITHUB_OUTPUT

It never fails the build — it's a report. The workflow uses ``has_gaps`` to open
or refresh a tracking issue so parts still needing an MPN stay visible.

Run locally: ``python verify_thumbnails.py`` (without creds it reports which
parts have an MPN; with ICECAT_SHOPNAME/ICECAT_API_TOKEN it also verifies each
resolves to a real image).
"""
from __future__ import annotations

import os
from pathlib import Path

import build_manifest as bm
from icecat import image_for

HERE = Path(__file__).parent
HAVE_CREDS = bool(os.environ.get("ICECAT_SHOPNAME") and
                  (os.environ.get("ICECAT_API_TOKEN") or os.environ.get("ICECAT_APP_KEY")))


def distinct_parts() -> dict[str, str]:
    """name -> component type, across all curated featured builds."""
    parts: dict[str, str] = {}
    for system in bm.FALLBACK_SYSTEMS:
        for comp in system.get("components", []):
            parts.setdefault(comp["name"], comp["type"])
    return parts


def classify(name: str, catalog: dict) -> tuple[str, str]:
    """Return (status_key, detail) for one part."""
    meta = catalog.get(name, {})
    if meta.get("image"):
        return "ok", "manual image"
    brand, mpn = meta.get("brand", ""), meta.get("mpn", "")
    if not mpn:
        return "missing", "no MPN"
    if not HAVE_CREDS:
        return "unchecked", f"MPN {mpn} (Icecat not checked — no creds)"
    return ("ok", f"Icecat {mpn}") if image_for(brand, mpn) else ("broken", f"MPN {mpn} — no Icecat image")


def main() -> int:
    catalog = bm.load_catalog()
    parts = distinct_parts()
    buckets = {"ok": [], "unchecked": [], "broken": [], "missing": []}
    rows = []
    for name, ptype in sorted(parts.items()):
        status, detail = classify(name, catalog)
        buckets[status].append(name)
        icon = {"ok": "✅", "unchecked": "➖", "broken": "⚠️", "missing": "❌"}[status]
        rows.append(f"| {icon} | {ptype} | {name} | {detail} |")

    total = len(parts)
    resolved = len(buckets["ok"])
    header = (
        f"# Thumbnail coverage\n\n"
        f"**{resolved}/{total}** parts have a thumbnail source"
        f"{' (Icecat verified)' if HAVE_CREDS else ' — Icecat not checked (no credentials in this run)'}.\n\n"
        f"- ✅ resolved: {resolved}\n"
        f"- ⚠️ MPN set but no Icecat image: {len(buckets['broken'])}\n"
        f"- ❌ needs an MPN: {len(buckets['missing'])}\n"
        + (f"- ➖ MPN set, not verified here: {len(buckets['unchecked'])}\n" if buckets["unchecked"] else "")
        + "\n| | Type | Part | Detail |\n|---|---|---|---|\n"
    )
    report = header + "\n".join(rows) + "\n"
    (HERE / "thumbnail_report.md").write_text(report, encoding="utf-8")

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(report)

    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        has_gaps = bool(buckets["missing"] or buckets["broken"])
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"has_gaps={'true' if has_gaps else 'false'}\n")
            f.write(f"resolved={resolved}\n")
            f.write(f"total={total}\n")

    print(f"Thumbnail coverage: {resolved}/{total} resolved; "
          f"{len(buckets['missing'])} need an MPN, {len(buckets['broken'])} broken.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
