import { useEffect, useRef, useState, type ReactNode } from "react";

/** Magic UI-style animated number ticker */
export function NumberTicker({ value, decimals = 1, suffix = "" }: { value: number; decimals?: number; suffix?: string }) {
  const [display, setDisplay] = useState(value);
  const raf = useRef<number>(0);

  useEffect(() => {
    const from = display;
    const to = value;
    const start = performance.now();
    const dur = 600;
    const step = (t: number) => {
      const p = Math.min((t - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (to - from) * eased);
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <span className="tabular-nums">
      {display.toFixed(decimals)}
      {suffix}
    </span>
  );
}

export function Panel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/50 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03),0_10px_30px_-18px_rgba(0,0,0,0.7)] backdrop-blur">
      <div className="flex items-center justify-between border-b border-slate-800/80 bg-gradient-to-b from-white/[0.03] to-transparent px-4 py-2.5">
        <h3 className="text-sm font-semibold tracking-wide text-slate-200">{title}</h3>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export function StatCard({ label, value, suffix, accent, sub }: { label: string; value: number; suffix?: string; accent: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 text-3xl font-bold ${accent}`}>
        <NumberTicker value={value} suffix={suffix ?? ""} />
      </div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export function Gauge({ value, label }: { value: number; label: string }) {
  const color = value >= 90 ? "#ef4444" : value >= 70 ? "#cda24a" : "#38a873";
  return (
    <div className="flex flex-col items-center">
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(value, 100)}%`, background: color }} />
      </div>
      <div className="mt-1 text-xs text-slate-500">{label}</div>
    </div>
  );
}

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "amber" | "red" | "cyan" }) {
  const tones: Record<string, string> = {
    slate: "bg-slate-800/80 text-slate-300 ring-slate-600/30",
    green: "bg-emerald-950/70 text-emerald-300 ring-emerald-500/25",
    amber: "bg-amber-950/70 text-amber-300 ring-amber-500/25",
    red: "bg-red-950/70 text-red-300 ring-red-500/25",
    cyan: "bg-cyan-950/70 text-cyan-300 ring-cyan-500/25",
  };
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}>{children}</span>;
}

export function Button({ children, onClick, danger, disabled }: { children: ReactNode; onClick?: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-all active:scale-[0.97] disabled:opacity-40 ${
        danger
          ? "bg-red-950/60 text-red-300 ring-red-500/25 hover:bg-red-900/60"
          : "bg-slate-800/90 text-slate-300 ring-slate-600/30 hover:bg-slate-700/90 hover:text-slate-100"
      }`}
    >
      {children}
    </button>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-slate-700/80 bg-slate-900 p-5 shadow-2xl ring-1 ring-white/[0.04]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-200">{title}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
