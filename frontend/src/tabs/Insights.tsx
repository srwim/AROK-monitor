import { useEffect, useState } from "react";
import {
  Sparkles, RefreshCw, Download, Cloud, HardDrive, Power, Wrench,
  Check, X, ExternalLink, Key, ChevronRight,
} from "lucide-react";
import { api, type Insight, type OptimizeResult, type CloudConnection } from "../api";
import { usePolling, fmtTime } from "../hooks";
import { Panel, Badge } from "../components/ui";

// ── Helpers ──────────────────────────────────────────────────────────────────

function Toggle({
  checked, disabled, onChange,
}: {
  checked: boolean; disabled?: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-40 ${
        checked ? "bg-cyan-600" : "bg-slate-700"
      }`}
      role="switch"
      aria-checked={checked}
    >
      <span
        className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all"
        style={{ left: checked ? "18px" : "2px" }}
      />
    </button>
  );
}

// ── Recommendations panel ─────────────────────────────────────────────────────

function RecommendationsPanel({ insight }: { insight: Insight | null }) {
  const [results, setResults] = useState<OptimizeResult[] | null>(null);
  const [running, setRunning] = useState(false);
  const recs = insight?.recommendations ?? [];

  const optimize = async () => {
    setRunning(true);
    try {
      setResults(await api.optimize());
    } finally {
      setRunning(false);
    }
  };

  return (
    <Panel
      title={`Optimization recommendations (${recs.length})`}
      action={
        <button
          onClick={optimize}
          disabled={running || recs.length === 0}
          className="flex items-center gap-2 rounded-lg bg-gradient-to-br from-emerald-600 to-teal-700 px-3 py-1.5 text-sm font-semibold text-white hover:from-emerald-500 hover:to-teal-600 disabled:opacity-40"
        >
          <Wrench size={14} className={running ? "animate-spin" : ""} />
          {running ? "Optimizing…" : "Optimize"}
        </button>
      }
    >
      {recs.length === 0 ? (
        <p className="text-sm text-slate-500">No recommendations — system is running clean.</p>
      ) : (
        <ul className="space-y-3">
          {recs.map((r) => {
            const res = results?.find((x) => x.id === r.id);
            return (
              <li key={r.id} className="flex items-start gap-3">
                {res ? (
                  res.ok ? (
                    <Check size={16} className="mt-0.5 shrink-0 text-emerald-400" />
                  ) : (
                    <X size={16} className="mt-0.5 shrink-0 text-red-400" />
                  )
                ) : (
                  <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-300">
                    {r.title}{" "}
                    <Badge tone="green">{r.impact}</Badge>
                  </div>
                  <div className="text-xs text-slate-500">
                    {res ? res.detail : r.detail}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// ── Local model panel ─────────────────────────────────────────────────────────

function LocalModelPanel({
  config, expanded, onToggle, onDownload,
}: {
  config: { local_enabled: boolean; local_model_ready: boolean; local_model_simulated: boolean; download: { status: string; pct: number; error: string | null } } | null;
  expanded: boolean;
  onToggle: (v: boolean) => void;
  onDownload: () => void;
}) {
  const downloading = config?.download.status === "downloading";

  if (!expanded) {
    // Minimised: compact card
    return (
      <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/30 p-4">
        <div className="flex items-center gap-3">
          <HardDrive size={16} className="text-slate-500" />
          <div>
            <div className="text-sm font-medium text-slate-400">Local Model</div>
            <div className="text-xs text-slate-600">
              {config?.local_model_ready ? "Gemma 2 2B installed" : "Not downloaded"}
            </div>
          </div>
        </div>
        <Toggle
          checked={config?.local_enabled ?? false}
          disabled={!config?.local_model_ready}
          onChange={onToggle}
        />
      </div>
    );
  }

  return (
    <Panel
      title="Local Model — fully offline"
      action={
        <div className="flex items-center gap-3">
          <HardDrive size={14} className="text-slate-500" />
          <Toggle
            checked={config?.local_enabled ?? false}
            disabled={!config?.local_model_ready}
            onChange={onToggle}
          />
        </div>
      }
    >
      {config?.local_model_ready ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-400">
            Gemma 2 2B is installed
            {config.local_model_simulated ? " (simulated download — demo mode)" : ""}.
            {config.local_enabled
              ? " Narration runs entirely on this machine — no API key, no network."
              : " Toggle on to use it for narration."}
          </p>
          {config.local_enabled && (
            <div className="rounded-lg bg-slate-800/60 px-4 py-3 text-sm text-slate-300">
              <span className="font-medium text-emerald-400">● Active</span> — All inference runs locally.
              Max context: 2 048 tokens · Temperature: 0.3 (fixed for deterministic narration).
            </div>
          )}
        </div>
      ) : downloading ? (
        <div>
          <div className="mb-1.5 flex justify-between text-xs text-slate-500">
            <span>Downloading Gemma 2 2B (~1.7 GB)…</span>
            <span className="tabular-nums">{config?.download.pct.toFixed(0)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 transition-all duration-300"
              style={{ width: `${config?.download.pct ?? 0}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-600">Runs in the background — keep using AROK normally.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-400">
            Download the model once (~1.7 GB) and narration never leaves this machine. No account,
            no API key, no network needed afterwards.
          </p>
          <button
            onClick={onDownload}
            className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-200 hover:bg-slate-700"
          >
            <Download size={14} /> Download Gemma 2 2B
          </button>
          {config?.download.status === "error" && (
            <p className="text-xs text-red-400">Download failed: {config.download.error}</p>
          )}
        </div>
      )}
    </Panel>
  );
}

