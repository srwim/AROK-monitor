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

from affiliate import DISCLOSURE, search_link, store_link
from icecat import image_for

HERE = Path(__file__).parent
OUT = HERE / "manifest.json"
CATALOG_PATH = HERE / "parts_catalog.json"

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
        comp = {"type": ctype, "name": cname, "url": search_link(cname)}
        # best-effort per-part price where the build page shows one
        price_cell = row.select_one(".td__price")
        if price_cell:
            ptxt = price_cell.get_text(strip=True)
            if ptxt.startswith("$"):
                comp["price"] = ptxt
        components.append(comp)

    # de-dup by (type, name)
    seen, uniq = set(), []
    for c in components:
        k = (c["type"], c["name"])
        if k not in seen:
            seen.add(k)
            uniq.append(c)

    return {"name": name, "source": "pcpartpicker", "sourceUrl": url, "components": uniq}


# Curated fallback builds so the section is never empty on first run / block.
# Reviewed 2026-07-03. Four archetypes: budget 1080p, balanced 1440p, high-end
# 4K, and a Bleeding Edge flagship (picks to follow). Prices are hints (same
# convention as CURATED); totals are computed.
#
# Each part tuple is (type, name, price[, store]). Store defaults to "Amazon"
# (tagged affiliate link); pass another known store (see affiliate.STORE_SEARCH)
# for parts Amazon doesn't carry — those get a plain, untagged link. A build
# with no parts renders as "coming soon" using its note.
def _curated_system(name: str, parts: list[tuple], note: str | None = None,
                    source_url: str | None = None) -> dict:
    # Collapse duplicate parts (same type+name+store) into one row with a qty,
    # so listing a part twice (e.g. two identical SSDs) renders as "x2" with the
    # unit price rather than a repeated line. Price stays per-unit; the build
    # total counts every tuple, so quantity is reflected automatically.
    comps: list[dict] = []
    by_key: dict[tuple, dict] = {}
    for p in parts:
        t, n, price = p[0], p[1], p[2]
        # 4th tuple element: a store name (str, back-compat) or an options dict
        # {store, image, brand, mpn}. image = tier-1 manual thumbnail; brand+mpn
        # = tier-2 Icecat inputs (resolved later, in resolve_images()).
        opts = p[3] if len(p) > 3 else {}
        if isinstance(opts, str):
            opts = {"store": opts}
        store = opts.get("store", "Amazon")
        key = (t, n, store)
        if key in by_key:
            by_key[key]["qty"] = by_key[key].get("qty", 1) + 1
            continue
        comp = {"type": t, "name": n, "price": f"~${price}", "url": store_link(n, store)}
        if store != "Amazon":
            comp["store"] = store
        if opts.get("image"):
            comp["image"] = opts["image"]
        elif opts.get("brand") and opts.get("mpn"):
            comp["_brand"], comp["_mpn"] = opts["brand"], opts["mpn"]
        by_key[key] = comp
        comps.append(comp)

    system: dict = {"name": name, "source": "curated", "components": comps}
    if parts:
        system["totalPrice"] = f"~${sum(p[2] for p in parts):,}"
    if note:
        system["note"] = note
    if source_url:
        system["sourceUrl"] = source_url
    return system


