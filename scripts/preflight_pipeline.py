#!/usr/bin/env python3
"""Pre-release sanity checks for the Hardware Upgrades pipeline.

Fast, offline checks that catch release-breaking mistakes *before* we build and
ship an installer:

  * every pipeline module imports cleanly (catches syntax errors and bad imports,
    e.g. a broken ``from icecat import ...``),
  * the curated fallback builds construct without error,
  * parts_catalog.json is valid JSON with a parts object,
  * manifest.json + manifest.schema.json parse, and the manifest validates
    against the schema (when jsonschema is installed).

No network and no manifest regeneration — it only inspects what's on disk. Exits
non-zero on the first failure so the release script can stop before building.

Run directly: ``python scripts/preflight_pipeline.py`` from the repo root.
"""
from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PIPE = ROOT / "upgrades-pipeline"


def _fail(msg: str) -> None:
    print(f"  FAIL: {msg}")
    raise SystemExit(1)


def _ok(msg: str) -> None:
    print(f"  ok: {msg}")


def main() -> int:
    print("Pipeline pre-flight ...")
    sys.path.insert(0, str(PIPE))

    # 1. Pipeline modules import (syntax + import wiring).
    for mod in ("affiliate", "icecat", "build_manifest", "verify_thumbnails"):
        try:
            importlib.import_module(mod)
            _ok(f"import {mod}")
        except Exception as e:
            _fail(f"import {mod}: {e}")

    # 2. Curated fallback builds construct, and every component has a usable url.
    try:
        import build_manifest as bm
        systems = bm.FALLBACK_SYSTEMS
        n_parts = sum(len(s["components"]) for s in systems)
        assert systems and n_parts, "no curated builds/components"
        assert all(c.get("url") for s in systems for c in s["components"]), "component missing url"
        _ok(f"curated builds ({len(systems)} builds, {n_parts} component rows)")
    except Exception as e:
        _fail(f"curated builds: {e}")

    # 3. Parts catalog is valid JSON with a parts object.
    try:
        cat = json.loads((PIPE / "parts_catalog.json").read_text(encoding="utf-8"))
        assert isinstance(cat.get("parts"), dict) and cat["parts"], "missing/empty 'parts'"
        _ok(f"parts_catalog.json ({len(cat['parts'])} parts)")
    except Exception as e:
        _fail(f"parts_catalog.json: {e}")

    # 4. Manifest + schema parse, and the manifest matches the schema.
    try:
        schema = json.loads((PIPE / "manifest.schema.json").read_text(encoding="utf-8"))
        manifest = json.loads((PIPE / "manifest.json").read_text(encoding="utf-8"))
        _ok("manifest.json + manifest.schema.json parse")
    except Exception as e:
        _fail(f"manifest/schema JSON: {e}")
    try:
        import jsonschema
        jsonschema.validate(manifest, schema)
        _ok("manifest validates against schema")
    except ImportError:
        print("  (skip: jsonschema not installed — `pip install jsonschema` for the full check)")
    except Exception as e:
        _fail(f"manifest does not match schema: {e}")

    print("Pipeline pre-flight: all checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
