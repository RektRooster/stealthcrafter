// One country's picture: what is happening there now, and — just as important —
// what we can and cannot see.
//
// Thirty of the thirty-nine countries in SC 13's remit have no machine-readable
// civil-protection feed at all. They run cell broadcast: the state pushes a
// warning straight to every phone in a cell, and there is nothing to subscribe
// to. That is not a gap in our coverage to be papered over. It is a fact a
// household should be told, because it changes what they should do — turn on
// the emergency alerts setting on your phone, because that is the channel your
// government will actually use.
//
// So every country page states its national system by name, says whether we can
// carry it, and lists what we watch instead. A page that says "we cannot see
// this, here is who can" is worth more than one that quietly shows less.

import { supabaseAdmin } from "./supabase";
import { REGISTRY } from "./feeds/registry";
import { countryName } from "./iso-ids";
import { getLiveSnapshot } from "./live-conditions";
import type { LiveEvent } from "./live-conditions";
import type { Feed, FeedKind } from "./feeds/types";

export const FEED_KIND_WORD: Record<string, string> = {
  "severe-weather": "Severe weather",
  "civil-protection": "Civil protection",
  flood: "Flood",
  seismic: "Earthquakes",
  wildfire: "Wildfire",
  power: "Power grid",
  roads: "Roads and logistics",
  "drinking-water": "Drinking water",
  "public-health": "Public health",
  other: "Other",
};

const KIND_ORDER: FeedKind[] = [
  "civil-protection",
  "severe-weather",
  "flood",
  "wildfire",
  "seismic",
  "power",
  "roads",
  "drinking-water",
  "public-health",
];

export type CoverageRow = {
  kind: FeedKind;
  label: string;
  /** Feeds we are actually carrying for this kind. */
  carried: { authority: string; attribution: string | null; licenceState: string; live: boolean }[];
  /** Researched, usable, built — but not switched on yet. Saying "none found"
      about a source that is sitting in the register would be a lie, and a
      lazy-looking one. */
  available: { authority: string; why: string }[];
  /** The authority whose warnings exist but are not machine-readable. */
  noFeed: { authority: string; why: string }[];
  /** We looked and found nothing at all. */
  notFound: boolean;
};

export type CountryConditions = {
  iso2: string;
  name: string;
  events: LiveEvent[];
  worst: string | null;
  coverage: CoverageRow[];
  /** The national public-warning system, named, whether or not we can read it. */
  nationalSystem: { authority: string; machineReadable: boolean; note: string } | null;
  credits: string[];
  feedsCarried: number;
  feedsRegistered: number;
  lastRead: string | null;
};

function registryFor(iso2: string): Feed[] {
  return REGISTRY.filter((f) => f.country_iso2 === iso2);
}

export function countriesWithRegistry(): { iso2: string; name: string; feeds: number; carried: number }[] {
  const by = new Map<string, Feed[]>();
  for (const f of REGISTRY) {
    if (!f.country_iso2) continue;
    if (!by.has(f.country_iso2)) by.set(f.country_iso2, []);
    by.get(f.country_iso2)!.push(f);
  }
  return [...by.entries()]
    .map(([iso2, rows]) => ({
      iso2,
      name: countryName(iso2) || iso2,
      feeds: rows.length,
      carried: rows.filter((f) => f.enabled).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getCountryConditions(iso2: string): Promise<CountryConditions | null> {
  const code = iso2.toUpperCase();
  const rows = registryFor(code);
  if (!rows.length) return null;

  const snapshot = await getLiveSnapshot(code);

  // Which of this country's feeds are actually reporting right now.
  const sb = supabaseAdmin();
  const liveIds = new Set<string>();
  let lastRead: string | null = null;
  if (sb) {
    const { data } = await sb
      .from("feeds")
      .select("id, last_status, last_success_at")
      .eq("country_iso2", code)
      .eq("enabled", true);
    for (const f of (data || []) as any[]) {
      if (f.last_status === "ok" || f.last_status === "empty") liveIds.add(f.id);
      if (f.last_success_at && (!lastRead || f.last_success_at > lastRead)) lastRead = f.last_success_at;
    }
  }

  const coverage: CoverageRow[] = [];
  for (const kind of KIND_ORDER) {
    const forKind = rows.filter((f) => f.kind === kind);
    if (!forKind.length) continue;

    const carried = forKind
      .filter((f) => f.enabled && f.licence_state !== "blocked" && f.licence_state !== "unknown")
      .map((f) => ({
        authority: f.authority,
        attribution: f.attribution,
        licenceState: f.licence_state,
        live: liveIds.has(f.id),
      }));

    const carriedIds = new Set(carried.map((c) => c.authority));

    // Researched and reachable, but not running yet — either because a licence
    // or key is outstanding, or simply because it is further down the build
    // order. Both are honest answers; "none found" is not.
    const available = forKind
      .filter(
        (f) =>
          !carriedIds.has(f.authority) &&
          f.register_status !== "NOT-FOUND" &&
          f.register_status !== "NO-PUBLIC-FEED"
      )
      .map((f) => ({
        authority: f.authority,
        why:
          f.licence_state === "blocked"
            ? "the licence does not permit our use"
            : f.access_state === "needs-contract"
            ? "needs a signed agreement"
            : f.access_state === "needs-key"
            ? "needs an API key"
            : f.access_state === "needs-registration"
            ? "needs an account"
            : f.licence_state === "unknown"
            ? "licence not established"
            : "built, not yet switched on",
      }));

    const noFeed = forKind
      .filter((f) => f.register_status === "NO-PUBLIC-FEED")
      .map((f) => ({ authority: f.authority, why: shorten(f.notes) }));

    const notFound =
      !carried.length &&
      !available.length &&
      !noFeed.length &&
      forKind.every((f) => f.register_status === "NOT-FOUND");

    coverage.push({ kind, label: FEED_KIND_WORD[kind] || kind, carried, available, noFeed, notFound });
  }

  // The national civil-protection system, named. If there is a machine-readable
  // one we say so; if not we name the system anyway, because the reader still
  // needs to know what will reach them.
  const civil = rows.filter((f) => f.kind === "civil-protection");
  const machine = civil.find((f) => f.enabled && f.licence_state !== "blocked");
  const stated = civil.find((f) => f.register_status === "NO-PUBLIC-FEED") ?? civil[0];
  const nationalSystem = stated
    ? {
        authority: (machine ?? stated).authority,
        machineReadable: Boolean(machine),
        note: shorten(stated.notes),
      }
    : null;

  const severityOrder = ["info", "watch", "elevated", "severe"];
  const worst =
    snapshot.events.length > 0
      ? snapshot.events
          .map((e) => e.severity)
          .sort((a, b) => severityOrder.indexOf(b) - severityOrder.indexOf(a))[0]
      : null;

  return {
    iso2: code,
    name: countryName(code) || code,
    events: snapshot.events,
    worst,
    coverage,
    nationalSystem,
    credits: snapshot.credits,
    feedsCarried: rows.filter((f) => f.enabled).length,
    feedsRegistered: rows.length,
    lastRead,
  };
}

/** SC 13's notes are research prose. Take the first sentence, which is reliably
    the finding, and leave the rest in the register where it belongs. */
function shorten(notes: string | null): string {
  if (!notes) return "";
  const first = notes.split(/(?<=[.!?])\s+/)[0] || notes;
  return first.length > 260 ? first.slice(0, 257) + "…" : first;
}
