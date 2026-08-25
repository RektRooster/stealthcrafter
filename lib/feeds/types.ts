// SC 05 Live Alerts Spine — shared vocabulary.
//
// The honesty rules from lib/hazards/types.ts carry over unchanged and now
// apply to forty-odd feeds instead of five:
//
//  1. Every alert comes from a named upstream source and keeps that source's
//     own identifier, timestamp and words. Nothing is synthesised.
//  2. A feed that cannot be reached, or that needs credentials we do not have,
//     records that state. It never degrades into fake data and never silently
//     disappears.
//  3. Severity is OUR classification of the authority's figures. The
//     authority's own wording is kept alongside it in `upstreamSeverity` and is
//     never restated as if we issued it, nor ours as if they did.
//  4. Attribution travels with the alert, not just with the feed, because
//     several of these licences require crediting the issuing service as well
//     as the aggregator that relayed it.

/** How much a household should care. Ours, not the authority's. */
export type Severity = "info" | "watch" | "elevated" | "severe";

export const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  watch: 1,
  elevated: 2,
  severe: 3,
};

/** What the alert is about. Extended well beyond the original five sources
    because CAP feeds carry the full European weather vocabulary. */
export type AlertKind =
  | "wildfire"
  | "earthquake"
  | "flood"
  | "storm"
  | "rain"
  | "snow"
  | "ice"
  | "avalanche"
  | "heat"
  | "cold"
  | "fog"
  | "coastal"
  | "disaster"
  | "grid"
  | "transport"
  | "health"
  | "water"
  | "other";

export const ALL_KINDS: AlertKind[] = [
  "wildfire", "earthquake", "flood", "storm", "rain", "snow", "ice", "avalanche",
  "heat", "cold", "fog", "coastal", "disaster", "grid", "transport", "health",
  "water", "other",
];

export const KIND_WORD: Record<AlertKind, string> = {
  wildfire: "Wildfire",
  earthquake: "Earthquake",
  flood: "Flood",
  storm: "Storm / wind",
  rain: "Heavy rain",
  snow: "Snow",
  ice: "Ice",
  avalanche: "Avalanche",
  heat: "Extreme heat",
  cold: "Extreme cold",
  fog: "Fog",
  coastal: "Coastal event",
  disaster: "Major event",
  grid: "Power grid",
  transport: "Transport",
  health: "Public health",
  water: "Drinking water",
  other: "Other",
};

/** Which preparedness pillars each kind bears on. Drives the "what this means
    for your household" bridge into Jimmy. */
export const PILLARS_BY_KIND: Record<AlertKind, string[]> = {
  wildfire: ["Shelter", "Water", "Medical"],
  earthquake: ["Shelter", "Water", "Medical"],
  flood: ["Water", "Shelter", "Medical"],
  storm: ["Shelter", "Fire", "Water"],
  rain: ["Shelter", "Water"],
  snow: ["Fire", "Food", "Shelter"],
  ice: ["Fire", "Shelter", "Medical"],
  avalanche: ["Shelter", "Medical"],
  heat: ["Water", "Medical"],
  cold: ["Fire", "Shelter", "Medical"],
  fog: ["Shelter"],
  coastal: ["Shelter", "Water"],
  disaster: ["Water", "Shelter", "Medical", "Food"],
  grid: ["Fire", "Food", "Water"],
  transport: ["Food", "Medical"],
  health: ["Medical"],
  water: ["Water", "Medical"],
  other: ["Shelter"],
};

/** Which feed family a row belongs to — SC 13's own nine types. */
export type FeedKind =
  | "severe-weather"
  | "civil-protection"
  | "flood"
  | "seismic"
  | "wildfire"
  | "power"
  | "roads"
  | "drinking-water"
  | "public-health"
  | "other";

/**
 * Whether the licence permits us to show this feed's data.
 *
 *  clear   — a named permissive licence whose conditions we know and meet.
 *  pending — a permissive base grant is stated, but some condition is not yet
 *            confirmed in writing. Renders WITH attribution while we confirm.
 *            Meteoalarm is the important case: its own feed declares terms
 *            "equivalent to CC BY 4.0" and we credit it, but the redistribution
 *            addenda live on a page nobody has been able to read (Ace A1).
 *  blocked — the licence prohibits our use: non-commercial only, all rights
 *            reserved, or a signed agreement we do not hold. Never renders.
 *  unknown — no licence found at all. Treated as blocked for display.
 */
export type LicenceState = "clear" | "pending" | "blocked" | "unknown";

/** What stands between us and running this feed. */
export type AccessState =
  | "open"
  | "needs-key"
  | "needs-registration"
  | "needs-contract"
  | "none";

export type Feed = {
  id: string;
  country_iso2: string | null;
  kind: FeedKind;
  authority: string;
  endpoint: string;
  parser: string;
  /** The NAME of the env var holding the key. Never a secret. */
  auth_env: string | null;
  cadence_s: number;
  licence: string | null;
  attribution: string | null;
  licence_state: LicenceState;
  access_state: AccessState;
  access_url: string | null;
  access_contact: string | null;
  enabled: boolean;
  priority: number;
  register_ref: string | null;
  register_status: string | null;
  notes: string | null;
  last_run_at?: string | null;
  last_success_at?: string | null;
  last_hash?: string | null;
  last_status?: string | null;
  consecutive_failures?: number;
};

/** A geographic area, which is what most of these alerts actually are. Points
    were the right model for five seismic and fire feeds; they are the wrong one
    for a district-level storm warning. */
export type AlertArea = {
  /** GeoJSON geometry when the feed gives one. */
  geom: GeoJSON.Geometry | null;
  /** [w, s, e, n] */
  bbox: [number, number, number, number] | null;
  /** Region codes — EMMA_ID, WARNCELLID, ARS, ORP. */
  geocodes: { scheme: string; value: string }[];
  /** The authority's own name for the area, e.g. "powiat biłgorajski". */
  desc: string | null;
  /** Representative point for the marker: a centroid, not an invented location. */
  lat: number | null;
  lon: number | null;
};

export type Alert = {
  id: string;
  feedId: string;
  countryIso2: string | null;
  kind: AlertKind;
  severity: Severity;
  upstreamSeverity: string | null;
  upstreamUrgency: string | null;
  upstreamCertainty: string | null;
  headline: string;
  description: string | null;
  /** The authority's own advice on what to do. */
  instruction: string | null;
  onset: string | null;
  expires: string | null;
  sent: string;
  area: AlertArea;
  /** { pl: {headline, description}, en: {...} } */
  langs: Record<string, { headline?: string; description?: string; instruction?: string }>;
  url: string | null;
  attribution: string | null;
  dedupeKey: string | null;
  raw: unknown;
};

export type FeedRunStatus = "ok" | "empty" | "error" | "skipped" | "needs-key" | "blocked";

export type FeedRun = {
  feedId: string;
  status: FeedRunStatus;
  itemCount: number;
  detail: string;
  contentHash: string | null;
  durationMs: number;
};

/** A parser turns one fetched payload into alerts. It never touches the
    network, never touches the database, and never throws for bad upstream
    data — malformed items are skipped and counted. */
export type ParseResult = { alerts: Alert[]; skipped: number; note?: string };

/** Only feeds whose licence actually permits display reach the storefront. */
export function mayDisplay(f: Pick<Feed, "licence_state">): boolean {
  return f.licence_state === "clear" || f.licence_state === "pending";
}
