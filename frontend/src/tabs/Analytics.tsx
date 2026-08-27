import { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceDot,
} from "recharts";
import { api, type SnapshotResult, type Alert } from "../api";
import { usePolling, fmtTime } from "../hooks";
import { Panel, Button, Badge } from "../components/ui";

const WINDOWS = [
  { label: "15 min", seconds: 900 },
  { label: "1 hour", seconds: 3600 },
  { label: "6 hours", seconds: 21600 },
  { label: "24 hours", seconds: 86400 },
];

const SERIES = [
  { key: "cpu",   label: "CPU %",       color: "#55c187", yAxis: "pct",  type: "monotone" as const },
  { key: "mem",   label: "MEM %",       color: "#a291d4", yAxis: "pct",  type: "monotone" as const },
  { key: "disk",  label: "Disk %",      color: "#cda24a", yAxis: "pct",  type: "monotone" as const },
  { key: "net",   label: "Net KB/s",    color: "#7ab6cd", yAxis: "raw",  type: "monotone" as const },
  { key: "procs", label: "Processes",   color: "#40d09c", yAxis: "raw",  type: "stepAfter" as const },
] as const;

type SeriesKey = (typeof SERIES)[number]["key"];

// resources we can attribute to individual processes
const RES_OF_SERIES: Partial<Record<SeriesKey, "cpu" | "mem">> = { cpu: "cpu", mem: "mem" };

