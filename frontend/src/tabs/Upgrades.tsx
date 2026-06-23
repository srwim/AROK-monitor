import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ExternalLink, ChevronLeft, ChevronRight, Gauge, Crown } from "lucide-react";
import { Panel, Badge } from "../components/ui";
import { api, type HardwareInventory } from "../api";

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
  "https://raw.githubusercontent.com/srwim/AROK/main/upgrades-pipeline/manifest.json";
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
}: {
  categories: [string, ComponentUpgrade][];
  currentParts: Record<string, string | null>;
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

export default function UpgradesTab() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [error, setError] = useState(false);
  const [hw, setHw] = useState<HardwareInventory | null>(null);

  useEffect(() => {
    loadManifest().then(setManifest).catch(() => setError(true));
    // hardware is best-effort: if it fails we just skip compatibility hints
    api.hardware().then(setHw).catch(() => {});
  }, []);

  // Sort categories so the most relevant upgrade for THIS system shows first.
  const categories = useMemo(() => {
    if (!manifest) return [] as [string, ComponentUpgrade][];
    const entries = Object.entries(manifest.componentUpgrades);
    if (!hw) return entries;
    return [...entries].sort(
      (a, b) => (hw.relevance[b[0]] ?? 0) - (hw.relevance[a[0]] ?? 0)
    );
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
          <UpgradeCarousel categories={categories} currentParts={currentParts} />

          <div className="pt-2">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Featured full systems</h3>
            <FeaturedSystems systems={manifest.featuredSystems} />
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
