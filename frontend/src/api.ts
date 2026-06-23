export type Stats = {
  ts: number;
  cpu: number;
  mem: number;
  disk: number;
  net_sent: number;
  net_recv: number;
  proc_count: number;
};

export type Proc = {
  pid: number;
  name: string;
  username: string | null;
  cpu_percent: number | null;
  memory_percent: number | null;
  status: string;
};

export type Conn = {
  fd: number;
  pid: number | null;
  proc: string | null;
  laddr: string;
  raddr: string;
  status: string;
};

export type Service = {
  name: string;
  display_name: string;
  status: string;
  start_type: string;
};

export type Alert = {
  id: number;
  ts: number;
  severity: string;
  metric: string;
  message: string;
  value: number;
  acked: number;
};

export type AppEvent = {
  id: number;
  ts: number;
  kind: string;
  detail: string;
};

export type Recommendation = {
  id: string;
  title: string;
  detail: string;
  impact: string;
  action: { type: string; [k: string]: unknown };
};

export type OptimizeResult = {
  id: string;
  title: string;
  ok: boolean;
  demo?: boolean;
  detail: string;
};

export type GamingStatus = {
  enabled: boolean;
  changes: string[];
  auto: boolean;
  detected: string | null;
};

export type Insight = {
  enabled: boolean;
  ts: number;
  engine: string;
  findings?: string[];
  narrative?: string;
  recommendations?: Recommendation[];
};

export type AiConfig = {
  enabled: boolean;
  local_enabled: boolean;
  api_enabled: boolean;
  api_key_set: boolean;
  local_model_ready: boolean;
  local_model_simulated: boolean;
  download: { status: string; pct: number; error: string | null };
  engine: string;
};

export type Settings = {
  demo_mode: boolean;
  version: string;
  ai_engine: string;
  sample_interval: number;
  abs_thresholds: Record<string, number>;
  z_threshold: number;
  prefs: { close_to_tray: boolean; low_power_tray: boolean };
  desktop: boolean;
};

export type LicenseStatus = {
  licensed: boolean;
  reason: string;
  name: string | null;
  email: string | null;
  expires: string | null;
};

export type UpdateInfo = {
  current: string;
  latest: string | null;
  update_available: boolean;
  url: string | null;
  asset_url: string | null;
  notes: string | null;
  error: string | null;
};

export type DetailData = Record<string, unknown>;

export type UpgradeSession = {
  token: string;
  url: string;
  status: string;
};

export type UpgradeStatus = {
  status: "pending" | "issued" | "activated" | "failed" | "cancelled" | "unknown";
  token?: string;
  license?: LicenseStatus;
  detail?: string;
};

export type CloudModel = { id: string; display: string };

export type CloudConnection = {
  connected: boolean;
  models: CloudModel[];
  selected_model: string;
  max_tokens: number;
  temperature: number;
  enabled: boolean;
  error?: string;
};

export type ProcSnapItem = { pid: number; name: string; cpu: number; mem: number };
export type SnapshotResult = {
  ts: number;
  found: boolean;
  resource: string;
  procs: ProcSnapItem[];
};

export type HardwareInventory = {
  os: string;
  wmi: boolean;
  cpu: { name: string; cores_physical: number | null; cores_logical: number | null };
  ram: { total_gb: number; type: string | null; speed_mhz: number | null };
  gpu: { name: string };
  disk: { total_gb: number | null };
  motherboard: { name: string | null };
  utilization: Record<string, number>;
  current: Record<string, string | null>;
  relevance: Record<string, number>;
};

export type RegistryIssue = {
  id: string;
  category: string;
  hive: string;
  path: string;
  name: string;
  detail: string;
};
export type RegistryScan = { ok: boolean; supported: boolean; issues: RegistryIssue[]; count?: number; detail?: string };
export type TempScan = { ok: boolean; dirs: string[]; bytes: number; files: number; mb: number };
export type CleanupResult = { ok: boolean; detail?: string; [k: string]: unknown };

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

