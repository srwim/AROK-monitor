import { useEffect, useMemo, useRef, useState } from "react";
import type { Conn } from "../api";
import { clientLocation, ipFromRaddr, isLocalIp, resolveIp } from "../geo";

/**
 * NetworkMap — a sleek, self-contained dotted world map for the Network tab.
 *
 * Ported from the MapView design (canvas dotted land + glowing pins + ripples),
 * re-themed to AROK's slate/cyan palette. It resolves every external connection
 * geographically (offline, see geo.ts) and animates traffic as packets flowing
 * along arcs between the central client node and each external endpoint —
 * outbound "sends" in rose, inbound "receives" in sky.
 *
 * No external map tiles, libraries, or API keys. The land bitmask is fetched
 * once from /world-dots.json.
 */

const THEME = {
  land: "#1c261e",
  pin: "#7ab6cd", // sky-400 — external endpoints
  pinCore: "#ece9dc",
  client: "#40d09c", // emerald-400 — the local client
  clientCore: "#ecfdf5",
  send: "#d18a70", // rose-400 — outbound packets
  recv: "#7ab6cd", // sky-400 — inbound packets
  arc: "rgba(99,130,200,0.22)",
  ripple: "#7ab6cd",
};

type Dots = {
  cols: number;
  rows: number;
  latTop: number;
  latBot: number;
  lonL: number;
  lonR: number;
  cells: { nx: number; ny: number }[];
};

type Endpoint = {
  key: string;
  lat: number;
  lng: number;
  label: string;
  count: number;
  procs: string[];
  ips: string[];
};

// Shared promise so the bitmask is fetched/decoded at most once per session.
let dotsPromise: Promise<Dots | null> | null = null;
function loadDots(): Promise<Dots | null> {
  if (dotsPromise) return dotsPromise;
  dotsPromise = fetch("/world-dots.json")
    .then((r) => r.json())
    .then((d) => {
      const bin = atob(d.data);
      const cells: { nx: number; ny: number }[] = [];
      let idx = 0;
      for (let row = 0; row < d.rows; row++) {
        for (let col = 0; col < d.cols; col++) {
          const byte = bin.charCodeAt(idx >> 3);
          const bit = (byte >> (7 - (idx & 7))) & 1;
          idx++;
          if (!bit) continue;
          cells.push({ nx: (col + 0.5) / d.cols, ny: (row + 0.5) / d.rows });
        }
      }
      return { ...d, cells } as Dots;
    })
    .catch(() => null);
  return dotsPromise;
}

// Packet animation defaults ON — a monitoring map with no packet flow looks
// broken, and the OS reduced-motion hint (Windows "Animation effects", also
// flipped off by "best performance" tweaks) proved too easy to trip by
// accident. The map's own toggle is the sole control; the choice persists.
const MOTION_KEY = "arok-map-motion";
function initialMotion(): boolean {
  try {
    const saved = localStorage.getItem(MOTION_KEY);
    if (saved !== null) return saved === "1";
  } catch { /* storage unavailable — fall through */ }
  return true;
}

/** Collapse raw connections into deduplicated, geo-resolved external endpoints. */
function buildEndpoints(conns: Conn[]): { endpoints: Endpoint[]; localCount: number } {
  const map = new Map<string, Endpoint>();
  let localCount = 0;
  for (const c of conns) {
    if (!c.raddr) continue;
    const ip = ipFromRaddr(c.raddr);
    if (!ip || isLocalIp(ip)) {
      if (c.status === "ESTABLISHED") localCount++;
      continue;
    }
    const geo = resolveIp(ip);
    if (!geo) {
      localCount++;
      continue;
    }
    const key = `${geo.lat.toFixed(2)},${geo.lng.toFixed(2)},${geo.label}`;
    let e = map.get(key);
    if (!e) {
      e = { key, lat: geo.lat, lng: geo.lng, label: geo.label, count: 0, procs: [], ips: [] };
      map.set(key, e);
    }
    e.count++;
    const proc = c.proc ?? (c.pid ? `pid ${c.pid}` : null);
    if (proc && !e.procs.includes(proc) && e.procs.length < 6) e.procs.push(proc);
    if (!e.ips.includes(ip) && e.ips.length < 6) e.ips.push(ip);
  }
  return { endpoints: [...map.values()].sort((a, b) => b.count - a.count), localCount };
}

