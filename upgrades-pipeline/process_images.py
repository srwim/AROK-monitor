#!/usr/bin/env python3
"""Image optimizer for Hardware Upgrades thumbnails.

Uncompressed source image -> compressed, correctly sized, tagged in the catalog.

For each part in parts_catalog.json the source image is, in priority order:
  1. ``sourceImage``   — set by enrich_catalog.py (manufacturer og:image)
  2. a remote ``image`` — legacy direct URL (adopted as sourceImage)
  3. Open Icecat        — brand+MPN lookup when credentials are present

Each source is downloaded once and two renditions are written to ``thumbs/``:

  <slug>.webp        FULL  — losslessly re-encoded WebP (PNG/WebP sources) or
                             visually-lossless q90 (JPEG sources, where true
                             lossless re-encoding would *grow* the file),
                             capped at 1200px on the long edge. Lightbox uses this.
  <slug>.thumb.webp  THUMB — 160px box, q82. The in-card rendition: a few KB
                             instead of a few hundred, which is what makes the
                             cards snappy.

The catalog entry is then tagged:
  image          -> raw.githubusercontent URL of the FULL rendition
  thumb          -> raw URL of the THUMB rendition
  sourceImage    -> where the original came from
  imageHash      -> sha1 of the source bytes; unchanged source = skipped rerun
  imageProcessedAt

Idempotent and per-part fault-tolerant: a failed part is reported and skipped,
never fatal. Requires Pillow (workflow installs it; not needed by the daily
manifest job).
"""
from __future__ import annotations

import datetime
import hashlib
import io
import json
import re
import sys
import urllib.request
from pathlib import Path

import icecat

HERE = Path(__file__).parent
CATALOG = HERE / "parts_catalog.json"
THUMBS = HERE / "thumbs"
RAW_BASE = "https://raw.githubusercontent.com/srwim/AROK-monitor/main/upgrades-pipeline/thumbs/"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

FULL_MAX = 1200   # px, long edge of the lightbox rendition
THUMB_BOX = 160   # px, bounding box of the card rendition (2x+ of the 56px display)


def _slug(name: str) -> str:
    return re.sub(r"-{2,}", "-", re.sub(r"[^a-z0-9]+", "-", name.lower())).strip("-")


def _fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def _renditions(data: bytes, slug: str) -> tuple[str, str]:
    """Write FULL + THUMB WebP renditions; return their filenames."""
    from PIL import Image

    img = Image.open(io.BytesIO(data))
    src_format = (img.format or "").upper()
    img.load()
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA" if "A" in img.mode or "P" in img.mode else "RGB")

    THUMBS.mkdir(exist_ok=True)

    full = img.copy()
    if max(full.size) > FULL_MAX:
        full.thumbnail((FULL_MAX, FULL_MAX), Image.LANCZOS)
    full_name = f"{slug}.webp"
    if src_format == "JPEG":
        # True lossless re-encoding of JPEG data typically GROWS the file;
        # q90 WebP is visually lossless and substantially smaller.
        full.save(THUMBS / full_name, "WEBP", quality=90, method=6)
    else:
        full.save(THUMBS / full_name, "WEBP", lossless=True, quality=100, method=6)

    thumb = img.copy()
    thumb.thumbnail((THUMB_BOX, THUMB_BOX), Image.LANCZOS)
    thumb_name = f"{slug}.thumb.webp"
    thumb.save(THUMBS / thumb_name, "WEBP", quality=82, method=6)

    return full_name, thumb_name


def main() -> int:
    force = "--force" in sys.argv[1:]
    cat = json.loads(CATALOG.read_text(encoding="utf-8"))
    today = datetime.date.today().isoformat()
    icecat_live = bool(icecat.SHOPNAME and (icecat.API_TOKEN or icecat.APP_KEY))

    done, skipped, missing, failed = [], [], [], []
    for name, part in cat.get("parts", {}).items():
        try:
            source = (part.get("sourceImage") or "").strip()
            if not source:
                legacy = (part.get("image") or "").strip()
                if legacy and not legacy.startswith(RAW_BASE):
                    source = legacy  # adopt a legacy direct URL as the source
            if not source and icecat_live and part.get("brand") and part.get("mpn"):
                source = icecat.image_for(part["brand"], part["mpn"]) or ""
            if not source:
                missing.append(name)
                continue

            data = _fetch(source)
            digest = "sha1:" + hashlib.sha1(data).hexdigest()
            if not force and part.get("imageHash") == digest and part.get("thumb"):
                skipped.append(name)
                continue

            full_name, thumb_name = _renditions(data, _slug(name))
            part["sourceImage"] = source
            part["image"] = RAW_BASE + full_name
            part["thumb"] = RAW_BASE + thumb_name
            part["imageHash"] = digest
            part["imageProcessedAt"] = today
            size_full = (THUMBS / full_name).stat().st_size
            size_thumb = (THUMBS / thumb_name).stat().st_size
            done.append(f"{name} (src {len(data)//1024} KB -> full {size_full//1024} KB, thumb {size_thumb//1024} KB)")
        except Exception as e:
            failed.append((name, f"{type(e).__name__}: {e}"))

    CATALOG.write_text(json.dumps(cat, indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="")

    print(f"processed {len(done)}:")
    for line in done:
        print(f"  + {line}")
    if skipped:
        print(f"unchanged (hash match) {len(skipped)}: {', '.join(skipped)}")
    if missing:
        print(f"no source image {len(missing)}: {', '.join(missing)}")
    if failed:
        print(f"failed {len(failed)}:")
        for n, why in failed:
            print(f"  ! {n} — {why}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
