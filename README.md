<div align="center">

<img src="branding/orb-128.png" alt="AROK Monitor" width="96" />

# AROK Monitor

**The system monitor that explains itself.**

AROK watches your Windows PC, detects anomalies deterministically, and uses a local AI to narrate what's happening in plain English — 100% on your machine. No cloud, no telemetry, no account.

[![Latest release](https://img.shields.io/github/v/release/srwim/AROK-monitor)](https://github.com/srwim/AROK-monitor/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/srwim/AROK-monitor/total)](https://github.com/srwim/AROK-monitor/releases)
[![License: MIT](https://img.shields.io/github/license/srwim/AROK-monitor)](LICENSE)
![Platform: Windows](https://img.shields.io/badge/platform-Windows%2010%2F11-blue)

**[⬇ Download the latest installer](https://github.com/srwim/AROK-monitor/releases/latest)**

<img src="docs/screenshots/network-map.gif" alt="AROK Monitor dashboard — live stats, AI Pulse narration, and the animated world map of network connections" width="820" />

<!-- Still version for listings / social previews: docs/screenshots/dashboard.png -->

</div>

---

## Why AROK?

- **It explains, it doesn't just graph.** Every monitor shows you a CPU line. AROK's local AI turns deterministic findings into plain English: *"Chrome has been climbing for 20 minutes and is now using 40% CPU — unusual for this time of day."* Detection is never delegated to the model, so it's exact; the AI only narrates.
- **100% local and private.** Metrics, history, and AI inference all stay on your machine. Works fully offline. Open source (MIT), no account, no telemetry, no ads.
- **Free.** AROK is monetized only by optional, clearly-disclosed Amazon affiliate links in the Hardware Upgrades tab — if you never open that tab, AROK costs nothing and sells nothing.

## What's inside

Ten tabs, all live against the local backend: **Dashboard · Processes · Network · Services · Cleanup · Analytics · AI Insights · Alerts · Upgrades · Settings**, plus a global **Gaming mode** toggle (with auto-detect).

- **Dashboard** — live CPU/memory/disk/network/process cards with drill-down detail and an AI Pulse narrative.
- **Network** — a geographic world map that resolves external connections and animates traffic between you and each endpoint, above a live connections table.
- **AI Insights** — the narrator: anomaly findings, plain-English system story, and one-click optimization recommendations.
- **Cleanup** — temp-file cleaner, conservative registry cleaner (restore point + `.reg` backup first), and a guided, checksum-verified Tron launcher.
- **Upgrades** — hardware-aware component picks matched to your detected platform (AMD/Intel, DDR4/DDR5), refreshed daily. *Affiliate-funded — every link is tagged and FTC-disclosed.*
- **Settings** — runtime settings, offline Ed25519 licensing, GitHub-Releases update checks.

## Real local AI

The in-app model download is real by default: AROK fetches a Gemma 2 2B Q4 GGUF (~1.7 GB) from Hugging Face, after which narration runs entirely offline (`pip install -r backend\requirements-ai.txt` for inference support). Engine priority: **local model → Anthropic Cloud (optional, bring your own key) → deterministic template**. Without any AI configured, narration falls back to templates — the app always works.

## Install

**Users:** grab the installer from [Releases](https://github.com/srwim/AROK-monitor/releases/latest) and run it.

**From source (Windows):**

1. `run_demo.bat` — creates a venv, installs deps, serves at `http://127.0.0.1:8420` (legacy console immediately).
2. `build_frontend.bat` (Node 18+) — builds the React UI; restart `run_demo.bat` to serve it.

Other launchers: `run_desktop.bat` (native pywebview/WebView2 window, system tray) · `make_installer.bat` (React build → PyInstaller → Inno Setup installer, needs Inno Setup 6).

React dev with hot reload: `cd frontend && npm run dev` (proxies `/api` and `/ws` to port 8420). `tsc -b` is the authoritative frontend correctness check.

## Security model

- The server binds to `127.0.0.1` only.
- All requests must carry a localhost `Host`/`Origin` (blocks DNS rebinding); all state-changing API calls require a per-session token (blocks cross-site request forgery from malicious pages).
- Control actions (kill process, block IP, stop service) can run in **demo mode** (`AROK_DEMO=1`): simulated and logged, never executed.
- Licensing is offline Ed25519 — generate keys with `python backend\generate_license.py` on a trusted machine; never ship `license_private.pem`. Unlicensed installs run as **Personal Use** with full functionality.

## Environment flags

| Variable | Default | Effect |
|---|---|---|
| `AROK_DEMO` | `0` | `0` = control actions execute for real. `1` = simulated and logged. Editable at runtime in Settings. |
| `AROK_MODEL_URL` | unset | Override the local-model GGUF download URL (defaults to a public Gemma 2 2B Q4). |
| `AROK_ANTHROPIC_KEY` | unset | Anthropic API key for cloud narration. |
| `AROK_REPO` | `srwim/AROK-monitor` | GitHub repo for update checks. |
| `AROK_DB` | `backend/arok.db` | SQLite path. |

## Architecture notes

- **LLM narrator pattern** — `monitor.py` detects everything deterministically (z-score over a 60-sample window + absolute-threshold safety net for flat baselines); `ai.py` only turns findings into prose.
- **Dual serving** — `main.py` serves `frontend/dist/` when built, falls back to `backend/index.html` otherwise.
- **Demo-safe controls** — every control endpoint logs to the event log; in demo mode nothing is executed.
- **Affiliate manifest** — tagged Amazon links generated by `upgrades-pipeline/build_manifest.py`; a daily GitHub Action refreshes `manifest.json`, with a bundled fallback at `frontend/public/manifest.json`. Search-URL links, so they never go stale or 404.

## Files

```
backend/   main.py · monitor.py · db.py · ai.py · control.py · hardware.py · cleanup.py · optimizer.py
           licensing.py · updater.py · desktop.py · index.html (legacy fallback) · arok.spec · requirements*.txt
frontend/  Vite + React + TS + Tailwind v4 · src/tabs/ (10 tabs) · src/components/ (ui.tsx, NetworkMap.tsx) · src/geo.ts
upgrades-pipeline/  build_manifest.py · affiliate.py · manifest.json
```

## License

MIT — see [LICENSE](LICENSE).

*As an Amazon Associate, this project earns from qualifying purchases made through links in the Hardware Upgrades tab.*