type Pin = { x: number; y: number; r: number; e: Endpoint };
type Ripple = { x: number; y: number; t: number };

export default function NetworkMap({ conns }: { conns: Conn[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; e: Endpoint; below: boolean } | null>(null);
  const [motion, setMotion] = useState(initialMotion);
  const motionRef = useRef(motion);
  motionRef.current = motion;

  const toggleMotion = () => {
    setMotion((m) => {
      try { localStorage.setItem(MOTION_KEY, m ? "0" : "1"); } catch { /* non-fatal */ }
      return !m;
    });
  };

  const { endpoints, localCount } = useMemo(() => buildEndpoints(conns), [conns]);
  const epRef = useRef(endpoints);
  epRef.current = endpoints;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d")!;
    const base = document.createElement("canvas");
    const baseCtx = base.getContext("2d")!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let dots: Dots | null = null;
    let pins: Pin[] = [];
    let ripples: Ripple[] = [];
    let cw = 10;
    let ch = 10;
    let dotPx = 1;
    let raf = 0;
    let pulseTimer = 0;
    let running = true;
    let hover: Pin | null = null;

    const project = (lat: number, lng: number) => {
      const d = dots!;
      const lon = Math.max(d.lonL, Math.min(d.lonR, lng));
      const la = Math.max(d.latBot, Math.min(d.latTop, lat));
      const nx = (lon - d.lonL) / (d.lonR - d.lonL);
      const ny = (d.latTop - la) / (d.latTop - d.latBot);
      const pad = dotPx * 1.5;
      const w = base.width;
      const h = base.height;
      return { x: pad + nx * (w - pad * 2), y: pad + ny * (h - pad * 2) };
    };

    // Place the client node at its approximate geographic position (from the
    // browser timezone). Falls back to map-centre if location is unknown.
    const clientLoc = clientLocation();
    const client = () => {
      if (clientLoc && dots) return project(clientLoc.lat, clientLoc.lng);
      return { x: base.width / 2, y: base.height * 0.52 };
    };

    const renderBase = () => {
      baseCtx.setTransform(1, 0, 0, 1, 0, 0);
      baseCtx.clearRect(0, 0, base.width, base.height);
      if (!dots) return;
      const w = base.width;
      const h = base.height;
      let size = 1.05 * dpr;
      let pad = size * 1.5;
      const spacing = (w - pad * 2) / (dots.cols || 1080);
      if (size > spacing * 0.5) {
        size = Math.max(0.6 * dpr, spacing * 0.5);
        pad = size * 1.5;
      }
      dotPx = size;
      baseCtx.fillStyle = THEME.land;
      for (let i = 0; i < dots.cells.length; i++) {
        const cell = dots.cells[i];
        const x = pad + cell.nx * (w - pad * 2);
        const y = pad + cell.ny * (h - pad * 2);
        baseCtx.beginPath();
        baseCtx.arc(x, y, size, 0, 6.2832);
        baseCtx.fill();
      }
      const grad = baseCtx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "rgba(255,255,255,0.02)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      baseCtx.fillStyle = grad;
      baseCtx.fillRect(0, 0, w, h);
    };

    const layoutPins = () => {
      if (!dots) return;
      needsFrame = true;
      const eps = epRef.current;
      let maxN = 1;
      eps.forEach((e) => (maxN = Math.max(maxN, e.count)));
      pins = eps.map((e) => {
        const p = project(e.lat, e.lng);
        return { x: p.x, y: p.y, e, r: 0.65 + 0.5 * Math.sqrt(e.count / maxN) };
      });
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      cw = Math.max(10, rect.width);
      ch = Math.max(10, rect.height);
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
      base.width = canvas.width;
      base.height = canvas.height;
      renderBase();
      layoutPins();
    };

    // Quadratic bezier control point: lift the midpoint perpendicular to the
    // chord so arcs bow outward like flight paths.
    const ctrl = (ax: number, ay: number, bx: number, by: number) => {
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      const dx = bx - ax;
      const dy = by - ay;
      const dist = Math.hypot(dx, dy) || 1;
      const lift = Math.min(dist * 0.22, base.height * 0.32);
      // Always bow "upward" (toward smaller y) for a consistent, tidy look.
      const nx = -dy / dist;
      const ny = dx / dist;
      const sign = ny > 0 ? -1 : 1;
      return { x: mx + nx * lift * sign, y: my + ny * lift * sign };
    };

    const bez = (a: number, c: number, b: number, t: number) => {
      const u = 1 - t;
      return u * u * a + 2 * u * t * c + t * t * b;
    };

    const draw = (now: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(base, 0, 0);
      if (!dots) return;

      const reduce = !motionRef.current;
      const cl = client();
      const glow = 10 * dpr;
      const psize = 3.2 * dpr;

      // 1) Arcs (static, faint) ------------------------------------------------
      ctx.lineWidth = 1 * dpr;
      ctx.strokeStyle = THEME.arc;
      for (const pn of pins) {
        const c = ctrl(cl.x, cl.y, pn.x, pn.y);
        ctx.beginPath();
        ctx.moveTo(cl.x, cl.y);
        ctx.quadraticCurveTo(c.x, c.y, pn.x, pn.y);
        ctx.stroke();
      }

      // 2) Ripples -------------------------------------------------------------
      ctx.save();
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i];
        const age = (now - rp.t) / 1600;
        if (age >= 1) {
          ripples.splice(i, 1);
          continue;
        }
        const rad = psize * 1.2 + age * psize * 7;
        ctx.beginPath();
        ctx.arc(rp.x, rp.y, rad, 0, 6.2832);
        ctx.strokeStyle = THEME.ripple;
        ctx.globalAlpha = (1 - age) * 0.45;
        ctx.lineWidth = 1.5 * dpr;
        ctx.stroke();
      }
      ctx.restore();

      // 3) Travelling packets — sends (out) + receives (in) -------------------
      if (!reduce) {
        const speed = 3400; // ms per full traversal
        for (let pi = 0; pi < pins.length; pi++) {
          const pn = pins[pi];
          const c = ctrl(cl.x, cl.y, pn.x, pn.y);
          const phase = (pi * 0.137) % 1;
          // two packets per direction, evenly spaced
          for (let k = 0; k < 2; k++) {
            const off = phase + k * 0.5;
            // send: client -> endpoint
            const ts = ((now / speed + off) % 1 + 1) % 1;
            const sx = bez(cl.x, c.x, pn.x, ts);
            const sy = bez(cl.y, c.y, pn.y, ts);
            packet(ctx, sx, sy, THEME.send, dpr, 1 - ts);
            // receive: endpoint -> client (offset so they don't overlap)
            const tr = ((now / speed + off + 0.25) % 1 + 1) % 1;
            const rx = bez(pn.x, c.x, cl.x, tr);
            const ry = bez(pn.y, c.y, cl.y, tr);
            packet(ctx, rx, ry, THEME.recv, dpr, 1 - tr);
          }
        }
      }

      // 4) Endpoint pins -------------------------------------------------------
      const breathe = reduce ? 1 : 0.85 + 0.15 * Math.sin(now / 700);
      for (const pn of pins) {
        const r = psize * pn.r * breathe;
        ctx.save();
        ctx.shadowColor = THEME.pin;
        ctx.shadowBlur = glow;
        ctx.beginPath();
        ctx.arc(pn.x, pn.y, r, 0, 6.2832);
        ctx.fillStyle = THEME.pin;
        ctx.globalAlpha = 0.92;
        ctx.fill();
        ctx.restore();
        ctx.beginPath();
        ctx.arc(pn.x, pn.y, Math.max(0.9 * dpr, r * 0.42), 0, 6.2832);
        ctx.fillStyle = THEME.pinCore;
        ctx.globalAlpha = 0.95;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // 5) Client node (always on top) ----------------------------------------
      const cr = psize * 1.7 * breathe;
      ctx.save();
      ctx.shadowColor = THEME.client;
      ctx.shadowBlur = glow * 1.8;
      ctx.beginPath();
      ctx.arc(cl.x, cl.y, cr, 0, 6.2832);
      ctx.fillStyle = THEME.client;
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(cl.x, cl.y, cr * 0.45, 0, 6.2832);
      ctx.fillStyle = THEME.clientCore;
      ctx.fill();
      // slow halo ring on the client
      if (!reduce) {
        const halo = (now / 2600) % 1;
        ctx.beginPath();
        ctx.arc(cl.x, cl.y, cr + halo * psize * 8, 0, 6.2832);
        ctx.strokeStyle = THEME.client;
        ctx.globalAlpha = (1 - halo) * 0.4;
        ctx.lineWidth = 1.4 * dpr;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // hover highlight
      if (hover) {
        ctx.beginPath();
        ctx.arc(hover.x, hover.y, psize * 2.4, 0, 6.2832);
        ctx.strokeStyle = THEME.pinCore;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 1.2 * dpr;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    };

    // With motion off the scene is static — draw once and idle (needsFrame
    // re-arms on resize, data changes, hover, and the motion toggle) instead
    // of burning a full redraw 60x/s for identical pixels.
    let needsFrame = true;
    const loop = (now: number) => {
      if (!running) return;
      if (motionRef.current || needsFrame) {
        draw(now);
        needsFrame = false;
      }
      raf = requestAnimationFrame(loop);
    };

    const pulse = () => {
      if (!motionRef.current) return;
      pins.slice(0, 14).forEach((pin, i) => {
        setTimeout(() => ripples.push({ x: pin.x, y: pin.y, t: performance.now() }), i * 120);
      });
    };

    // hover hit-testing -> React tooltip
    const onMove = (ev: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = (ev.clientX - rect.left) * dpr;
      const my = (ev.clientY - rect.top) * dpr;
      let best: Pin | null = null;
      let bd = 16 * dpr;
      for (const pn of pins) {
        const dist = Math.hypot(pn.x - mx, pn.y - my);
        if (dist < bd) {
          bd = dist;
          best = pn;
        }
      }
      if (hover !== best) needsFrame = true;
      hover = best;
      if (best) {
        const x = ev.clientX - rect.left;
        const y = ev.clientY - rect.top;
        setTooltip({
          // clamp so the centred tooltip can't spill past the container's
          // left/right edge (the wrapper is overflow-hidden)
          x: Math.min(Math.max(x, 90), Math.max(90, rect.width - 90)),
          y,
          e: best.e,
          // near the top of the map there's no room above the cursor — flip below
          below: y < 96,
        });
      } else setTooltip(null);
    };
    const onLeave = () => {
      if (hover) needsFrame = true;
      hover = null;
      setTooltip(null);
    };

    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        raf = requestAnimationFrame(loop);
      }
    };

    const ro = new ResizeObserver(() => resize());

    loadDots().then((d) => {
      dots = d;
      if (!d) return;
      resize();
      ro.observe(canvas);
      canvas.addEventListener("mousemove", onMove);
      canvas.addEventListener("mouseleave", onLeave);
      document.addEventListener("visibilitychange", onVisibility);
      raf = requestAnimationFrame(loop);
      pulse();
      pulseTimer = window.setInterval(() => {
        if (!document.hidden && running) pulse();
      }, 4500);
    });

    // expose hooks so the data-effect and motion toggle can wake the loop
    (canvas as any).__relayout = layoutPins;
    (canvas as any).__pulse = pulse;
    (canvas as any).__wake = () => { needsFrame = true; };

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      clearInterval(pulseTimer);
      ro.disconnect();
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Re-layout pins + ping when the connection set changes.
  useEffect(() => {
    const canvas = canvasRef.current as any;
    if (canvas && canvas.__relayout) {
      canvas.__relayout();
      canvas.__pulse?.();
    }
  }, [endpoints]);

  // Redraw once when motion is toggled (covers the paused → paused-but-dirty case).
  useEffect(() => {
    (canvasRef.current as any)?.__wake?.();
  }, [motion]);

  const countries = endpoints.length;
  const clientLabel = clientLocation()?.label ?? "Client";

  return (
    <div
      ref={wrapRef}
      className="relative w-full overflow-hidden rounded-xl border border-slate-800"
      style={{
        height: 340,
        background: "radial-gradient(120% 140% at 50% -10%, #10150f, #0a0d0a 60%)",
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* HUD: title + counters */}
      <div className="pointer-events-none absolute left-4 top-3 flex items-center gap-6">
        <div>
          <div className="text-2xl font-bold tabular-nums text-sky-300" style={{ textShadow: "0 0 18px rgba(56,189,248,0.35)" }}>
            {endpoints.reduce((s, e) => s + e.count, 0)}
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-slate-500">External</div>
        </div>
        <div>
          <div className="text-2xl font-bold tabular-nums text-emerald-300">{localCount}</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-slate-500">Local</div>
        </div>
        <div>
          <div className="text-2xl font-bold tabular-nums text-slate-200">{countries}</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-slate-500">Locations</div>
        </div>
      </div>

      {/* legend + motion toggle */}
      <div className="absolute bottom-3 right-4 flex items-center gap-4 text-[11px] text-slate-400">
        <span className="pointer-events-none inline-flex items-center gap-1.5">
          <i className="inline-block h-2 w-2 rounded-full" style={{ background: THEME.send, boxShadow: `0 0 8px ${THEME.send}` }} /> Send
        </span>
        <span className="pointer-events-none inline-flex items-center gap-1.5">
          <i className="inline-block h-2 w-2 rounded-full" style={{ background: THEME.recv, boxShadow: `0 0 8px ${THEME.recv}` }} /> Receive
        </span>
        <span className="pointer-events-none inline-flex items-center gap-1.5">
          <i className="inline-block h-2 w-2 rounded-full" style={{ background: THEME.client, boxShadow: `0 0 8px ${THEME.client}` }} /> {clientLabel}
        </span>
        <button
          onClick={toggleMotion}
          title={motion ? "Pause packet animation" : "Play packet animation"}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors ${
            motion
              ? "border-cyan-800/60 bg-cyan-950/50 text-cyan-300 hover:bg-cyan-900/50"
              : "border-slate-700 bg-slate-900/60 text-slate-500 hover:text-slate-300"
          }`}
        >
          {motion ? "❚❚" : "▶"} Motion
        </button>
      </div>

      {/* empty state */}
      {endpoints.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="text-sm text-slate-500">No external connections to map</span>
        </div>
      )}

      {/* tooltip */}
      {tooltip && (
        <div
          className={`pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-950/90 px-3 py-2 text-xs shadow-xl ${
            tooltip.below ? "translate-y-4" : "-translate-y-[130%]"
          }`}
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="font-semibold text-slate-100">{tooltip.e.label}</div>
          <div className="text-slate-400">
            {tooltip.e.count} connection{tooltip.e.count === 1 ? "" : "s"}
          </div>
          {tooltip.e.procs.length > 0 && <div className="mt-0.5 text-slate-500">{tooltip.e.procs.join(", ")}</div>}
          {tooltip.e.ips.length > 0 && <div className="mt-0.5 tabular-nums text-slate-600">{tooltip.e.ips[0]}</div>}
        </div>
      )}
    </div>
  );
}

// Small glowing packet dot with a soft fade as it nears its destination.
function packet(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, dpr: number, fade: number) {
  const a = 0.35 + 0.55 * Math.min(1, fade * 1.6);
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 8 * dpr;
  ctx.beginPath();
  ctx.arc(x, y, 1.7 * dpr, 0, 6.2832);
  ctx.fillStyle = color;
  ctx.globalAlpha = a;
  ctx.fill();
  ctx.restore();
}
