// Country outlines in raw lon/lat, for the MapLibre satellite basemap.
//
// This is deliberately NOT lib/euro-map.ts. That module projects the 50m
// dataset into SVG path strings on the server — the right tool when we were
// drawing the continent ourselves. Here the imagery IS the map, and the
// outlines are a thin interaction layer: something to hover, click and fly to.
// So we ship the 110m dataset (a tenth of the weight), unprojected, because
// MapLibre does the projection on the GPU.
//
// Server-only: it requires the topology. The FeatureCollection it returns is
// plain JSON and crosses to the client as a prop.
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import { BY_NAME_IDS, EU27_IDS, NEIGHBOUR_IDS, countryName } from "./iso-ids";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const world = require("world-atlas/countries-110m.json") as Topology<{
  countries: GeometryCollection<{ name: string }>;
}>;

/** The frame we care about. Rings entirely outside it are dropped whole —
    we are not clipping here, because MapLibre handles off-screen geometry
    itself and a clipped ring would draw a false border down the edge of
    Russia. Dropping by ring keeps Siberia out without inventing coastline. */
const BOX = { w: -32, e: 62, s: 26, n: 75 };

export type CountryBounds = [number, number, number, number]; // [w, s, e, n]

export type EuroGeo = {
  fc: GeoJSON.FeatureCollection;
  /** Fly-to target per country, in lon/lat. */
  bounds: Record<string, CountryBounds>;
};

type Pt = [number, number];

function ringInBox(ring: Pt[]): boolean {
  let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < w) w = lon;
    if (lon > e) e = lon;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  // A ring spanning more than half the globe in longitude is an antimeridian
  // artefact, never a country's European extent. Same guard as euro-map.ts —
  // it cost a day the first time it was missing.
  if (e - w > 180) return false;
  return w <= BOX.e && e >= BOX.w && s <= BOX.n && n >= BOX.s;
}

/** Round to 3 decimals — ~100 m, far finer than a 110m dataset resolves,
    and it takes roughly a third off the wire. */
function r3(ring: Pt[]): Pt[] {
  return ring.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);
}

function trim(geom: any): any | null {
  const keep = (poly: Pt[][]): Pt[][] | null => {
    // The outer ring decides: if it misses the frame the holes are irrelevant.
    if (!poly.length || !ringInBox(poly[0])) return null;
    return poly.map(r3);
  };
  if (geom?.type === "Polygon") {
    const p = keep(geom.coordinates as Pt[][]);
    return p ? { type: "Polygon", coordinates: p } : null;
  }
  if (geom?.type === "MultiPolygon") {
    const polys = (geom.coordinates as Pt[][][]).map(keep).filter(Boolean) as Pt[][][];
    return polys.length ? { type: "MultiPolygon", coordinates: polys } : null;
  }
  return null;
}

/** Bounds of the parts that are actually inside the frame. Using the whole
    country would fly the camera to the middle of Siberia for Russia and to
    the Sahara for Algeria. */
function boundsOf(geom: any): CountryBounds | null {
  let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
  const scan = (ring: Pt[]) => {
    for (const [lon, lat] of ring) {
      if (lon < BOX.w || lon > BOX.e || lat < BOX.s || lat > BOX.n) continue;
      if (lon < w) w = lon;
      if (lon > e) e = lon;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
    }
  };
  const polys: Pt[][][] = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) scan(poly[0]);
  if (!Number.isFinite(w) || e <= w || n <= s) return null;
  const r = (v: number) => Math.round(v * 100) / 100;
  return [r(w), r(s), r(e), r(n)];
}

let cache: EuroGeo | null = null;

export function getEuroGeo(): EuroGeo {
  if (cache) return cache;
  const all = feature(world, world.objects.countries).features;
  const features: GeoJSON.Feature[] = [];
  const bounds: Record<string, CountryBounds> = {};

  for (const f of all) {
    const id = String(f.id).padStart(3, "0");
    const neName = ((f.properties as any)?.name as string) || "";
    const iso2 = EU27_IDS[id] || NEIGHBOUR_IDS[id] || BY_NAME_IDS[neName];
    if (!iso2) continue;
    const geometry = trim(f.geometry);
    if (!geometry) continue;
    const b = boundsOf(geometry);
    if (b) bounds[iso2] = b;
    features.push({
      type: "Feature",
      // MapLibre needs a numeric or string id on the feature itself for
      // setFeatureState (hover and selection are drawn from feature state,
      // not from re-setting the whole source on every mouse move).
      id: iso2,
      properties: {
        iso2,
        name: countryName(iso2) || neName || iso2,
        eu: Boolean(EU27_IDS[id]),
      },
      geometry,
    });
  }

  cache = { fc: { type: "FeatureCollection", features }, bounds };
  return cache;
}