FALLBACK_SYSTEMS = [
    _curated_system("Budget 1080p Gaming Build", [
        ("CPU", "AMD Ryzen 5 9600X", 180),
        ("GPU", "NVIDIA GeForce RTX 5060", 300),
        ("Memory", "Corsair Vengeance DDR5 32GB 6000 CL30", 380),
        ("Storage", "WD Black SN850X 1TB NVMe", 100),
        ("Motherboard", "Gigabyte B650 Aorus Elite AX", 170),
        ("PSU", "be quiet! Pure Power 12 M 750W", 80),
        ("Cooler", "Thermalright Peerless Assassin 120 SE", 36),
        ("Case", "Montech AIR 903 MAX", 75),
    ]),
    _curated_system("Balanced 1440p Gaming Build", [
        ("CPU", "AMD Ryzen 7 9700X", 300),
        ("GPU", "AMD Radeon RX 9070 16GB", 550),
        ("Memory", "Corsair Vengeance DDR5 32GB 6000 CL30", 380),
        ("Storage", "Samsung 990 EVO Plus 2TB NVMe", 160),
        ("Motherboard", "MSI MAG B850 Tomahawk MAX WiFi", 250),
        ("PSU", "Montech Century II 850W 80+ Gold", 90),
        ("Cooler", "Thermalright Peerless Assassin 120 SE", 36),
        ("Case", "Corsair 4000D Airflow", 95),
    ]),
    _curated_system("High-End 4K Build", [
        ("CPU", "AMD Ryzen 7 9800X3D", 440),
        ("GPU", "NVIDIA GeForce RTX 5080", 1000),
        ("Memory", "G.Skill Trident Z5 Neo DDR5 64GB 6000", 700),
        ("Storage", "Samsung 990 PRO 2TB NVMe", 200),
        ("Motherboard", "ASUS ROG Strix X870E-E Gaming WiFi", 500),
        ("PSU", "Corsair RM1000x 1000W 80+ Gold", 190),
        ("Cooler", "ARCTIC Liquid Freezer III 360", 120),
        ("Case", "Lian Li O11 Dynamic EVO", 170),
    ]),
    # 4th build: flagship, no-compromise (curated from a compatibility-checked
    # PCPartPicker list). Dual 8TB Gen5 SSDs, 128GB DDR5, RTX 5090.
    _curated_system("Bleeding Edge", [
        ("CPU", "AMD Ryzen 9 9950X3D", 670),
        ("GPU", "ASUS ROG Astral OC GeForce RTX 5090 32GB", 4330),
        ("Memory", "Corsair Dominator Platinum RGB 64GB (2x32) DDR5-5200 CL40", 973),
        ("Memory", "Corsair Dominator Platinum RGB 64GB (2x32) DDR5-5200 CL40", 973),
        ("Storage", "Samsung 9100 PRO 8TB NVMe PCIe 5.0", 2000),
        ("Storage", "Samsung 9100 PRO 8TB NVMe PCIe 5.0", 2000),
        ("Motherboard", "ASUS ROG Crosshair X870E GLACIAL EATX", 1300),
        ("PSU", "Corsair HX1500i 1500W 80+ Platinum", 350),
        ("Cooler", "Corsair iCUE LINK TITAN 360 RX LCD", 220),
        ("Case", "HYTE Y70 Touch Infinite", 350),
    ], source_url="https://pcpartpicker.com/list/NBpjn2"),
]


# ---------------------------------------------------------------------------
# GPU watch — a curated watch-list of high-demand cards with a launch-reference
# MSRP and a tagged Amazon search link. Deliberately NOT scraped: Amazon and
# PCPartPicker block headless requests and their ToS forbids scraping (and we
# are an Amazon Associate — automated access risks the affiliate account). The
# MSRP is a static deal-benchmark; the user compares it to live Amazon listings.
# ---------------------------------------------------------------------------
GPU_WATCH = [
    {"model": "NVIDIA GeForce RTX 5080", "msrp": "$999"},
    {"model": "NVIDIA GeForce RTX 5090", "msrp": "$1,999"},
]


def gpu_watch() -> list[dict]:
    """Curated watch-list entries: model, launch-reference MSRP, and a tagged
    Amazon search link. No network — nothing to fail, nothing to go stale."""
    return [
        {"model": s["model"], "msrp": s["msrp"], "url": search_link(s["model"])}
        for s in GPU_WATCH
    ]


def load_catalog() -> dict:
    """Part-metadata registry: name -> {brand, mpn, image, ...}. A missing or
    broken file yields an empty catalog, so enrichment simply does nothing."""
    try:
        data = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
        return (data or {}).get("parts", {})
    except Exception:
        return {}


def enrich_from_catalog(systems: list[dict], catalog: dict) -> list[dict]:
    """Attach thumbnail metadata from the catalog by exact component name. A
    catalog 'image' becomes the tier-1 thumbnail; otherwise brand+mpn are stashed
    as tier-2 (Icecat) inputs. Values already set inline on the component win."""
    for system in systems:
        for comp in system.get("components", []):
            meta = catalog.get(comp["name"])
            if not meta or "image" in comp or "_mpn" in comp:
                continue
            if meta.get("image"):
                comp["image"] = meta["image"]
            elif meta.get("brand") and meta.get("mpn"):
                comp["_brand"], comp["_mpn"] = meta["brand"], meta["mpn"]
    return systems


def resolve_images(systems: list[dict]) -> list[dict]:
    """Tier-2 thumbnail fill. For any component that has no manually curated
    image but carries a brand+MPN, ask Open Icecat for one. The private lookup
    keys (_brand/_mpn) are always stripped so they never reach the manifest.
    Icecat is inert without credentials, so this is a no-op until they're set."""
    for system in systems:
        for comp in system.get("components", []):
            if "image" not in comp and comp.get("_mpn"):
                url = image_for(comp.get("_brand", ""), comp.get("_mpn", ""))
                if url:
                    comp["image"] = url
            comp.pop("_brand", None)
            comp.pop("_mpn", None)
    return systems


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

    featured = enrich_from_catalog(featured, load_catalog())
    featured = resolve_images(featured)

    manifest = {
        "version": 1,
        "generatedAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "disclosure": DISCLOSURE,
        "componentUpgrades": verify_links(build_component_upgrades()),
        "featuredSystems": featured,
        "gpuWatch": gpu_watch(),
    }

    OUT.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"[manifest] wrote {OUT} "
          f"({len(manifest['componentUpgrades'])} categories, "
          f"{len(featured)} systems)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
