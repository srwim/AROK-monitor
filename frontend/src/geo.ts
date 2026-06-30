/**
 * Approximate, offline geo-resolution for connection endpoints.
 * No network calls, no GeoIP database: private/local addresses collapse to the
 * client node, well-known provider ranges map to real city coordinates, and any
 * other public IP is deterministically hashed onto a major-city location so the
 * same address always lands in the same place. Good enough for a "where in the
 * world are my connections" picture without leaking any IPs off the machine.
 */

export type GeoPoint = { lat: number; lng: number; label: string };

/** Pull the bare IP out of a "ip:port" (or "[v6]:port" / "v6:port") string. */
export function ipFromRaddr(raddr: string): string {
  if (!raddr) return "";
  let s = raddr.trim();
  if (s.startsWith("[")) {
    const end = s.indexOf("]");
    return end > 0 ? s.slice(1, end) : s.slice(1);
  }
  // IPv4 "a.b.c.d:port" -> strip the final :port. IPv6 without brackets keeps
  // its colons; rsplit only the last segment, which is the port psutil appended.
  const i = s.lastIndexOf(":");
  if (i === -1) return s;
  const head = s.slice(0, i);
  // If what's left still looks like a v4 address or a v6 address, use it.
  return head || s;
}

/** Private, loopback, link-local, multicast, unspecified — not externally routable. */
export function isLocalIp(ip: string): boolean {
  if (!ip) return true;
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::" || v === "0.0.0.0" || v === "*") return true;
  if (v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd")) return true; // v6 link/unique-local
  if (v.startsWith("ff")) return true; // v6 multicast
  if (v.startsWith("127.")) return true;
  if (v.startsWith("10.")) return true;
  if (v.startsWith("192.168.")) return true;
  if (v.startsWith("169.254.")) return true;
  if (v.startsWith("224.") || v.startsWith("239.") || v.startsWith("255.")) return true;
  // 172.16.0.0 – 172.31.255.255
  const m = v.match(/^172\.(\d+)\./);
  if (m) {
    const o = parseInt(m[1], 10);
    if (o >= 16 && o <= 31) return true;
  }
  // 100.64.0.0/10 carrier-grade NAT
  const c = v.match(/^100\.(\d+)\./);
  if (c) {
    const o = parseInt(c[1], 10);
    if (o >= 64 && o <= 127) return true;
  }
  return false;
}

type Provider = { prefix: string; lat: number; lng: number; label: string };

// Representative coordinates for well-known networks. Longest prefix wins
// (sorted at module load), so specific ranges override broad ones.
const PROVIDERS: Provider[] = [
  // exact public resolvers
  { prefix: "8.8.8.8", lat: 37.39, lng: -122.08, label: "Google DNS" },
  { prefix: "8.8.4.4", lat: 37.39, lng: -122.08, label: "Google DNS" },
  { prefix: "1.1.1.1", lat: 37.77, lng: -122.42, label: "Cloudflare DNS" },
  { prefix: "1.0.0.1", lat: 37.77, lng: -122.42, label: "Cloudflare DNS" },
  { prefix: "9.9.9.9", lat: 37.87, lng: -122.27, label: "Quad9 DNS" },
  { prefix: "208.67.222.222", lat: 37.77, lng: -122.42, label: "OpenDNS" },
  { prefix: "208.67.220.220", lat: 37.77, lng: -122.42, label: "OpenDNS" },
  // Google / GCP
  { prefix: "142.250.", lat: 37.42, lng: -122.08, label: "Google" },
  { prefix: "172.217.", lat: 37.42, lng: -122.08, label: "Google" },
  { prefix: "172.253.", lat: 37.42, lng: -122.08, label: "Google" },
  { prefix: "216.58.", lat: 37.42, lng: -122.08, label: "Google" },
  { prefix: "74.125.", lat: 37.42, lng: -122.08, label: "Google" },
  { prefix: "64.233.", lat: 37.42, lng: -122.08, label: "Google" },
  { prefix: "35.190.", lat: 39.04, lng: -77.49, label: "Google Cloud" },
  { prefix: "35.191.", lat: 39.04, lng: -77.49, label: "Google Cloud" },
  { prefix: "34.64.", lat: 37.42, lng: -122.08, label: "Google Cloud" },
  { prefix: "2607:f8b0", lat: 37.42, lng: -122.08, label: "Google" },
  // Cloudflare
  { prefix: "104.16.", lat: 37.77, lng: -122.42, label: "Cloudflare" },
  { prefix: "104.17.", lat: 37.77, lng: -122.42, label: "Cloudflare" },
  { prefix: "104.18.", lat: 37.77, lng: -122.42, label: "Cloudflare" },
  { prefix: "104.19.", lat: 37.77, lng: -122.42, label: "Cloudflare" },
  { prefix: "104.20.", lat: 37.77, lng: -122.42, label: "Cloudflare" },
  { prefix: "104.21.", lat: 37.77, lng: -122.42, label: "Cloudflare" },
  { prefix: "172.64.", lat: 37.77, lng: -122.42, label: "Cloudflare" },
  { prefix: "172.67.", lat: 37.77, lng: -122.42, label: "Cloudflare" },
  { prefix: "162.158.", lat: 37.77, lng: -122.42, label: "Cloudflare" },
  { prefix: "188.114.", lat: 37.77, lng: -122.42, label: "Cloudflare" },
  { prefix: "2606:4700", lat: 37.77, lng: -122.42, label: "Cloudflare" },
  // Apple
  { prefix: "17.", lat: 37.32, lng: -122.03, label: "Apple" },
  // Meta / Facebook
  { prefix: "31.13.", lat: 37.45, lng: -122.18, label: "Meta" },
  { prefix: "157.240.", lat: 37.45, lng: -122.18, label: "Meta" },
  { prefix: "69.171.", lat: 37.45, lng: -122.18, label: "Meta" },
  { prefix: "66.220.", lat: 37.45, lng: -122.18, label: "Meta" },
  { prefix: "173.252.", lat: 37.45, lng: -122.18, label: "Meta" },
  { prefix: "2a03:2880", lat: 37.45, lng: -122.18, label: "Meta" },
  // Microsoft / Azure
  { prefix: "13.107.", lat: 47.64, lng: -122.13, label: "Microsoft" },
  { prefix: "20.", lat: 47.64, lng: -122.13, label: "Microsoft Azure" },
  { prefix: "40.", lat: 47.64, lng: -122.13, label: "Microsoft Azure" },
  { prefix: "23.96.", lat: 47.64, lng: -122.13, label: "Microsoft Azure" },
  { prefix: "104.40.", lat: 47.64, lng: -122.13, label: "Microsoft Azure" },
  // Amazon AWS (representative: us-east-1, Ashburn VA)
  { prefix: "3.", lat: 39.04, lng: -77.49, label: "Amazon AWS" },
  { prefix: "15.", lat: 39.04, lng: -77.49, label: "Amazon AWS" },
  { prefix: "18.", lat: 39.04, lng: -77.49, label: "Amazon AWS" },
  { prefix: "34.", lat: 39.04, lng: -77.49, label: "Amazon AWS" },
  { prefix: "44.", lat: 39.04, lng: -77.49, label: "Amazon AWS" },
  { prefix: "52.", lat: 39.04, lng: -77.49, label: "Amazon AWS" },
  { prefix: "54.", lat: 39.04, lng: -77.49, label: "Amazon AWS" },
  { prefix: "99.", lat: 39.04, lng: -77.49, label: "Amazon AWS" },
  // Fastly
  { prefix: "151.101.", lat: 37.77, lng: -122.42, label: "Fastly" },
  { prefix: "199.232.", lat: 37.77, lng: -122.42, label: "Fastly" },
  // Netflix
  { prefix: "23.246.", lat: 37.23, lng: -121.96, label: "Netflix" },
  { prefix: "45.57.", lat: 37.23, lng: -121.96, label: "Netflix" },
  { prefix: "198.38.", lat: 37.23, lng: -121.96, label: "Netflix" },
  // Akamai
  { prefix: "23.", lat: 42.37, lng: -71.11, label: "Akamai" },
  { prefix: "104.64.", lat: 42.37, lng: -71.11, label: "Akamai" },
  { prefix: "184.24.", lat: 42.37, lng: -71.11, label: "Akamai" },
].sort((a, b) => b.prefix.length - a.prefix.length);

// Fallback pool: major global cities. Unknown public IPs hash deterministically
// into this list so they always land on a recognizable, on-land location.
const CITIES: GeoPoint[] = [
  { lat: 40.71, lng: -74.01, label: "New York" },
  { lat: 39.04, lng: -77.49, label: "Ashburn" },
  { lat: 37.77, lng: -122.42, label: "San Francisco" },
  { lat: 34.05, lng: -118.24, label: "Los Angeles" },
  { lat: 47.61, lng: -122.33, label: "Seattle" },
  { lat: 32.78, lng: -96.8, label: "Dallas" },
  { lat: 41.88, lng: -87.63, label: "Chicago" },
  { lat: 25.76, lng: -80.19, label: "Miami" },
  { lat: 43.65, lng: -79.38, label: "Toronto" },
  { lat: -23.55, lng: -46.63, label: "São Paulo" },
  { lat: 19.43, lng: -99.13, label: "Mexico City" },
  { lat: -34.6, lng: -58.38, label: "Buenos Aires" },
  { lat: 51.51, lng: -0.13, label: "London" },
  { lat: 53.35, lng: -6.26, label: "Dublin" },
  { lat: 52.37, lng: 4.9, label: "Amsterdam" },
  { lat: 50.11, lng: 8.68, label: "Frankfurt" },
  { lat: 48.86, lng: 2.35, label: "Paris" },
  { lat: 40.42, lng: -3.7, label: "Madrid" },
  { lat: 59.33, lng: 18.06, label: "Stockholm" },
  { lat: 52.23, lng: 21.01, label: "Warsaw" },
  { lat: 55.76, lng: 37.62, label: "Moscow" },
  { lat: 41.01, lng: 28.98, label: "Istanbul" },
  { lat: 30.04, lng: 31.24, label: "Cairo" },
  { lat: 25.2, lng: 55.27, label: "Dubai" },
  { lat: 32.08, lng: 34.78, label: "Tel Aviv" },
  { lat: -26.2, lng: 28.05, label: "Johannesburg" },
  { lat: 19.08, lng: 72.88, label: "Mumbai" },
  { lat: 12.97, lng: 77.59, label: "Bangalore" },
  { lat: 1.35, lng: 103.82, label: "Singapore" },
  { lat: -6.21, lng: 106.85, label: "Jakarta" },
  { lat: 22.32, lng: 114.17, label: "Hong Kong" },
  { lat: 31.23, lng: 121.47, label: "Shanghai" },
  { lat: 39.9, lng: 116.4, label: "Beijing" },
  { lat: 37.57, lng: 126.98, label: "Seoul" },
  { lat: 35.68, lng: 139.69, label: "Tokyo" },
  { lat: -33.87, lng: 151.21, label: "Sydney" },
];

// IANA timezone → representative coordinates. Used to place the client node
// geographically from the only locally-available signal (the browser's
// timezone) without any IP lookup or network call.
const TIMEZONES: Record<string, GeoPoint> = {
  "America/New_York": { lat: 40.71, lng: -74.01, label: "New York" },
  "America/Detroit": { lat: 42.33, lng: -83.05, label: "Detroit" },
  "America/Toronto": { lat: 43.65, lng: -79.38, label: "Toronto" },
  "America/Chicago": { lat: 41.88, lng: -87.63, label: "Chicago" },
  "America/Denver": { lat: 39.74, lng: -104.99, label: "Denver" },
  "America/Phoenix": { lat: 33.45, lng: -112.07, label: "Phoenix" },
  "America/Los_Angeles": { lat: 34.05, lng: -118.24, label: "Los Angeles" },
  "America/Vancouver": { lat: 49.28, lng: -123.12, label: "Vancouver" },
  "America/Mexico_City": { lat: 19.43, lng: -99.13, label: "Mexico City" },
  "America/Sao_Paulo": { lat: -23.55, lng: -46.63, label: "São Paulo" },
  "America/Argentina/Buenos_Aires": { lat: -34.6, lng: -58.38, label: "Buenos Aires" },
  "America/Bogota": { lat: 4.71, lng: -74.07, label: "Bogotá" },
  "America/Anchorage": { lat: 61.22, lng: -149.9, label: "Anchorage" },
  "Pacific/Honolulu": { lat: 21.31, lng: -157.86, label: "Honolulu" },
  "Europe/London": { lat: 51.51, lng: -0.13, label: "London" },
  "Europe/Dublin": { lat: 53.35, lng: -6.26, label: "Dublin" },
  "Europe/Lisbon": { lat: 38.72, lng: -9.14, label: "Lisbon" },
  "Europe/Madrid": { lat: 40.42, lng: -3.7, label: "Madrid" },
  "Europe/Paris": { lat: 48.86, lng: 2.35, label: "Paris" },
  "Europe/Amsterdam": { lat: 52.37, lng: 4.9, label: "Amsterdam" },
  "Europe/Brussels": { lat: 50.85, lng: 4.35, label: "Brussels" },
  "Europe/Berlin": { lat: 52.52, lng: 13.4, label: "Berlin" },
  "Europe/Zurich": { lat: 47.37, lng: 8.54, label: "Zurich" },
  "Europe/Rome": { lat: 41.9, lng: 12.5, label: "Rome" },
  "Europe/Stockholm": { lat: 59.33, lng: 18.06, label: "Stockholm" },
  "Europe/Oslo": { lat: 59.91, lng: 10.75, label: "Oslo" },
  "Europe/Warsaw": { lat: 52.23, lng: 21.01, label: "Warsaw" },
  "Europe/Prague": { lat: 50.08, lng: 14.44, label: "Prague" },
  "Europe/Athens": { lat: 37.98, lng: 23.73, label: "Athens" },
  "Europe/Istanbul": { lat: 41.01, lng: 28.98, label: "Istanbul" },
  "Europe/Moscow": { lat: 55.76, lng: 37.62, label: "Moscow" },
  "Europe/Kyiv": { lat: 50.45, lng: 30.52, label: "Kyiv" },
  "Africa/Cairo": { lat: 30.04, lng: 31.24, label: "Cairo" },
  "Africa/Lagos": { lat: 6.52, lng: 3.38, label: "Lagos" },
  "Africa/Johannesburg": { lat: -26.2, lng: 28.05, label: "Johannesburg" },
  "Africa/Nairobi": { lat: -1.29, lng: 36.82, label: "Nairobi" },
  "Asia/Jerusalem": { lat: 31.78, lng: 35.22, label: "Jerusalem" },
  "Asia/Dubai": { lat: 25.2, lng: 55.27, label: "Dubai" },
  "Asia/Riyadh": { lat: 24.71, lng: 46.68, label: "Riyadh" },
  "Asia/Karachi": { lat: 24.86, lng: 67.0, label: "Karachi" },
  "Asia/Kolkata": { lat: 19.08, lng: 72.88, label: "Mumbai" },
  "Asia/Dhaka": { lat: 23.81, lng: 90.41, label: "Dhaka" },
  "Asia/Bangkok": { lat: 13.76, lng: 100.5, label: "Bangkok" },
  "Asia/Singapore": { lat: 1.35, lng: 103.82, label: "Singapore" },
  "Asia/Jakarta": { lat: -6.21, lng: 106.85, label: "Jakarta" },
  "Asia/Hong_Kong": { lat: 22.32, lng: 114.17, label: "Hong Kong" },
  "Asia/Shanghai": { lat: 31.23, lng: 121.47, label: "Shanghai" },
  "Asia/Taipei": { lat: 25.03, lng: 121.57, label: "Taipei" },
  "Asia/Seoul": { lat: 37.57, lng: 126.98, label: "Seoul" },
  "Asia/Tokyo": { lat: 35.68, lng: 139.69, label: "Tokyo" },
  "Australia/Perth": { lat: -31.95, lng: 115.86, label: "Perth" },
  "Australia/Sydney": { lat: -33.87, lng: 151.21, label: "Sydney" },
  "Australia/Melbourne": { lat: -37.81, lng: 144.96, label: "Melbourne" },
  "Pacific/Auckland": { lat: -36.85, lng: 174.76, label: "Auckland" },
};

// Rough longitude per UTC offset hour, used when the exact timezone isn't in
// the table — keeps the client node at least in the right vertical band.
function offsetFallback(): GeoPoint | null {
  try {
    const offMin = -new Date().getTimezoneOffset(); // east of UTC = positive
    const lng = Math.max(-179, Math.min(179, (offMin / 60) * 15));
    return { lat: 30, lng, label: "Your location (approx.)" };
  } catch {
    return null;
  }
}

/**
 * Best-effort client location from the browser timezone. Offline, no IP lookup.
 * Returns null only if even the timezone is unavailable.
 */
export function clientLocation(): GeoPoint | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && TIMEZONES[tz]) return TIMEZONES[tz];
  } catch {
    /* fall through */
  }
  return offsetFallback();
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Resolve an endpoint to an approximate location.
 * Returns null for local / non-routable addresses (drawn at the client node).
 */
export function resolveIp(ip: string): GeoPoint | null {
  if (!ip || isLocalIp(ip)) return null;
  const v = ip.toLowerCase();
  for (const p of PROVIDERS) {
    if (v.startsWith(p.prefix)) return { lat: p.lat, lng: p.lng, label: p.label };
  }
  // Deterministic, stable fallback.
  const city = CITIES[hashStr(v) % CITIES.length];
  return { lat: city.lat, lng: city.lng, label: city.label };
}
