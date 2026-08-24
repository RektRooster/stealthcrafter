// Shared vocabulary for the live European hazard layer.
//
// Honesty rules that the whole module is built around:
//  1. Every event on the map comes from a named upstream source and carries
//     that source's own identifier and timestamp. Nothing is synthesised.
//  2. A source that cannot be reached, or that needs credentials we do not
//     have, reports that state to the UI. It never degrades into fake data
//     and never silently disappears.
//  3. Severity is OUR classification of the upstream numbers, and is labelled
//     as such. We do not restate it as if the agency issued it.

export type HazardSource = "EFFIS" | "EMSC" | "GDACS" | "ENTSOE" | "TRANSPORT";

export type HazardKind =
  | "wildfire"
  | "earthquake"
  | "flood"
  | "storm"
  | "disaster"
  | "grid"
  | "transport";

/** Our reading of how much a household should care. Not an official alert. */
export type Severity = "info" | "watch" | "elevated" | "severe";

export const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  watch: 1,
  elevated: 2,
  severe: 3,
};

export type HazardEvent = {
  /** `${source}:${upstream id}` — stable across refreshes. */
  id: string;
  source: HazardSource;
  kind: HazardKind;
  title: string;
  summary: string;
  lat: number;
  lon: number;
  /** Plotted position, or null when the event falls outside the drawn frame. */
  xy: { x: number; y: number } | null;
  countryIso2: string | null;
  severity: Severity;
  /** The upstream number the severity was derived from. */
  magnitude: number | null;
  unit: string | null;
  /** ISO-8601 UTC of the event itself (not of our fetch). */
  at: string;
  url: string | null;
  /** Which preparedness pillars this kind of event bears on. */
  pillars: string[];
};

export type SourceState = "live" | "empty" | "error" | "needs-key" | "not-built";

export type SourceStatus = {
  source: HazardSource;
  label: string;
  /** One line: what this feed actually contributes. */
  what: string;
  state: SourceState;
  /** Plain-language detail — the error, or what is missing. */
  detail: string;
  fetchedAt: string | null;
  count: number;
  attribution: string;
  href: string;
};

export type HazardSnapshot = {
  events: HazardEvent[];
  sources: SourceStatus[];
  generatedAt: string;
};

export const PILLARS_BY_KIND: Record<HazardKind, string[]> = {
  wildfire: ["Shelter", "Water", "Medical"],
  earthquake: ["Shelter", "Water", "Medical"],
  flood: ["Water", "Shelter", "Medical"],
  storm: ["Shelter", "Fire", "Water"],
  disaster: ["Water", "Shelter", "Medical", "Food"],
  grid: ["Fire", "Food", "Water"],
  transport: ["Food", "Medical"],
};

export function severityFromMagnitude(mag: number, thresholds: [number, number, number]): Severity {
  const [watch, elevated, severe] = thresholds;
  if (mag >= severe) return "severe";
  if (mag >= elevated) return "elevated";
  if (mag >= watch) return "watch";
  return "info";
}

/** Shared guarded fetch: hard timeout, no throw, cached at the edge. */
export async function safeFetch(
  url: string,
  opts: { revalidate?: number; timeoutMs?: number; headers?: Record<string, string> } = {}
): Promise<{ ok: true; res: Response } | { ok: false; detail: string }> {
  const { revalidate = 900, timeoutMs = 9000, headers } = opts;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "StealthCrafter/1.0 (+https://stealthcrafter.com)", ...(headers || {}) },
      signal: AbortSignal.timeout(timeoutMs),
      next: { revalidate },
    });
    if (!res.ok) return { ok: false, detail: `upstream returned HTTP ${res.status}` };
    return { ok: true, res };
  } catch (e: any) {
    const msg = e?.name === "TimeoutError" ? `no response within ${timeoutMs / 1000}s` : e?.message || String(e);
    return { ok: false, detail: msg };
  }
}
