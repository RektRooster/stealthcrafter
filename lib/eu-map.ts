// EU-27 map geometry, generated server-side from the world-atlas 50m dataset.
// Never import this into client components — pass the computed paths as props.
import { geoConicConformal, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
// world-atlas ships plain JSON.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const world = require("world-atlas/countries-50m.json") as Topology<{
  countries: GeometryCollection<{ name: string }>;
}>;

// Numeric ISO 3166-1 ids (world-atlas feature ids) -> ISO2 for the EU-27.
const EU27_BY_NUMERIC: Record<string, string> = {
  "040": "AT", "056": "BE", "100": "BG", "191": "HR", "196": "CY",
  "203": "CZ", "208": "DK", "233": "EE", "246": "FI", "250": "FR",
  "276": "DE", "300": "GR", "348": "HU", "372": "IE", "380": "IT",
  "428": "LV", "440": "LT", "442": "LU", "470": "MT", "528": "NL",
  "616": "PL", "620": "PT", "642": "RO", "703": "SK", "705": "SI",
  "724": "ES", "752": "SE",
};

export const EU27_ISO2 = Object.values(EU27_BY_NUMERIC);

// Mainland-Europe frame. Rings whose first point falls outside this box are
// overseas territories (Canary Islands, French Guiana, Azores, Réunion, …)
// and are dropped so the projection stays on Europe — per the mockup.
const LON_MIN = -11, LON_MAX = 35, LAT_MIN = 34, LAT_MAX = 71;

type Ring = [number, number][];
type PolyCoords = Ring[];

function ringInFrame(ring: Ring): boolean {
  const [lon, lat] = ring[0] || [0, 0];
  return lon >= LON_MIN && lon <= LON_MAX && lat >= LAT_MIN && lat <= LAT_MAX;
}

function clipGeometry(geom: any): any | null {
  if (!geom) return null;
  if (geom.type === "Polygon") {
    return ringInFrame(geom.coordinates[0] as Ring) ? geom : null;
  }
  if (geom.type === "MultiPolygon") {
    const polys = (geom.coordinates as PolyCoords[]).filter((p) => ringInFrame(p[0]));
    if (!polys.length) return null;
    if (polys.length === 1) return { type: "Polygon", coordinates: polys[0] };
    return { type: "MultiPolygon", coordinates: polys };
  }
  return null;
}

export type EuCountryPath = {
  iso2: string;
  name: string;
  d: string;
  labelX: number;
  labelY: number;
  area: number; // projected px^2 — used to decide which countries get labels
};

export type EuMapData = {
  width: number;
  height: number;
  countries: EuCountryPath[];
};

export const EU_MAP_WIDTH = 960;
export const EU_MAP_HEIGHT = 880;

function buildEuFeatures() {
  const all = feature(world, world.objects.countries).features;
  const out: { iso2: string; name: string; geometry: any }[] = [];
  for (const f of all) {
    const iso2 = EU27_BY_NUMERIC[String(f.id).padStart(3, "0")];
    if (!iso2) continue;
    const clipped = clipGeometry(f.geometry);
    if (!clipped) continue;
    out.push({ iso2, name: (f.properties as any)?.name || iso2, geometry: clipped });
  }
  return out;
}

let cached: EuMapData | null = null;

export function getEuMapData(): EuMapData {
  if (cached) return cached;
  const feats = buildEuFeatures();
  const collection = {
    type: "FeatureCollection" as const,
    features: feats.map((f) => ({ type: "Feature" as const, properties: {}, geometry: f.geometry })),
  };
  const projection = geoConicConformal()
    .rotate([-15, 0])
    .center([0, 52])
    .parallels([40, 65])
    .fitExtent(
      [
        [16, 16],
        [EU_MAP_WIDTH - 16, EU_MAP_HEIGHT - 16],
      ],
      collection as any
    );
  const path = geoPath(projection);
  const countries: EuCountryPath[] = feats.map((f) => {
    const geo = { type: "Feature" as const, properties: {}, geometry: f.geometry };
    const [labelX, labelY] = path.centroid(geo as any);
    return {
      iso2: f.iso2,
      name: f.name,
      d: path(geo as any) || "",
      labelX: Math.round(labelX * 10) / 10,
      labelY: Math.round(labelY * 10) / 10,
      area: Math.round(path.area(geo as any)),
    };
  });
  cached = { width: EU_MAP_WIDTH, height: EU_MAP_HEIGHT, countries };
  return cached;
}

// Small single-country map (country profile page): same pipeline, one feature,
// fit to its own viewBox.
export type CountryMini = { d: string; width: number; height: number };

const miniCache: Record<string, CountryMini | null> = {};

export function getCountryMini(iso2: string, width = 420, height = 320): CountryMini | null {
  const key = `${iso2}:${width}x${height}`;
  if (key in miniCache) return miniCache[key];
  const f = buildEuFeatures().find((x) => x.iso2 === iso2);
  if (!f) {
    miniCache[key] = null;
    return null;
  }
  const geo = { type: "Feature" as const, properties: {}, geometry: f.geometry };
  const projection = geoConicConformal()
    .rotate([-15, 0])
    .center([0, 52])
    .parallels([40, 65])
    .fitExtent(
      [
        [14, 14],
        [width - 14, height - 14],
      ],
      geo as any
    );
  const path = geoPath(projection);
  const mini = { d: path(geo as any) || "", width, height };
  miniCache[key] = mini;
  return mini;
}
