// Wider-Europe map geometry, generated server-side from the world-atlas 50m
// dataset. Same projection family as the admin EU-27 map (lib/eu-map.ts) but
// framed on the whole continent so non-EU neighbours are visible — the
// customer-facing hazard map has to look like Europe, not like a policy area.
//
// Never import this into a client component: it pulls in the 50m topology.
// Project points on the server and pass {x,y} down as props.
import { geoConicConformal, geoPath, geoContains, geoCentroid } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const world = require("world-atlas/countries-50m.json") as Topology<{
  countries: GeometryCollection<{ name: string }>;
}>;

// EU-27 — the interactive tier (markets we operate in).
const EU27: Record<string, string> = {
  "040": "AT", "056": "BE", "100": "BG", "191": "HR", "196": "CY",
  "203": "CZ", "208": "DK", "233": "EE", "246": "FI", "250": "FR",
  "276": "DE", "300": "GR", "348": "HU", "372": "IE", "380": "IT",
  "428": "LV", "440": "LT", "442": "LU", "470": "MT", "528": "NL",
  "616": "PL", "620": "PT", "642": "RO", "703": "SK", "705": "SI",
  "724": "ES", "752": "SE",
};

// Everything else that shares the continent. Drawn dimmer and not clickable,
// but hazards inside them are still plotted — a fire in Ukraine or a quake in
// Turkey matters to a household in Poland or Greece.
const NEIGHBOURS: Record<string, string> = {
  "826": "GB", "578": "NO", "756": "CH", "352": "IS", "804": "UA",
  "688": "RS", "070": "BA", "008": "AL", "807": "MK", "499": "ME",
  "498": "MD", "112": "BY", "792": "TR", "643": "RU", "438": "LI",
  "020": "AD", "492": "MC", "674": "SM", "336": "VA", "292": "GI",
  "031": "AZ", "051": "AM", "268": "GE", "012": "DZ", "504": "MA",
  "788": "TN", "434": "LY", "818": "EG", "760": "SY", "422": "LB",
  "376": "IL", "400": "JO", "368": "IQ", "398": "KZ",
  "234": "FO", "833": "IM", "832": "JE", "831": "GG",
};

// Kosovo carries no stable numeric id in Natural Earth — match on name.
const BY_NAME: Record<string, string> = { Kosovo: "XK" };

export const EU27_ISO2 = Object.values(EU27);

// Continental frame. Polygons are properly clipped to this box (not merely
// dropped) so Russia, Kazakhstan and North Africa terminate at the edge
// instead of dragging the projection halfway round the world.
const LON_MIN = -26, LON_MAX = 46, LAT_MIN = 32, LAT_MAX = 72;

type Pt = [number, number];
type Box = { w: number; e: number; s: number; n: number };

const DRAW_BOX: Box = { w: LON_MIN, e: LON_MAX, s: LAT_MIN, n: LAT_MAX };

// Box used ONLY to fit the projection. It spans the whole drawn continent so
// the composition fills the canvas, but excludes the Atlantic outliers
// (Madeira, the Azores) that would otherwise drag the frame west and leave a
// quarter of the canvas as empty ocean. Iceland sits in the NW margin.
const FIT_BOX: Box = { w: -13, e: 45, s: 33, n: 71 };

