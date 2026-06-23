# AROK Hardware Upgrades — data pipeline

This folder feeds the **Upgrades** tab. The app does not ship daily, so the
data lives in a `manifest.json` that a GitHub Action regenerates every day and
commits to the repo. The app fetches the **raw** GitHub URL at runtime, so the
upgrade picks and featured builds stay fresh without any app update.

## Files

| File | Purpose |
|---|---|
| `affiliate.py` | Builds Amazon affiliate links (tag `lifeupgrad02b-20`). `/dp/<ASIN>` for curated picks, tagged search URLs as fallback. |
| `build_manifest.py` | Generates `manifest.json`: curated carousel picks + best-effort PCPartPicker featured builds. |
| `manifest.schema.json` | JSON schema the manifest is validated against. |
| `manifest.sample.json` | Example output. |
| `manifest.json` | The live file the app reads (regenerated daily). |
| `requirements.txt` | Python deps for the generator. |
| `.github-workflow--update-manifest.yml` | The daily Action. **Move to `.github/workflows/update-manifest.yml`.** |

## How the data is sourced (and why)

- **Carousel picks** (`componentUpgrades`) are **curated** in `build_manifest.py`
  → edit the `CURATED` dict to change what rotates. Each pick uses a fixed ASIN
  for a clean product card. This needs no Amazon API and no scraping, so it is
  compliant and works today.
- **Full systems** (`featuredSystems`) are a **best-effort scrape** of
  PCPartPicker's featured builds. Each part name is turned into a tagged Amazon
  search link. The scrape is fully isolated: if PCPartPicker blocks it or
  changes layout, the previous good `manifest.json` is reused (or a curated
  fallback build is used on first run). The app never breaks.

> Note: programmatic live Amazon pricing would require the Product Advertising
> API (approved Associate + recent qualifying sales; being deprecated in favor
> of the Creators API). This pipeline deliberately avoids that dependency by
> using curated ASINs + search links. If you later get API access, swap the URL
> builders in `affiliate.py` for live lookups — nothing else changes.

## Wiring the app to the manifest

Point the Upgrades tab at the raw URL of the committed manifest:

```
https://raw.githubusercontent.com/srwim/AROK/main/upgrades-pipeline/manifest.json
```

Fetch on tab mount, cache the last good copy locally so the tab still renders
offline.

## Compliance

- The affiliate tag `lifeupgrad02b-20` is applied to every outbound link
  (verified by the test pass — no untagged URLs).
- The FTC-required disclosure ("As an Amazon Associate I earn from qualifying
  purchases.") is stored in the manifest and must be rendered in the tab.

## Run locally

```bash
pip install -r requirements.txt
python build_manifest.py        # writes manifest.json
```
