// Road and logistics disruption.
//
// There is no single live European road feed, so this layer is a set of
// national adapters behind one interface. Two jobs: warn a household when
// severe weather, flooding, snow or an incident is affecting travel, and let
// the back office see when a corridor serving our warehouses or suppliers is
// disrupted.
//
// Adapter 1 (live, keyless): Germany's Autobahn open data — the busiest
// freight corridor set in the EU and the spine of most of our inbound routes.
// Further adapters (NDW for the Netherlands, Bison Futé for France, ANAS for
// Italy, DGT for Spain) attach to the same normaliser.
import { countryOf, projectLonLat } from "@/lib/euro-map";
import { PILLARS_BY_KIND, safeFetch } from "./types";
import type { HazardEvent, SourceStatus } from "./types";

const AUTOBAHN = "https://verkehr.autobahn.de/o/autobahn";

// Freight spine rather than all ~120 Autobahnen — keeps one render bounded.
const CORRIDORS = ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10", "A45", "A61", "A81"];

const PENDING = "Netherlands (NDW), France (Bison Futé), Italy (ANAS), Spain (DGT)";

// Scheduled construction, not an incident.
const PLANNED = /bauphase|bauarbeit|baustelle|bauma(ss|ß)nahme|gesamtma(ss|ß)nahme|sanierung|erneuerung/i;

/** "A3 | Manzing - Deggendorf" -> "Manzing and Deggendorf". */
function cleanSegment(raw: string): string {
  const s = raw.replace(/^[A-Z]?\d+\s*\|\s*/, "").trim();
  if (!s) return "";
  return s.replace(/\s*(->|-|–|—)\s*/g, " and ").slice(0, 80);
}

export async function fetchTransport(): Promise<{ events: HazardEvent[]; status: SourceStatus }> {
  const base: SourceStatus = {
    source: "TRANSPORT",
    label: "Roads & logistics",
    what: "Closures on the European freight corridors — travel disruption for households, and route risk for our own inbound supply.",
    state: "error",
    detail: "",
    fetchedAt: null,
    count: 0,
    attribution: "Autobahn GmbH des Bundes open data (Germany). Further national adapters pending.",
    href: "https://verkehr.autobahn.de/",
  };

  const events: HazardEvent[] = [];
  const failures: string[] = [];
  const queue = [...CORRIDORS];

  const workers = Array.from({ length: 5 }, async () => {
    for (;;) {
      const road = queue.shift();
      if (!road) return;
      // Closures only. Roadworks and minor warnings run to hundreds of rows
      // and would bury every other layer on the map for no household benefit.
      for (const feed of ["closure"] as const) {
        const r = await safeFetch(`${AUTOBAHN}/${road}/services/${feed}`, {
          revalidate: 900,
          timeoutMs: 8000,
        });
        if (!r.ok) {
          failures.push(`${road}/${feed}: ${r.detail}`);
          continue;
        }
        let json: any;
        try {
          json = await r.res.json();
        } catch {
          failures.push(`${road}/${feed}: unparseable`);
          continue;
        }
        const rows: any[] = json?.[feed] || json?.roadworks || [];
        for (const w of Array.isArray(rows) ? rows : []) {
          const lat = Number(w?.coordinate?.lat);
          const lon = Number(w?.coordinate?.long ?? w?.coordinate?.lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

          const title = String(w?.title || "").trim();
          const subtitle = String(w?.subtitle || "").trim();
          const body = Array.isArray(w?.description)
            ? w.description.filter(Boolean).join(" ").trim()
            : String(w?.description || "").trim();

          // The German feed is dominated by long-running construction phases.
          // A scheduled roadworks closure is not a hazard and must not sit on
          // a preparedness map next to earthquakes.
          if (PLANNED.test(body) || PLANNED.test(title) || PLANNED.test(subtitle)) continue;

          const where = cleanSegment(subtitle || title);
          out.push({
            id: `TRANSPORT:DE:${w?.identifier || `${road}:${lat},${lon}`}`,
            source: "TRANSPORT",
            kind: "transport",
            title: `${road} closed${where ? ` — ${where}` : ""}`,
            summary:
              `Unplanned closure reported on the ${road} in Germany` +
              (where ? ` between ${where}` : "") +
              `. Freight corridor: expect delays to deliveries routed through this section.`,
            lat,
            lon,
            xy: projectLonLat(lon, lat),
            countryIso2: countryOf(lon, lat) || "DE",
            // Deliberately capped at "worth knowing". A road closure is a
            // travel and logistics inconvenience, not a household emergency.
            severity: "watch",
            magnitude: null,
            unit: null,
            at: parseWhen(w?.startTimestamp),
            url: "https://verkehr.autobahn.de/",
            pillars: PILLARS_BY_KIND.transport,
          });
        }
      }
    }
  });
  await Promise.all(workers);

  const trimmed = dedupe(events).slice(0, 60);
  const allFailed = failures.length >= CORRIDORS.length;

  return {
    events: trimmed,
    status: {
      ...base,
      state: allFailed ? "error" : trimmed.length ? "live" : "empty",
      detail: allFailed
        ? `Autobahn open data unreachable — ${failures[0] || "unknown error"}.`
        : trimmed.length
        ? `${trimmed.length} closures across ${CORRIDORS.length} German freight corridors. ` +
          `1 of 5 national adapters connected — pending: ${PENDING}.`
        : `Connected to the German corridor feed; nothing currently reported. ` +
          `1 of 5 national adapters connected — pending: ${PENDING}.`,
      fetchedAt: new Date().toISOString(),
      count: trimmed.length,
    },
  };
}

function dedupe(events: HazardEvent[]): HazardEvent[] {
  const seen = new Set<string>();
  const out: HazardEvent[] = [];
  for (const e of events) {
    const k = `${e.lat.toFixed(2)},${e.lon.toFixed(2)},${e.title}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

function parseWhen(v: any): string {
  if (!v) return new Date().toISOString();
  const d = new Date(v);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
