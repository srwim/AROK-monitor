# Contributing to AROK Monitor

Thanks for your interest! AROK is a Windows desktop system monitor built on one architectural conviction — deterministic detection, AI narration — and contributions that respect that rule are very welcome.

## Ground rules (the short version)

1. **Never move detection into the model.** `backend/monitor.py` (and `sensors.py`) detect everything deterministically — z-scores, thresholds, SMART status. `backend/ai.py` only turns structured findings into prose. A PR that asks an LLM to decide whether something is anomalous will be declined, however clever it is.
2. **The app must always work offline and without AI.** Every feature needs a sane path when no model is downloaded, no API key is set, and no network exists. The deterministic template narrator is the floor, not a fallback afterthought.
3. **Control actions must respect demo mode.** Anything that kills a process, stops a service, blocks an IP, or writes to the registry goes through the demo-mode gate (`AROK_DEMO`) and logs to the event log.
4. **Affiliate integrity.** All Amazon links must carry the Associate tag and `rel="sponsored nofollow noopener"`, with the FTC disclosure rendered wherever they appear. Links are tagged *search* URLs (never bare `/dp/` ASINs — they go stale). Don't add other monetization (the paid "Pro" upsell was removed deliberately; please don't reintroduce it).
5. **Privacy is a feature.** No telemetry, no phoning home, no accounts. Network calls are limited to: the manifest fetch, the GitHub release check, the optional model download, and the optional user-configured Anthropic API.

## Getting set up (Windows)

Prereqs: Python 3.10+, Node 18+, and optionally Inno Setup 6 for installer builds.

```
git clone https://github.com/srwim/AROK-monitor
cd AROK-monitor
run_demo.bat          # venv + deps + server at http://127.0.0.1:8420
build_frontend.bat    # build the React UI (then restart run_demo.bat)
```

For frontend work with hot reload:

```
cd frontend
npm install
npm run dev           # proxies /api and /ws to port 8420
```

`run_desktop.bat` launches the native pywebview window; `make_installer.bat` runs the full packaging pipeline.

## Project layout

```
backend/            FastAPI app + monitoring core (Python)
  main.py           routes, dual-serving, localhost security middleware
  monitor.py        deterministic anomaly detection
  sensors.py        CPU temp + SMART disk health (best-effort, no hard deps)
  ai.py             narration layer (local GGUF → Anthropic → template)
  control.py        demo-safe control actions
frontend/           Vite + React + TS + Tailwind v4
  src/tabs/         one file per tab
  src/components/   shared primitives (ui.tsx, NetworkMap.tsx)
  src/api.ts        typed API client (handles the session token)
upgrades-pipeline/  affiliate manifest generator (runs daily via Action)
```

## Making changes

**Frontend:** `tsc -b` in `frontend/` is the authoritative correctness check — run it before considering a change done. Tabs live one-per-file in `src/tabs/`; shared primitives go in `src/components/ui.tsx`; all data fetching goes through `src/api.ts` + the `usePolling` hook. State-changing endpoints require the session token — use the existing `post`/`del` helpers in `api.ts` and it's handled for you.

**Backend:** keep modules dependency-light and degradation-friendly — everything in `hardware.py` and `sensors.py` must return sensible nulls rather than raise when WMI/PowerShell/sensors are unavailable. New state-changing endpoints are covered by the auth middleware automatically; think twice before adding anything to its exemption list.

**Affiliate pipeline:** curated picks live in the `CURATED` dict in `upgrades-pipeline/build_manifest.py` (titles + price hints; links are generated tagged searches). If you update picks, note the review date in the comment above the dict. Validate with `python build_manifest.py` and check the output against `manifest.schema.json`.

## Submitting

- Open an issue first for anything non-trivial — especially new tabs, new monetization surfaces, or anything touching the security middleware.
- Commit messages: conventional-ish prefixes (`feat:`, `fix:`, `chore:`, `docs:`) with a concise description.
- One logical change per PR. Include before/after screenshots for UI changes.
- PR checklist:
  - [ ] `tsc -b` passes (frontend changes)
  - [ ] Runs offline with AI disabled
  - [ ] Demo mode respected for any control action
  - [ ] Degrades gracefully when WMI/PowerShell/sensors are unavailable
  - [ ] Affiliate links (if touched) are tagged, `rel`-attributed, and disclosed

There's no automated test suite yet — manual verification against `run_demo.bat` plus `tsc -b` is the current bar. A PR adding a real test harness would be extremely welcome.

## Reporting issues

Bug reports: include Windows version, AROK version (Settings → bottom), whether you're on the installer or running from source, and the relevant tab. Security issues in the localhost API: please report privately via GitHub security advisories rather than a public issue.

## License

MIT. By contributing, you agree your contributions are licensed under the same terms.
