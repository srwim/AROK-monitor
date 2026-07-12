import { useEffect, useState, type ReactNode } from "react";
import { api, type Settings, type LicenseStatus, type UpdateInfo, type AiConfig } from "../api";
import { Panel, Badge, Button } from "../components/ui";

// ── License panel ─────────────────────────────────────────────────────────────

function LicensePanel() {
  const [lic, setLic] = useState<LicenseStatus | null>(null);
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api.license().then(setLic);
  }, []);

  const activate = async () => {
    const r = await api.setLicense(key);
    setLic(r);
    setMsg(r.licensed ? `Activated for ${r.name}` : `Activation failed: ${r.reason}`);
    if (r.licensed) setKey("");
  };

  return (
    <Panel
      title="License"
      action={
        <Badge tone={lic?.licensed ? "green" : "cyan"}>
          {lic ? (lic.licensed ? "licensed" : "Personal Use") : "…"}
        </Badge>
      }
    >
      {lic?.licensed ? (
        <div className="space-y-2 text-sm text-slate-400">
          <p>
            Licensed to <span className="text-slate-200">{lic.name}</span> ({lic.email})
            {lic.expires ? ` — expires ${lic.expires}` : " — perpetual"}
          </p>
          <Button onClick={async () => setLic(await api.setLicense(""))}>Deactivate</Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-slate-500">
            Offline Ed25519-signed key — no account or activation server needed. Paste your key:
          </p>
          <div className="flex gap-2">
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="eyJuYW1lIjo…"
              className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:border-cyan-700 focus:outline-none"
            />
            <Button onClick={activate} disabled={!key.trim()}>Activate</Button>
          </div>
          {msg && <p className="text-xs text-amber-400">{msg}</p>}
        </div>
      )}
    </Panel>
  );
}

function UpdatePanel({ version }: { version?: string }) {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      setInfo(await api.updateCheck());
    } finally {
      setChecking(false);
    }
  };

  return (
    <Panel
      title="Updates"
      action={<Button onClick={check} disabled={checking}>{checking ? "Checking…" : "Check for Updates"}</Button>}
    >
      <div className="space-y-2 text-sm text-slate-400">
        <p>
          Current version: <span className="text-slate-200">{version ?? "…"}</span>
        </p>
        {info &&
          (info.error ? (
            <p className="text-xs text-amber-400">Check failed: {info.error}</p>
          ) : info.update_available ? (
            <p>
              <Badge tone="green">update available</Badge>{" "}
              <span className="text-slate-200">{info.latest}</span> —{" "}
              <a href={info.asset_url ?? info.url ?? "#"} target="_blank" rel="noreferrer" className="text-cyan-400 underline">
                {info.asset_url ? "download installer (.exe)" : "download from GitHub Releases"}
              </a>
            </p>
          ) : (
            <p className="text-emerald-400">Up to date ({info.latest ?? info.current}).</p>
          ))}
      </div>
    </Panel>
  );
}

