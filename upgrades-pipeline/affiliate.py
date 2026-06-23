"""Amazon affiliate link tooling for AROK Hardware Upgrades.

All links are tagged with the Associate store tag. Two link types:

  * dp_link(asin)        -> direct product link for a curated ASIN
  * search_link(query)   -> tagged Amazon search URL (fallback when no ASIN)

No scraping and no Product Advertising API are required: both forms are
valid Amazon Associate links that pass the tag, so they are compliant and
work without API approval. Curated ASINs give clean product cards for the
carousel; the search fallback covers any component name (e.g. scraped
PCPartPicker parts) we don't have a fixed ASIN for.
"""

from __future__ import annotations

from urllib.parse import quote_plus

# The Amazon Associates store/tracking tag. Override with the AMAZON_TAG
# environment variable if it ever changes.
import os

AFFILIATE_TAG = os.environ.get("AMAZON_TAG", "lifeupgrad02b-20")

# Marketplace host. US store by default.
AMAZON_HOST = os.environ.get("AMAZON_HOST", "www.amazon.com")

# FTC-required disclosure. Rendered in the Upgrades tab and stored in the
# manifest so the source of truth lives with the data.
DISCLOSURE = "As an Amazon Associate I earn from qualifying purchases."


def dp_link(asin: str) -> str:
    """Direct product link for a known ASIN, carrying the affiliate tag."""
    asin = (asin or "").strip()
    if not asin:
        raise ValueError("dp_link requires a non-empty ASIN")
    return f"https://{AMAZON_HOST}/dp/{asin}/?tag={AFFILIATE_TAG}"


def search_link(query: str) -> str:
    """Tagged Amazon search URL. Used when there is no curated ASIN."""
    q = quote_plus((query or "").strip())
    return f"https://{AMAZON_HOST}/s?k={q}&tag={AFFILIATE_TAG}"


def link_for(*, asin: str | None = None, query: str | None = None) -> str:
    """Best link available: prefer a curated ASIN, else a search fallback."""
    if asin:
        return dp_link(asin)
    if query:
        return search_link(query)
    raise ValueError("link_for needs either an asin or a query")


def has_tag(url: str) -> bool:
    """True if the URL carries our affiliate tag. Used by the test pass."""
    return f"tag={AFFILIATE_TAG}" in (url or "")


if __name__ == "__main__":
    # Quick self-check.
    print("tag      :", AFFILIATE_TAG)
    print("dp       :", dp_link("B0CGJ7DBPB"))
    print("search   :", search_link("AMD Ryzen 7 7800X3D"))
    print("disclosure:", DISCLOSURE)
