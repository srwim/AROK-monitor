import { useEffect, useRef, useState } from "react";
import {
  Activity, Cpu, Network, Cog, BarChart3, Sparkles, Bell, Settings as SettingsIcon, Gamepad2, ArrowUpCircle, Trash2,
} from "lucide-react";
import { usePolling } from "./hooks";
import { api, type GamingStatus } from "./api";
import DashboardTab from "./tabs/Dashboard";
import ProcessesTab from "./tabs/Processes";
import NetworkTab from "./tabs/Network";
import ServicesTab from "./tabs/Services";
import AnalyticsTab from "./tabs/Analytics";
import InsightsTab from "./tabs/Insights";
import AlertsTab from "./tabs/Alerts";
import CleanupTab from "./tabs/Cleanup";
import UpgradesTab from "./tabs/Upgrades";
import SettingsTab from "./tabs/Settings";

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: Activity },
  { id: "processes", label: "Processes", icon: Cpu },
  { id: "network", label: "Network", icon: Network },
  { id: "services", label: "Services", icon: Cog },
  { id: "cleanup", label: "Cleanup", icon: Trash2 },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "insights", label: "AI Insights", icon: Sparkles },
  { id: "alerts", label: "Alerts", icon: Bell },
  { id: "upgrades", label: "Upgrades", icon: ArrowUpCircle },
  { id: "settings", label: "Settings", icon: SettingsIcon },
] as const;

type TabId = (typeof TABS)[number]["id"];

type Toast = { id: number; severity: string; message: string };

export default function App() {
  const [tab, setTab] = useState<TabId>("dashboard");
  const alerts = usePolling(() => api.alerts(), 5000);
  const unacked = (alerts ?? []).filter((a) => !a.acked).length;
  const gamingPolled = usePolling(() => api.gaming(), 8000);
  const settings = usePolling(() => api.settings(), 60000);
  const version = settings?.version ?? "";
  const [gaming, setGaming] = useState<GamingStatus | null>(null);
  const [gamingBusy, setGamingBusy] = useState(false);
  const g = gaming ?? gamingPolled;

  const toggleGaming = async () => {
    if (gamingBusy) return;
    setGamingBusy(true);
    try {
      setGaming(await api.setGaming(!(g?.enabled ?? false)));
    } finally {
      setGamingBusy(false);
    }
  };

  // toast notifications for newly arrived unacked alerts
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seen = useRef<Set<number> | null>(null);
  useEffect(() => {
    if (!alerts) return;
    if (seen.current === null) {
      seen.current = new Set(alerts.map((a) => a.id));
      return;
    }
    const fresh = alerts.filter((a) => !a.acked && !seen.current!.has(a.id));
    if (fresh.length) {
      fresh.forEach((a) => seen.current!.add(a.id));
      setToasts((t) => [...t, ...fresh.map((a) => ({ id: a.id, severity: a.severity, message: a.message }))].slice(-4));
      fresh.forEach((a) =>
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== a.id)), 7000)
      );
    }
  }, [alerts]);

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-950/80">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <img src="/orb.png" alt="AROK" className="h-10 w-10" />
          <div>
            <div className="brand-serif text-base font-bold tracking-[0.25em] text-slate-100">AROK</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500">
              Monitor <span className="text-orange-500">{version || "…"}</span>
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                tab === id
                  ? "bg-cyan-950/60 text-cyan-300"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
            >
              <Icon size={16} />
              {label}
              {id === "alerts" && unacked > 0 && (
                <span className="ml-auto rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{unacked}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="border-t border-slate-800 px-3 py-3">
          <button
            onClick={toggleGaming}
            disabled={gamingBusy}
            title={g?.enabled ? `Gaming mode ON` : "Stop non-essential services & boost power plan"}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
              g?.enabled
                ? "bg-gradient-to-r from-fuchsia-950/80 to-violet-950/80 text-fuchsia-300"
                : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
            }`}
          >
            <Gamepad2 size={16} className={g?.enabled ? "text-fuchsia-400" : ""} />
            Gaming mode
            <span
              className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                g?.enabled ? "bg-fuchsia-600 text-white" : "bg-slate-800 text-slate-500"
              }`}
            >
              {gamingBusy ? "..." : g?.enabled ? "ON" : "OFF"}
            </span>
          </button>
          <button
            onClick={async () => setGaming(await api.setGamingAuto(!(g?.auto ?? false)))}
            title="Watch for running games and engage gaming mode automatically"
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-1 text-xs text-slate-500 hover:bg-slate-900 hover:text-slate-300"
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                g?.auto ? "bg-fuchsia-400" : "bg-slate-700"
              }`}
            />
            Auto-detect games {g?.auto ? "on" : "off"}
            {g?.detected && <span className="ml-auto truncate text-fuchsia-400">{g.detected}</span>}
          </button>
          <div className="mt-2 flex items-center gap-2 px-3 text-xs text-slate-500">
            <span className="pulse-dot inline-block h-2 w-2 rounded-full bg-emerald-500" />
            Live sampling 3s
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-6">
        {tab === "dashboard" && <DashboardTab />}
        {tab === "processes" && <ProcessesTab />}
        {tab === "network" && <NetworkTab />}
        {tab === "services" && <ServicesTab />}
        {tab === "cleanup" && <CleanupTab />}
        {tab === "analytics" && <AnalyticsTab />}
        {tab === "insights" && <InsightsTab />}
        {tab === "alerts" && <AlertsTab />}
        {tab === "upgrades" && <UpgradesTab />}
        {tab === "settings" && <SettingsTab />}
      </main>

      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-xl backdrop-blur ${
              t.severity === "critical"
                ? "border-red-800 bg-red-950/90 text-red-200"
                : "border-amber-800 bg-amber-950/90 text-amber-200"
            }`}
          >
            <div className="mb-0.5 text-[10px] font-bold uppercase tracking-wider opacity-70">
              {t.severity} alert
            </div>
            {t.message}
            <button
              className="ml-2 text-xs underline opacity-60 hover:opacity-100"
              onClick={() => {
                api.ackAlert(t.id);
                setToasts((x) => x.filter((y) => y.id !== t.id));
              }}
            >
              ack
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
