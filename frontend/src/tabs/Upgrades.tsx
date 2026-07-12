import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ExternalLink, Gauge, Crown, Cpu, MemoryStick, HardDrive, MonitorCog, CircuitBoard,
  AlertTriangle, ChevronDown, ShieldCheck, Microchip, Power, Fan, Computer, Package,
  type LucideIcon,
} from "lucide-react";
import { Panel, Badge } from "../components/ui";
import { api, type HardwareInventory } from "../api";

const AMAZON_TAG = "lifeupgrad02b-20";
const amazonSearch = (q: string) =>
  `https://www.amazon.com/s?k=${encodeURIComponent(q)}&tag=${AMAZON_TAG}`;

// ── Manifest types ──────────────────────────────────────────────────────────
type Pick = { title: string; asin?: string; price?: string; image?: string; thumb?: string; url: string };
type ComponentUpgrade = { label: string; bangForBuck: Pick; highEnd: Pick };
type SystemComponent = { type: string; name: string; url: string; price?: string; store?: string; qty?: number; image?: string; thumb?: string };
type FeaturedSystem = {
  name: string;
  source?: string;
  sourceUrl?: string;
  totalPrice?: string;
  note?: string;
  components: SystemComponent[];
};
type GpuWatchEntry = {
  model: string;
  url: string;
  msrp?: string | null;
};
type Manifest = {
  version: number;
  generatedAt: string;
  disclosure: string;
  componentUpgrades: Record<string, ComponentUpgrade>;
  featuredSystems: FeaturedSystem[];
  gpuWatch?: GpuWatchEntry[];
};

// Daily-refreshed manifest committed by the GitHub Action, with a bundled
// fallback shipped in the build. We fetch BOTH and use whichever is best:
// the remote can lag an app update that introduced new manifest sections
// (prices, gpuWatch), and the bundle goes stale between app updates — so
// prefer the newer format, then the newer generation date.
const MANIFEST_REMOTE =
  "https://raw.githubusercontent.com/srwim/AROK-monitor/main/upgrades-pipeline/manifest.json";
const MANIFEST_LOCAL = "/manifest.json";

function isNewFormat(m: Manifest): boolean {
  return Array.isArray(m.gpuWatch);
}

async function fetchManifest(url: string): Promise<Manifest | null> {
  try {
    const r = await fetch(url, { cache: "no-cache" });
    return r.ok ? ((await r.json()) as Manifest) : null;
  } catch {
    return null;
  }
}

async function loadManifest(): Promise<Manifest> {
  const [remote, local] = await Promise.all([
    fetchManifest(MANIFEST_REMOTE),
    fetchManifest(MANIFEST_LOCAL),
  ]);
  const candidates = [remote, local].filter((m): m is Manifest => m !== null);
  if (!candidates.length) throw new Error("manifest unavailable");
  candidates.sort((a, b) => {
    const fmt = Number(isNewFormat(b)) - Number(isNewFormat(a));
    if (fmt !== 0) return fmt;
    return new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime();
  });
  return candidates[0];
}

// ── Shared affiliate link (tag is already baked into every manifest URL) ──────
function AmazonLink({ url, children, primary }: { url: string; children: ReactNode; primary?: boolean }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="sponsored nofollow noopener noreferrer"
      className={
        primary
          ? "inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2 text-sm font-semibold text-white shadow transition-colors hover:from-amber-400 hover:to-orange-400"
          : "inline-flex items-center gap-1 text-xs text-cyan-400 underline-offset-2 hover:text-cyan-300 hover:underline"
      }
    >
      {children}
      <ExternalLink size={primary ? 14 : 12} />
    </a>
  );
}

// Store-aware rel: Amazon links carry our affiliate tag ("sponsored");
// non-Amazon stores have no affiliate program yet, so plain rel.
function storeRel(store?: string): string {
  return !store || store === "Amazon"
    ? "sponsored nofollow noopener noreferrer"
    : "nofollow noopener noreferrer";
}

// ── Thumbnail lightbox ────────────────────────────────────────────────────────
// Clicking any product thumbnail opens the full-size image with the part name
// captioned as the same purchase link the card carries. Click outside (or
// press Escape) to close.
type LightboxData = { src: string; title: string; href: string; sponsored: boolean };
const LightboxCtx = createContext<(d: LightboxData) => void>(() => {});