export default function SettingsTab() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [aiCfg, setAiCfg] = useState<AiConfig | null>(null);

  useEffect(() => {
    api.settings().then((s) => {
      setSettings(s);
      setThresholds({ ...s.abs_thresholds });
    });
    api.aiConfig().then(setAiCfg).catch(() => {});
  }, []);

  const setChat = async (v: boolean) => {
    setAiCfg(await api.setAiConfig({ chat_enabled: v }));
    setSaved(`Chat with AI ${v ? "enabled — available in AI Insights and on the Dashboard" : "disabled"}`);
  };

  const save = async (metric: string) => {
    await api.setThreshold(metric, thresholds[metric]);
    setSaved(`${metric.toUpperCase()} threshold saved: ${thresholds[metric]}%`);
  };

  const applyRuntime = async (patch: Parameters<typeof api.setRuntime>[0], label: string) => {
    const s = await api.setRuntime(patch);
    setSettings(s);
    setSaved(label);
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-slate-200">Settings</h2>

      {saved && (
        <div className="rounded-lg border border-emerald-900 bg-emerald-950/40 px-4 py-2 text-sm text-emerald-300">
          {saved} <button className="ml-2 text-emerald-500" onClick={() => setSaved(null)}>dismiss</button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Runtime">
          <dl className="space-y-3 text-sm">
            <Row label="Control mode">
              <div
                className="inline-flex overflow-hidden rounded-lg border border-slate-700 text-xs font-semibold"
                title="Whether control actions (kill, block IP, stop service) execute for real or are simulated"
              >
                <button
                  onClick={() => settings?.demo_mode && applyRuntime({ demo_mode: false }, "Control mode set to LIVE — actions execute")}
                  disabled={!settings}
                  className={`px-3 py-1.5 transition-colors ${
                    settings && !settings.demo_mode
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-900 text-slate-500 hover:text-slate-300"
                  }`}
                >
                  LIVE
                </button>
                <button
                  onClick={() => !settings?.demo_mode && applyRuntime({ demo_mode: true }, "Demo mode ON — actions simulated")}
                  disabled={!settings}
                  className={`px-3 py-1.5 transition-colors ${
                    settings?.demo_mode
                      ? "bg-amber-500 text-slate-950"
                      : "bg-slate-900 text-slate-500 hover:text-slate-300"
                  }`}
                >
                  Demo Mode
                </button>
              </div>
            </Row>
            <Row label="AI engine">
              <select
                value={settings?.ai_engine_mode ?? "off"}
                onChange={(e) => applyRuntime({ ai_engine: e.target.value }, `AI engine set to ${e.target.value}`)}
                disabled={!settings}
                className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-cyan-700 focus:outline-none"
              >
                <option value="off">Off</option>
                <option value="template">Template (no LLM)</option>
                <option value="local">Local model</option>
                <option value="cloud">Anthropic Cloud</option>
              </select>
            </Row>
            <Row label="Chat with AI">
              <button
                onClick={() => setChat(!(aiCfg?.chat_enabled ?? false))}
                disabled={!aiCfg}
                role="switch"
                aria-checked={aiCfg?.chat_enabled ?? false}
                title="Show a chat panel for the active AI engine in AI Insights and on the Dashboard"
                className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-40 ${
                  aiCfg?.chat_enabled ? "bg-cyan-600" : "bg-slate-700"
                }`}
              >
                <span
                  className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all"
                  style={{ left: aiCfg?.chat_enabled ? "18px" : "2px" }}
                />
              </button>
            </Row>
            <Row label="Sample interval">
              <NumberField
                suffix="s"
                value={settings?.sample_interval ?? 0}
                min={1}
                max={60}
                step={1}
                onCommit={(v) => applyRuntime({ sample_interval: v }, `Sample interval set to ${v}s`)}
              />
            </Row>
            <Row label="Z-score threshold">
              <NumberField
                suffix="σ"
                value={settings?.z_threshold ?? 0}
                min={1}
                max={6}
                step={0.1}
                onCommit={(v) => applyRuntime({ z_threshold: v }, `Z-score threshold set to ${v}σ`)}
              />
            </Row>
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-slate-500">
            These take effect immediately and persist across restarts. Environment variables
            (<code>AROK_DEMO</code>, <code>AROK_ANTHROPIC_KEY</code>) still provide the initial defaults.
          </p>
        </Panel>

        <Panel title="Absolute Alert Thresholds (safety net)">
          <div className="space-y-4">
            {Object.entries(thresholds).map(([metric, value]) => (
              <div key={metric} className="flex items-center gap-3">
                <span className="w-14 text-sm uppercase text-slate-400">{metric}</span>
                <input
                  type="range"
                  min={50}
                  max={100}
                  value={value}
                  onChange={(e) => setThresholds({ ...thresholds, [metric]: +e.target.value })}
                  className="flex-1 accent-cyan-500"
                />
                <span className="w-12 text-right text-sm tabular-nums text-slate-300">{value}%</span>
                <Button onClick={() => save(metric)}>Save</Button>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-slate-500">
            Absolute thresholds fire even on flat baselines where z-score detection is blind — the v3 anomaly
            detection safety net.
          </p>
        </Panel>
      </div>

      <Panel
        title="Desktop & tray"
        action={
          settings && !settings.desktop ? <Badge tone="slate">desktop app only</Badge> : undefined
        }
      >
        <div className="space-y-4">
          <PrefRow
            label="Run AROK Monitor on Windows startup"
            desc="Registers AROK in your per-user startup apps (no admin needed) so monitoring begins when you sign in. Also visible and removable in Task Manager → Startup apps."
            checked={settings?.autostart ?? false}
            onChange={async (v) => {
              const r = await api.setAutostart(v);
              setSettings(settings ? { ...settings, autostart: r.enabled } : settings);
              setSaved(r.ok ? `Run on startup ${r.enabled ? "enabled" : "disabled"}` : `Failed: ${r.detail ?? "unknown error"}`);
            }}
          />
          <PrefRow
            label="Automatic updates"
            desc="Check GitHub Releases in the background, download and verify new versions, and offer a one-click 'Relaunch to update' in the sidebar. Nothing installs until you click it."
            checked={settings?.prefs?.auto_update ?? true}
            onChange={async (v) => {
              const r = await api.setPref("auto_update", v);
              setSettings(settings ? { ...settings, prefs: r.prefs } : settings);
            }}
          />
          <PrefRow
            label="Close to tray"
            desc="Closing the window keeps AROK monitoring in the background — it stays in the system tray, logging metrics and alerts. Right-click the tray icon for quick controls; reopen anytime and Analytics will have the full history."
            checked={settings?.prefs?.close_to_tray ?? true}
            onChange={async (v) => {
              const r = await api.setPref("close_to_tray", v);
              setSettings(settings ? { ...settings, prefs: r.prefs } : settings);
            }}
          />
          <PrefRow
            label="Low-power background sampling"
            desc="While in the tray, sample every 30s instead of 3s — minimal resource usage, just logging. Normal speed resumes the moment the window reopens."
            checked={settings?.prefs?.low_power_tray ?? true}
            onChange={async (v) => {
              const r = await api.setPref("low_power_tray", v);
              setSettings(settings ? { ...settings, prefs: r.prefs } : settings);
            }}
          />
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <LicensePanel />
        <UpdatePanel version={settings?.version} />
      </div>

      <Panel title="About">
        <p className="text-sm leading-relaxed text-slate-400">
          AROK Monitor {settings?.version ?? "…"} — Autonomous Resource Observation Kernel. FastAPI backend with dual-serving
          strategy (React build with legacy fallback), deterministic detection with LLM narration, Ed25519 offline
          licensing and self-update via GitHub Releases in the full build.
        </p>
      </Panel>
    </div>
  );
}

function PrefRow({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div>
        <div className="text-sm font-medium text-slate-300">{label}</div>
        <div className="mt-0.5 max-w-xl text-xs leading-relaxed text-slate-500">{desc}</div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
        className={`relative mt-1 h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-cyan-600" : "bg-slate-700"}`}
      >
        <span
          className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all"
          style={{ left: checked ? "18px" : "2px" }}
        />
      </button>
    </div>
  );
}

// Editable number with commit-on-blur / Enter, seeded from the live value.
function NumberField({
  value, min, max, step, suffix, onCommit,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const n = Number(draft);
    if (!isNaN(n) && n !== value) onCommit(Math.min(max, Math.max(min, n)));
    else setDraft(String(value));
  };

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="w-16 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-right text-xs tabular-nums text-slate-200 focus:border-cyan-700 focus:outline-none"
      />
      {suffix && <span className="text-xs text-slate-500">{suffix}</span>}
    </span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
