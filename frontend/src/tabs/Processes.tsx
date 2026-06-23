import { useState } from "react";
import { api, type Proc } from "../api";
import { usePolling } from "../hooks";
import { Panel, Badge, Button, Modal } from "../components/ui";

export default function ProcessesTab() {
  const procs = usePolling(() => api.processes(30), 5000);
  const [selected, setSelected] = useState<Proc | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const kill = async (pid: number) => {
    const r = await api.kill(pid);
    setResult(r.detail);
    setSelected(null);
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-slate-200">Processes</h2>
      {result && (
        <div className="rounded-lg border border-cyan-900 bg-cyan-950/40 px-4 py-2 text-sm text-cyan-300">
          {result} <button className="ml-2 text-cyan-500" onClick={() => setResult(null)}>dismiss</button>
        </div>
      )}
      <Panel title={`Top ${procs?.length ?? 0} by CPU`}>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500">
              <th className="pb-2 pr-3">PID</th>
              <th className="pb-2 pr-3">Name</th>
              <th className="pb-2 pr-3">User</th>
              <th className="pb-2 pr-3 text-right">CPU %</th>
              <th className="pb-2 pr-3 text-right">MEM %</th>
              <th className="pb-2 pr-3">Status</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {(procs ?? []).map((p) => (
              <tr key={p.pid} className="border-b border-slate-800/50 text-slate-300 hover:bg-slate-800/30">
                <td className="py-1.5 pr-3 tabular-nums text-slate-500">{p.pid}</td>
                <td className="py-1.5 pr-3 font-medium">
                  <button className="hover:text-cyan-300" onClick={() => setSelected(p)}>{p.name}</button>
                </td>
                <td className="py-1.5 pr-3 text-slate-500">{p.username ?? "—"}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{(p.cpu_percent ?? 0).toFixed(1)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{(p.memory_percent ?? 0).toFixed(1)}</td>
                <td className="py-1.5 pr-3"><Badge tone={p.status === "running" ? "green" : "slate"}>{p.status}</Badge></td>
                <td className="py-1.5 text-right">
                  <Button danger onClick={() => setSelected(p)}>Kill</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={`Terminate ${selected?.name}?`}>
        <p className="mb-4 text-sm text-slate-400">
          PID {selected?.pid} · {selected?.username ?? "unknown user"} · CPU {(selected?.cpu_percent ?? 0).toFixed(1)}% · MEM {(selected?.memory_percent ?? 0).toFixed(1)}%
        </p>
        <div className="flex justify-end gap-2">
          <Button onClick={() => setSelected(null)}>Cancel</Button>
          <Button danger onClick={() => selected && kill(selected.pid)}>Terminate</Button>
        </div>
      </Modal>
    </div>
  );
}
