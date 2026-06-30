import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ExternalLink, ChevronLeft, ChevronRight, Gauge, Crown, Cpu, MemoryStick, HardDrive, MonitorCog, CircuitBoard } from "lucide-react";
import { Panel, Badge } from "../components/ui";
import { api, type HardwareInventory } from "../api";

const AMAZON_TAG = "lifeupgrad02b-20";
const amazonSearch = (q: string) =>
  `https://www.amazon.com/s?k=${encodeURIComponent(q)}&tag=${AMAZON_TAG}`;

// ── Manifest types ──────────────────────────────────────────────────────────
type Pick = { title: string; asin?: string; price?: string; image?: string; url: string };
type ComponentUpgrade = { label: string; bangForBuck: Pick; highEnd: Pick };
type SystemComponent = { type: string; name: string; url: string };
type FeaturedSystem = {
  name: string;
  source?: string;
  sourceUrl?: string;
  totalPrice?: string;
  components: SystemComponent[];
};
type Manifest = {
  version: number;
  generatedAt: string;
  disclosure: string;
  componentUpgrades: Record<string, ComponentUpgrade>;
  featuredSystems: FeaturedSystem[];
};

// Daily-refreshed manifest committed by the GitHub Action. The app fetches this
// raw URL at runtime so picks/builds stay fresh without an app update. If it is
// unreachable (offline, first run), we fall back to the copy bundled at
// /manifest.json that ships with the build.
const MANIFEST_REMOTE =
  "https://raw.githubusercontent.com/srwim/AROK-monitor/main/upgrades-pipeline/manifest.json";
const MANIFEST_LOCAL = "/manifest.json";

const ROTATE_MS = 6000; // "slowly rotating" carousel cadence

