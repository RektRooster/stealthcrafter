// What the storefront reads.
//
// Two sources feed one list, and the split is deliberate rather than temporary
// mess:
//
//   * The five original pan-European adapters (EMSC, GDACS, EFFIS, ENTSO-E,
//     transport) still fetch at render. Five requests per render was never the
//     problem — the problem was adding forty more, and those forty now go
//     through the ingest spine. They migrate onto it next; until then they work
//     exactly as they did.
//   * Everything in the `alerts` table, written by the scheduled ingest worker
//     and read here with one indexed query.
//
// The licence gate lives here, at the last point before display: an alert whose
// feed is `blocked` or `unknown` never reaches a page, whatever else happens
// upstream of it. Attribution travels with each alert for the same reason —
// several of these licences require crediting the issuing service, and a credit
// that lives only on a source page nobody opens is not attribution.

import { supabaseAdmin } from "./supabase";
import { getHazardSnapshot } from "./hazards";
import type { SourceStatus } from "./hazards/types";
import { SEVERITY_RANK } from "./feeds/types";
import type { AlertKind, Severity } from "./feeds/types";

export type LiveEvent = {
  id: string;
  source: string;
  /** Feed row id, or the legacy adapter's source name. */
  feedId: string;
  kind: string;
  severity: Severity;
  /** The authority's own classification, kept verbatim beside ours. */
  upstreamSeverity: string | null;
  title: string;
  summary: string;
  /** The authority's own advice on what to do, where the feed carries it. */
  instruction: string | null;
  countryIso2: string | null;
  /** Named area, e.g. "powiat biłgorajski". Present even when geometry is not. */
  areaDesc: string | null;
  /** Only where the feed actually supplied geometry. Never invented. */
  geom: GeoJSON.Geometry | null;
  lat: number | null;
  lon: number | null;
  at: string;
  expires: string | null;
  url: string | null;
  attribution: string | null;
  pillars: string[];
};

export type FeedHealth = {
  id: string;
  label: string;
  country: string | null;
  state: "live" | "quiet" | "stale" | "error" | "needs-key" | "not-run";
  lastSuccess: string | null;
  detail: string;
  attribution: string | null;
  licenceState: string;
};

export type LiveSnapshot = {
  events: LiveEvent[];
  /** Legacy adapter statuses, for the source strip. */
  sources: SourceStatus[];
  feeds: FeedHealth[];
  generatedAt: string;
  /** Distinct credit lines that must be rendered somewhere on the page. */
  credits: string[];
};

