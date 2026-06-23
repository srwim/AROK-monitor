import { useState } from "react";
import { api } from "../api";
import { usePolling, fmtBytes } from "../hooks";
import { Panel, Badge, Button } from "../components/ui";

export default function NetworkTab() {
  const conns = usePolling(() => api.network(60), 6000);
  const stats = usePolling(() => api.stats(), 3000);
  const [result, setResult] = useState<string | null>(null);

  const block = async (raddr: string) => {
    const ip = raddr.split(":")[0];
    if (!ip) return;
    const r = await api.blockIp(ip);
    setResult(r.detail);
  };

  const established = (conns ?? []).filter((c) => c.status === "ESTABLISHED");
  const listening = (conns ?? []).filter((c) => c.status === "LISTEN");

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-slate-200">Network Intelligence</h2>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label="Receive" value={fmtBytes(stats?.net_recv ?? 0)} accent="text-sky-400" />
        <Tile label="Send" value={fmtBytes(stats?.net_sent ?? 0)} accent="text-rose-400" />
        <Tile label="Established" value={String(established.length)} accent="text-emerald-400" />
        <Tile label="Listening" value={String(listening.length)} accent="text-amber-400" />
      </div>

      {result && (
        <div className="rounded-lg border border-cyan-900 bg-cyan-950/40 px-4 py-2 text-sm text-cyan-300">
          {result} <button className="ml-2 text-cyan-500" onClick={() => setResult(null)}>dismiss</button>
        </div>
      )}

      <Panel title="Connections">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500">
              <th className="pb-2 pr-3">Process</th>
              <th className="pb-2 pr-3">Local</th>
              <th className="pb-2 pr-3">Remote</th>
              <th className="pb-2 pr-3">Status</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {(conns ?? []).map((c, i) => (
              <tr key={i} className="border-b border-slate-800/50 text-slate-300 hover:bg-slate-800/30">
                <td className="py-1.5 pr-3 font-medium">{c.proc ?? `pid ${c.pid ?? "?"}`}</td>
                <td className="py-1.5 pr-3 tabular-nums text-slate-400">{c.laddr}</td>
                <td className="py-1.5 pr-3 tabular-nums text-slate-400">{c.raddr || "—"}</td>
                <td className="py-1.5 pr-3">
                  <Badge tone={c.status === "ESTABLISHED" ? "green" : c.status === "LISTEN" ? "cyan" : "slate"}>{c.status}</Badge>
                </td>
                <td className="py-1.5 text-right">
                  {c.raddr && <Button danger onClick={() => block(c.raddr)}>Block IP</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
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
