// EFFIS / GWIS — Copernicus Emergency Management Service.
//
// Why EFFIS rather than national fire services: it is one harmonised European
// layer instead of 27 different national ones, and it separates two things a
// household needs to keep apart — an actual fire burning nearby, and an area
// where fire conditions are becoming unusually dangerous.
//
// EFFIS publishes hotspots through a MapServer WFS at /effis. Verified shape:
//   ?service=WFS&version=1.1.0&request=getfeature&typename=ms:modis.hs
//    &outputformat=geojson&maxfeatures=N
// Properties: id, acq_at, lon, lat, frp, confidence, satellite, gid_0, CLASS.
//
// IMPORTANT: the layer is the whole archive and comes back in id order, so an
// unfiltered request yields detections from years ago. Requests therefore
// carry an OGC date predicate, and anything older than the freshness window is
// discarded outright. If only archive rows come back we report the source as
// needing attention rather than showing historical fires as if they were
// burning now.
import { countryOf, projectLonLat } from "@/lib/euro-map";
import { PILLARS_BY_KIND, safeFetch } from "./types";
import type { HazardEvent, SourceStatus } from "./types";

const BASE = "https://maps.effis.emergency.copernicus.eu/effis";

const LAYERS = process.env.EFFIS_HOTSPOT_LAYER
  ? [process.env.EFFIS_HOTSPOT_LAYER]
  : ["ms:modis.hs", "ms:viirs.hs"];

const FRAME = { minlon: -26, maxlon: 46, minlat: 32, maxlat: 72 };
const WINDOW_DAYS = 3;
const MAX_AGE_DAYS = 14; // hard freshness guard

