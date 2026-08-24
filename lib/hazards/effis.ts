// EFFIS — Copernicus Emergency Management Service, European Forest Fire
// Information System.
//
// Why EFFIS rather than 27 national fire services: one harmonised European
// layer, one definition of a fire, one set of units.
//
// WHICH EFFIS LAYER, AND WHY. The obvious choice looks like the hotspot
// layers — all.hs, modis.hs, viirs.hs, noaa.hs. Every one of them is a frozen
// archive: the newest detections they return are from 2019-2021, and a
// date-filtered request for the last three days comes back empty from all
// four. Shipping those would have put fires from years ago on a map headed
// "right now".
//
// The service's GetCapabilities lists pre-scoped burnt-area layers instead —
// modis.ba.poly.today / .week / .month / .season — and those are live and
// fast: .week answers in ~350ms with fires updated this morning. It is also
// the better signal: a confirmed burn with a measured size in hectares, a
// country, a province and start/end timestamps, rather than an unverified
// thermal pixel. No OGC filter is needed because the layer is already scoped.
//
// Verified request shape:
//   /effis?service=WFS&version=1.1.0&request=getfeature
//         &typename=ms:modis.ba.poly.week&outputformat=geojson&maxfeatures=N
// Properties: FIREDATE, FINALDATE, LASTUPDATE, COUNTRY (ISO2), PROVINCE,
//             COMMUNE, AREA_HA, plus a land-cover breakdown.
import { countryOf, projectLonLat } from "@/lib/euro-map";
import { PILLARS_BY_KIND, safeFetch } from "./types";
import type { HazardEvent, Severity, SourceStatus } from "./types";

const BASE = "https://maps.effis.emergency.copernicus.eu/effis";
const LAYER = process.env.EFFIS_BA_LAYER || "ms:modis.ba.poly.week";

const FRAME = { minlon: -26, maxlon: 46, minlat: 32, maxlat: 72 };
const WINDOW_DAYS = 7; // the layer is already scoped to the week
const MAX_AGE_DAYS = 30; // hard freshness guard — nothing older ever renders

