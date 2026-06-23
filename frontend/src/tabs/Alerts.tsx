import { useState } from "react";
import { api } from "../api";
import { usePolling, fmtTime } from "../hooks";
import { Panel, Badge, Button } from "../components/ui";

export default function AlertsTab() {
  const alerts = usePolling(() => api.alerts(), 5000);
  const events = usePolling(() => api.events(), 10000);

  // optimistic removals so the UI updates instantly (next poll confirms)
  const [cleared, setCleared] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const clear = async (id: number) => {
    setCleared((s) => new Set(s).add(id));
    try {
      await api.clearAlert(id);
    } catch {
      setCleared((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  };

  const clearAll = async () => {
    if (busy) return;
    setBusy(true);
    const ids = (alerts ?? []).map((a) => a.id);
    setCleared((s) => {
      const n = new Set(s);
      ids.forEach((i) => n.add(i));
      return n;
    });
    try {
      await api.clearAllAlerts();
    } finally {
      setBusy(false);
    }
  };

  const visible = (alerts ?? []).filter((a) => !cleared.has(a.id));

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-slate-200">Alerts &amp; Events</h2>

      <Panel
        title="Anomaly alerts (z-score + absolute threshold)"
        action={
          visible.length > 0 ? (
            <Button onClick={clearAll} disabled={busy}>
              {busy ? "Clearing…" : "Clear All"}
            </Button>
          ) : undefined
        }
      >
        {visible.length === 0 ? (
          <p className="text-sm text-slate-500">No alerts — system within normal bounds.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500">
                <th className="pb-2 pr-3">Time</th>
                <th className="pb-2 pr-3">Severity</th>
                <th className="pb-2 pr-3">Metric</th>
                <th className="pb-2 pr-3">Message</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => (
                <tr key={a.id} className="border-b border-slate-800/50">
                  <td className="py-1.5 pr-3 tabular-nums text-slate-500">{fmtTime(a.ts)}</td>
                  <td className="py-1.5 pr-3">
                    <Badge tone={a.severity === "critical" ? "red" : "amber"}>{a.severity}</Badge>
                  </td>
                  <td className="py-1.5 pr-3 uppercase text-slate-400">{a.metric}</td>
                  <td className="py-1.5 pr-3 text-slate-300">{a.message}</td>
                  <td className="py-1.5 text-right">
                    <Button onClick={() => clear(a.id)}>Clear</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Event log (control actions & system events)">
        {(events ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">No events yet. Control actions (kill, block IP, service stop/start) land here.</p>
        ) : (
          <ul className="space-y-1.5">
            {(events ?? []).map((e) => (
              <li key={e.id} className="flex items-center gap-3 text-sm">
                <span className="tabular-nums text-xs text-slate-600">{fmtTime(e.ts)}</span>
                <Badge tone="cyan">{e.kind}</Badge>
                <span className="text-slate-400">{e.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