const PILLARS_BY_KIND: Record<string, string[]> = {
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

/** A feed that has not reported inside three times its own cadence is stale.
    This matters more than it sounds: SC 13 found member feeds that stop
    publishing for weeks, and a stale feed looks exactly like a calm country
    unless we say otherwise. */
function healthOf(f: any): FeedHealth["state"] {
  if (!f.last_run_at) return "not-run";
  if (f.last_status === "needs-key") return "needs-key";
  if (f.last_status === "error") return "error";
  const last = f.last_success_at ? Date.parse(f.last_success_at) : 0;
  if (!last) return "error";
  if (Date.now() - last > f.cadence_s * 1000 * 3) return "stale";
  return f.last_status === "empty" ? "quiet" : "live";
}

export async function getLiveSnapshot(countryIso2?: string): Promise<LiveSnapshot> {
  const [legacy, stored] = await Promise.all([
    getHazardSnapshot(),
    readStoredAlerts(countryIso2),
  ]);

  const events: LiveEvent[] = [
    ...stored.events,
    // The legacy adapters already carry the honesty rules; they are reshaped,
    // not reinterpreted.
    ...legacy.events
      .filter((e) => !countryIso2 || e.countryIso2 === countryIso2)
      .map((e) => ({
        id: e.id,
        source: e.source,
        feedId: e.source,
        kind: e.kind as string,
        severity: e.severity as Severity,
        upstreamSeverity: e.magnitude !== null ? `${e.magnitude} ${e.unit ?? ""}`.trim() : null,
        title: e.title,
        summary: e.summary,
        instruction: null,
        countryIso2: e.countryIso2,
        areaDesc: null,
        geom: null,
        lat: e.lat,
        lon: e.lon,
        at: e.at,
        expires: null,
        url: e.url,
        attribution:
          legacy.sources.find((s) => s.source === e.source)?.attribution ?? null,
        pillars: e.pillars,
      })),
  ];

  // Worst first, then most recent — the list has to lead with what a household
  // would act on.
  events.sort((a, b) => {
    const d = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (d) return d;
    const c = Number(Boolean(b.countryIso2)) - Number(Boolean(a.countryIso2));
    if (c) return c;
    return Date.parse(b.at) - Date.parse(a.at);
  });

  const credits = [
    ...new Set(
      [
        ...events.map((e) => e.attribution),
        ...legacy.sources.filter((s) => s.state === "live").map((s) => s.attribution),
      ].filter(Boolean) as string[]
    ),
  ].sort();

  return {
    events,
    sources: legacy.sources,
    feeds: stored.feeds,
    generatedAt: new Date().toISOString(),
    credits,
  };
}

/* ------------------------------------------------------------------ */

async function readStoredAlerts(
  countryIso2?: string
): Promise<{ events: LiveEvent[]; feeds: FeedHealth[] }> {
  const sb = supabaseAdmin();
  if (!sb) return { events: [], feeds: [] };

  // Only feeds whose licence permits display. This is the gate, and it is
  // applied in the query rather than after it so a display bug cannot leak a
  // feed we are not entitled to show.
  const { data: feedRows } = await sb
    .from("feeds")
    .select(
      "id, country_iso2, authority, attribution, licence_state, enabled, cadence_s, last_run_at, last_success_at, last_status, kind"
    )
    .eq("enabled", true)
    .in("licence_state", ["clear", "pending"]);

  const feeds = (feedRows || []) as any[];
  if (!feeds.length) return { events: [], feeds: [] };

  const allowed = new Map(feeds.map((f) => [f.id, f]));
  const now = new Date().toISOString();

  let q = sb
    .from("alerts")
    .select(
      "id, feed_id, country_iso2, kind, severity, upstream_severity, headline, description, instruction, area_desc, geom, lat, lon, sent, onset, expires, url, attribution"
    )
    .in("feed_id", [...allowed.keys()])
    .or(`expires.is.null,expires.gt.${now}`)
    .order("sent", { ascending: false })
    .limit(1200);
  if (countryIso2) q = q.eq("country_iso2", countryIso2);

  const { data } = await q;

  const events: LiveEvent[] = (data || []).map((a: any) => {
    const feed = allowed.get(a.feed_id);
    return {
      id: a.id,
      source: feed?.authority?.split(" (")[0] ?? a.feed_id,
      feedId: a.feed_id,
      kind: a.kind,
      severity: a.severity as Severity,
      upstreamSeverity: a.upstream_severity,
      title: a.headline,
      summary: (a.description || a.area_desc || "").slice(0, 600),
      instruction: a.instruction,
      countryIso2: a.country_iso2,
      areaDesc: a.area_desc,
      geom: a.geom ?? null,
      lat: a.lat,
      lon: a.lon,
      at: a.onset || a.sent,
      expires: a.expires,
      url: a.url,
      // Alert-level attribution wins: an aggregated feed may need to credit the
      // issuing national service, not only the aggregator.
      attribution: a.attribution || feed?.attribution || null,
      pillars: PILLARS_BY_KIND[a.kind] ?? ["Shelter"],
    };
  });

  const health: FeedHealth[] = feeds.map((f) => ({
    id: f.id,
    label: f.authority,
    country: f.country_iso2,
    state: healthOf(f),
    lastSuccess: f.last_success_at,
    detail: f.last_status || "not yet run",
    attribution: f.attribution,
    licenceState: f.licence_state,
  }));

  return { events, feeds: health };
}

/** Country roll-up for the map's shading and the country cards. Counts every
    alert, including those with no geometry — a warning we cannot draw is still
    a warning that country is under. */
export function summariseByCountry(events: LiveEvent[]) {
  const byCountry: Record<string, { count: number; worst: number }> = {};
  let severe = 0;
  for (const e of events) {
    if (e.severity === "severe") severe++;
    if (!e.countryIso2) continue;
    const cur = byCountry[e.countryIso2] || { count: 0, worst: -1 };
    cur.count++;
    cur.worst = Math.max(cur.worst, SEVERITY_RANK[e.severity]);
    byCountry[e.countryIso2] = cur;
  }
  return { byCountry, severe, total: events.length };
}
