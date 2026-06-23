# AROK Monitor v1.0

Autonomous Resource Observation Kernel. FastAPI backend + React/Vite/Tailwind UI, following the v3 architecture: deterministic detection with LLM narration, dual-serving frontend, demo-safe control plane.

## Quick start (Windows)

1. Double-click **`run_demo.bat`** — creates a venv, installs deps, starts the server, opens the browser at `http://127.0.0.1:8420`. You get the legacy console immediately.
2. Double-click **`build_frontend.bat`** (requires Node 18+) — builds the full eight-tab React UI. Restart `run_demo.bat` and it's served automatically (dual-serving strategy).

Other launchers: **`run_desktop.bat`** — native window (pywebview/WebView2), no browser. **`make_installer.bat`** — full pipeline: React build → PyInstaller `AROK.exe` → Inno Setup `installer_out\AROK-Setup-3.1.0.exe` (needs Inno Setup 6).

For React dev with hot reload: `cd frontend && npm run dev` (proxies `/api` and `/ws` to port 8420).

## Licensing & updates

Generate a keypair + license on a trusted machine (never ship `license_private.pem`):

```
python backend\generate_license.py --name "Customer" --email c@example.com --days 365
```

First run creates `license_pub.hex` (ships with the app; bundled by `arok.spec` automatically). Activate keys in **Settings → License** — verification is offline Ed25519. **Settings → Updates** checks GitHub Releases (`AROK_REPO`, default `srwim/AROK`).

## Real local AI

Set `AROK_MODEL_URL` to a GGUF download URL (e.g. a Gemma quant from Hugging Face, ~1.7 GB Q4) and the in-app download becomes real even in demo mode. Install inference support with `pip install -r backend\requirements-ai.txt`. Without a URL, the download is simulated for demoing the UX.

## The eight tabs

Dashboard · Processes · Network · Services · Analytics · AI Insights · Alerts · Settings — all live against the backend, polling every 3–10s.

## Environment flags

| Variable | Default | Effect |
|---|---|---|
| `AROK_DEMO` | `1` | `1` = control actions (kill, block IP, service stop) are simulated and logged. `0` = live. |
| `AROK_LOCAL_MODEL` | unset | Path to a local GGUF model (e.g. Gemma 3 2B) for offline narration via llama-cpp. |
| `AROK_ANTHROPIC_KEY` | unset | Anthropic API fallback for narration. |
| `AROK_DB` | `backend/arok.db` | SQLite path. |

Without either AI flag, narration uses the deterministic template engine — the demo always works offline.

## Architecture notes

- **LLM narrator pattern** — `monitor.py` detects everything deterministically (z-score over a 60-sample window + absolute-threshold safety net for flat baselines); `ai.py` only turns findings into prose.
- **Dual serving** — `main.py` serves `frontend/dist/` when built, falls back to `backend/index.html` otherwise.
- **VACUUM fix** — `db.purge()` runs VACUUM on a fresh autocommit connection, outside any transaction.
- **Demo-safe controls** — every control endpoint logs to the event log; in demo mode nothing is executed.

## Files

```
backend/   main.py · monitor.py · db.py · ai.py · control.py · index.html (legacy fallback) · requirements.txt
frontend/  Vite + React + TS + Tailwind v4 · src/tabs/ (8 tabs) · src/components/ui.tsx (NumberTicker etc.)
```
