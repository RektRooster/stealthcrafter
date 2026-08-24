// EFFIS / GWIS — Copernicus Emergency Management Service.
//
// Why EFFIS rather than national fire services: it is one harmonised European
// layer instead of 27 different national ones, and it separates two things a
// household needs to keep apart — an actual fire burning nearby, and an area
// where fire conditions are becoming unusually dangerous.
//
// EFFIS publishes active-fire hotspots through its OGC WFS. The public layer
// name has moved between service generations, so we try the known names in
// order and report which one answered. EFFIS_HOTSPOT_LAYER overrides the list.
import { countryOf, projectLonLat } from "@/lib/euro-map";
import { PILLARS_BY_KIND, safeFetch } from "./types";
import type { HazardEvent, SourceStatus } from "./types";

const WFS = "https://maps.effis.emergency.copernicus.eu/gwis";

const CANDIDATE_LAYERS = ["ms:modis.hs", "ms:viirs.hs", "modis.hs", "viirs.hs"];

// Continental frame (minlon,minlat,maxlon,maxlat) in EPSG:4326.
const BBOX = "-26,32,46,72";

export async function fetchEffis(): Promise<{ events: HazardEvent[]; status: SourceStatus }> {
  const base: SourceStatus = {
    source: "EFFIS",
    label: "Wildfires",
    what: "One harmonised European wildfire layer — active-fire detections, so a fire burning nearby is distinguishable from an area merely running hot.",
    state: "error",
    detail: "",
    fetchedAt: null,
    count: 0,
    attribution: "EFFIS / GWIS — Copernicus Emergency Management Service (European Commission, JRC)",
    href: "https://forest-fire.emergency.copernicus.eu/",
  };

  const layers = process.env.EFFIS_HOTSPOT_LAYER
    ? [process.env.EFFIS_HOTSPOT_LAYER]
    : CANDIDATE_LAYERS;

  const failures: string[] = [];

  for (const layer of layers) {
    const url =
      `${WFS}?service=WFS&version=2.0.0&request=GetFeature` +
      `&typeName=${encodeURIComponent(layer)}` +
      `&outputFormat=${encodeURIComponent("application/json")}` +
      `&srsName=EPSG:4326&count=600&bbox=${encodeURIComponent(BBOX + ",EPSG:4326")}`;

    const r = await safeFetch(url, { revalidate: 1800, timeoutMs: 12000 });
    if (!r.ok) {
      failures.push(`${layer}: ${r.detail}`);
      continue;
    }

    let json: any;
    try {
      const text = await r.res.text();
      if (/ServiceException|ows:Exception|<\?xml/i.test(text.slice(0, 400))) {
        failures.push(`${layer}: service returned an OGC exception, not GeoJSON`);
        continue;
      }
      json = JSON.parse(text);
    } catch (e: any) {
      failures.push(`${layer}: ${e?.message || e}`);
      continue;
    }

    const feats: any[] = Array.isArray(json?.features) ? json.features : [];
    if (!feats.length) {
      failures.push(`${layer}: reachable but returned no features`);
      continue;
    }

    const events = mapHotspots(feats, layer);
    return {
      events,
      status: {
        ...base,
        state: events.length ? "live" : "empty",
        detail: events.length
          ? `${events.length} active-fire detections from EFFIS layer ${layer}.`
          : `EFFIS layer ${layer} answered but no detections fell inside the frame.`,
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
      detail:
        `EFFIS active-fire layer did not answer. Tried: ${layers.join(", ")}. ` +
        `Last errors — ${failures.slice(-2).join(" | ")}. ` +
        `EFFIS moves its public WFS layer names between service generations; set EFFIS_HOTSPOT_LAYER to the current one to pin it.`,
    },
  };
}

function mapHotspots(feats: any[], layer: string): HazardEvent[] {
  const out: HazardEvent[] = [];
  for (const f of feats) {
    const p = f?.properties || {};
    const c = f?.geometry?.coordinates;
    const lon = Number(Array.isArray(c) ? c[0] : p.longitude ?? p.lon ?? p.x);
    const lat = Number(Array.isArray(c) ? c[1] : p.latitude ?? p.lat ?? p.y);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;

    // EFFIS hotspot attributes vary by layer generation — read defensively.
    const conf = Number(p.confidence ?? p.conf ?? NaN);
    const frp = Number(p.frp ?? p.FRP ?? NaN); // fire radiative power (MW)
    const place = String(p.place ?? p.province ?? p.commune ?? p.country ?? "").trim();
    const when = p.acq_date
      ? `${p.acq_date}T${String(p.acq_time ?? "0000").padStart(4, "0").replace(/(\d{2})(\d{2})/, "$1:$2")}:00Z`
      : p.date || p.datetime || null;

    // Fire radiative power is the honest intensity proxy; confidence gates it.
    let severity: HazardEvent["severity"] = "watch";
    if (Number.isFinite(frp)) {
      severity = frp >= 200 ? "severe" : frp >= 50 ? "elevated" : frp >= 10 ? "watch" : "info";
    }
    if (Number.isFinite(conf) && conf < 50 && severity !== "info") severity = "watch";

    const iso2 = countryOf(lon, lat);
    out.push({
      id: `EFFIS:${p.id ?? p.gid ?? p.fid ?? `${lat.toFixed(3)},${lon.toFixed(3)},${when ?? ""}`}`,
      source: "EFFIS",
      kind: "wildfire",
      title: `Active fire detection${place ? ` — ${place}` : iso2 ? ` — ${iso2}` : ""}`,
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
      at: parseWhen(when),
      url: "https://forest-fire.emergency.copernicus.eu/apps/effis_current_situation/",
      pillars: PILLARS_BY_KIND.wildfire,
    });
  }
  // EFFIS returns raw satellite pixels; cluster tight groups so one large fire
  // is one marker rather than forty.
  return cluster(out);
}

/** Collapse detections within ~0.15° of each other into their strongest member. */
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
      lead.title = `${group.length} active fire detections${lead.countryIso2 ? ` — ${lead.countryIso2}` : ""}`;
      lead.summary = `Cluster of ${group.length} satellite fire detections in one area. ${lead.summary}`;
    }
    out.push(lead);
  }
  return out.sort((a, b) => (b.magnitude ?? 0) - (a.magnitude ?? 0)).slice(0, 250);
}

function parseWhen(v: any): string {
  if (!v) return new Date().toISOString();
  const d = new Date(v);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