// ── Cloud model panel ─────────────────────────────────────────────────────────

type ConnectStep = "idle" | "opening" | "pasting" | "connecting" | "done";

function CloudModelPanel({
  config, conn, expanded, onToggle, onConnectionChange,
}: {
  config: { api_enabled: boolean; api_key_set: boolean } | null;
  conn: CloudConnection | null;
  expanded: boolean;
  onToggle: (v: boolean) => void;
  onConnectionChange: () => void;
}) {
  const [step, setStep] = useState<ConnectStep>("idle");
  const [keyInput, setKeyInput] = useState("");
  const [guide, setGuide] = useState("");
  const [connError, setConnError] = useState("");
  const [editModel, setEditModel] = useState(false);

  const openConsole = async () => {
    setStep("opening");
    setConnError("");
    try {
      const r = await api.aiConnectOpen();
      setGuide(r.guide);
      setStep("pasting");
    } catch {
      setStep("idle");
    }
  };

  const connect = async () => {
    if (!keyInput.trim()) return;
    setStep("connecting");
    setConnError("");
    try {
      const r = await api.aiConnect(keyInput.trim());
      if (r.connected) {
        // Also tell the parent ai config that api is enabled
        await api.setAiConfig({ api_enabled: true });
        onConnectionChange();
        setStep("done");
        setKeyInput("");
      } else {
        setConnError(r.error ?? "Connection failed");
        setStep("pasting");
      }
    } catch (e) {
      setConnError(String(e));
      setStep("pasting");
    }
  };

  const disconnect = async () => {
    await api.aiDisconnect();
    await api.setAiConfig({ api_enabled: false });
    onConnectionChange();
    setStep("idle");
    setKeyInput("");
    setGuide("");
  };

  const setModel = async (model: string) =>
    api.aiSetModel(model).then(onConnectionChange);

  const setMaxTokens = async (v: number) =>
    api.aiSetModel("", v).then(onConnectionChange);

  const setTemperature = async (v: number) =>
    api.aiSetModel("", undefined, v).then(onConnectionChange);

  const connected = conn?.connected ?? false;

  if (!expanded) {
    // Minimised: compact card
    return (
      <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/30 p-4">
        <div className="flex items-center gap-3">
          <Cloud size={16} className="text-slate-500" />
          <div>
            <div className="text-sm font-medium text-slate-400">Anthropic Cloud Model</div>
            <div className="text-xs text-slate-600">
              {connected ? (conn?.selected_model || "Connected") : "Not connected"}
            </div>
          </div>
        </div>
        <Toggle
          checked={config?.api_enabled ?? false}
          disabled={!connected}
          onChange={onToggle}
        />
      </div>
    );
  }

  return (
    <Panel
      title="Anthropic Cloud Model"
      action={
        <div className="flex items-center gap-3">
          {connected && (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" /> Connected
            </span>
          )}
          <Cloud size={14} className="text-slate-500" />
          <Toggle
            checked={config?.api_enabled ?? false}
            disabled={!connected}
            onChange={onToggle}
          />
        </div>
      }
    >
      {!connected ? (
        <div className="space-y-4">
          {/* Connect flow */}
          {step === "idle" || step === "opening" ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-400">
                Connect AROK to the Anthropic API to narrate system findings with Claude.
                Your key is stored locally and never leaves this machine.
              </p>
              <button
                onClick={openConsole}
                disabled={step === "opening"}
                className="flex items-center gap-2 rounded-lg bg-gradient-to-br from-slate-700 to-slate-800 px-4 py-2.5 text-sm font-medium text-slate-200 hover:from-slate-600 hover:to-slate-700 disabled:opacity-50"
              >
                <ExternalLink size={14} />
                {step === "opening" ? "Opening Claude console…" : "Connect with Claude"}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Guide banner */}
              <div className="flex items-start gap-3 rounded-lg border border-cyan-900/50 bg-cyan-950/30 px-4 py-3">
                <Key size={14} className="mt-0.5 shrink-0 text-cyan-400" />
                <p className="text-sm leading-relaxed text-cyan-300">{guide}</p>
              </div>
              {/* Key input */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-500">Paste your API key</label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && connect()}
                    placeholder="sk-ant-…"
                    autoFocus
                    className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-cyan-700 focus:outline-none"
                  />
                  <button
                    onClick={connect}
                    disabled={!keyInput.trim() || step === "connecting"}
                    className="flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-cyan-600 to-blue-700 px-4 py-2 text-sm font-semibold text-white hover:from-cyan-500 hover:to-blue-600 disabled:opacity-50"
                  >
                    {step === "connecting" ? (
                      <RefreshCw size={13} className="animate-spin" />
                    ) : (
                      <ChevronRight size={13} />
                    )}
                    {step === "connecting" ? "Connecting…" : "Connect"}
                  </button>
                </div>
                {connError && <p className="text-xs text-red-400">{connError}</p>}
                <button
                  onClick={() => { setStep("idle"); setKeyInput(""); setGuide(""); }}
                  className="text-xs text-slate-600 hover:text-slate-400"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {/* Model selector */}
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Model</div>
            <div className="space-y-1.5">
              {(conn?.models ?? []).map((m) => (
                <label
                  key={m.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
                    conn?.selected_model === m.id
                      ? "border-cyan-700/60 bg-cyan-950/30"
                      : "border-slate-800 hover:border-slate-700 hover:bg-slate-800/40"
                  }`}
                >
                  <input
                    type="radio"
                    name="ai-model"
                    value={m.id}
                    checked={conn?.selected_model === m.id}
                    onChange={() => setModel(m.id)}
                    className="accent-cyan-500"
                  />
                  <span className={`text-sm ${conn?.selected_model === m.id ? "text-slate-200" : "text-slate-400"}`}>
                    {m.display}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Parameter controls */}
          <div className="space-y-4 rounded-lg border border-slate-800 bg-slate-950/40 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Parameters</div>
            {/* max_tokens */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-sm text-slate-400">Max tokens</label>
                <span className="text-sm tabular-nums text-slate-300">{conn?.max_tokens ?? 1024}</span>
              </div>
              <input
                type="range"
                min={128} max={4096} step={128}
                value={conn?.max_tokens ?? 1024}
                onChange={(e) => setMaxTokens(Number(e.target.value))}
                onMouseUp={(e) => setMaxTokens(Number((e.target as HTMLInputElement).value))}
                className="w-full accent-cyan-500"
              />
              <div className="flex justify-between text-xs text-slate-600">
                <span>128</span><span>4096</span>
              </div>
            </div>
            {/* temperature */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-sm text-slate-400">Temperature</label>
                <span className="text-sm tabular-nums text-slate-300">
                  {(conn?.temperature ?? 0.3).toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={0} max={1} step={0.05}
                value={conn?.temperature ?? 0.3}
                onChange={(e) => setTemperature(Number(e.target.value))}
                onMouseUp={(e) => setTemperature(Number((e.target as HTMLInputElement).value))}
                className="w-full accent-cyan-500"
              />
              <div className="flex justify-between text-xs text-slate-600">
                <span>0 — deterministic</span><span>1 — creative</span>
              </div>
            </div>
          </div>

          {/* Disconnect */}
          <div className="flex justify-end">
            <button
              onClick={disconnect}
              className="text-xs text-slate-600 underline hover:text-slate-400"
            >
              Disconnect Anthropic API
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}

// ── Main tab ──────────────────────────────────────────────────────────────────

export default function InsightsTab() {
  const [config, refetchConfig] = usePollingWithRefetch(() => api.aiConfig(), 3000);
  const [conn, refetchConn] = usePollingWithRefetch(() => api.aiConnection(), 5000);
  const auto = usePolling(() => api.insights(), 45000);
  const [manual, setManual] = useState<Insight | null>(null);
  const [loading, setLoading] = useState(false);

  const insight = manual ?? auto;
  const downloading = config?.download.status === "downloading";

  const refresh = async () => {
    setLoading(true);
    try {
      setManual(await api.insights());
    } finally {
      setLoading(false);
    }
  };

  const patch = async (p: Parameters<typeof api.setAiConfig>[0]) => {
    await api.setAiConfig(p);
    refetchConfig();
    setManual(await api.insights());
  };

  const onConnectionChange = () => {
    refetchConn();
    refetchConfig();
  };

  // Determine which engine is active so we know which panel expands.
  const localActive = config?.local_enabled && config?.local_model_ready;
  const cloudActive = config?.api_enabled && (conn?.connected ?? config?.api_key_set);

  // ---------- disabled: opt-in hero ----------
  if (config && !config.enabled) {
    return (
      <div className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-200">
          <Sparkles size={18} className="text-cyan-400" /> AI Insights
        </h2>
        <div className="flex flex-col items-center rounded-xl border border-slate-800 bg-slate-900/50 px-6 py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-700/20">
            <Sparkles size={26} className="text-cyan-400" />
          </div>
          <h3 className="mt-4 text-xl font-bold text-slate-200">AI Insights are off</h3>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">
            AROK ships without AI. Monitoring and anomaly detection are fully deterministic and always on —
            enabling insights adds plain-English narration of what AROK finds. Run it fully offline with
            a local model, or connect the Anthropic API. Your choice, your machine.
          </p>
          <button
            onClick={() => patch({ enabled: true })}
            className="mt-6 flex items-center gap-2 rounded-lg bg-gradient-to-br from-cyan-600 to-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:from-cyan-500 hover:to-blue-600"
          >
            <Power size={15} /> Enable AI Insights
          </button>
        </div>
        <RecommendationsPanel insight={insight} />
      </div>
    );
  }

  // ---------- enabled ----------
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-200">
          <Sparkles size={18} className="text-cyan-400" /> AI Insights
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-cyan-950 px-3 py-1.5 text-sm font-medium text-cyan-300 hover:bg-cyan-900 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Regenerate
          </button>
          <button
            onClick={() => patch({ enabled: false })}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-400 hover:bg-slate-700"
          >
            Disable
          </button>
        </div>
      </div>

      {/* Engine panels — expand selected, minimise the other */}
      {localActive && !cloudActive ? (
        // Local is active: expand local, collapse cloud
        <div className="space-y-3">
          <LocalModelPanel
            config={config}
            expanded
            onToggle={(v) => patch({ local_enabled: v })}
            onDownload={() => api.aiDownload().then(refetchConfig)}
          />
          <CloudModelPanel
            config={config}
            conn={conn}
            expanded={false}
            onToggle={(v) => patch({ api_enabled: v })}
            onConnectionChange={onConnectionChange}
          />
        </div>
      ) : cloudActive && !localActive ? (
        // Cloud is active: expand cloud, collapse local
        <div className="space-y-3">
          <CloudModelPanel
            config={config}
            conn={conn}
            expanded
            onToggle={(v) => patch({ api_enabled: v })}
            onConnectionChange={onConnectionChange}
          />
          <LocalModelPanel
            config={config}
            expanded={false}
            onToggle={(v) => patch({ local_enabled: v })}
            onDownload={() => api.aiDownload().then(refetchConfig)}
          />
        </div>
      ) : (
        // Neither active (or both): side-by-side
        <div className="grid gap-4 lg:grid-cols-2">
          <LocalModelPanel
            config={config}
            expanded
            onToggle={(v) => patch({ local_enabled: v })}
            onDownload={() => api.aiDownload().then(refetchConfig)}
          />
          <CloudModelPanel
            config={config}
            conn={conn}
            expanded
            onToggle={(v) => patch({ api_enabled: v })}
            onConnectionChange={onConnectionChange}
          />
        </div>
      )}

      {/* Narrative */}
      <Panel
        title="System Narrative"
        action={
          <div className="flex items-center gap-2">
            <Badge tone="cyan">engine: {config?.engine ?? "…"}</Badge>
            {insight?.enabled && (
              <span className="text-xs text-slate-500">{fmtTime(insight.ts)}</span>
            )}
          </div>
        }
      >
        <p className="text-base leading-relaxed text-slate-300">
          {insight?.narrative ?? "Building first narrative from baseline samples…"}
        </p>
      </Panel>

      <RecommendationsPanel insight={insight} />

      <Panel title="Deterministic findings (LLM narrator pattern — detection never hallucinates)">
        <ul className="space-y-2">
          {(insight?.findings ?? []).map((f, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-slate-400">
              <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-500" />
              {f}
            </li>
          ))}
        </ul>
      </Panel>

      <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-4 text-xs leading-relaxed text-slate-500">
        <strong className="text-slate-400">How this works:</strong> Python detects everything deterministically
        (z-score + absolute-threshold anomaly detection). The AI layer only narrates findings into prose — it
        is never a reasoning engine. Engine priority: local model → Anthropic Cloud Model → built-in template.
        With both engines off, the deterministic template still narrates — insights always work offline.
      </div>
    </div>
  );
}

// ── usePollingWithRefetch — polling that also returns an imperative refetch ───

function usePollingWithRefetch<T>(
  fn: () => Promise<T>,
  interval: number
): [T | null, () => void] {
  const [data, setData] = useState<T | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const run = () => fn().then((d) => { if (alive) setData(d); }).catch(() => {});
    run();
    const id = setInterval(run, interval);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interval, tick]);

  const refetch = () => setTick((t) => t + 1);
  return [data, refetch];
}
