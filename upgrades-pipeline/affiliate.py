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


# ---------------------------------------------------------------------------
# Non-Amazon stores. Used when a part isn't sold on Amazon: we link to the next
# best store so the recommendation is still actionable. No affiliate program is
# wired up for these yet, so their links are plain (untagged) searches. To start
# earning on a store later, add its affiliate/tracking query params to
# STORE_AFFILIATE[store] and store_link() will append them automatically — no
# other code changes needed.
# ---------------------------------------------------------------------------
STORE_SEARCH: dict[str, str] = {
    "Newegg": "https://www.newegg.com/p/pl?d={q}",
    "B&H": "https://www.bhphotovideo.com/c/search?q={q}",
    "Micro Center": "https://www.microcenter.com/search/search_results.aspx?Ntt={q}",
    "Best Buy": "https://www.bestbuy.com/site/searchpage.jsp?st={q}",
}

# Future affiliate params per store, e.g. {"Newegg": {"cm_mmc": "..."}}. Empty
# today — links stay clean until a program is set up.
STORE_AFFILIATE: dict[str, dict[str, str]] = {}


def store_link(query: str, store: str = "Amazon") -> str:
    """Best purchase link for a part.

    Amazon (the default) returns a tagged affiliate search link. Any other known
    store returns a plain search link, plus affiliate params if/when they are
    configured in STORE_AFFILIATE. An unknown store safely falls back to Amazon.
    """
    if store == "Amazon" or store not in STORE_SEARCH:
        return search_link(query)
    url = STORE_SEARCH[store].format(q=quote_plus((query or "").strip()))
    params = STORE_AFFILIATE.get(store)
    if params:
        from urllib.parse import urlencode
        url += ("&" if "?" in url else "?") + urlencode(params)
    return url


if __name__ == "__main__":
    # Quick self-check.
    print("tag      :", AFFILIATE_TAG)
    print("dp       :", dp_link("B0CGJ7DBPB"))
    print("search   :", search_link("AMD Ryzen 7 7800X3D"))
    print("disclosure:", DISCLOSURE)