function ColorKey({
  visible, onToggle,
}: {
  visible: Set<SeriesKey>;
  onToggle: (key: SeriesKey) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {SERIES.map((s) => {
        const on = visible.has(s.key);
        return (
          <button
            key={s.key}
            onClick={() => onToggle(s.key)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all ${
              on ? "border border-transparent text-white" : "border border-slate-700 bg-transparent text-slate-500"
            }`}
            style={on ? { background: `${s.color}22`, borderColor: `${s.color}55`, color: s.color } : {}}
            title={on ? `Hide ${s.label}` : `Show ${s.label}`}
          >
            <span className="inline-block h-2 w-2 rounded-full transition-opacity" style={{ background: s.color, opacity: on ? 1 : 0.25 }} />
            {s.label}
          </button>
        );
      })}
      <span className="ml-1 text-xs text-slate-600">click to toggle</span>
    </div>
  );
}

function tooltipFmt(value: number, name: string): [string, string] {
  if (name === "Net KB/s") return [`${value.toFixed(1)} KB/s`, name];
  if (name === "Processes") return [`${value}`, name];
  return [`${value.toFixed(1)}%`, name];
}

// Which chart series (and pct-axis y-value) an alert's metric maps to.
const ALERT_METRIC_SERIES: Record<string, SeriesKey> = { cpu: "cpu", mem: "mem", disk: "disk" };

export default function AnalyticsTab() {
  const [win, setWin] = useState(3600);
  const history = usePolling(() => api.analytics(win), 10000);
  const alerts = usePolling(() => api.alerts(), 6000);
  const events = usePolling(() => api.events(), 12000);
  const [purgeMsg, setPurgeMsg] = useState<string | null>(null);
  const [visible, setVisible] = useState<Set<SeriesKey>>(new Set(SERIES.map((s) => s.key)));
  const [cleared, setCleared] = useState<Set<number>>(new Set());
  const [clearingAll, setClearingAll] = useState(false);

  // pinned drill-down state
  const [pinnedTs, setPinnedTs] = useState<number | null>(null);
  const [resource, setResource] = useState<"cpu" | "mem">("cpu");
  const [snap, setSnap] = useState<SnapshotResult | null>(null);
  const [snapLoading, setSnapLoading] = useState(false);

  useEffect(() => {
    if (pinnedTs === null) return;
    let alive = true;
    setSnapLoading(true);
    api.snapshot(pinnedTs, resource)
      .then((s) => { if (alive) setSnap(s); })
      .finally(() => { if (alive) setSnapLoading(false); });
    return () => { alive = false; };
  }, [pinnedTs, resource]);

  const toggle = (key: SeriesKey) => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(key)) { if (next.size > 1) next.delete(key); } else { next.add(key); }
      return next;
    });
  };

  const data = (history ?? []).map((h) => ({
    ts: h.ts,
    t: fmtTime(h.ts),
    cpu: +h.cpu.toFixed(1),
    mem: +h.mem.toFixed(1),
    disk: +h.disk.toFixed(1),
    net: +((h.net_recv + h.net_sent) / 1024).toFixed(1),
    procs: h.proc_count,
  }));

  // Alerts that fall inside the current chart window, newest first.
  const windowStart = data.length ? data[0].ts : 0;
  const winAlerts = (alerts ?? []).filter((a) => !cleared.has(a.id) && a.ts >= windowStart);

  // Map each spike alert onto the nearest chart point so it can be dotted on
  // the graph. Only cpu/mem/disk have a matching pct-axis series.
  const spikeMarkers = useMemo(() => {
    if (!data.length) return [] as { key: number; x: string; y: number; color: string; a: Alert }[];
    return winAlerts
      .map((a) => {
        const series = ALERT_METRIC_SERIES[a.metric];
        if (!series || !visible.has(series)) return null;
        // nearest data point by timestamp
        let best = data[0], bestD = Infinity;
        for (const d of data) {
          const dd = Math.abs(d.ts - a.ts);
          if (dd < bestD) { bestD = dd; best = d; }
        }
        const color = a.severity === "critical" ? "#ef4444" : "#cda24a";
        return { key: a.id, x: best.t, y: (best as any)[series] as number, color, a };
      })
      .filter((m): m is { key: number; x: string; y: number; color: string; a: Alert } => m !== null);
  }, [winAlerts, data, visible]);

  // click on the chart -> pin that timestamp for drill-down
  const onChartClick = (state: any) => {
    const ts = state?.activePayload?.[0]?.payload?.ts;
    if (typeof ts === "number") setPinnedTs(ts);
  };

  const purge = async () => {
    const r = await api.purge(3600);
    setPurgeMsg(`Purged ${r.metrics_purged} metric rows and ${r.events_purged} events (kept last hour). VACUUM complete.`);
  };

  const clearOne = async (id: number) => {
    setCleared((s) => new Set(s).add(id));
    try { await api.clearAlert(id); } catch { setCleared((s) => { const n = new Set(s); n.delete(id); return n; }); }
  };
  const clearAll = async () => {
    if (clearingAll) return;
    setClearingAll(true);
    setCleared((s) => { const n = new Set(s); (alerts ?? []).forEach((a) => n.add(a.id)); return n; });
    try { await api.clearAllAlerts(); } finally { setClearingAll(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-200">Analytics &amp; Trends</h2>
        <div className="flex items-center gap-2">
          {WINDOWS.map((w) => (
            <button
              key={w.seconds}
              onClick={() => setWin(w.seconds)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                win === w.seconds ? "bg-cyan-950 text-cyan-300" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
              }`}
            >
              {w.label}
            </button>
          ))}
          <Button danger onClick={purge}>Purge Old Logs</Button>
        </div>
      </div>

      {purgeMsg && (
        <div className="rounded-lg border border-cyan-900 bg-cyan-950/40 px-4 py-2 text-sm text-cyan-300">
          {purgeMsg} <button className="ml-2 text-cyan-500" onClick={() => setPurgeMsg(null)}>dismiss</button>
        </div>
      )}

      <Panel
        title="Resource Trends"
        action={<span className="text-xs text-slate-500 tabular-nums">{data.length} samples · click a point to drill down</span>}
      >
        <div className="mb-4">
          <ColorKey visible={visible} onToggle={toggle} />
        </div>

        <div className="h-80">
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 4, right: 48, left: 0, bottom: 0 }} onClick={onChartClick} style={{ cursor: "pointer" }}>
              <CartesianGrid stroke="#232823" strokeDasharray="3 3" />
              <XAxis dataKey="t" tick={{ fill: "#4e564d", fontSize: 10 }} minTickGap={60} />
              <YAxis yAxisId="pct" domain={[0, 100]} tick={{ fill: "#4e564d", fontSize: 10 }} width={32} tickFormatter={(v) => `${v}%`} />
              <YAxis yAxisId="raw" orientation="right" tick={{ fill: "#4e564d", fontSize: 10 }} width={48} />
              <Tooltip
                contentStyle={{ background: "#131712", border: "1px solid #3a413a", borderRadius: 8 }}
                labelFormatter={(l) => `Time ${l}`}
                formatter={tooltipFmt}
              />
              {SERIES.map((s) =>
                visible.has(s.key) ? (
                  <Line
                    key={s.key}
                    yAxisId={s.yAxis}
                    type={s.type}
                    dataKey={s.key}
                    stroke={s.color}
                    dot={false}
                    activeDot={{ r: 4, onClick: () => { const r = RES_OF_SERIES[s.key]; if (r) setResource(r); } }}
                    strokeWidth={1.5}
                    name={s.label}
                    isAnimationActive={false}
                  />
                ) : null
              )}
              {/* Spike-cause markers: a dot on the series where each alert fired */}
              {spikeMarkers.map((m) => (
                <ReferenceDot
                  key={m.key}
                  yAxisId="pct"
                  x={m.x}
                  y={m.y}
                  r={5}
                  fill={m.color}
                  stroke="#131712"
                  strokeWidth={1.5}
                  ifOverflow="extendDomain"
                  onClick={() => setPinnedTs(m.a.ts)}
                  style={{ cursor: "pointer" }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {data.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-slate-800 pt-3">
            {(["cpu", "mem", "disk"] as const).map((k) => {
              const vals = data.map((d) => d[k]);
              const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
              const mx = Math.max(...vals);
              const s = SERIES.find((s) => s.key === k)!;
              return (
                <div key={k} className="text-xs" style={{ color: s.color }}>
                  <span className="font-medium">{s.label}</span>
                  <span className="ml-2 text-slate-500">avg {avg.toFixed(1)}% · max {mx.toFixed(1)}%</span>
                </div>
              );
            })}
            {spikeMarkers.length > 0 && (
              <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-slate-500">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-slate-900" />
                spike markers — click to see the cause
              </span>
            )}
          </div>
        )}
      </Panel>

      {/* Anomaly alerts — cause of each spike, moved here from the old Alerts tab */}
      <Panel
        title="Anomaly Alerts (z-score + absolute threshold)"
        action={
          winAlerts.length > 0 ? (
            <Button onClick={clearAll} disabled={clearingAll}>{clearingAll ? "Clearing…" : "Clear All"}</Button>
          ) : undefined
        }
      >
        {winAlerts.length === 0 ? (
          <p className="text-sm text-slate-500">No alerts in this window — system within normal bounds.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500">
                <th className="pb-2 pr-3">Time</th>
                <th className="pb-2 pr-3">Severity</th>
                <th className="pb-2 pr-3">Metric</th>
                <th className="pb-2 pr-3">Cause</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {winAlerts.map((a) => (
                <tr key={a.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                  <td className="py-1.5 pr-3 tabular-nums text-slate-500">
                    <button
                      className="hover:text-cyan-300"
                      title="Pin this moment for a per-process drill-down"
                      onClick={() => setPinnedTs(a.ts)}
                    >
                      {fmtTime(a.ts)}
                    </button>
                  </td>
                  <td className="py-1.5 pr-3">
                    <Badge tone={a.severity === "critical" ? "red" : "amber"}>{a.severity}</Badge>
                  </td>
                  <td className="py-1.5 pr-3 uppercase text-slate-400">{a.metric}</td>
                  <td className="py-1.5 pr-3 text-slate-300">{a.message}</td>
                  <td className="py-1.5 text-right"><Button onClick={() => clearOne(a.id)}>Clear</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {/* Event log — control actions & system events */}
      <Panel title="Event Log (control actions & system events)">
        {(events ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">No events yet. Control actions (kill, block IP, service stop/start) land here.</p>
        ) : (
          <ul className="space-y-1.5">
            {(events ?? []).slice(0, 40).map((e) => (
              <li key={e.id} className="flex items-center gap-3 text-sm">
                <span className="tabular-nums text-xs text-slate-600">{fmtTime(e.ts)}</span>
                <Badge tone="cyan">{e.kind}</Badge>
                <span className="text-slate-400">{e.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* Drill-down snapshot: what was driving utilization at the pinned moment */}
      {pinnedTs !== null && (
        <Panel
          title={`Snapshot — ${fmtTime(pinnedTs)}`}
          action={
            <div className="flex items-center gap-2">
              <div className="flex rounded-md border border-slate-700 p-0.5">
                {(["cpu", "mem"] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setResource(r)}
                    className={`rounded px-2 py-0.5 text-xs font-medium ${
                      resource === r ? "bg-cyan-900/70 text-cyan-300" : "text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    {r.toUpperCase()}
                  </button>
                ))}
              </div>
              <button className="text-xs text-slate-500 hover:text-slate-300" onClick={() => { setPinnedTs(null); setSnap(null); }}>
                close
              </button>
            </div>
          }
        >
          {snapLoading ? (
            <p className="text-sm text-slate-500">Loading snapshot…</p>
          ) : !snap || !snap.found || snap.procs.length === 0 ? (
            <p className="text-sm text-slate-500">
              No process snapshot stored near this moment. Snapshots are captured every ~15s while AROK runs.
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500">
                  <th className="pb-2 pr-3">Process</th>
                  <th className="pb-2 pr-3">PID</th>
                  <th className={`pb-2 pr-3 ${resource === "cpu" ? "text-cyan-300" : ""}`}>CPU %</th>
                  <th className={`pb-2 ${resource === "mem" ? "text-violet-300" : ""}`}>MEM %</th>
                </tr>
              </thead>
              <tbody>
                {snap.procs.slice(0, 15).map((p) => (
                  <tr key={p.pid} className="border-b border-slate-800/50">
                    <td className="py-1.5 pr-3 text-slate-300">{p.name}</td>
                    <td className="py-1.5 pr-3 tabular-nums text-slate-500">{p.pid}</td>
                    <td className={`py-1.5 pr-3 tabular-nums ${resource === "cpu" ? "text-cyan-300" : "text-slate-400"}`}>{p.cpu.toFixed(1)}</td>
                    <td className={`py-1.5 tabular-nums ${resource === "mem" ? "text-violet-300" : "text-slate-400"}`}>{p.mem.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      )}
    </div>
  );
}
