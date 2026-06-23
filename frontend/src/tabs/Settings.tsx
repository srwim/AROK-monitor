import { useEffect, useState, type ReactNode } from "react";
import { api, type Settings, type LicenseStatus, type UpdateInfo } from "../api";
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
        <Badge tone={lic?.licensed ? "green" : "amber"}>
          {lic ? (lic.licensed ? "licensed" : "unlicensed — demo") : "…"}
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
      action={<Button onClick={check} disabled={checking}>{checking ? "Checking…" : "Check for updates"}</Button>}
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

  useEffect(() => {
    api.settings().then((s) => {
      setSettings(s);
      setThresholds({ ...s.abs_thresholds });
    });
  }, []);

  const save = async (metric: string) => {
    await api.setThreshold(metric, thresholds[metric]);
    setSaved(`${metric.toUpperCase()} threshold saved: ${thresholds[metric]}%`);
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
            <Row label="Demo mode">
              <Badge tone={settings?.demo_mode ? "amber" : "green"}>
                {settings?.demo_mode ? "ON — control actions are simulated" : "OFF — control actions are live"}
              </Badge>
            </Row>
            <Row label="AI engine">
              <Badge tone="cyan">{settings?.ai_engine ?? "…"}</Badge>
            </Row>
            <Row label="Sample interval">
              <span className="text-slate-300">{settings?.sample_interval ?? "…"}s</span>
            </Row>
            <Row label="Z-score threshold">
              <span className="text-slate-300">{settings?.z_threshold ?? "…"}σ</span>
            </Row>
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-slate-500">
            Control actions are <strong>live by default</strong>. Set <code>AROK_DEMO=1</code> to simulate them instead,
            <code>AROK_LOCAL_MODEL</code> to point at a local GGUF model, <code>AROK_ANTHROPIC_KEY</code> for API fallback narration.
          </p>
        </Panel>

        <Panel title="Absolute alert thresholds (safety net)">
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
          AROK Monitor v1.0 — Autonomous Resource Observation Kernel. FastAPI backend with dual-serving
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

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
