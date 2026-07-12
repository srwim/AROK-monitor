import { useState } from "react";
import { api } from "../api";
import { usePolling } from "../hooks";
import { Panel, Badge, Button } from "../components/ui";

export default function ServicesTab() {
  const services = usePolling(() => api.services(), 15000);
  const [filter, setFilter] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const act = async (name: string, action: string) => {
    const r = await api.serviceAction(name, action);
    setResult(r.detail);
  };

  const list = (services ?? []).filter(
    (s) =>
      s.name.toLowerCase().includes(filter.toLowerCase()) ||
      s.display_name.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-200">Services</h2>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter services…"
          className="w-64 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-cyan-700 focus:outline-none"
        />
      </div>

      {result && (
        <div className="rounded-lg border border-cyan-900 bg-cyan-950/40 px-4 py-2 text-sm text-cyan-300">
          {result} <button className="ml-2 text-cyan-500" onClick={() => setResult(null)}>dismiss</button>
        </div>
      )}

      {services && services.length === 0 ? (
        <Panel title="No Services">
          <p className="text-sm text-slate-500">
            Service enumeration is Windows-only. Run the demo on Windows to see live services here — this panel
            will populate automatically via <code className="text-slate-400">psutil.win_service_iter()</code>.
          </p>
        </Panel>
      ) : (
        <Panel title={`${list.length} services`}>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500">
                <th className="pb-2 pr-3">Name</th>
                <th className="pb-2 pr-3">Display name</th>
                <th className="pb-2 pr-3">Status</th>
                <th className="pb-2 pr-3">Start type</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, 80).map((s) => (
                <tr key={s.name} className="border-b border-slate-800/50 text-slate-300 hover:bg-slate-800/30">
                  <td className="py-1.5 pr-3 font-medium">{s.name}</td>
                  <td className="py-1.5 pr-3 text-slate-400">{s.display_name}</td>
                  <td className="py-1.5 pr-3">
                    <Badge tone={s.status === "running" ? "green" : "slate"}>{s.status}</Badge>
                  </td>
                  <td className="py-1.5 pr-3 text-slate-500">{s.start_type}</td>
                  <td className="py-1.5 text-right">
                    <div className="flex justify-end gap-1.5">
                      {s.status === "running" ? (
                        <>
                          <Button onClick={() => act(s.name, "restart")}>Restart</Button>
                          <Button danger onClick={() => act(s.name, "stop")}>Stop</Button>
                        </>
                      ) : (
                        <Button onClick={() => act(s.name, "start")}>Start</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