function sinceLiteral(days: number): string {
  const d = new Date(Date.now() - days * 864e5);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} 00:00:00`;
}

/* Date predicate ONLY.
   The first attempt also constrained lat/lon through <PropertyIsBetween> and
   returned zero features: those attributes come back as strings, so the
   comparison ran lexically ("9.5" > "46") and excluded almost all of Europe.
   The frame is therefore applied here, after parsing, where it is numeric. */
function buildFilter(): string {
  return (
    `<Filter><PropertyIsGreaterThan><PropertyName>acq_at</PropertyName>` +
    `<Literal>${sinceLiteral(WINDOW_DAYS)}</Literal></PropertyIsGreaterThan></Filter>`
  );
}

function inFrame(lon: number, lat: number): boolean {
  return lon >= FRAME.minlon && lon <= FRAME.maxlon && lat >= FRAME.minlat && lat <= FRAME.maxlat;
}

export async function fetchEffis(): Promise<{ events: HazardEvent[]; status: SourceStatus }> {
  const base: SourceStatus = {
    source: "EFFIS",
    label: "Wildfires",
    what: "One harmonised European wildfire layer — active-fire detections from the last 3 days, so a fire burning nearby is distinguishable from an area merely running hot.",
    state: "error",
    detail: "",
    fetchedAt: null,
    count: 0,
    attribution: "EFFIS / GWIS — Copernicus Emergency Management Service (European Commission, JRC)",
    href: "https://forest-fire.emergency.copernicus.eu/",
  };

  const notes: string[] = [];
  let sawStale = false;

  for (const layer of LAYERS) {
    const url =
      `${BASE}?service=WFS&version=1.1.0&request=getfeature` +
      `&typename=${encodeURIComponent(layer)}&outputformat=geojson&maxfeatures=4000` +
      `&filter=${encodeURIComponent(buildFilter())}`;

    const r = await safeFetch(url, { revalidate: 1800, timeoutMs: 14000 });
    if (!r.ok) {
      notes.push(`${layer}: ${r.detail}`);
      continue;
    }

    let json: any;
    try {
      const text = await r.res.text();
      if (/ServiceException|ows:Exception|^\s*<\?xml/i.test(text.slice(0, 400))) {
        notes.push(`${layer}: OGC exception rather than GeoJSON`);
        continue;
      }
      json = JSON.parse(text);
    } catch (e: any) {
      notes.push(`${layer}: ${e?.message || e}`);
      continue;
    }

    const feats: any[] = Array.isArray(json?.features) ? json.features : [];
    if (!feats.length) {
      notes.push(`${layer}: no detections in the window`);
      continue;
    }

    const cutoff = Date.now() - MAX_AGE_DAYS * 864e5;
    const fresh = feats.filter((f) => {
      const t = Date.parse(String(f?.properties?.acq_at || "").replace(" ", "T") + "Z");
      return Number.isFinite(t) && t >= cutoff;
    });

    if (!fresh.length) {
      sawStale = true;
      notes.push(`${layer}: date predicate ignored, archive rows only`);
      continue;
    }

    const mapped = mapHotspots(fresh);
    if (!mapped.length) {
      notes.push(`${layer}: ${fresh.length} recent detections worldwide, none inside the European frame`);
      continue;
    }
    const events = cluster(mapped);
    return {
      events,
      status: {
        ...base,
        state: events.length ? "live" : "empty",
        detail: events.length
          ? `${events.length} active-fire areas from EFFIS layer ${layer} (last ${WINDOW_DAYS} days).`
          : `EFFIS layer ${layer} answered but nothing fell inside the European frame.`,
        fetchedAt: new Date().toISOString(),
        count: events.length,
      },
    };
  }

  return {
    events: [],
    status: {
      ...base,
      state: "error",
      detail: sawStale
        ? `EFFIS answered but only with archive detections, so nothing is shown — historical fires must never appear as if they were burning now. Tried: ${LAYERS.join(", ")}. Pin the current layer with EFFIS_HOTSPOT_LAYER.`
        : `EFFIS active-fire layer did not answer. Tried: ${LAYERS.join(", ")}. ${notes.slice(-2).join(" | ")}`,
    },
  };
}

function mapHotspots(feats: any[]): HazardEvent[] {
  const out: HazardEvent[] = [];
  for (const f of feats) {
    const p = f?.properties || {};
    const c = f?.geometry?.coordinates;
    const lon = Number(Array.isArray(c) ? c[0] : p.lon);
    const lat = Number(Array.isArray(c) ? c[1] : p.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (!inFrame(lon, lat)) continue;

    const conf = Number(p.confidence);
    const frp = Number(p.frp); // fire radiative power, MW
    const at = String(p.acq_at || "").replace(" ", "T") + "Z";

    // Fire radiative power is the honest intensity proxy; low confidence caps it.
    let severity: HazardEvent["severity"] = "watch";
    if (Number.isFinite(frp)) {
      severity = frp >= 250 ? "severe" : frp >= 80 ? "elevated" : frp >= 15 ? "watch" : "info";
    }
    if (Number.isFinite(conf) && conf < 50 && severity !== "info") severity = "watch";

    const iso2 = countryOf(lon, lat);
    out.push({
      id: `EFFIS:${p.id ?? `${lat.toFixed(3)},${lon.toFixed(3)},${p.acq_at ?? ""}`}`,
      source: "EFFIS",
      kind: "wildfire",
      title: `Active fire detection${iso2 ? ` — ${iso2}` : ""}`,
      summary:
        `Satellite fire detection${Number.isFinite(frp) ? `, radiative power ${Math.round(frp)} MW` : ""}` +
        `${Number.isFinite(conf) ? `, ${Math.round(conf)}% confidence` : ""}. ` +
        `A detection is a thermal signature, not a confirmed incident — treat it as a prompt to check local emergency services.`,
      lat,
      lon,
      xy: projectLonLat(lon, lat),
      countryIso2: iso2,
      severity,
      magnitude: Number.isFinite(frp) ? Math.round(frp) : null,
      unit: Number.isFinite(frp) ? "MW" : null,
      at: Number.isFinite(Date.parse(at)) ? new Date(at).toISOString() : new Date().toISOString(),
      url: "https://forest-fire.emergency.copernicus.eu/apps/effis_current_situation/",
      pillars: PILLARS_BY_KIND.wildfire,
    });
  }
  return out;
}

/** Collapse detections within ~0.15° into their strongest member: one fire,
    one marker, rather than forty satellite pixels. */
function cluster(events: HazardEvent[]): HazardEvent[] {
  const CELL = 0.15;
  const byCell = new Map<string, HazardEvent[]>();
  for (const e of events) {
    const k = `${Math.round(e.lat / CELL)}:${Math.round(e.lon / CELL)}`;
    const arr = byCell.get(k);
    if (arr) arr.push(e);
    else byCell.set(k, [e]);
  }
  const out: HazardEvent[] = [];
  for (const group of byCell.values()) {
    group.sort((a, b) => (b.magnitude ?? 0) - (a.magnitude ?? 0));
    const lead = group[0];
    if (group.length > 1) {
      lead.title = `${group.length} fire detections${lead.countryIso2 ? ` — ${lead.countryIso2}` : ""}`;
      lead.summary = `Cluster of ${group.length} satellite detections in one area. ${lead.summary}`;
    }
    out.push(lead);
  }
  return out.sort((a, b) => (b.magnitude ?? 0) - (a.magnitude ?? 0)).slice(0, 200);
}
