// EMSC — European-Mediterranean Seismological Centre.
// FDSN event web service at seismicportal.eu. Open, no key.
//
// The point is not "draw dots". It is to sort a seismic event into
// informational / potentially disruptive / worth acting on, using magnitude,
// depth and where it actually happened.
import { countryOf, projectLonLat } from "@/lib/euro-map";
import { PILLARS_BY_KIND, safeFetch, severityFromMagnitude } from "./types";
import { SEVERITY_RANK } from "./types";
import type { HazardEvent, Severity, SourceStatus } from "./types";

const BASE = "https://www.seismicportal.eu/fdsnws/event/1/query";

// Euro-Med window, matched to the drawn frame plus a margin.
const BBOX = { minlat: 30, maxlat: 73, minlon: -30, maxlon: 50 };

export async function fetchEmsc(): Promise<{ events: HazardEvent[]; status: SourceStatus }> {
  const start = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 19);
  const url =
    `${BASE}?format=json&limit=400&minmag=2.5&start=${start}` +
    `&minlat=${BBOX.minlat}&maxlat=${BBOX.maxlat}&minlon=${BBOX.minlon}&maxlon=${BBOX.maxlon}` +
    `&orderby=time`;

  const base: SourceStatus = {
    source: "EMSC",
    label: "Earthquakes",
    what: "European-Mediterranean seismicity — magnitude, depth and location, last 7 days (M2.5+).",
    state: "error",
    detail: "",
    fetchedAt: null,
    count: 0,
    attribution: "EMSC — European-Mediterranean Seismological Centre (FDSN event service)",
    href: "https://www.seismicportal.eu/",
  };

  const r = await safeFetch(url, { revalidate: 600 });
  if (!r.ok) return { events: [], status: { ...base, detail: `EMSC unreachable — ${r.detail}.` } };

  let json: any;
  try {
    json = await r.res.json();
  } catch (e: any) {
    return { events: [], status: { ...base, detail: `EMSC returned unparseable JSON — ${e?.message || e}.` } };
  }

  const feats: any[] = Array.isArray(json?.features) ? json.features : [];
  const events: HazardEvent[] = [];
  for (const f of feats) {
    const p = f?.properties || {};
    const coords = Array.isArray(f?.geometry?.coordinates) ? f.geometry.coordinates : null;
    const lon = Number(coords ? coords[0] : p.lon);
    const lat = Number(coords ? coords[1] : p.lat);
    const mag = Number(p.mag);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(mag)) continue;
    const depth = Number(p.depth);
    const id = String(p.unid || p.source_id || `${lat},${lon},${p.time}`);
    const region = String(p.flynn_region || "").trim() || "Europe / Mediterranean";
    const at = p.time ? new Date(p.time).toISOString() : new Date().toISOString();

    const iso2 = countryOf(lon, lat);

    // Magnitude alone is not the question a household is asking. A shallow
    // quake shakes far harder than a deep one of the same size, and a mid-
    // ocean event of any size is not something anyone should act on. So:
    // promote shallow onshore events one step, demote unattributed offshore
    // events one step.
    let severity = severityFromMagnitude(mag, [4.0, 5.0, 6.0]);
    const shallow = Number.isFinite(depth) && depth <= 20;
    if (shallow && mag >= 4.5 && iso2) severity = bump(severity, 1);
    if (!iso2) severity = bump(severity, -1);

    events.push({
      id: `EMSC:${id}`,
      source: "EMSC",
      kind: "earthquake",
      title: `M${mag.toFixed(1)} — ${titleCase(region)}`,
      summary:
        `Magnitude ${mag.toFixed(1)}` +
        (Number.isFinite(depth) ? ` at ${Math.round(depth)} km depth` : "") +
        `, ${titleCase(region)}.` +
        (!iso2
          ? " Offshore — recorded for completeness, no household action implied."
          : severity === "info"
          ? " Below the level that is normally felt indoors."
          : severity === "watch"
          ? " Widely felt locally; damage unlikely."
          : severity === "elevated"
          ? " Strong enough to disrupt power and water locally."
          : " Large enough to cause structural damage and sustained disruption."),
      lat,
      lon,
      xy: projectLonLat(lon, lat),
      countryIso2: iso2,
      severity,
      magnitude: mag,
      unit: "M",
      at,
      url: p.unid ? `https://www.emsc-csem.org/Earthquake_information/earthquake.php?id=${p.unid}` : null,
      pillars: PILLARS_BY_KIND.earthquake,
    });
  }

  return {
    events,
    status: {
      ...base,
      state: events.length ? "live" : "empty",
      detail: events.length
        ? `${events.length} events in the last 7 days.`
        : "Connected, but no M2.5+ events in the window.",
      fetchedAt: new Date().toISOString(),
      count: events.length,
    },
  };
}

const ORDER: Severity[] = ["info", "watch", "elevated", "severe"];
function bump(s: Severity, by: number): Severity {
  return ORDER[Math.max(0, Math.min(ORDER.length - 1, SEVERITY_RANK[s] + by))];
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/([\s,\-/]+)/)
    .map((w) => (/^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w))
    .join("");
}
