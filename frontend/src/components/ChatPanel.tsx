import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { api, type ChatTurn } from "../api";
import { Panel } from "./ui";

// ── Chat with the active AI engine ───────────────────────────────────────────
// Shared between AI Insights (with an enable toggle) and the Dashboard (chat
// only — the toggle lives in AI Insights and Settings). `enabled` is the
// persisted ai_chat_enabled flag; `onToggle` renders the switch when provided.

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 rounded-full transition-colors ${checked ? "bg-cyan-600" : "bg-slate-700"}`}
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

export default function ChatPanel({
  engine, enabled, onToggle, compact,
}: {
  engine: string;
  enabled: boolean;
  onToggle?: (v: boolean) => void;
  compact?: boolean;
}) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [turns, busy]);

  const send = async () => {
    const msg = input.trim();
    if (!msg || busy) return;
    const next = [...turns, { role: "user" as const, content: msg }];
    setTurns(next);
    setInput("");
    setBusy(true);
    try {
      const r = await api.aiChat(msg, next);
      setTurns([...next, { role: "assistant", content: r.reply || "(no reply)" }]);
    } catch {
      setTurns([...next, { role: "assistant", content: "Chat request failed." }]);
    } finally {
      setBusy(false);
    }
  };

  // Without a toggle (Dashboard), the parent only renders this when enabled.
  if (!enabled && !onToggle) return null;

  return (
    <Panel
      title="Chat with AI"
      action={
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-600">{engine}</span>
          {onToggle && <Toggle checked={enabled} onChange={onToggle} />}
        </div>
      }
    >
      {!enabled ? (
        <p className="text-sm text-slate-500">
          Toggle on to chat directly with the active engine — here and on the Dashboard.
          Runs on whichever model is loaded; local stays on your machine.
        </p>
      ) : (
        <div className="space-y-3">
          <div className={`${compact ? "max-h-56" : "max-h-72"} space-y-2 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/40 p-3`}>
            {turns.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-600">Ask anything — e.g. “what should I check if my PC feels slow?”</p>
            ) : (
              turns.map((t, i) => (
                <div key={i} className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                    t.role === "user" ? "bg-cyan-950/70 text-cyan-100" : "bg-slate-800/80 text-slate-200"
                  }`}>
                    {t.content}
                  </div>
                </div>
              ))
            )}
            {busy && <div className="flex justify-start"><div className="rounded-2xl bg-slate-800/80 px-3 py-2 text-sm text-slate-500">thinking…</div></div>}
            <div ref={endRef} />
          </div>
          <div className="flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") send(); }}
              placeholder="Type a message…"
              className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-cyan-700 focus:outline-none"
            />
            <button
              onClick={send}
              disabled={busy || !input.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-950 px-3 py-2 text-sm font-medium text-cyan-300 hover:bg-cyan-900 disabled:opacity-40"
            >
              <Send size={14} /> Send
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}
