// Region geometry: turning a warning's area CODE into a shape on the map.
//
// This is the piece Phase 2 exists for, and the live data changed what it can
// be. The plan assumed EMMA_ID was a relabelling of NUTS and that a static
// mapping would cover most of Europe. The first sweep says otherwise:
//
//   EMMA_ID     14,302 uses · 1,374 codes · 19 countries  — Meteoalarm's OWN
//               regionalisation. AT has 113 codes where NUTS 3 has 35; ES has
//               233 where NUTS 3 has 59. These are not NUTS under another name
//               and no arithmetic turns one into the other.
//   NUTS3/NUTS2  8,038 uses ·   181 codes ·  5 countries  — genuinely NUTS.
//   WARNCELLID   1,443 uses ·   299 codes · Germany       — DWD's own cells.
//   CISORP       1,322 uses ·   196 codes · Czechia       — ORP municipalities.
//   FIPS           546 uses ·    26 codes · Ireland       — FIPS 10-4 counties.
//
// So the honest position: **EMMA_ID geometry can only come from Meteoalarm's
// Metadata API**, which needs the key bundled into Ace action A1. Until then
// nineteen countries are shaded at country level and their warnings carry the
// authority's own area name, which is meaningful to a reader in that country
// even without a shape. We do not approximate a region we cannot draw.
//
// What we CAN draw today is the NUTS set, and the resolver is built so the
// EMMA_ID table drops into the same slot the day the key arrives.
//
// VINTAGES. NUTS is re-cut every three years and the feeds are not on one
// vintage: France's Meteoalarm codes are NUTS 2013 (FR211 became FRF21 in
// 2016), Hungary's HU10 predates the 2016 split, Bulgaria and Romania have not
// changed. Resolving against 2021 alone matched 92 of 181 codes. Carrying 2021,
// 2016 and 2013 and preferring the newest matches all 181.
//
// Source: Eurostat GISCO, 20M generalisation, EPSG:4326.
// Licence: free reuse with acknowledgement — see ATTRIBUTION below.

import nuts from "./nuts.json";

export const NUTS_ATTRIBUTION =
  "Administrative boundaries: © EuroGeographics / Eurostat GISCO";

type Table = { regions: Record<string, GeoJSON.Geometry>; names: Record<string, string> };
const TABLE = nuts as unknown as Table;

export type Geocode = { scheme: string; value: string };

export type ResolvedArea = {
  geom: GeoJSON.Geometry;
  bbox: [number, number, number, number];
  lat: number;
  lon: number;
  /** Which table answered — recorded so a shape can always be traced. */
  source: "nuts";
  /** Codes we could draw, and codes we could not. Both are worth knowing. */
  matched: string[];
  unmatched: string[];
};

/** Schemes this resolver understands today. EMMA_ID is deliberately absent
    rather than guessed at. */
const NUTS_SCHEMES = new Set(["NUTS", "NUTS2", "NUTS3", "NUTS_ID"]);

export function regionName(code: string): string | null {
  return TABLE.names[code] ?? null;
}

export function hasRegion(code: string): boolean {
  return Boolean(TABLE.regions[code]);
}

/**
 * Resolve one alert's geocodes to a drawable area.
 *
 * Multiple codes are unioned — a warning covering nine départements is one
 * shape made of nine rings, which is what the reader should see.
 *
 * Returns null when nothing resolves. The caller must then leave the alert
 * without geometry: it will be listed under its own area name and counted into
 * its country. That is the whole discipline here — an area we cannot draw is
 * never drawn approximately.
 */
export function resolveArea(geocodes: Geocode[] | null | undefined): ResolvedArea | null {
  if (!geocodes?.length) return null;

  const matched: string[] = [];
  const unmatched: string[] = [];
  const polys: number[][][][] = [];

  for (const g of geocodes) {
    const scheme = (g?.scheme || "").toUpperCase();
    const value = (g?.value || "").trim();
    if (!value) continue;
    if (!NUTS_SCHEMES.has(scheme)) {
      unmatched.push(`${scheme}:${value}`);
      continue;
    }
    const geom = TABLE.regions[value];
    if (!geom) {
      unmatched.push(`${scheme}:${value}`);
      continue;
    }
    matched.push(value);
    if (geom.type === "Polygon") polys.push((geom as any).coordinates);
    else if (geom.type === "MultiPolygon") polys.push(...(geom as any).coordinates);
  }

  if (!polys.length) return null;

  const geom: GeoJSON.Geometry =
    polys.length === 1
      ? ({ type: "Polygon", coordinates: polys[0] } as GeoJSON.Geometry)
      : ({ type: "MultiPolygon", coordinates: polys } as GeoJSON.Geometry);

  const bbox = bboxOf(geom);
  if (!bbox) return null;

  return {
    geom,
    bbox,
    lon: round(( bbox[0] + bbox[2]) / 2),
    lat: round((bbox[1] + bbox[3]) / 2),
    source: "nuts",
    matched,
    unmatched,
  };
}

/** Coverage report for the operator page: which schemes we can draw and which
    we are carrying blind. Reading this beside the feed list is how we know
    whether A1 has become worth chasing harder. */
export function schemeCoverage(geocodes: Geocode[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const g of geocodes) {
    const scheme = (g?.scheme || "").toUpperCase();
    out[scheme] = NUTS_SCHEMES.has(scheme) && hasRegion(g.value);
  }
  return out;
}

export function bboxOf(geom: GeoJSON.Geometry | null): [number, number, number, number] | null {
  if (!geom) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const walk = (c: any) => {
    if (typeof c?.[0] === "number") {
      const [lon, lat] = c as number[];
      if (lon < w) w = lon;
      if (lon > e) e = lon;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
      return;
    }
    if (Array.isArray(c)) for (const x of c) walk(x);
  };
  walk((geom as any).coordinates ?? []);
  if (!Number.isFinite(w) || e <= w || n <= s) return null;
  return [round(w), round(s), round(e), round(n)];
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;

/** How many regions we hold, for the operator page. */
export function regionTableSize(): number {
  return Object.keys(TABLE.regions).length;
}