function Lightbox({ data, onClose }: { data: LightboxData; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/85 p-8 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-label={data.title}
    >
      <img
        src={data.src}
        alt={data.title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[75vh] max-w-[85vw] rounded-2xl bg-white object-contain p-4 shadow-2xl"
      />
      <a
        href={data.href}
        target="_blank"
        rel={data.sponsored ? "sponsored nofollow noopener noreferrer" : "nofollow noopener noreferrer"}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-cyan-400 underline-offset-4 hover:text-cyan-300 hover:underline"
      >
        {data.title}
        <ExternalLink size={14} />
      </a>
    </div>
  );
}

function PickThumb({ pick }: { pick: Pick }) {
  const openLightbox = useContext(LightboxCtx);
  if (!pick.image) return null;
  return (
    <button
      onClick={() => openLightbox({ src: pick.image!, title: pick.title, href: pick.url, sponsored: true })}
      title={`${pick.title} — click to enlarge`}
      className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-slate-100 p-1 shadow-sm ring-1 ring-slate-700/50 transition-transform hover:scale-105 focus:outline-none"
    >
      {/* card shows the tiny rendition; the lightbox loads the full image */}
      <img src={pick.thumb ?? pick.image} alt={pick.title} loading="lazy" decoding="async" className="h-full w-full object-contain" />
    </button>
  );
}

function PickCard({ pick, kind }: { pick: Pick; kind: "value" | "high" }) {
  const value = kind === "value";
  return (
    <div className="flex flex-1 flex-col rounded-xl border border-slate-700/60 bg-slate-900/60 p-4">
      <div className="mb-2 flex items-center gap-2">
        {value ? <Gauge size={14} className="text-emerald-400" /> : <Crown size={14} className="text-amber-400" />}
        <Badge tone={value ? "green" : "amber"}>{value ? "Best bang for buck" : "High end"}</Badge>
      </div>
      <div className="flex flex-1 items-start justify-between gap-3">
        <div className="min-w-0">
          <a
            href={pick.url}
            target="_blank"
            rel={storeRel()}
            title={`View ${pick.title} on Amazon`}
            className="group inline-flex items-start gap-1 text-sm font-medium leading-snug text-slate-200 transition-colors hover:text-cyan-300"
          >
            <span className="underline-offset-2 group-hover:underline">{pick.title}</span>
            <ExternalLink size={12} className="mt-0.5 shrink-0 text-slate-600 group-hover:text-cyan-400" />
          </a>
          {pick.price && <div className="mt-1 text-xs text-slate-500">{pick.price}</div>}
        </div>
        <PickThumb pick={pick} />
      </div>
    </div>
  );
}

// ── Socket detection & compatibility ──────────────────────────────────────────
// An upgrade pick must FIT the machine it's recommended to. CPU picks stay on
// the user's existing socket (drop-in); motherboard picks match the user's CPU.
// Dead-end sockets get an honest "platform upgrade" note instead of a part that
// won't fit.

type Socket = "AM4" | "AM5" | "LGA1151" | "LGA1200" | "LGA1700" | "LGA1851" | null;

function detectSocket(cpuName?: string | null): Socket {
  const n = (cpuName ?? "").toLowerCase();
  const ryzen = n.match(/ryzen\s+\d+\s+(\d{4})/);
  if (ryzen) {
    // Desktop Ryzen: 1000–5000 = AM4, 7000/8000/9000 = AM5.
    return parseInt(ryzen[1][0], 10) >= 7 ? "AM5" : "AM4";
  }
  if (n.includes("threadripper")) return null; // HEDT — don't guess
  if (n.includes("core ultra")) return "LGA1851";
  const intel = n.match(/i[3579][- ](\d{4,5})/);
  if (intel) {
    const digits = intel[1];
    const gen = digits.length === 5 ? parseInt(digits.slice(0, 2), 10) : parseInt(digits[0], 10);
    if (gen >= 12) return "LGA1700";
    if (gen >= 10) return "LGA1200";
    return "LGA1151";
  }
  return null;
}

// Reviewed 2026-07-03 — keep in step with upgrades-pipeline/build_manifest.py.
// Drop-in CPU upgrades per socket.
const CPU_BY_SOCKET: Partial<Record<NonNullable<Socket>, { bang: Pick; high: Pick; note: string }>> = {
  AM5: {
    bang: { title: "AMD Ryzen 5 9600X", price: "~$180", url: amazonSearch("AMD Ryzen 5 9600X CPU") },
    high: { title: "AMD Ryzen 7 9800X3D", price: "~$440", url: amazonSearch("AMD Ryzen 7 9800X3D CPU") },
    note: "Drop-in upgrades for your AM5 socket — no new motherboard needed",
  },
  AM4: {
    bang: { title: "AMD Ryzen 5 5600", price: "~$120", url: amazonSearch("AMD Ryzen 5 5600 CPU") },
    high: { title: "AMD Ryzen 7 5700X3D", price: "~$230", url: amazonSearch("AMD Ryzen 7 5700X3D CPU") },
    note: "Drop-in upgrades for your AM4 socket — no new motherboard needed",
  },
  LGA1700: {
    bang: { title: "Intel Core i5-14600K", price: "~$250", url: amazonSearch("Intel Core i5-14600K CPU") },
    high: { title: "Intel Core i7-14700K", price: "~$350", url: amazonSearch("Intel Core i7-14700K CPU") },
    note: "Drop-in upgrades for your LGA1700 socket — no new motherboard needed",
  },
  LGA1851: {
    bang: { title: "Intel Core Ultra 5 250K Plus", price: "~$280", url: amazonSearch("Intel Core Ultra 5 250K Plus CPU") },
    high: { title: "Intel Core Ultra 7 270K Plus", price: "~$400", url: amazonSearch("Intel Core Ultra 7 270K Plus CPU") },
    note: "Drop-in upgrades for your LGA1851 socket — no new motherboard needed",
  },
};

// Motherboards that match the user's existing CPU socket.
const MOBO_BY_SOCKET: Partial<Record<NonNullable<Socket>, { bang: Pick; high: Pick; note: string }>> = {
  AM5: {
    bang: { title: "Gigabyte B650 Aorus Elite AX (AM5)", price: "~$170", url: amazonSearch("Gigabyte B650 Aorus Elite AX AM5") },
    high: { title: "MSI MAG B850 Tomahawk MAX WiFi", price: "~$250", url: amazonSearch("MSI MAG B850 Tomahawk MAX WiFi") },
    note: "AM5 boards — compatible with your current CPU",
  },
  AM4: {
    bang: { title: "ASUS TUF Gaming B550-PLUS WiFi II (AM4)", price: "~$130", url: amazonSearch("ASUS TUF Gaming B550-PLUS WiFi II AM4") },
    high: { title: "MSI MAG B550 Tomahawk (AM4)", price: "~$170", url: amazonSearch("MSI MAG B550 Tomahawk AM4") },
    note: "AM4 boards — compatible with your current CPU",
  },
  LGA1700: {
    bang: { title: "MSI PRO B760-P WiFi (LGA1700)", price: "~$150", url: amazonSearch("MSI PRO B760-P WiFi LGA1700") },
    high: { title: "ASUS ROG Strix Z790-E Gaming (LGA1700)", price: "~$400", url: amazonSearch("ASUS ROG Strix Z790-E Gaming WiFi") },
    note: "LGA1700 boards — compatible with your current CPU",
  },
  LGA1851: {
    bang: { title: "MSI PRO B860-P WiFi (LGA1851)", price: "~$170", url: amazonSearch("MSI PRO B860-P WiFi LGA1851") },
    high: { title: "ASUS ROG Strix Z890-E Gaming (LGA1851)", price: "~$450", url: amazonSearch("ASUS ROG Strix Z890-E Gaming WiFi") },
    note: "LGA1851 boards — compatible with your current CPU",
  },
};

const DEAD_END_SOCKETS: Socket[] = ["LGA1151", "LGA1200"];

type Ddr = "DDR4" | "DDR5" | null;

function detectDdr(ramType?: string | null): Ddr {
  const t = (ramType ?? "").toUpperCase();
  if (t.includes("DDR5")) return "DDR5";
  if (t.includes("DDR4")) return "DDR4";
  return null;
}

// A RAM pick for a given generation + capacity, as a tagged Amazon search so it
// always resolves and matches the user's actual DDR generation.
function ramPick(gen: Ddr, capGB: number, tier: "value" | "premium"): Pick {
  const g = gen ?? "";
  const speed = gen === "DDR5" ? (tier === "premium" ? "6400" : "6000") : gen === "DDR4" ? (tier === "premium" ? "3600" : "3200") : "";
  const title = [`${capGB} GB`, g, tier === "premium" ? "(high-speed)" : "Kit"].filter(Boolean).join(" ");
  const query = [`${capGB}GB`, g, speed, "desktop memory kit"].filter(Boolean).join(" ");
  return { title, url: amazonSearch(query) };
}

type Tailored = { entry: ComponentUpgrade; note: string | null; wellEquipped?: boolean };

/**
 * Config-matched version of a category plus a short note. CPU and motherboard
 * are socket-aware (see above); RAM is generation- and capacity-aware.
 */
function tailorCategory(key: string, entry: ComponentUpgrade, hw: HardwareInventory | null): Tailored {
  if (!hw) return { entry, note: null };
  const socket = detectSocket(hw.cpu?.name);

  if (key === "cpu") {
    const table = socket ? CPU_BY_SOCKET[socket] : undefined;
    if (table) {
      return { entry: { ...entry, bangForBuck: table.bang, highEnd: table.high }, note: table.note };
    }
    if (socket && DEAD_END_SOCKETS.includes(socket)) {
      return {
        entry,
        note: `Your ${socket} socket has no meaningfully faster CPUs — a CPU upgrade means a new motherboard too. These picks assume that platform upgrade.`,
      };
    }
    return { entry, note: null };
  }

  if (key === "motherboard") {
    const table = socket ? MOBO_BY_SOCKET[socket] : undefined;
    if (table) {
      return { entry: { ...entry, bangForBuck: table.bang, highEnd: table.high }, note: table.note };
    }
    if (socket && DEAD_END_SOCKETS.includes(socket)) {
      return {
        entry,
        note: `A new board won't fit your current ${socket} CPU — these current-gen boards pair with the CPU picks as a platform upgrade.`,
      };
    }
    return { entry, note: null };
  }

  if (key === "ram") {
    const gen = detectDdr(hw.ram?.type);
    const cur = Math.round(hw.ram?.total_gb ?? 0);
    const genStr = gen ? `${gen} ` : "";
    // Capacity ladder differs by generation (DDR5 adds 96 GB 2x48 kits).
    const tiers = gen === "DDR5" ? [16, 32, 64, 96, 128] : [16, 32, 64, 128];
    const bangCap = tiers.find((t) => t > cur);
    if (!bangCap) {
      return {
        entry,
        note: `Your ${cur} GB ${genStr}is already at the ceiling for consumer boards — no RAM upgrade needed.`,
        wellEquipped: true,
      };
    }
    const highCap = tiers.find((t) => t > bangCap) ?? bangCap;
    const wellEquipped = cur >= 32; // 32 GB+ is plenty for the vast majority of use
    const note = wellEquipped
      ? `You already run ${cur} GB ${genStr}— plenty for gaming and productivity; add capacity only for heavy VMs, rendering, or large datasets.`
      : `Matched to your ${gen ?? "memory"} — a genuine step up from your ${cur} GB.`;
    return {
      entry: { ...entry, bangForBuck: ramPick(gen, bangCap, "value"), highEnd: ramPick(gen, highCap, "premium") },
      note,
      wellEquipped,
    };
  }

  return { entry, note: null };
}

// ── Deterministic findings from the machine's own telemetry ───────────────────
type Severity = "critical" | "warn" | "info";
type Finding = { category: string; severity: Severity; title: string; detail: string };

function buildFindings(hw: HardwareInventory | null): Finding[] {
  if (!hw) return [];
  const out: Finding[] = [];
  const util = hw.utilization ?? {};
  const sens = hw.sensors;

  for (const d of sens?.disks ?? []) {
    if (d.health !== "Healthy" && d.health !== "Unknown") {
      out.push({
        category: "storage", severity: "critical",
        title: `${d.name} reports ${d.health}`,
        detail: "SMART reports this drive is failing. Back it up now and plan a replacement — this is the one upgrade that shouldn't wait.",
      });
    } else if ((d.wear_pct ?? 0) >= 80) {
      out.push({
        category: "storage", severity: "warn",
        title: `${d.name} is at ${d.wear_pct}% rated wear`,
        detail: "This SSD has used most of its rated endurance. It still works, but replacing it soon avoids data loss later.",
      });
    }
  }
  if ((util.disk ?? 0) >= 90) {
    out.push({
      category: "storage", severity: "warn",
      title: `Storage ${util.disk}% full`,
      detail: "Windows slows down noticeably past ~90% full — an added or larger drive is the cheapest real-world speedup available to you right now.",
    });
  } else if ((util.disk ?? 0) >= 50) {
    out.push({
      category: "storage", severity: "info",
      title: `Storage ${util.disk}% used`,
      detail: "More than half full. No slowdown yet, but SSDs perform best with free space in reserve — a good moment to plan extra capacity before it becomes urgent.",
    });
  }

  const t = sens?.cpu.temp_c;
  if (t != null && t >= 85) {
    out.push({
      category: "cooler", severity: "warn",
      title: `CPU running at ${t}°C`,
      detail: "Sustained high temperatures cause thermal throttling — better cooling restores performance you already paid for.",
    });
  } else if (t != null && t >= 75) {
    out.push({
      category: "cooler", severity: "info",
      title: `CPU at ${t}°C`,
      detail: "Within spec, but extra cooler headroom improves boost clocks and noise.",
    });
  }

  if ((util.mem ?? 0) >= 85) {
    out.push({
      category: "ram", severity: "warn",
      title: `Memory pressure at ${util.mem}%`,
      detail: "RAM has been near its ceiling over the last hour (blend of average and peak). More memory is the most direct fix for multitasking stutter.",
    });
  } else if ((util.mem ?? 0) >= 70) {
    out.push({
      category: "ram", severity: "info",
      title: `Memory pressure ${util.mem}%`,
      detail: "Regularly elevated. If things slow down with many tabs and apps open, RAM is the likely constraint.",
    });
  }

  if ((util.cpu ?? 0) >= 80) {
    out.push({
      category: "cpu", severity: "warn",
      title: `CPU load ${util.cpu}% over the last hour`,
      detail: "Sustained high CPU load suggests the processor is the bottleneck for your workload.",
    });
  }

  const order: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

// ── Advisor cards (diagnosis → prescription) ──────────────────────────────────
function AdvisorCard({
  finding, entry, currentPart, note, defaultOpen,
}: {
  finding: Finding;
  entry: ComponentUpgrade;
  currentPart: string | null;
  note: string | null;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const sev = finding.severity;
  const border = sev === "critical" ? "border-red-800/60" : sev === "warn" ? "border-amber-800/60" : "border-slate-700/70";
  const accent = sev === "critical" ? "bg-red-500" : sev === "warn" ? "bg-amber-500" : "bg-cyan-500";
  const iconColor = sev === "critical" ? "text-red-400" : sev === "warn" ? "text-amber-400" : "text-cyan-400";
  const badgeTone: "red" | "amber" | "cyan" = sev === "critical" ? "red" : sev === "warn" ? "amber" : "cyan";
  return (
    <div className={`relative overflow-hidden rounded-2xl border ${border} bg-gradient-to-br from-slate-900/80 to-slate-900/40 shadow-sm`}>
      <div className={`absolute inset-y-0 left-0 w-1 ${accent}`} />
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 py-4 pl-5 pr-4 text-left transition-colors hover:bg-slate-800/30">
        <AlertTriangle size={16} className={`shrink-0 ${iconColor}`} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-100">{finding.title}</div>
          <div className="mt-0.5 truncate text-xs text-slate-500">
            {entry.label}
            {currentPart ? <> — current: <span className="text-slate-400">{currentPart}</span></> : null}
          </div>
        </div>
        <Badge tone={badgeTone}>{sev}</Badge>
        <ChevronDown size={16} className={`shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-slate-800/70 py-4 pl-5 pr-4">
          <p className="mb-3 text-xs leading-relaxed text-slate-400">{finding.detail}</p>
          {note && <p className="mb-3 text-xs text-emerald-400">✓ {note}</p>}
          <div className="flex flex-col gap-3 sm:flex-row">
            <PickCard pick={entry.bangForBuck} kind="value" />
            <PickCard pick={entry.highEnd} kind="high" />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Compact browse cards ──────────────────────────────────────────────────────
function PickRow({ pick, kind }: { pick: Pick; kind: "value" | "high" }) {
  return (
    <div className="py-1.5">
      <div className="flex items-center gap-1.5">
        {kind === "value" ? <Gauge size={12} className="shrink-0 text-emerald-400" /> : <Crown size={12} className="shrink-0 text-amber-400" />}
        <a
          href={pick.url}
          target="_blank"
          rel={storeRel()}
          title={`View ${pick.title} on Amazon`}
          className="group inline-flex min-w-0 items-center gap-1 text-xs text-slate-300 transition-colors hover:text-cyan-300"
        >
          <span className="truncate underline-offset-2 group-hover:underline">{pick.title}</span>
          <ExternalLink size={10} className="shrink-0 text-slate-600 group-hover:text-cyan-400" />
        </a>
      </div>
      {pick.price && <div className="pl-[18px] text-[11px] text-slate-600">{pick.price}</div>}
    </div>
  );
}

function BrowseCard({
  categoryKey, label, entry, currentPart, note, wellEquipped, flagged,
}: {
  categoryKey: string;
  label: string;
  entry: ComponentUpgrade;
  currentPart: string | null;
  note: string | null;
  wellEquipped: boolean;
  flagged?: Severity;
}) {
  const Icon = CATEGORY_ICONS[categoryKey] ?? Package;
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 transition-colors hover:border-slate-700/80 hover:bg-slate-900/60">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-800/80 text-cyan-500 ring-1 ring-inset ring-slate-700/50">
            <Icon size={14} />
          </span>
          <h4 className="truncate text-sm font-semibold text-slate-200">{label}</h4>
        </div>
        {flagged ? (
          <Badge tone={flagged === "critical" ? "red" : flagged === "warn" ? "amber" : "cyan"}>see advisor</Badge>
        ) : wellEquipped ? (
          <Badge tone="slate">well equipped</Badge>
        ) : null}
      </div>
      {currentPart && (
        <div className="mb-1 truncate pl-[38px] text-xs text-slate-500" title={currentPart}>
          Current: <span className="text-slate-400">{currentPart}</span>
        </div>
      )}
      {note && <div className="mb-2 pl-[38px] text-[11px] leading-snug text-slate-600">{note}</div>}
      <div className="mt-1 divide-y divide-slate-800/60 border-t border-slate-800/60">
        <PickRow pick={entry.bangForBuck} kind="value" />
        <PickRow pick={entry.highEnd} kind="high" />
      </div>
    </div>
  );
}

// ── Featured full systems (cross-referenced to Amazon) ────────────────────────
// Thumbnail tiers: show the manifest image (curated, else Icecat) when present,
// otherwise a category icon. Cases render larger — the case is the visual anchor.
const COMPONENT_ICONS: Record<string, LucideIcon> = {
  CPU: Cpu, GPU: Microchip, Memory: MemoryStick, Storage: HardDrive,
  Motherboard: CircuitBoard, PSU: Power, Cooler: Fan, Case: Computer,
};

// Same icon set keyed by manifest category id (browse cards).
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  cpu: Cpu, gpu: Microchip, ram: MemoryStick, storage: HardDrive,
  motherboard: CircuitBoard, psu: Power, cooler: Fan, case: Computer,
};

function ComponentThumb({ c }: { c: SystemComponent }) {
  const openLightbox = useContext(LightboxCtx);
  const big = c.type === "Case";
  const box = big ? "h-12 w-12" : "h-9 w-9";
  if (c.image) {
    return (
      <button
        onClick={() =>
          openLightbox({
            src: c.image!,
            title: c.name,
            href: c.url,
            sponsored: !c.store || c.store === "Amazon",
          })
        }
        title={`${c.name} — click to enlarge`}
        className={`${box} shrink-0 overflow-hidden rounded-md bg-slate-100 p-0.5 shadow-sm ring-1 ring-slate-700/50 transition-transform hover:scale-110 focus:outline-none`}
      >
        {/* row shows the tiny rendition; the lightbox loads the full image */}
        <img src={c.thumb ?? c.image} alt={c.name} loading="lazy" decoding="async" className="h-full w-full object-contain" />
      </button>
    );
  }
  const Icon = COMPONENT_ICONS[c.type] ?? Package;
  return (
    <div className={`${box} grid shrink-0 place-items-center rounded-md bg-slate-800/60 text-slate-500 ring-1 ring-inset ring-slate-700/40`}>
      <Icon size={big ? 22 : 16} />
    </div>
  );
}

function FeaturedSystems({ systems }: { systems: FeaturedSystem[] }) {
  if (!systems.length) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      {systems.map((sys, idx) => (
        <Panel
          key={idx}
          title={sys.name}
          action={sys.totalPrice ? <Badge tone="cyan">{sys.totalPrice}</Badge> : undefined}
        >
          {sys.components.length === 0 ? (
            <p className="py-3 text-sm text-slate-500">
              {sys.note ?? "Component picks coming soon."}
            </p>
          ) : (
            <ul className="divide-y divide-slate-800/70">
              {sys.components.map((c, j) => (
                <li key={j} className="flex items-center gap-3 py-2">
                  <ComponentThumb c={c} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">
                      {c.type}
                      {c.store && c.store !== "Amazon" ? <span className="normal-case tracking-normal text-slate-600"> · via {c.store}</span> : null}
                    </div>
                    <div className="flex min-w-0 items-center gap-1.5">
                      <a
                        href={c.url}
                        target="_blank"
                        rel={storeRel(c.store)}
                        title={`View ${c.name} on ${c.store ?? "Amazon"}`}
                        className="group inline-flex min-w-0 items-center gap-1 text-sm text-slate-300 transition-colors hover:text-cyan-300"
                      >
                        <span className="truncate underline-offset-2 group-hover:underline">{c.name}</span>
                        <ExternalLink size={11} className="shrink-0 text-slate-600 group-hover:text-cyan-400" />
                      </a>
                      {c.qty && c.qty > 1 ? (
                        <span className="shrink-0 rounded bg-slate-700/70 px-1 py-0.5 text-[10px] font-medium tabular-nums text-slate-300">
                          ×{c.qty}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {c.price && (
                    <span className="shrink-0 text-xs tabular-nums text-slate-500">
                      {c.price}{c.qty && c.qty > 1 ? " ea" : ""}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {sys.sourceUrl && (
            <a
              href={sys.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block text-xs text-slate-600 hover:text-slate-400"
            >
              Build source ↗
            </a>
          )}
        </Panel>
      ))}
    </div>
  );
}

// ── GPU watch (curated high-demand cards: reference MSRP + live-listings link) ─
function GpuWatch({ entries }: { entries: GpuWatchEntry[] }) {
  if (!entries.length) return null;
  return (
    <Panel title="GPU Watch">
      <ul className="divide-y divide-slate-800/70">
        {entries.map((g) => (
          <li key={g.model} className="flex items-center justify-between gap-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-800/80 text-emerald-400 ring-1 ring-inset ring-slate-700/50">
                <Microchip size={15} />
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-200">{g.model}</div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {g.msrp ? (
                    <>MSRP <span className="tabular-nums text-slate-300">{g.msrp}</span></>
                  ) : (
                    "reference price unavailable"
                  )}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <AmazonLink url={g.url}>View Listings</AmazonLink>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] leading-snug text-slate-600">
        MSRP is the launch reference price — compare it against live Amazon listings to judge a deal.
      </p>
    </Panel>
  );
}

// ── User's detected system hardware ───────────────────────────────────────────
function HwRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 border-b border-slate-800/60 py-2.5 last:border-0">
      <span className="mt-0.5 text-cyan-500">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
        <div className="truncate text-sm text-slate-200" title={value}>{value}</div>
      </div>
    </div>
  );
}

function healthTone(health: string): "green" | "amber" | "red" | "slate" {
  if (health === "Healthy") return "green";
  if (health === "Warning") return "amber";
  if (health === "Unhealthy") return "red";
  return "slate";
}

function SystemHardware({ hw }: { hw: HardwareInventory | null }) {
  if (!hw) {
    return (
      <Panel title="Your System">
        <p className="text-sm text-slate-500">Detecting hardware…</p>
      </Panel>
    );
  }
  const socket = detectSocket(hw.cpu?.name);
  const ramStr =
    `${hw.ram.total_gb} GB` +
    (hw.ram.type ? ` ${hw.ram.type}` : "") +
    (hw.ram.speed_mhz ? ` @ ${hw.ram.speed_mhz} MHz` : "");
  const cpuTemp = hw.sensors?.cpu.temp_c;
  const cpuStr =
    hw.cpu.name +
    (hw.cpu.cores_physical ? ` · ${hw.cpu.cores_physical}C` : "") +
    (hw.cpu.cores_logical ? `/${hw.cpu.cores_logical}T` : "") +
    (socket ? ` · ${socket}` : "") +
    (cpuTemp != null ? ` · ${cpuTemp}°C` : "");
  const disks = hw.sensors?.disks ?? [];
  return (
    <Panel
      title="Your System"
      action={<Badge tone="slate">{hw.os}</Badge>}
    >
      <div className="-mt-1">
        <HwRow icon={<Cpu size={15} />} label="Processor" value={cpuStr} />
        <HwRow icon={<MonitorCog size={15} />} label="Graphics" value={hw.gpu.name} />
        <HwRow icon={<MemoryStick size={15} />} label="Memory" value={ramStr} />
        <HwRow icon={<HardDrive size={15} />} label="Storage" value={hw.disk.total_gb ? `${hw.disk.total_gb} GB total` : "—"} />
        <HwRow icon={<CircuitBoard size={15} />} label="Motherboard" value={hw.motherboard.name ?? "—"} />
      </div>
      {disks.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Drive health</div>
          <ul className="space-y-1.5">
            {disks.map((d, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-xs text-slate-400" title={d.name}>
                  {d.name}
                  {d.wear_pct != null && <span className="text-slate-600"> · {d.wear_pct}% wear</span>}
                  {d.temp_c != null && <span className="text-slate-600"> · {d.temp_c}°C</span>}
                </span>
                <Badge tone={healthTone(d.health)}>{d.health}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!hw.wmi && (
        <p className="mt-3 text-xs text-slate-600">
          Limited detail available on this system — connect details improve with WMI on Windows.
        </p>
      )}
    </Panel>
  );
}

// ── Segmented view switcher ───────────────────────────────────────────────────
const VIEWS = ["advisor", "components", "builds"] as const;
type View = (typeof VIEWS)[number];

function Segmented({ view, setView, findingCount }: { view: View; setView: (v: View) => void; findingCount: number }) {
  const items: { id: View; label: string }[] = [
    { id: "advisor", label: findingCount > 0 ? `Advisor (${findingCount})` : "Advisor" },
    { id: "components", label: "Components" },
    { id: "builds", label: "Full Builds" },
  ];
  return (
    <div className="inline-flex rounded-lg border border-slate-800 bg-slate-950/60 p-0.5 shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => setView(it.id)}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
            view === it.id
              ? "bg-cyan-950/80 text-cyan-300 shadow-[0_1px_4px_rgba(0,0,0,0.4)] ring-1 ring-inset ring-cyan-500/25"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export default function UpgradesTab() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [error, setError] = useState(false);
  const [hw, setHw] = useState<HardwareInventory | null>(null);
  const [view, setView] = useState<View>("advisor");
  const [lightbox, setLightbox] = useState<LightboxData | null>(null);

  useEffect(() => {
    loadManifest().then(setManifest).catch(() => setError(true));
    // hardware is best-effort: if it fails we just skip compatibility hints
    api.hardware().then(setHw).catch(() => {});
  }, []);

  // Tailor each category to the detected hardware, sorted by relevance.
  const { categories, notes, wellEquipped } = useMemo(() => {
    if (!manifest)
      return {
        categories: [] as [string, ComponentUpgrade][],
        notes: {} as Record<string, string | null>,
        wellEquipped: {} as Record<string, boolean>,
      };
    const noteMap: Record<string, string | null> = {};
    const wellMap: Record<string, boolean> = {};
    let entries = Object.entries(manifest.componentUpgrades).map(([key, entry]) => {
      const t = tailorCategory(key, entry, hw);
      noteMap[key] = t.note;
      wellMap[key] = !!t.wellEquipped;
      return [key, t.entry] as [string, ComponentUpgrade];
    });
    if (hw) {
      const score = (k: string) => (hw.relevance[k] ?? 0) - (wellMap[k] ? 1000 : 0);
      entries = [...entries].sort((a, b) => score(b[0]) - score(a[0]));
    }
    return { categories: entries, notes: noteMap, wellEquipped: wellMap };
  }, [manifest, hw]);

  // Diagnosis: one finding per category (highest severity wins).
  const findings = useMemo(() => {
    const all = buildFindings(hw);
    const seen = new Set<string>();
    return all.filter((f) => {
      if (!manifest?.componentUpgrades[f.category] || seen.has(f.category)) return false;
      seen.add(f.category);
      return true;
    });
  }, [hw, manifest]);
  const findingSeverity = useMemo(() => {
    const m: Record<string, Severity> = {};
    findings.forEach((f) => (m[f.category] = f.severity));
    return m;
  }, [findings]);

  const currentParts = hw?.current ?? {};
  const entryMap = useMemo(() => Object.fromEntries(categories), [categories]);

  return (
    <LightboxCtx.Provider value={setLightbox}>
    <div className="space-y-4">
      {lightbox && <Lightbox data={lightbox} onClose={() => setLightbox(null)} />}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-200">Hardware Upgrades</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Recommendations diagnosed from your own telemetry — refreshed daily, matched to your socket and platform.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Segmented view={view} setView={setView} findingCount={findings.length} />
          {manifest && (
            <span className="text-xs text-slate-600">
              Updated {new Date(manifest.generatedAt).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>

      {error && (
        <Panel title="Upgrades Unavailable">
          <p className="text-sm text-slate-400">
            Couldn’t load the upgrades catalog right now. It refreshes automatically — check back shortly.
          </p>
        </Panel>
      )}

      {!manifest && !error && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-10 text-center text-sm text-slate-500">
          Loading upgrade picks…
        </div>
      )}

      {manifest && view === "advisor" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-3 lg:col-span-2">
            {findings.length === 0 ? (
              <div className="flex items-center gap-3.5 rounded-2xl border border-emerald-900/40 bg-gradient-to-br from-emerald-950/30 to-slate-900/40 p-5">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-950/70 text-emerald-400 ring-1 ring-inset ring-emerald-500/25">
                  <ShieldCheck size={20} />
                </span>
                <div>
                  <div className="text-sm font-semibold text-emerald-300">All clear</div>
                  <p className="mt-0.5 text-sm text-slate-400">
                    Nothing urgent — your system is running within healthy bounds. See{" "}
                    <button className="text-cyan-400 underline underline-offset-2 hover:text-cyan-300" onClick={() => setView("components")}>
                      Components
                    </button>{" "}
                    if you're planning ahead.
                  </p>
                </div>
              </div>
            ) : (
              findings.map((f, i) =>
                entryMap[f.category] ? (
                  <AdvisorCard
                    key={f.category}
                    finding={f}
                    entry={entryMap[f.category]}
                    currentPart={currentParts[f.category] ?? null}
                    note={notes[f.category]}
                    defaultOpen={i === 0}
                  />
                ) : null
              )
            )}
          </div>
          <div className="space-y-4">
            <SystemHardware hw={hw} />
            <GpuWatch entries={manifest.gpuWatch ?? []} />
          </div>
        </div>
      )}

      {manifest && view === "components" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map(([key, entry]) => (
            <BrowseCard
              key={key}
              categoryKey={key}
              label={entry.label}
              entry={entry}
              currentPart={currentParts[key] ?? null}
              note={notes[key]}
              wellEquipped={!!wellEquipped[key]}
              flagged={findingSeverity[key]}
            />
          ))}
        </div>
      )}

      {manifest && view === "builds" && (
        <FeaturedSystems systems={manifest.featuredSystems} />
      )}

      {manifest && (
        /* FTC-required affiliate disclosure */
        <p className="border-t border-slate-800 pt-3 text-xs leading-relaxed text-slate-600">
          {manifest.disclosure} Prices and availability shown on Amazon at time of click.
        </p>
      )}
    </div>
    </LightboxCtx.Provider>
  );
}
