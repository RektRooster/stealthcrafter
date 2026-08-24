// One snapshot of live European conditions, assembled from the named public
// sources. Every source runs isolated: one failing feed degrades to a stated
// status line, it never takes the page down and never invents a stand-in.
import { fetchEffis } from "./effis";
import { fetchEmsc } from "./emsc";
import { fetchEntsoe } from "./entsoe";
import { fetchGdacs } from "./gdacs";
import { fetchTransport } from "./transport";
import { SEVERITY_RANK } from "./types";
import type { HazardEvent, HazardSnapshot, SourceStatus } from "./types";

export * from "./types";

type Adapter = () => Promise<{ events: HazardEvent[]; status: SourceStatus }>;

const ADAPTERS: { key: string; run: Adapter; fallback: SourceStatus }[] = [
  {
    key: "EFFIS",
    run: fetchEffis,
    fallback: stub("EFFIS", "Wildfires", "Harmonised European active-fire detections.", "EFFIS / GWIS — Copernicus EMS", "https://forest-fire.emergency.copernicus.eu/"),
  },
  {
    key: "EMSC",
    run: fetchEmsc,
    fallback: stub("EMSC", "Earthquakes", "European-Mediterranean seismicity.", "EMSC", "https://www.seismicportal.eu/"),
  },
  {
    key: "GDACS",
    run: fetchGdacs,
    fallback: stub("GDACS", "Major disasters", "Events large enough to affect populations and supply chains.", "GDACS (JRC / UN OCHA)", "https://www.gdacs.org/"),
  },
  {
    key: "ENTSOE",
    run: fetchEntsoe,
    fallback: stub("ENTSOE", "Power grid", "European generation and transmission unavailability.", "ENTSO-E Transparency Platform", "https://transparency.entsoe.eu/"),
  },
  {
    key: "TRANSPORT",
    run: fetchTransport,
    fallback: stub("TRANSPORT", "Roads & logistics", "Closures and incidents on European freight corridors.", "National transport open data", "https://verkehr.autobahn.de/"),
  },
];

function stub(source: any, label: string, what: string, attribution: string, href: string): SourceStatus {
  return {
    source,
    label,
    what,
    state: "error",
    detail: "Adapter threw before returning a status.",
    fetchedAt: null,
    count: 0,
    attribution,
    href,
  };
}

export async function getHazardSnapshot(): Promise<HazardSnapshot> {
  const settled = await Promise.allSettled(ADAPTERS.map((a) => a.run()));

  const events: HazardEvent[] = [];
  const sources: SourceStatus[] = [];

  settled.forEach((res, i) => {
    const { fallback } = ADAPTERS[i];
    if (res.status === "fulfilled") {
      events.push(...res.value.events);
      sources.push(res.value.status);
    } else {
      sources.push({
        ...fallback,
        detail: `Adapter failed — ${res.reason?.message || String(res.reason)}.`,
      });
    }
  });

  // Worst first, then most recent. That ordering is the whole point: the list
  // has to lead with what a household would act on.
  events.sort((a, b) => {
    const d = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (d) return d;
    return new Date(b.at).getTime() - new Date(a.at).getTime();
  });

  return { events, sources, generatedAt: new Date().toISOString() };
}

/** Counts used by the map's country shading and the headline strip. */
export function summarise(events: HazardEvent[]) {
  const byCountry: Record<string, { count: number; worst: number }> = {};
  const byKind: Record<string, number> = {};
  let severe = 0;
  for (const e of events) {
    byKind[e.kind] = (byKind[e.kind] || 0) + 1;
    if (e.severity === "severe") severe++;
    if (!e.countryIso2) continue;
    const cur = byCountry[e.countryIso2] || { count: 0, worst: -1 };
    cur.count++;
    cur.worst = Math.max(cur.worst, SEVERITY_RANK[e.severity]);
    byCountry[e.countryIso2] = cur;
  }
  return { byCountry, byKind, severe, total: events.length };
}