export async function fetchEffis(): Promise<{ events: HazardEvent[]; status: SourceStatus }> {
  const base: SourceStatus = {
    source: "EFFIS",
    label: "Wildfires",
    what: `One harmonised European wildfire layer — confirmed burnt areas with a measured size, last ${WINDOW_DAYS} days.`,
    state: "error",
    detail: "",
    fetchedAt: null,
    count: 0,
    attribution: "EFFIS — Copernicus Emergency Management Service (European Commission, JRC)",
    href: "https://forest-fire.emergency.copernicus.eu/",
  };

  const url =
    `${BASE}?service=WFS&version=1.1.0&request=getfeature` +
    `&typename=${encodeURIComponent(LAYER)}&outputformat=geojson&maxfeatures=1500`;

  const r = await safeFetch(url, { revalidate: 1800, timeoutMs: 14000 });
  if (!r.ok) {
    return { events: [], status: { ...base, detail: `EFFIS unreachable — ${r.detail}.` } };
  }

  let json: any;
  try {
    const text = await r.res.text();
    if (/ServiceException|ows:Exception|^\s*<\?xml/i.test(text.slice(0, 400))) {
      return {
        events: [],
        status: { ...base, detail: `EFFIS returned an OGC exception for layer ${LAYER}.` },
      };
    }
    json = JSON.parse(text);
  } catch (e: any) {
    return { events: [], status: { ...base, detail: `EFFIS response unparseable — ${e?.message || e}.` } };
  }

  const feats: any[] = Array.isArray(json?.features) ? json.features : [];
  const cutoff = Date.now() - MAX_AGE_DAYS * 864e5;
  const events: HazardEvent[] = [];

  for (const f of feats) {
    const p = f?.properties || {};
    const started = parseStamp(p.FIREDATE);
    if (!started || started.getTime() < cutoff) continue;

    const c = centroid(f?.geometry);
    if (!c) continue;
    const [lon, lat] = c;
    if (lon < FRAME.minlon || lon > FRAME.maxlon || lat < FRAME.minlat || lat > FRAME.maxlat) continue;

    const ha = Number(p.AREA_HA);
    const ended = parseStamp(p.FINALDATE);
    // Still burning if the last observation is recent; otherwise it is a burn
    // scar, which matters for erosion, water quality and re-ignition risk.
    const ongoing = !ended || Date.now() - ended.getTime() < 36 * 3600e3;

    let severity: Severity = "info";
    if (Number.isFinite(ha)) {
      severity = ha >= 2000 ? "severe" : ha >= 500 ? "elevated" : ha >= 100 ? "watch" : "info";
    }
    // EFFIS maps burnt area; it does not say whether a fire is still burning.
    // A fire first recorded more than three days ago is very likely being
    // managed or already out, so it is stepped down rather than sitting at the
    // top of the page as something to act on today.
    const stale = Date.now() - started.getTime() > 72 * 3600e3;
    if ((!ongoing || stale) && severity !== "info") severity = down(severity);

    const iso2 = clean(String(p.COUNTRY || "")).toUpperCase() || countryOf(lon, lat) || null;
    const place = [clean(String(p.COMMUNE || "")), clean(String(p.PROVINCE || ""))]
      .filter((x) => x && x !== "N.A.")
      .join(", ");

    events.push({
      id: `EFFIS:${p.id ?? `${lat.toFixed(3)},${lon.toFixed(3)},${p.FIREDATE ?? ""}`}`,
      source: "EFFIS",
      kind: "wildfire",
      title:
        `${Number.isFinite(ha) ? `${Math.round(ha).toLocaleString("en-GB")} ha ` : ""}` +
        `${ongoing ? "wildfire" : "burnt area"}${place ? ` — ${place}` : iso2 ? ` — ${iso2}` : ""}`,
      summary:
        (ongoing
          ? `Fire recorded from ${fmt(started)}${ended ? `, last observed ${fmt(ended)}` : ""}. `
          : `Fire burned ${fmt(started)}${ended ? ` to ${fmt(ended)}` : ""} and is no longer being observed. `) +
        (Number.isFinite(ha) ? `Burnt area ${Math.round(ha).toLocaleString("en-GB")} hectares. ` : "") +
        `Mapped by EFFIS from satellite imagery — check local emergency services for the live position of any fire near you.`,
      lat,
      lon,
      xy: projectLonLat(lon, lat),
      countryIso2: iso2 && /^[A-Z]{2}$/.test(iso2) ? iso2 : countryOf(lon, lat),
      severity,
      magnitude: Number.isFinite(ha) ? Math.round(ha) : null,
      unit: Number.isFinite(ha) ? "ha" : null,
      at: started.toISOString(),
      url: "https://forest-fire.emergency.copernicus.eu/apps/effis_current_situation/",
      pillars: PILLARS_BY_KIND.wildfire,
    });
  }

  events.sort((a, b) => (b.magnitude ?? 0) - (a.magnitude ?? 0));
  const CAP = 200;
  const top = events.slice(0, CAP);
  const trimmed = Math.max(0, events.length - CAP);

  return {
    events: top,
    status: {
      ...base,
      state: top.length ? "live" : feats.length ? "empty" : "empty",
      detail: top.length
        ? `${top.length} fires mapped across Europe in the last ${WINDOW_DAYS} days` +
          (trimmed ? `, largest first — ${trimmed} smaller fires not shown` : "") +
          ` (layer ${LAYER}).`
        : `Connected to ${LAYER}, but no European fires recorded in the last ${WINDOW_DAYS} days.`,
      fetchedAt: new Date().toISOString(),
      count: top.length,
    },
  };
}

/* ---------------- helpers ---------------- */

function parseStamp(v: any): Date | null {
  if (!v) return null;
  const d = new Date(String(v).replace(" ", "T") + "Z");
  return isNaN(d.getTime()) ? null : d;
}

function fmt(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function down(s: Severity): Severity {
  return s === "severe" ? "elevated" : s === "elevated" ? "watch" : "info";
}

/* MapServer does not always declare a charset, so some non-Latin place names
   arrive mis-decoded. A garbled name is worse than no name: drop the field
   entirely rather than printing mojibake at a reader. */
function clean(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (!t || t === "N.A.") return "";
  if (/[\uFFFD]/.test(t)) return "";
  return t;
}

/* Area-weighted centroid of a (Multi)Polygon, good enough to place a marker. */
function centroid(geom: any): [number, number] | null {
  if (!geom) return null;
  const polys: any[] =
    geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
  let sx = 0, sy = 0, n = 0;
  for (const poly of polys) {
    const ring = poly?.[0];
    if (!Array.isArray(ring)) continue;
    for (const pt of ring) {
      const x = Number(pt?.[0]), y = Number(pt?.[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      sx += x; sy += y; n++;
    }
  }
  if (!n) return null;
  return [sx / n, sy / n];
}