/* Sutherland–Hodgman clip of a ring against an axis-aligned lon/lat box. */
function clipRing(ring: Pt[], b: Box): Pt[] {
  const edges: { keep: (p: Pt) => boolean; cut: (a: Pt, b: Pt) => Pt }[] = [
    {
      keep: (p) => p[0] >= b.w,
      cut: (p, q) => [b.w, p[1] + ((q[1] - p[1]) * (b.w - p[0])) / (q[0] - p[0])],
    },
    {
      keep: (p) => p[0] <= b.e,
      cut: (p, q) => [b.e, p[1] + ((q[1] - p[1]) * (b.e - p[0])) / (q[0] - p[0])],
    },
    {
      keep: (p) => p[1] >= b.s,
      cut: (p, q) => [p[0] + ((q[0] - p[0]) * (b.s - p[1])) / (q[1] - p[1]), b.s],
    },
    {
      keep: (p) => p[1] <= b.n,
      cut: (p, q) => [p[0] + ((q[0] - p[0]) * (b.n - p[1])) / (q[1] - p[1]), b.n],
    },
  ];
  let out = ring;
  for (const e of edges) {
    const input = out;
    out = [];
    if (!input.length) break;
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const curIn = e.keep(cur);
      const prevIn = e.keep(prev);
      if (curIn) {
        if (!prevIn) out.push(e.cut(prev, cur));
        out.push(cur);
      } else if (prevIn) {
        out.push(e.cut(prev, cur));
      }
    }
  }
  return out;
}

/* A ring whose own extent misses the box is discarded before clipping.
   Without this, Russia's Siberian and trans-antimeridian rings survive as
   degenerate slivers and blow the conic projection's bounds to ~2e8, which
   silently collapses fitExtent to a single point. */
function ringIntersects(ring: Pt[], b: Box): boolean {
  let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < w) w = lon;
    if (lon > e) e = lon;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  // Rings spanning more than half the globe in longitude are antimeridian
  // artefacts, never a country's European extent.
  if (e - w > 180) return false;
  return w <= b.e && e >= b.w && s <= b.n && n >= b.s;
}

function clipGeometry(geom: any, box: Box = DRAW_BOX): any | null {
  if (!geom) return null;
  const clipPoly = (poly: Pt[][]): Pt[][] | null => {
    const rings = poly
      .filter((r) => ringIntersects(r, box))
      .map((r) => clipRing(r, box))
      .filter((r) => r.length >= 3);
    return rings.length ? rings : null;
  };
  if (geom.type === "Polygon") {
    const p = clipPoly(geom.coordinates as Pt[][]);
    return p ? { type: "Polygon", coordinates: p } : null;
  }
  if (geom.type === "MultiPolygon") {
    const polys = (geom.coordinates as Pt[][][]).map(clipPoly).filter(Boolean) as Pt[][][];
    if (!polys.length) return null;
    return { type: "MultiPolygon", coordinates: polys };
  }
  return null;
}

export type MapCountry = {
  iso2: string;
  name: string;
  d: string;
  labelX: number;
  labelY: number;
  area: number;
  eu: boolean;
  /** Projected bounding box [x, y, w, h] — what the client zooms to. */
  bbox: [number, number, number, number];
};

export type EuroMapData = {
  width: number;
  height: number;
  countries: MapCountry[]; // neighbours first, EU-27 last (paint order)
};

export const EURO_MAP_WIDTH = 1180;
export const EURO_MAP_HEIGHT = 760;

type Built = { iso2: string; name: string; eu: boolean; clipped: any; raw: any };

let builtCache: Built[] | null = null;

function buildFeatures(): Built[] {
  if (builtCache) return builtCache;
  const all = feature(world, world.objects.countries).features;
  const out: Built[] = [];
  for (const f of all) {
    const id = String(f.id).padStart(3, "0");
    const name = ((f.properties as any)?.name as string) || "";
    const iso2 = EU27[id] || NEIGHBOURS[id] || BY_NAME[name];
    if (!iso2) continue;
    const clipped = clipGeometry(f.geometry);
    if (!clipped) continue;
    out.push({ iso2, name: name || iso2, eu: Boolean(EU27[id]), clipped, raw: f.geometry });
  }
  builtCache = out;
  return out;
}

function projection() {
  const feats = buildFeatures();
  // Fit to the EU-27 plus the near neighbours that define the visual frame,
  // so the continent is centred rather than dragged toward the Sahara.
  // Fit against everything that will actually be drawn, clipped to FIT_BOX, so
  // the continent fills the canvas rather than sitting in one corner.
  const collection = {
    type: "FeatureCollection" as const,
    features: feats
      .map((f) => ({ type: "Feature" as const, properties: {}, geometry: clipGeometry(f.raw, FIT_BOX) }))
      .filter((f) => f.geometry),
  };
  return geoConicConformal()
    .rotate([-15, 0])
    .center([0, 52])
    .parallels([40, 65])
    .fitExtent(
      [
        [18, 18],
        [EURO_MAP_WIDTH - 18, EURO_MAP_HEIGHT - 18],
      ],
      collection as any
    );
}

