#!/usr/bin/env python3
"""Daily manifest generator for AROK Hardware Upgrades.

Produces ``manifest.json`` consumed by the Upgrades tab at runtime. Two
sections:

  componentUpgrades  -> curated per-category bang-for-buck + high-end picks
                        (stable, always present, drives the carousel)
  featuredSystems    -> full builds, best-effort scraped from PCPartPicker's
                        featured list, each part cross-referenced to Amazon

Design notes
------------
* The carousel never depends on the network: its picks come from the
  CURATED catalog below, so editing this file is how you curate the rotation.
* The PCPartPicker scrape is best-effort and fully isolated. If it fails
  (block, layout change, timeout), we keep the previous manifest's
  featuredSystems so the app always has good data. Nothing here can break
  the running app.
* Run by a daily GitHub Action which commits the result; the app fetches the
  raw URL. The app does not need to update for the data to refresh.
"""

from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

from affiliate import DISCLOSURE, search_link

HERE = Path(__file__).parent
OUT = HERE / "manifest.json"

# ---------------------------------------------------------------------------
# Curated carousel catalog. Edit these to change what the carousel rotates.
# Each pick: title, asin (drives a clean /dp link), price hint, image URL.
# Leave asin empty to fall back to a tagged Amazon search for the title.
# ---------------------------------------------------------------------------
# Last curated review: 2026-07-03 (Tom's Hardware / TechSpot / PC Gamer roundups).
# Prices are hints only — links are searches, so they never go stale, but the
# titles and price hints should be re-reviewed roughly monthly. Note: DDR5 is
# in a genuine shortage (mid-2026); RAM price hints are accurate, not typos.
CURATED: dict[str, dict] = {
    "cpu": {
        "label": "Processor (CPU)",
        "bangForBuck": {"title": "AMD Ryzen 5 9600X", "asin": "", "price": "~$180"},
        "highEnd": {"title": "AMD Ryzen 7 9800X3D", "asin": "", "price": "~$440"},
    },
    "gpu": {
        "label": "Graphics Card (GPU)",
        "bangForBuck": {"title": "AMD Radeon RX 9060 XT 16GB", "asin": "", "price": "~$349"},
        "highEnd": {"title": "AMD Radeon RX 9070 XT", "asin": "", "price": "~$599"},
    },
    "ram": {
        "label": "Memory (RAM)",
        "bangForBuck": {"title": "Corsair Vengeance DDR5 32GB (2x16) 6000 CL30", "asin": "", "price": "~$380"},
        "highEnd": {"title": "G.Skill Trident Z5 Neo DDR5 64GB (2x32) 6000", "asin": "", "price": "~$700"},
    },
    "storage": {
        "label": "SSD / Storage",
        "bangForBuck": {"title": "WD Black SN850X 1TB NVMe", "asin": "", "price": "~$100"},
        "highEnd": {"title": "Samsung 990 PRO 2TB NVMe", "asin": "", "price": "~$200"},
    },
    "motherboard": {
        "label": "Motherboard",
        "bangForBuck": {"title": "Gigabyte B650 Aorus Elite AX", "asin": "", "price": "~$170"},
        "highEnd": {"title": "MSI MAG B850 Tomahawk MAX WiFi", "asin": "", "price": "~$250"},
    },
    "psu": {
        "label": "Power Supply (PSU)",
        "bangForBuck": {"title": "be quiet! Pure Power 12 M 750W 80+ Gold", "asin": "", "price": "~$80"},
        "highEnd": {"title": "Corsair RM1000x 1000W 80+ Gold", "asin": "", "price": "~$190"},
    },
    "cooler": {
        "label": "CPU Cooler",
        "bangForBuck": {"title": "Thermalright Peerless Assassin 120 SE", "asin": "", "price": "~$36"},
        "highEnd": {"title": "ARCTIC Liquid Freezer III 360", "asin": "", "price": "~$120"},
    },
}


def build_component_upgrades() -> dict:
    # Long-term link strategy: every pick uses a TAGGED AMAZON SEARCH link keyed
    # by product title. Search links never 404 (unlike per-product /dp/ASIN links,
    # which break when an ASIN is delisted or wrong), always carry the affiliate
    # tag, and need zero ASIN upkeep or PA-API access. Curated ASINs are kept in
    # the catalog only as human-readable notes; they no longer drive the URL.
    out: dict[str, dict] = {}
    for key, spec in CURATED.items():
        entry = {"label": spec["label"]}
        for slot in ("bangForBuck", "highEnd"):
            pick = dict(spec[slot])
            pick["url"] = search_link(pick["title"])
            pick.pop("asin", None)
            entry[slot] = pick
        out[key] = entry
    return out


