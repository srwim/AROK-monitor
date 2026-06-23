import { useEffect, useRef, useState } from "react";
import { api, type Stats } from "./api";

/** Live stats via WebSocket, falling back to 3s polling if WS is unavailable. */
export function useLiveStats(): Stats | null {
  const [data, setData] = useState<Stats | null>(null);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let poll: number | undefined;
    let closed = false;

    const startPoll = () => {
      if (poll !== undefined) return;
      const tick = async () => {
        try {
          setData(await api.stats());
        } catch {
          /* keep last */
        }
      };
      tick();
      poll = window.setInterval(tick, 3000);
    };

    try {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws/stats`);
      ws.onmessage = (e) => setData(JSON.parse(e.data));
      ws.onerror = () => ws?.close();
      ws.onclose = () => {
        if (!closed) startPoll();
      };
    } catch {
      startPoll();
    }

    return () => {
      closed = true;
      ws?.close();
      if (poll !== undefined) clearInterval(poll);
    };
  }, []);

  return data;
}

export function usePolling<T>(fn: () => Promise<T>, intervalMs: number): T | null {
  const [data, setData] = useState<T | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const d = await fnRef.current();
        if (alive) setData(d);
      } catch {
        /* server may still be starting; keep last good data */
      }
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [intervalMs]);

  return data;
}

export function fmtBytes(b: number): string {
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB/s`;
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KB/s`;
  return `${b.toFixed(0)} B/s`;
}

export function fmtTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString();
}