async function del<T>(path: string): Promise<T> {
  const r = await fetch(path, { method: "DELETE" });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

export const api = {
  stats: () => get<Stats>("/api/stats"),
  processes: (limit = 25) => get<Proc[]>(`/api/processes?limit=${limit}`),
  network: (limit = 50) => get<Conn[]>(`/api/network?limit=${limit}`),
  services: () => get<Service[]>("/api/services"),
  analytics: (seconds = 3600) => get<Stats[]>(`/api/analytics?seconds=${seconds}`),
  snapshot: (ts: number, resource: "cpu" | "mem" = "cpu") =>
    get<SnapshotResult>(`/api/snapshot?ts=${ts}&resource=${resource}`),
  hardware: () => get<HardwareInventory>("/api/hardware"),
  // Cleanup tab
  cleanupRestorePoint: () => post<CleanupResult>("/api/cleanup/restore-point"),
  tronInfo: () => get<{ thread: string; repo: string; note: string }>("/api/cleanup/tron"),
  tronVerify: (path: string, sha256: string) =>
    post<CleanupResult & { digest?: string; expected?: string }>("/api/cleanup/tron/verify", { path, sha256 }),
  tronLaunch: (path: string, make_restore_point = true) =>
    post<CleanupResult>("/api/cleanup/tron/launch", { path, make_restore_point }),
  registryScan: () => get<RegistryScan>("/api/cleanup/registry/scan"),
  registryClean: (ids: string[], issues: RegistryIssue[]) =>
    post<CleanupResult & { removed?: string[]; backups?: string[]; backup_dir?: string }>("/api/cleanup/registry/clean", { ids, issues }),
  tempScan: () => get<TempScan>("/api/cleanup/temp/scan"),
  tempClean: () => post<CleanupResult & { freed_mb?: number; removed?: number }>("/api/cleanup/temp/clean"),
  alerts: () => get<Alert[]>("/api/alerts"),
  ackAlert: (id: number) => post(`/api/alerts/${id}/ack`),
  clearAlert: (id: number) => del<{ ok: boolean; cleared: number }>(`/api/alerts/${id}`),
  clearAllAlerts: () => post<{ ok: boolean; cleared: number }>("/api/alerts/clear"),
  events: () => get<AppEvent[]>("/api/events"),
  insights: () => get<Insight>("/api/insights"),
  aiConfig: () => get<AiConfig>("/api/ai/config"),
  setAiConfig: (patch: Partial<{ enabled: boolean; local_enabled: boolean; api_enabled: boolean; api_key: string }>) =>
    post<AiConfig>("/api/ai/config", patch),
  aiDownload: () => post<AiConfig["download"]>("/api/ai/download"),
  optimize: (ids?: string[]) => post<OptimizeResult[]>("/api/optimize", { ids: ids ?? null }),
  gaming: () => get<GamingStatus>("/api/gaming"),
  setGaming: (enabled: boolean) => post<GamingStatus>("/api/gaming", { enabled }),
  setGamingAuto: (auto: boolean) => post<GamingStatus>("/api/gaming", { auto }),
  license: () => get<LicenseStatus>("/api/license"),
  setLicense: (key: string) => post<LicenseStatus & { reason?: string }>("/api/license", { key }),
  updateCheck: () => get<UpdateInfo>("/api/update/check"),
  settings: () => get<Settings>("/api/settings"),
  setThreshold: (metric: string, value: number) => post("/api/settings/threshold", { metric, value }),
  setPref: (key: string, value: boolean) =>
    post<{ ok: boolean; prefs: Settings["prefs"] }>("/api/settings/pref", { key, value }),
  kill: (pid: number) => post<{ ok: boolean; detail: string }>("/api/control/kill", { pid }),
  serviceAction: (name: string, action: string) => post<{ ok: boolean; detail: string }>("/api/control/service", { name, action }),
  blockIp: (ip: string) => post<{ ok: boolean; detail: string }>("/api/control/block-ip", { ip }),
  purge: (older = 0) => post<{ metrics_purged: number; events_purged: number }>("/api/purge", { older_than_seconds: older }),
  // Detail drill-down
  detail: (metric: string) => get<DetailData>(`/api/detail/${metric}`),
  // In-app upgrade
  upgradeStart: (name?: string, email?: string) =>
    post<UpgradeSession>("/api/upgrade/start", { name, email }),
  upgradeStatus: (token: string) => get<UpgradeStatus>(`/api/upgrade/status/${token}`),
  upgradeCancel: (token: string) => post<{ ok: boolean }>(`/api/upgrade/cancel/${token}`),
  // Anthropic cloud connect
  aiConnectOpen: () => post<{ ok: boolean; url: string; guide: string }>("/api/ai/connect/open"),
  aiConnect: (key: string) => post<CloudConnection>("/api/ai/connect", { key }),
  aiConnection: () => get<CloudConnection>("/api/ai/connect"),
  aiDisconnect: () => del<CloudConnection>("/api/ai/connect"),
  aiSetModel: (model: string, max_tokens?: number, temperature?: number) =>
    post<CloudConnection>("/api/ai/model", { model, max_tokens, temperature }),
};