# ---------------------------------------------------------------------------
# Best-effort PCPartPicker featured-builds scrape. Isolated and optional.
# ---------------------------------------------------------------------------
PCPP_FEATURED = "https://pcpartpicker.com/builds/"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"


def verify_links(component_upgrades: dict) -> dict:
    """Keep affiliate links alive. Best-effort check of each curated /dp/ link;
    on a DEFINITIVE dead response (404/410) downgrade it to a tagged search link
    for the same title. Transient failures (timeouts, blocks, 503) are ignored so
    a rate-limited runner never wipes good links. Stamps linkCheckedAt."""
    try:
        import requests
    except Exception:
        return component_upgrades

    sess = requests.Session()
    sess.headers.update({"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})

    def alive(url: str) -> bool | None:
        # returns False only on a definitive dead status; None = unknown/skip
        try:
            r = sess.head(url, timeout=12, allow_redirects=True)
            if r.status_code in (404, 410):
                return False
            if r.status_code == 405:  # HEAD not allowed; try a light GET
                r = sess.get(url, timeout=15, allow_redirects=True, stream=True)
                if r.status_code in (404, 410):
                    return False
            return True
        except Exception:
            return None

    checked = 0
    downgraded = 0
    for spec in component_upgrades.values():
        for slot in ("bangForBuck", "highEnd"):
            pick = spec.get(slot)
            if not pick or not pick.get("asin"):
                continue
            checked += 1
            if alive(pick["url"]) is False:
                pick["url"] = search_link(pick["title"])
                pick["asin"] = ""  # ASIN no longer valid
                downgraded += 1
        spec["linkCheckedAt"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"[links] checked {checked} dp links, downgraded {downgraded} dead -> search", file=sys.stderr)
    return component_upgrades


def scrape_pcpartpicker(max_builds: int = 6) -> list[dict]:
    """Return featured builds, or [] on any failure (never raises)."""
    try:
        import requests
        from bs4 import BeautifulSoup
    except Exception as e:  # deps missing
        print(f"[scrape] dependencies unavailable ({e}); skipping", file=sys.stderr)
        return []

    try:
        sess = requests.Session()
        sess.headers.update({"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
        resp = sess.get(PCPP_FEATURED, timeout=20)
        if resp.status_code != 200:
            print(f"[scrape] featured list HTTP {resp.status_code}; skipping", file=sys.stderr)
            return []
        soup = BeautifulSoup(resp.text, "html.parser")

        # Featured builds link out to /b/<id>. Collect unique build hrefs.
        hrefs: list[str] = []
        for a in soup.select("a[href^='/b/']"):
            h = a.get("href", "")
            if h and h not in hrefs:
                hrefs.append(h)
        hrefs = hrefs[:max_builds]

        builds: list[dict] = []
        for h in hrefs:
            try:
                builds.append(_scrape_build(sess, "https://pcpartpicker.com" + h))
            except Exception as e:
                print(f"[scrape] build {h} failed: {e}", file=sys.stderr)
        return [b for b in builds if b.get("components")]
    except Exception as e:
        print(f"[scrape] aborted: {e}", file=sys.stderr)
        return []


def _scrape_build(sess, url: str) -> dict:
    from bs4 import BeautifulSoup

    r = sess.get(url, timeout=20)
    soup = BeautifulSoup(r.text, "html.parser")
    name = (soup.find("h1").get_text(strip=True) if soup.find("h1") else "Featured Build")

    components: list[dict] = []
    # Build pages render parts in rows with a component-type cell and a name.
    for row in soup.select("tr.tr__product, .partlist__keyMetric, tr"):
        type_cell = row.select_one(".td__component, .tr__product .td__component")
        name_cell = row.select_one(".td__name a, td.td__name a")
        if not type_cell or not name_cell:
            continue
        ctype = type_cell.get_text(strip=True)
        cname = name_cell.get_text(strip=True)
        if not ctype or not cname:
            continue
        components.append({"type": ctype, "name": cname, "url": search_link(cname)})

    # de-dup by (type, name)
    seen, uniq = set(), []
    for c in components:
        k = (c["type"], c["name"])
        if k not in seen:
            seen.add(k)
            uniq.append(c)

    return {"name": name, "source": "pcpartpicker", "sourceUrl": url, "components": uniq}


# Curated fallback builds so the section is never empty on first run / block.
# Reviewed 2026-07-03. Three archetypes: budget 1080p, balanced 1440p, high-end 4K.
FALLBACK_SYSTEMS = [
    {
        "name": "Budget 1080p Gaming Build",
        "source": "curated",
        "components": [
            {"type": "CPU", "name": "AMD Ryzen 5 9600X", "url": search_link("AMD Ryzen 5 9600X")},
            {"type": "GPU", "name": "NVIDIA GeForce RTX 5060", "url": search_link("NVIDIA GeForce RTX 5060")},
            {"type": "Memory", "name": "Corsair Vengeance DDR5 32GB 6000 CL30", "url": search_link("Corsair Vengeance DDR5 32GB 6000 CL30")},
            {"type": "Storage", "name": "WD Black SN850X 1TB NVMe", "url": search_link("WD Black SN850X 1TB NVMe")},
            {"type": "Motherboard", "name": "Gigabyte B650 Aorus Elite AX", "url": search_link("Gigabyte B650 Aorus Elite AX")},
            {"type": "PSU", "name": "be quiet! Pure Power 12 M 750W", "url": search_link("be quiet! Pure Power 12 M 750W")},
            {"type": "Cooler", "name": "Thermalright Peerless Assassin 120 SE", "url": search_link("Thermalright Peerless Assassin 120 SE")},
        ],
    },
    {
        "name": "Balanced 1440p Gaming Build",
        "source": "curated",
        "components": [
            {"type": "CPU", "name": "AMD Ryzen 7 9700X", "url": search_link("AMD Ryzen 7 9700X")},
            {"type": "GPU", "name": "AMD Radeon RX 9070 16GB", "url": search_link("AMD Radeon RX 9070 16GB")},
            {"type": "Memory", "name": "Corsair Vengeance DDR5 32GB 6000 CL30", "url": search_link("Corsair Vengeance DDR5 32GB 6000 CL30")},
            {"type": "Storage", "name": "Samsung 990 EVO Plus 2TB NVMe", "url": search_link("Samsung 990 EVO Plus 2TB NVMe")},
            {"type": "Motherboard", "name": "MSI MAG B850 Tomahawk MAX WiFi", "url": search_link("MSI MAG B850 Tomahawk MAX WiFi")},
            {"type": "PSU", "name": "Montech Century II 850W 80+ Gold", "url": search_link("Montech Century II 850W 80+ Gold")},
            {"type": "Cooler", "name": "Thermalright Peerless Assassin 120 SE", "url": search_link("Thermalright Peerless Assassin 120 SE")},
        ],
    },
    {
        "name": "High-End 4K Build",
        "source": "curated",
        "components": [
            {"type": "CPU", "name": "AMD Ryzen 7 9800X3D", "url": search_link("AMD Ryzen 7 9800X3D")},
            {"type": "GPU", "name": "NVIDIA GeForce RTX 5080", "url": search_link("NVIDIA GeForce RTX 5080")},
            {"type": "Memory", "name": "G.Skill Trident Z5 Neo DDR5 64GB 6000", "url": search_link("G.Skill Trident Z5 Neo DDR5 64GB 6000")},
            {"type": "Storage", "name": "Samsung 990 PRO 2TB NVMe", "url": search_link("Samsung 990 PRO 2TB NVMe")},
            {"type": "Motherboard", "name": "ASUS ROG Strix X870E-E Gaming WiFi", "url": search_link("ASUS ROG Strix X870E-E Gaming WiFi")},
            {"type": "PSU", "name": "Corsair RM1000x 1000W 80+ Gold", "url": search_link("Corsair RM1000x 1000W 80+ Gold")},
            {"type": "Cooler", "name": "ARCTIC Liquid Freezer III 360", "url": search_link("ARCTIC Liquid Freezer III 360")},
        ],
    },
]


def load_previous() -> dict | None:
    if OUT.exists():
        try:
            return json.loads(OUT.read_text(encoding="utf-8"))
        except Exception:
            return None
    return None


def main() -> int:
    prev = load_previous()

    featured = scrape_pcpartpicker()
    if not featured:
        # Reuse the previous manifest only if it holds real scraped builds.
        # If the previous fallback was itself curated, prefer the (possibly
        # newer) curated list in this file — otherwise a stale curated build
        # persists forever once the scrape starts failing.
        prev_systems = (prev or {}).get("featuredSystems") or []
        if any(s.get("source") == "pcpartpicker" for s in prev_systems):
            featured = prev_systems
            print("[manifest] scrape empty; reusing previous scraped featuredSystems", file=sys.stderr)
        else:
            featured = FALLBACK_SYSTEMS
            print("[manifest] scrape empty; using curated fallback", file=sys.stderr)

    manifest = {
        "version": 1,
        "generatedAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "disclosure": DISCLOSURE,
        "componentUpgrades": verify_links(build_component_upgrades()),
        "featuredSystems": featured,
    }

    OUT.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"[manifest] wrote {OUT} "
          f"({len(manifest['componentUpgrades'])} categories, "
          f"{len(featured)} systems)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
