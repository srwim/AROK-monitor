import { useEffect, useState } from "react";
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { api, type DetailData } from "../api";
import { usePolling, useLiveStats, fmtBytes, fmtTime } from "../hooks";
import { Panel, Gauge, Badge, Modal, NumberTicker } from "../components/ui";

// ── Detail modal ─────────────────────────────────────────────────────────────

type Metric = "cpu" | "mem" | "disk" | "net" | "proc";

function PercentBar({ value, max = 100, color = "bg-cyan-500" }: { value: number; max?: number; color?: string }) {
  const pct = Math.min((value / max) * 100, 100);
  const bar = pct > 80 ? "bg-red-500" : pct > 60 ? "bg-amber-500" : color;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
      <div className={`h-full rounded-full transition-all ${bar}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function fmt(n: unknown, decimals = 1): string {
  if (n === null || n === undefined) return "—";
  const v = Number(n);
  return isNaN(v) ? String(n) : v.toFixed(decimals);
}

function fmtGB(bytes: unknown): string {
  const v = Number(bytes);
  if (isNaN(v)) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)} GB`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(0)} MB`;
  return `${(v / 1e3).toFixed(0)} KB`;
}

function CpuDetail({ d }: { d: DetailData }) {
  const cores = (d.percpu as number[]) ?? [];
  const freq = d.freq as Record<string, number> | null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <span className="text-slate-500">Physical cores</span><span className="text-slate-300">{String(d.cores_physical ?? "—")}</span>
        <span className="text-slate-500">Logical cores</span><span className="text-slate-300">{String(d.cores_logical ?? "—")}</span>
        {freq && <><span className="text-slate-500">Frequency</span><span className="text-slate-300">{fmt(freq.current)} MHz</span></>}
      </div>
      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Per-core utilisation</div>
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
          {cores.map((pct, i) => (
            <div key={i} className="space-y-1">
              <div className="flex justify-between text-xs text-slate-400">
                <span>Core {i}</span><span className="tabular-nums">{pct.toFixed(1)}%</span>
              </div>
              <PercentBar value={pct} color="bg-cyan-500" />
            </div>
          ))}
        </div>
      </div>
      <TopProcs procs={(d.top as object[]) ?? []} metric="cpu_percent" label="CPU %" />
    </div>
  );
}

function MemDetail({ d }: { d: DetailData }) {
  const vm = d.virtual as Record<string, number> ?? {};
  const sw = d.swap as Record<string, number> ?? {};
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Virtual memory</div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <span className="text-slate-500">Total</span><span className="text-slate-300">{fmtGB(vm.total)}</span>
          <span className="text-slate-500">Used</span><span className="text-slate-300">{fmtGB(vm.used)} ({fmt(vm.percent)}%)</span>
          <span className="text-slate-500">Available</span><span className="text-slate-300">{fmtGB(vm.available)}</span>
          <span className="text-slate-500">Cached</span><span className="text-slate-300">{fmtGB(vm.cached)}</span>
        </div>
        <PercentBar value={vm.percent ?? 0} color="bg-violet-500" />
      </div>
      {sw.total > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Swap</div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <span className="text-slate-500">Total</span><span className="text-slate-300">{fmtGB(sw.total)}</span>
            <span className="text-slate-500">Used</span><span className="text-slate-300">{fmtGB(sw.used)} ({fmt(sw.percent)}%)</span>
          </div>
          <PercentBar value={sw.percent ?? 0} color="bg-fuchsia-500" />
        </div>
      )}
      <TopProcs procs={(d.top as object[]) ?? []} metric="memory_percent" label="MEM %" />
    </div>
  );
}

function DiskDetail({ d }: { d: DetailData }) {
  const parts = (d.partitions as Record<string, unknown>[]) ?? [];
  const io = d.io as Record<string, number> | null;
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Partitions</div>
        <div className="space-y-3">
          {parts.map((p, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-slate-300">{String(p.mountpoint ?? p.device ?? `Part ${i}`)}</span>
                <span className="text-slate-400">{fmtGB(p.used)} / {fmtGB(p.total)} ({fmt(p.percent)}%)</span>
              </div>
              <PercentBar value={Number(p.percent) || 0} color="bg-amber-500" />
              <div className="text-xs text-slate-600">{String(p.fstype ?? "")} · {String(p.device ?? "")}</div>
            </div>
          ))}
        </div>
      </div>
      {io && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500 col-span-2">I/O counters</div>
          <span className="text-slate-500">Read bytes</span><span className="text-slate-300">{fmtGB(io.read_bytes)}</span>
          <span className="text-slate-500">Write bytes</span><span className="text-slate-300">{fmtGB(io.write_bytes)}</span>
          <span className="text-slate-500">Read count</span><span className="text-slate-300">{String(io.read_count ?? "—")}</span>
          <span className="text-slate-500">Write count</span><span className="text-slate-300">{String(io.write_count ?? "—")}</span>
        </div>
      )}
    </div>
  );
}

function NetDetail({ d }: { d: DetailData }) {
  const nics = d.nics as Record<string, Record<string, number>> ?? {};
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <span className="text-slate-500">Connection count</span>
        <span className="text-slate-300">{String(d.connection_count ?? "—")}</span>
      </div>
      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Network interfaces</div>
        <div className="space-y-4">
          {Object.entries(nics).map(([name, stats]) => (
            <div key={name}>
              <div className="mb-1 text-sm font-medium text-slate-300">{name}</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 pl-2 text-xs">
                <span className="text-slate-500">↓ Received</span><span className="text-slate-400">{fmtGB(stats.bytes_recv)}</span>
                <span className="text-slate-500">↑ Sent</span><span className="text-slate-400">{fmtGB(stats.bytes_sent)}</span>
                <span className="text-slate-500">Packets in</span><span className="text-slate-400">{String(stats.packets_recv ?? "—")}</span>
                <span className="text-slate-500">Packets out</span><span className="text-slate-400">{String(stats.packets_sent ?? "—")}</span>
                {(stats.errin > 0 || stats.errout > 0) && (
                  <><span className="text-red-500">Errors</span><span className="text-red-400">{stats.errin}↓ {stats.errout}↑</span></>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProcDetail({ d }: { d: DetailData }) {
  const byStatus = d.by_status as Record<string, number> ?? {};
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="text-4xl font-bold text-emerald-400">{String(d.total ?? "—")}</div>
        <div className="text-sm text-slate-500">total processes</div>
      </div>
      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">By status</div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(byStatus).map(([status, count]) => (
            <div key={status} className="rounded-lg bg-slate-800 px-3 py-1 text-sm">
              <span className="text-slate-400">{status} </span>
              <span className="font-semibold text-slate-200">{count}</span>
            </div>
          ))}
        </div>
      </div>
      <TopProcs procs={(d.top as object[]) ?? []} metric="cpu_percent" label="CPU %" />
    </div>
  );
}

function TopProcs({ procs, metric, label }: { procs: object[]; metric: string; label: string }) {
  if (!procs.length) return null;
  return (
    <div>
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Top processes ({label})</div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-800 text-slate-600">
            <th className="pb-1 text-left font-medium">Name</th>
            <th className="pb-1 text-left font-medium">PID</th>
            <th className="pb-1 text-right font-medium">{label}</th>
          </tr>
        </thead>
        <tbody>
          {procs.slice(0, 8).map((p: object, i: number) => {
            const proc = p as Record<string, unknown>;
            return (
              <tr key={i} className="border-b border-slate-800/50">
                <td className="py-0.5 pr-2 text-slate-300 font-medium">{String(proc.name ?? "—")}</td>
                <td className="py-0.5 pr-2 text-slate-500">{String(proc.pid ?? "—")}</td>
                <td className="py-0.5 text-right tabular-nums text-slate-300">
                  {proc[metric] !== null && proc[metric] !== undefined ? Number(proc[metric]).toFixed(1) : "—"}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DetailModal({ metric, onClose }: { metric: Metric | null; onClose: () => void }) {
  const [data, setData] = useState<DetailData | null>(null);
  const [raw, setRaw] = useState(false);

  useEffect(() => {
    if (!metric) return;
    setData(null);
    setRaw(false);
    api.detail(metric).then(setData).catch(() => setData({}));
  }, [metric]);

  const titles: Record<Metric, string> = {
    cpu: "CPU — Full Detail",
    mem: "Memory — Full Detail",
    disk: "Disk — Full Detail",
    net: "Network — Full Detail",
    proc: "Processes — Full Detail",
  };

  if (!metric) return null;

  return (
    <Modal open title={titles[metric]} onClose={onClose}>
      <div className="max-h-[70vh] overflow-y-auto pr-1">
        {!data ? (
          <p className="py-8 text-center text-sm text-slate-500">Loading…</p>
        ) : raw ? (
          <pre className="rounded-lg bg-slate-950 p-3 text-xs text-slate-400 overflow-x-auto">
            {JSON.stringify(data, null, 2)}
          </pre>
        ) : (
          <>
            {metric === "cpu" && <CpuDetail d={data} />}
            {metric === "mem" && <MemDetail d={data} />}
            {metric === "disk" && <DiskDetail d={data} />}
            {metric === "net" && <NetDetail d={data} />}
            {metric === "proc" && <ProcDetail d={data} />}
          </>
        )}
      </div>
      <div className="mt-4 flex justify-between border-t border-slate-800 pt-3">
        <button
          onClick={() => setRaw((v) => !v)}
          className="text-xs text-slate-500 hover:text-slate-300 underline"
        >
          {raw ? "Show formatted view" : "View raw JSON"}
        </button>
        <button onClick={onClose} className="rounded-md bg-slate-800 px-3 py-1 text-xs text-slate-300 hover:bg-slate-700">
          Close
        </button>
      </div>
    </Modal>
  );
}

// ── Clickable stat card ───────────────────────────────────────────────────────

function ClickStatCard({
  label, value, suffix, accent, sub, onClick,
}: {
  label: string; value: number; suffix?: string; accent: string; sub?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-left transition-colors hover:border-slate-600 hover:bg-slate-800/60 focus:outline-none"
    >
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
        <div className="text-xs text-slate-700 group-hover:text-slate-500 transition-colors">↗</div>
      </div>
      <div className={`mt-1 text-3xl font-bold ${accent}`}>
        <NumberTicker value={value} suffix={suffix ?? ""} />
      </div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </button>
  );
}

// ── Main tab ──────────────────────────────────────────────────────────────────

export default function DashboardTab() {
  const stats = useLiveStats();
  const history = usePolling(() => api.analytics(900), 6000);
  const alerts = usePolling(() => api.alerts(), 6000);
  const insight = usePolling(() => api.insights(), 30000);
  const [open, setOpen] = useState<Metric | null>(null);

  const chart = (history ?? []).map((h) => ({
    t: fmtTime(h.ts),
    cpu: +h.cpu.toFixed(1),
    mem: +h.mem.toFixed(1),
  }));
  const unacked = (alerts ?? []).filter((a) => !a.acked);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-200">System Overview</h2>
        <span className="text-xs text-slate-600">Click any card for full detail</span>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <ClickStatCard label="CPU" value={stats?.cpu ?? 0} suffix="%" accent="text-cyan-400" onClick={() => setOpen("cpu")} />
        <ClickStatCard label="Memory" value={stats?.mem ?? 0} suffix="%" accent="text-violet-400" onClick={() => setOpen("mem")} />
        <ClickStatCard label="Disk" value={stats?.disk ?? 0} suffix="%" accent="text-amber-400" onClick={() => setOpen("disk")} />
        <ClickStatCard label="Processes" value={stats?.proc_count ?? 0} suffix="" accent="text-emerald-400" onClick={() => setOpen("proc")} />
        <button
          onClick={() => setOpen("net")}
          className="group rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-left transition-colors hover:border-slate-600 hover:bg-slate-800/60 focus:outline-none"
        >
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-wider text-slate-500">Network</div>
            <div className="text-xs text-slate-700 group-hover:text-slate-500 transition-colors">↗</div>
          </div>
          <div className="mt-1 text-sm font-semibold text-sky-400">↓ {fmtBytes(stats?.net_recv ?? 0)}</div>
          <div className="text-sm font-semibold text-rose-400">↑ {fmtBytes(stats?.net_sent ?? 0)}</div>
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Gauge value={stats?.cpu ?? 0} label="CPU load" />
        <Gauge value={stats?.mem ?? 0} label="Memory pressure" />
        <Gauge value={stats?.disk ?? 0} label="Disk usage" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel title="CPU & Memory — last 15 minutes">
            <div className="h-56">
              <ResponsiveContainer>
                <AreaChart data={chart}>
                  <defs>
                    <linearGradient id="gc" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gm" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#a78bfa" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="t" tick={{ fill: "#475569", fontSize: 10 }} minTickGap={50} />
                  <YAxis domain={[0, 100]} tick={{ fill: "#475569", fontSize: 10 }} width={32} />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8 }} />
                  <Area type="monotone" dataKey="cpu" stroke="#22d3ee" fill="url(#gc)" strokeWidth={2} name="CPU %" />
                  <Area type="monotone" dataKey="mem" stroke="#a78bfa" fill="url(#gm)" strokeWidth={2} name="MEM %" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="AI Pulse" action={<Badge tone="cyan">{insight?.engine ?? "…"}</Badge>}>
            {insight && !insight.enabled ? (
              <p className="text-sm leading-relaxed text-slate-500">
                AI Insights are off. Enable them in the <span className="text-cyan-400">AI Insights</span> tab —
                offline local model or API, your choice.
              </p>
            ) : (
              <p className="text-sm leading-relaxed text-slate-400">
                {insight?.narrative ?? "Gathering baseline…"}
              </p>
            )}
          </Panel>
          <Panel title="Active Alerts">
            {unacked.length === 0 ? (
              <p className="text-sm text-slate-500">All clear — no unacknowledged alerts.</p>
            ) : (
              <ul className="space-y-2">
                {unacked.slice(0, 5).map((a) => (
                  <li key={a.id} className="flex items-start gap-2 text-xs text-slate-400">
                    <Badge tone={a.severity === "critical" ? "red" : "amber"}>{a.severity}</Badge>
                    <span>{a.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <DetailModal metric={open} onClose={() => setOpen(null)} />
    </div>
  );
}
