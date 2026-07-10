#!/usr/bin/env python3
"""One-shot catalog enrichment: manufacturer og:image -> tier-1 thumbnails.

For every part in parts_catalog.json that has a ``productUrl`` but no
``image``, fetch the manufacturer's own product page, read its ``og:image``
(or ``twitter:image``) meta tag, verify the image URL actually serves an
image, and store it as the part's tier-1 thumbnail.

Position in the thumbnail ladder (see parts_catalog.json _comment):
  tier 1  manual/manufacturer image URL  <- this script fills these
  tier 2  Open Icecat lookup by brand+MPN (icecat.py, needs credentials)
  tier 3  category icon in the app

When Icecat credentials are present (ICECAT_SHOPNAME + token), parts that
already resolve through Icecat are SKIPPED — tier 2 covers them and the
catalog stays lean. Without credentials, every part with a productUrl is
enriched.

Copyright posture: these are the manufacturers' own marketing images, hotlinked
from their pages for products the app links people to buy. That's commonly
tolerated but not licensed — when the Amazon Creators API becomes available,
prefer replacing this tier with its licensed images (asin/gtin fields in the
catalog are reserved for exactly that).

Usage:
    python enrich_catalog.py            # fill missing images
    python enrich_catalog.py --force    # re-fetch even where an image is set

Never raises per-part; prints a summary and always exits 0 (the run report is
the product — gaps stay visible in the verify-thumbnails tracking issue).
"""
from __future__ import annotations

import datetime
import json
import re
import sys
import urllib.request
from pathlib import Path
from urllib.parse import urljoin

import icecat

HERE = Path(__file__).parent
CATALOG = HERE / "parts_catalog.json"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

# property/name attribute before or after content= — both orders occur in the wild.
_OG_A = re.compile(
    r'<meta[^>]+(?:property|name)=["\'](?:og:image|twitter:image)(?::src)?["\'][^>]*content=["\']([^"\']+)', re.I)
_OG_B = re.compile(
    r'<meta[^>]+content=["\']([^"\']+)["\'][^>]*(?:property|name)=["\'](?:og:image|twitter:image)(?::src)?["\']', re.I)


def og_image(page_url: str) -> str | None:
    req = urllib.request.Request(page_url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
    with urllib.request.urlopen(req, timeout=25) as r:
        html = r.read(500_000).decode("utf-8", "replace")
    m = _OG_A.search(html) or _OG_B.search(html)
    if not m:
        return None
    img = m.group(1).strip()
    if img.startswith("//"):
        return "https:" + img
    if img.startswith("/"):
        return urljoin(page_url, img)
    return img


def image_ok(url: str) -> bool:
    """True if the URL serves an image (HEAD, falling back to a ranged GET)."""
    for method, extra in (("HEAD", {}), ("GET", {"Range": "bytes=0-256"})):
        try:
            req = urllib.request.Request(url, method=method, headers={"User-Agent": UA, **extra})
            with urllib.request.urlopen(req, timeout=20) as r:
                return "image" in (r.headers.get("Content-Type") or "").lower()
        except Exception:
            continue
    return False


def main() -> int:
    force = "--force" in sys.argv[1:]
    cat = json.loads(CATALOG.read_text(encoding="utf-8"))
    today = datetime.date.today().isoformat()
    icecat_live = bool(icecat.SHOPNAME and (icecat.API_TOKEN or icecat.APP_KEY))

    filled, skipped_icecat, no_url, failed = [], [], [], []
    for name, part in cat.get("parts", {}).items():
        if (part.get("sourceImage") or part.get("image")) and not force:
            continue
        url = (part.get("productUrl") or "").strip()
        if not url:
            no_url.append(name)
            continue
        if icecat_live and part.get("brand") and part.get("mpn"):
            try:
                if icecat.image_for(part["brand"], part["mpn"]):
                    skipped_icecat.append(name)
                    continue  # tier 2 already covers this part
            except Exception:
                pass
        try:
            img = og_image(url)
            if img and image_ok(img):
                # Stage as the SOURCE; process_images.py downloads it, writes
                # compressed renditions, and sets the final image/thumb URLs.
                part["sourceImage"] = img
                part["source"] = "manufacturer"
                part["updatedAt"] = today
                filled.append(name)
            else:
                failed.append((name, "no og:image on page" if not img else "image URL did not verify"))
        except Exception as e:
            failed.append((name, f"{type(e).__name__}: {e}"))

    CATALOG.write_text(json.dumps(cat, indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="")

    print(f"enriched {len(filled)}:")
    for n in filled:
        print(f"  + {n}")
    if skipped_icecat:
        print(f"skipped (Icecat already resolves) {len(skipped_icecat)}: {', '.join(skipped_icecat)}")
    if failed:
        print(f"failed {len(failed)}:")
        for n, why in failed:
            print(f"  ! {n} — {why}")
    if no_url:
        print(f"no productUrl {len(no_url)}: {', '.join(no_url)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
