import { useState } from "react";
import {
  ShieldAlert, ShieldCheck, Shield, Search, X, Globe, Cpu, ExternalLink, ChevronRight,
} from "lucide-react";
import { api, type AssessedConn, type NetInvestigation, type SafeEntry } from "../api";
import { usePolling, fmtBytes, fmtTime } from "../hooks";
import { Panel, Badge, Button } from "../components/ui";
import NetworkMap from "../components/NetworkMap";

// ── Risk presentation ─────────────────────────────────────────────────────────
function riskTone(sev: string): "red" | "amber" | "slate" | "green" {
  if (sev === "critical") return "red";
  if (sev === "warn") return "amber";
  return "slate";
}
function riskLabel(c: AssessedConn): string {
  if (c.safe) return "safe";
  if (c.severity === "critical") return "suspicious";
  if (c.severity === "warn") return "watch";
  return "ok";
}

// ── Investigation drawer ──────────────────────────────────────────────────────
function InvestigateDrawer({ data, onClose, onFlag, onUnflag, busy }: {
  data: NetInvestigation;
  onClose: () => void;
  onFlag: () => void;
  onUnflag: () => void;
  busy: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="h-full w-full max-w-md overflow-y-auto border-l border-slate-700/80 bg-slate-950 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500">
              <Globe size={12} /> Remote endpoint
            </div>
            <div className="mt-0.5 break-all font-mono text-lg font-semibold text-slate-100">{data.ip}</div>
            {data.hostname && <div className="mt-0.5 break-all text-sm text-cyan-400">{data.hostname}</div>}
          </div>
          <button onClick={onClose} className="shrink-0 rounded-md p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200">
            <X size={18} />
          </button>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone={data.safe ? "green" : data.risk >= 75 ? "red" : data.risk >= 50 ? "amber" : "slate"}>
            {data.safe ? "flagged safe" : `risk ${data.risk}`}
          </Badge>
          <Badge tone="slate">{data.public ? "public IP" : "private / LAN"}</Badge>
          <Badge tone="cyan">{data.connectionCount} connection{data.connectionCount === 1 ? "" : "s"}</Badge>
        </div>

        {data.reasons.length > 0 && (
          <div className="mb-4 rounded-xl border border-amber-900/50 bg-amber-950/20 p-3">
            <div className="mb-1 text-xs font-semibold text-amber-300">Why it was flagged</div>
            <ul className="space-y-1 text-xs text-slate-400">
              {data.reasons.map((r, i) => <li key={i} className="flex gap-1.5"><ChevronRight size={13} className="mt-0.5 shrink-0 text-amber-500" />{r}</li>)}
            </ul>
          </div>
        )}

        {data.services.length > 0 && (
          <div className="mb-4">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Services / ports</div>
            <div className="flex flex-wrap gap-1.5">
              {data.services.map((s) => <Badge key={s} tone="slate">{s}</Badge>)}
            </div>
          </div>
        )}

        <div className="mb-4">
          <div className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-500">Local processes talking to it</div>
          <div className="divide-y divide-slate-800/70 rounded-xl border border-slate-800">
            {data.processes.map((p, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2 text-xs">
                <Cpu size={13} className="shrink-0 text-cyan-500" />
                <span className="font-medium text-slate-300">{p.proc ?? `pid ${p.pid ?? "?"}`}</span>
                <span className="ml-auto tabular-nums text-slate-500">{p.laddr} → {p.raddr}</span>
                <Badge tone={p.status === "ESTABLISHED" ? "green" : "slate"}>{p.status}</Badge>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-slate-800 pt-4">
          {data.safe ? (
            <Button onClick={onUnflag} disabled={busy}>Remove safe flag</Button>
          ) : (
            <button
              onClick={onFlag}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-950/70 px-3 py-1.5 text-xs font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-500/25 transition-colors hover:bg-emerald-900/60 disabled:opacity-50"
            >
              <ShieldCheck size={14} /> Flag as safe
            </button>
          )}
          <a
            href={`https://www.virustotal.com/gui/ip-address/${encodeURIComponent(data.ip)}`}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="ml-auto inline-flex items-center gap-1 text-xs text-slate-500 hover:text-cyan-400"
          >
            Look up on VirusTotal <ExternalLink size={11} />
          </a>
        </div>
      </div>
    </div>
  );
}

export default function NetworkTab() {
  const [tab, setTab] = useState<"live" | "safe">("live");
  const assess = usePolling(() => api.networkAssess(120), 6000);
  const safelist = usePolling(() => api.networkSafelist(), 10000);
  const stats = usePolling(() => api.stats(), 3000);
  const [result, setResult] = useState<string | null>(null);
  const [probe, setProbe] = useState<NetInvestigation | null>(null);
  const [busy, setBusy] = useState(false);

  const conns = assess?.connections ?? [];
  const suspicious = conns.filter((c) => !c.safe && c.severity !== "info");

  const block = async (raddr: string) => {
    const ip = raddr.split(":")[0];
    if (!ip) return;
    const r = await api.blockIp(ip);
    setResult(r.detail);
  };

  const investigate = async (ip: string) => {
    if (!ip) return;
    setBusy(true);
    try {
      setProbe(await api.networkInvestigate(ip));
    } finally {
      setBusy(false);
    }
  };

  const flagSafe = async (proc: string | null, ip: string) => {
    setBusy(true);
    try {
      await api.networkFlagSafe(proc, ip);
      if (probe) setProbe(await api.networkInvestigate(ip));
    } finally {
      setBusy(false);
    }
  };

  const unflag = async (key: string, ip?: string) => {
    setBusy(true);
    try {
      await api.networkUnflag(key);
      if (ip && probe) setProbe(await api.networkInvestigate(ip));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-200">Network Intelligence</h2>
        <div className="inline-flex rounded-lg border border-slate-800 bg-slate-950/60 p-0.5 shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]">
          {(["live", "safe"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                tab === t ? "bg-cyan-950/80 text-cyan-300 ring-1 ring-inset ring-cyan-500/25" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {t === "live" ? "Live connections" : `Safe log${safelist?.safe.length ? ` (${safelist.safe.length})` : ""}`}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label="Receive" value={fmtBytes(stats?.net_recv ?? 0)} accent="text-sky-400" />
        <Tile label="Send" value={fmtBytes(stats?.net_sent ?? 0)} accent="text-rose-400" />
        <Tile label="Suspicious" value={String(assess?.suspicious ?? 0)} accent={assess?.suspicious ? "text-red-400" : "text-slate-300"} />
        <Tile label="Flagged safe" value={String(assess?.safeCount ?? 0)} accent="text-emerald-400" />
      </div>

      {result && (
        <div className="rounded-lg border border-cyan-900 bg-cyan-950/40 px-4 py-2 text-sm text-cyan-300">
          {result} <button className="ml-2 text-cyan-500" onClick={() => setResult(null)}>dismiss</button>
        </div>
      )}

      {tab === "live" && (
        <>
          {suspicious.length > 0 && (
            <div className="rounded-2xl border border-red-900/50 bg-gradient-to-br from-red-950/30 to-slate-900/40 p-4">
              <div className="mb-2 flex items-center gap-2">
                <ShieldAlert size={18} className="text-red-400" />
                <span className="text-sm font-semibold text-red-300">
                  {suspicious.length} connection{suspicious.length === 1 ? "" : "s"} worth a look
                </span>
              </div>
              <ul className="space-y-1.5">
                {suspicious.slice(0, 6).map((c, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs">
                    <Badge tone={riskTone(c.severity)}>{c.risk}</Badge>
                    <span className="font-medium text-slate-300">{c.proc ?? `pid ${c.pid ?? "?"}`}</span>
                    <span className="tabular-nums text-slate-500">→ {c.raddr}</span>
                    <span className="min-w-0 flex-1 truncate text-slate-500">{c.reasons[0]}</span>
                    <button onClick={() => investigate(c.raddr.split(":")[0])} className="shrink-0 text-cyan-400 hover:text-cyan-300">Investigate</button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <NetworkMap conns={conns} />

          <Panel title="Connections" action={<span className="text-[11px] text-slate-600">risk score = heuristics, not a verdict</span>}>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500">
                  <th className="pb-2 pr-3">Risk</th>
                  <th className="pb-2 pr-3">Process</th>
                  <th className="pb-2 pr-3">Remote</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {conns.map((c, i) => {
                  const ip = c.raddr.split(":")[0];
                  return (
                    <tr key={i} className="border-b border-slate-800/50 text-slate-300 hover:bg-slate-800/30">
                      <td className="py-1.5 pr-3">
                        {c.safe ? (
                          <span title="You flagged this endpoint safe"><Shield size={15} className="text-emerald-500" /></span>
                        ) : c.severity !== "info" ? (
                          <Badge tone={riskTone(c.severity)}>{riskLabel(c)} {c.risk}</Badge>
                        ) : (
                          <span className="text-xs text-slate-600">—</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 font-medium">{c.proc ?? `pid ${c.pid ?? "?"}`}</td>
                      <td className="py-1.5 pr-3 tabular-nums text-slate-400">{c.raddr || "—"}</td>
                      <td className="py-1.5 pr-3">
                        <Badge tone={c.status === "ESTABLISHED" ? "green" : c.status === "LISTEN" ? "cyan" : "slate"}>{c.status}</Badge>
                      </td>
                      <td className="py-1.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {ip && (
                            <button
                              onClick={() => investigate(ip)}
                              title="Investigate this endpoint"
                              className="inline-flex items-center gap-1 rounded-md bg-slate-800/90 px-2 py-1 text-xs text-slate-300 ring-1 ring-inset ring-slate-600/30 hover:bg-slate-700/90 hover:text-slate-100"
                            >
                              <Search size={12} /> Investigate
                            </button>
                          )}
                          {c.raddr && !c.safe && <Button danger onClick={() => block(c.raddr)}>Block</Button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
        </>
      )}

      {tab === "safe" && <SafeLog entries={safelist?.safe ?? []} onUnflag={(k) => unflag(k)} busy={busy} onInvestigate={investigate} />}

      {probe && (
        <InvestigateDrawer
          data={probe}
          busy={busy}
          onClose={() => setProbe(null)}
          onFlag={() => flagSafe(probe.processes[0]?.proc ?? null, probe.ip)}
          onUnflag={() => unflag(`${(probe.processes[0]?.proc ?? "?").toLowerCase()}|${probe.ip}`, probe.ip)}
        />
      )}
    </div>
  );
}

function SafeLog({ entries, onUnflag, busy, onInvestigate }: {
  entries: SafeEntry[];
  onUnflag: (key: string) => void;
  busy: boolean;
  onInvestigate: (ip: string) => void;
}) {
  return (
    <Panel title="Safe connections" action={<Badge tone="green">excluded from suspicion</Badge>}>
      {entries.length === 0 ? (
        <p className="py-3 text-sm text-slate-500">
          No endpoints flagged safe yet. Investigate a connection and click <span className="text-emerald-400">Flag as safe</span> to
          silence it here.
        </p>
      ) : (
        <ul className="divide-y divide-slate-800/70">
          {entries.map((e) => (
            <li key={`${e.proc}|${e.ip}`} className="flex items-center gap-3 py-2.5 text-sm">
              <ShieldCheck size={16} className="shrink-0 text-emerald-500" />
              <div className="min-w-0">
                <div className="truncate font-medium text-slate-300">{e.proc}</div>
                <div className="truncate font-mono text-xs text-slate-500">{e.ip}{e.note ? ` · ${e.note}` : ""}</div>
              </div>
              <span className="ml-auto shrink-0 text-xs text-slate-600">{fmtTime(e.flaggedAt)}</span>
              <button onClick={() => onInvestigate(e.ip)} className="shrink-0 text-xs text-cyan-400 hover:text-cyan-300">Details</button>
              <Button onClick={() => onUnflag(`${e.proc.toLowerCase()}|${e.ip}`)} disabled={busy}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-bold ${accent}`}>{value}</div>
    </div>
  );
}