async function loadManifest(): Promise<Manifest> {
  for (const url of [MANIFEST_REMOTE, MANIFEST_LOCAL]) {
    try {
      const r = await fetch(url, { cache: "no-cache" });
      if (r.ok) return (await r.json()) as Manifest;
    } catch {
      /* try next source */
    }
  }
  throw new Error("manifest unavailable");
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

function PickCard({ pick, kind }: { pick: Pick; kind: "value" | "high" }) {
  const value = kind === "value";
  return (
    <div className="flex flex-1 flex-col rounded-xl border border-slate-700/60 bg-slate-900/60 p-4">
      <div className="mb-2 flex items-center gap-2">
        {value ? <Gauge size={14} className="text-emerald-400" /> : <Crown size={14} className="text-amber-400" />}
        <Badge tone={value ? "green" : "amber"}>{value ? "Best bang for buck" : "High end"}</Badge>
      </div>
      <div className="flex-1 text-sm font-medium leading-snug text-slate-200">{pick.title}</div>
      {pick.price && <div className="mt-1 text-xs text-slate-500">{pick.price}</div>}
      <div className="mt-3">
        <AmazonLink url={pick.url} primary>
          View on Amazon
        </AmazonLink>
      </div>
    </div>
  );
}

// ── Slowly rotating carousel of per-component upgrade picks ───────────────────
function UpgradeCarousel({
  categories,
  currentParts,
  notes,
}: {
  categories: [string, ComponentUpgrade][];
  currentParts: Record<string, string | null>;
  notes: Record<string, string | null>;
}) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = categories.length;
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (paused || n <= 1) return;
    timer.current = setInterval(() => setI((x) => (x + 1) % n), ROTATE_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [paused, n]);

  if (n === 0) return null;
  const go = (d: number) => setI((x) => (x + d + n) % n);
  const [key, current] = categories[i];
  const currentPart = currentParts[key];
  const note = notes[key];

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-5"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
            Recommended upgrade {i === 0 && <span className="ml-1 text-emerald-400">· most relevant to your system</span>}
          </div>
          <h3 className="text-lg font-bold text-slate-100">{current.label}</h3>
          {currentPart && (
            <div className="mt-0.5 text-xs text-slate-500">
              Your current: <span className="text-slate-300">{currentPart}</span>
            </div>
          )}
          {note && (
            <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-950/50 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
              ✓ {note}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => go(-1)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200" aria-label="Previous">
            <ChevronLeft size={18} />
          </button>
          <button onClick={() => go(1)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200" aria-label="Next">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* key forces a soft fade as slides rotate */}
      <div key={i} className="flex flex-col gap-3 fade-in sm:flex-row">
        <PickCard pick={current.bangForBuck} kind="value" />
        <PickCard pick={current.highEnd} kind="high" />
      </div>

      {/* dots */}
      <div className="mt-4 flex items-center justify-center gap-1.5">
        {categories.map(([key], idx) => (
          <button
            key={key}
            onClick={() => setI(idx)}
            aria-label={`Go to ${key}`}
            className={`h-1.5 rounded-full transition-all ${idx === i ? "w-5 bg-cyan-400" : "w-1.5 bg-slate-700 hover:bg-slate-600"}`}
          />
        ))}
      </div>
    </div>
  );
}

// ── Featured full systems (cross-referenced to Amazon) ────────────────────────
function FeaturedSystems({ systems }: { systems: FeaturedSystem[] }) {
  if (!systems.length) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {systems.map((sys, idx) => (
        <Panel
          key={idx}
          title={sys.name}
          action={sys.totalPrice ? <Badge tone="cyan">{sys.totalPrice}</Badge> : undefined}
        >
          <ul className="divide-y divide-slate-800/70">
            {sys.components.map((c, j) => (
              <li key={j} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">{c.type}</div>
                  <div className="truncate text-sm text-slate-300">{c.name}</div>
                </div>
                <AmazonLink url={c.url}>Amazon</AmazonLink>
              </li>
            ))}
          </ul>
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

// ── Make picks relevant to the user's actual configuration ────────────────────
// The manifest is platform-agnostic (AMD/DDR5 curated). When we know the user's
// CPU vendor or memory generation, swap in platform-appropriate picks so we
// never suggest an Intel user an AM5 board, or a DDR4 user a DDR5 kit. Links are
// tagged Amazon searches, so every tailored pick still resolves and earns.

type Platform = "amd" | "intel" | null;
type Ddr = "DDR4" | "DDR5" | null;

function detectPlatform(cpuName?: string | null): Platform {
  const n = (cpuName ?? "").toLowerCase();
  if (n.includes("amd") || n.includes("ryzen") || n.includes("threadripper")) return "amd";
  if (n.includes("intel") || n.includes("core i") || /\bi[3579]-/.test(n) || n.includes("xeon") || n.includes("ultra")) return "intel";
  return null;
}

function detectDdr(ramType?: string | null): Ddr {
  const t = (ramType ?? "").toUpperCase();
  if (t.includes("DDR5")) return "DDR5";
  if (t.includes("DDR4")) return "DDR4";
  return null;
}

const CPU_PICKS: Record<"amd" | "intel", { bang: Pick; high: Pick }> = {
  amd: {
    bang: { title: "AMD Ryzen 5 7600", price: "~$199", url: amazonSearch("AMD Ryzen 5 7600 CPU") },
    high: { title: "AMD Ryzen 7 7800X3D", price: "~$359", url: amazonSearch("AMD Ryzen 7 7800X3D CPU") },
  },
  intel: {
    bang: { title: "Intel Core i5-14600K", price: "~$279", url: amazonSearch("Intel Core i5-14600K CPU") },
    high: { title: "Intel Core i7-14700K", price: "~$389", url: amazonSearch("Intel Core i7-14700K CPU") },
  },
};

const MOBO_PICKS: Record<"amd" | "intel", { bang: Pick; high: Pick }> = {
  amd: {
    bang: { title: "MSI B650 Gaming Plus WiFi (AM5)", price: "~$179", url: amazonSearch("MSI B650 Gaming Plus WiFi AM5") },
    high: { title: "ASUS ROG Strix X670E-E Gaming", price: "~$469", url: amazonSearch("ASUS ROG Strix X670E-E Gaming") },
  },
  intel: {
    bang: { title: "MSI PRO B760-P WiFi (LGA1700)", price: "~$159", url: amazonSearch("MSI PRO B760-P WiFi LGA1700") },
    high: { title: "ASUS ROG Strix Z790-E Gaming", price: "~$449", url: amazonSearch("ASUS ROG Strix Z790-E Gaming WiFi") },
  },
};

const RAM_PICKS: Record<"DDR4" | "DDR5", { bang: Pick; high: Pick }> = {
  DDR4: {
    bang: { title: "Corsair Vengeance LPX DDR4 32GB (2x16) 3600", price: "~$69", url: amazonSearch("Corsair Vengeance LPX DDR4 32GB 3600") },
    high: { title: "G.Skill Trident Z RGB DDR4 64GB 3600", price: "~$139", url: amazonSearch("G.Skill Trident Z RGB DDR4 64GB 3600") },
  },
  DDR5: {
    bang: { title: "Corsair Vengeance DDR5 32GB (2x16) 6000", price: "~$94", url: amazonSearch("Corsair Vengeance DDR5 32GB 6000") },
    high: { title: "G.Skill Trident Z5 DDR5 64GB 6400", price: "~$229", url: amazonSearch("G.Skill Trident Z5 DDR5 64GB 6400") },
  },
};

/** Returns a config-matched version of a category plus a short compatibility note. */
function tailorCategory(
  key: string,
  entry: ComponentUpgrade,
  hw: HardwareInventory | null
): { entry: ComponentUpgrade; note: string | null } {
  if (!hw) return { entry, note: null };
  const platform = detectPlatform(hw.cpu?.name);
  const ddr = detectDdr(hw.ram?.type);

  if ((key === "cpu" || key === "motherboard") && platform) {
    const table = key === "cpu" ? CPU_PICKS : MOBO_PICKS;
    const p = table[platform];
    return {
      entry: { ...entry, bangForBuck: p.bang, highEnd: p.high },
      note: `Matched to your ${platform === "amd" ? "AMD" : "Intel"} platform`,
    };
  }
  if (key === "ram" && ddr) {
    const p = RAM_PICKS[ddr];
    return { entry: { ...entry, bangForBuck: p.bang, highEnd: p.high }, note: `Matched to your ${ddr}` };
  }
  return { entry, note: null };
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

function SystemHardware({ hw }: { hw: HardwareInventory | null }) {
  if (!hw) {
    return (
      <Panel title="Your system">
        <p className="text-sm text-slate-500">Detecting hardware…</p>
      </Panel>
    );
  }
  const ramStr =
    `${hw.ram.total_gb} GB` +
    (hw.ram.type ? ` ${hw.ram.type}` : "") +
    (hw.ram.speed_mhz ? ` @ ${hw.ram.speed_mhz} MHz` : "");
  const cpuStr =
    hw.cpu.name +
    (hw.cpu.cores_physical ? ` · ${hw.cpu.cores_physical}C` : "") +
    (hw.cpu.cores_logical ? `/${hw.cpu.cores_logical}T` : "");
  return (
    <Panel
      title="Your system"
      action={<Badge tone="slate">{hw.os}</Badge>}
    >
      <div className="-mt-1">
        <HwRow icon={<Cpu size={15} />} label="Processor" value={cpuStr} />
        <HwRow icon={<MonitorCog size={15} />} label="Graphics" value={hw.gpu.name} />
        <HwRow icon={<MemoryStick size={15} />} label="Memory" value={ramStr} />
        <HwRow icon={<HardDrive size={15} />} label="Storage" value={hw.disk.total_gb ? `${hw.disk.total_gb} GB total` : "—"} />
        <HwRow icon={<CircuitBoard size={15} />} label="Motherboard" value={hw.motherboard.name ?? "—"} />
      </div>
      {!hw.wmi && (
        <p className="mt-3 text-xs text-slate-600">
          Limited detail available on this system — connect details improve with WMI on Windows.
        </p>
      )}
    </Panel>
  );
}

export default function UpgradesTab() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [error, setError] = useState(false);
  const [hw, setHw] = useState<HardwareInventory | null>(null);

  useEffect(() => {
    loadManifest().then(setManifest).catch(() => setError(true));
    // hardware is best-effort: if it fails we just skip compatibility hints
    api.hardware().then(setHw).catch(() => {});
  }, []);

  // Tailor each category to the detected hardware, then sort so the most
  // relevant upgrade for THIS system shows first.
  const { categories, notes } = useMemo(() => {
    if (!manifest) return { categories: [] as [string, ComponentUpgrade][], notes: {} as Record<string, string | null> };
    let entries = Object.entries(manifest.componentUpgrades);
    const noteMap: Record<string, string | null> = {};
    entries = entries.map(([key, entry]) => {
      const t = tailorCategory(key, entry, hw);
      noteMap[key] = t.note;
      return [key, t.entry] as [string, ComponentUpgrade];
    });
    if (hw) {
      entries = [...entries].sort((a, b) => (hw.relevance[b[0]] ?? 0) - (hw.relevance[a[0]] ?? 0));
    }
    return { categories: entries, notes: noteMap };
  }, [manifest, hw]);

  const currentParts = hw?.current ?? {};

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-200">Hardware Upgrades</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Best-value and high-end picks for every component, plus complete featured builds — refreshed daily.
          </p>
        </div>
        {manifest && (
          <span className="text-xs text-slate-600">
            Updated {new Date(manifest.generatedAt).toLocaleDateString()}
          </span>
        )}
      </div>

      {error && (
        <Panel title="Upgrades unavailable">
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

      {manifest && (
        <>
          <UpgradeCarousel categories={categories} currentParts={currentParts} notes={notes} />

          <div className="grid gap-4 pt-2 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Featured full systems</h3>
              <FeaturedSystems systems={manifest.featuredSystems} />
            </div>
            <div>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">System hardware</h3>
              <SystemHardware hw={hw} />
            </div>
          </div>

          {/* FTC-required affiliate disclosure */}
          <p className="border-t border-slate-800 pt-3 text-xs leading-relaxed text-slate-600">
            {manifest.disclosure} Prices and availability shown on Amazon at time of click.
          </p>
        </>
      )}
    </div>
  );
}