let projCache: ReturnType<typeof projection> | null = null;
function proj() {
  if (!projCache) projCache = projection();
  return projCache;
}

let mapCache: EuroMapData | null = null;

export function getEuroMapData(): EuroMapData {
  if (mapCache) return mapCache;
  const feats = buildFeatures();
  const path = geoPath(proj());
  const countries: MapCountry[] = feats.map((f) => {
    const geo = { type: "Feature" as const, properties: {}, geometry: f.clipped };
    const [labelX, labelY] = path.centroid(geo as any);
    const b = path.bounds(geo as any);
    const ok = b.every((pair) => pair.every((n) => Number.isFinite(n)));
    const r1 = (n: number) => Math.round(n * 10) / 10;
    return {
      iso2: f.iso2,
      name: f.name,
      d: path(geo as any) || "",
      labelX: Number.isFinite(labelX) ? r1(labelX) : -999,
      labelY: Number.isFinite(labelY) ? r1(labelY) : -999,
      area: Math.round(path.area(geo as any)),
      eu: f.eu,
      bbox: ok
        ? [r1(b[0][0]), r1(b[0][1]), r1(b[1][0] - b[0][0]), r1(b[1][1] - b[0][1])]
        : [0, 0, EURO_MAP_WIDTH, EURO_MAP_HEIGHT],
    };
  });
  countries.sort((a, b) => Number(a.eu) - Number(b.eu)); // neighbours painted first
  mapCache = { width: EURO_MAP_WIDTH, height: EURO_MAP_HEIGHT, countries };
  return mapCache;
}

/* Server-side point projection. Returns null if the point falls outside the
   drawn frame, so off-map events are listed but never plotted at a lie. */
export function projectLonLat(lon: number, lat: number): { x: number; y: number } | null {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lon < LON_MIN || lon > LON_MAX || lat < LAT_MIN || lat > LAT_MAX) return null;
  const p = proj()([lon, lat]);
  if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
  const [x, y] = p;
  if (x < 0 || y < 0 || x > EURO_MAP_WIDTH || y > EURO_MAP_HEIGHT) return null;
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

/* Attribute a hazard to a country using the UNCLIPPED geometry.
   Coastal and estuary points routinely fall a few km outside a 50m-resolution
   coastline (Lisbon on the Tagus, Istanbul on the Bosphorus), so an exact miss
   is retried against a small ring of offsets before giving up. Offshore events
   correctly stay unattributed. */
export function countryOf(lon: number, lat: number): string | null {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const feats = buildFeatures();
  const hit = (x: number, y: number): string | null => {
    for (const f of feats) {
      if (geoContains({ type: "Feature", properties: {}, geometry: f.raw } as any, [x, y])) {
        return f.iso2;
      }
    }
    return null;
  };
  const exact = hit(lon, lat);
  if (exact) return exact;
  for (const r of [0.08, 0.2]) {
    for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) {
      const near = hit(lon + dx, lat + dy);
      if (near) return near;
    }
  }
  return null;
}

export function isEu(iso2: string | null): boolean {
  return Boolean(iso2 && (EU27_ISO2 as string[]).includes(iso2));
}

/* Representative lon/lat for a country — used to place country-level readings
   (grid stress, transport disruption) that have no point geometry of their own. */
export function countryPointLonLat(iso2: string): [number, number] | null {
  const f = buildFeatures().find((x) => x.iso2 === iso2);
  if (!f) return null;
  const c = geoCentroid({ type: "Feature", properties: {}, geometry: f.clipped } as any);
  return Number.isFinite(c[0]) && Number.isFinite(c[1]) ? [c[0], c[1]] : null;
}
