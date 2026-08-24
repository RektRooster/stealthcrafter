// GDACS — Global Disaster Alert and Coordination System (JRC / UN OCHA).
//
// This is the big-event filter. GDACS already combines hazard science with
// an estimate of how many people sit inside the affected area, so it is what
// stops us treating every flood the same as every other flood. We keep the
// European/Mediterranean events and carry GDACS's own alert level through.
import { countryOf, projectLonLat } from "@/lib/euro-map";
import { PILLARS_BY_KIND, safeFetch } from "./types";
import type { HazardEvent, HazardKind, Severity, SourceStatus } from "./types";

const RSS = "https://www.gdacs.org/xml/rss.xml";

const KIND_BY_CODE: Record<string, HazardKind> = {
  EQ: "earthquake",
  TC: "storm",
  FL: "flood",
  WF: "wildfire",
  VO: "disaster",
  DR: "disaster",
  TS: "disaster",
};

const KIND_LABEL: Record<string, string> = {
  EQ: "Earthquake",
  TC: "Tropical cyclone",
  FL: "Flood",
  WF: "Wildfire",
  VO: "Volcanic activity",
  DR: "Drought",
  TS: "Tsunami",
};

// Only events that touch the continent we serve.
const FRAME = { minlat: 30, maxlat: 73, minlon: -30, maxlon: 50 };

export async function fetchGdacs(): Promise<{ events: HazardEvent[]; status: SourceStatus }> {
  const base: SourceStatus = {
    source: "GDACS",
    label: "Major disasters",
    what: "Events large enough to affect populations, infrastructure or supply chains — with GDACS's own Green/Orange/Red alert level.",
    state: "error",
    detail: "",
    fetchedAt: null,
    count: 0,
    attribution: "GDACS — Global Disaster Alert and Coordination System (JRC / UN OCHA)",
    href: "https://www.gdacs.org/",
  };

  const r = await safeFetch(RSS, { revalidate: 900 });
  if (!r.ok) return { events: [], status: { ...base, detail: `GDACS unreachable — ${r.detail}.` } };

  let xml: string;
  try {
    xml = await r.res.text();
  } catch (e: any) {
    return { events: [], status: { ...base, detail: `GDACS response unreadable — ${e?.message || e}.` } };
  }

  const items = xml.split(/<item[\s>]/).slice(1);
  const events: HazardEvent[] = [];

  for (const raw of items) {
    const item = raw.split("</item>")[0];
    const code = tag(item, "gdacs:eventtype") || "";
    const kind = KIND_BY_CODE[code];
    if (!kind) continue;

    const lat = Number(tag(item, "geo:lat"));
    const lon = Number(tag(item, "geo:long"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < FRAME.minlat || lat > FRAME.maxlat || lon < FRAME.minlon || lon > FRAME.maxlon) continue;

    const alert = (tag(item, "gdacs:alertlevel") || "green").toLowerCase();
    const eventId = tag(item, "gdacs:eventid") || "";
    const episode = tag(item, "gdacs:episodeid") || "";
    const countryRaw = decode(tag(item, "gdacs:country") || "");
    const from = tag(item, "gdacs:fromdate");
    const sevText = decode(tag(item, "gdacs:severity") || "");
    const sevValue = Number(attr(item, "gdacs:severity", "value"));
    const sevUnit = attr(item, "gdacs:severity", "unit");
    const popValue = Number(attr(item, "gdacs:population", "value"));
    const popText = decode(tag(item, "gdacs:population") || "");
    const link = decode(tag(item, "link") || "") || null;
    const span = bboxSpan(tag(item, "gdacs:bbox") || "");

    const started = new Date(parseDate(from));
    const ageDays = (Date.now() - started.getTime()) / 864e5;
    // GDACS keeps slow-onset episodes current for months. They are real, but a
    // year-old drought is not what a "right now" map is for.
    if (ageDays > 180) continue;

    // GDACS's own alert level is the primary signal — it already folds in
    // exposure. We only add a floor: anything with a large exposed population
    // is at least "worth knowing" even if GDACS still has it green.
    let severity: Severity = alert === "red" ? "severe" : alert === "orange" ? "elevated" : alert === "yellow" ? "watch" : "info";
    if (Number.isFinite(popValue) && popValue >= 1_000_000 && severity === "info") severity = "watch";
    // Long-running events are already known and already being managed.
    if (ageDays > 30 && severity !== "info") severity = down(severity);

    // Continental-scale events are listed but never pinned: a point marker
    // would claim a precision the bounding box does not have.
    const wide = span !== null && span > 12;
    const { label: where, count: countryCount } = shortCountries(countryRaw);
    const label = KIND_LABEL[code] || "Event";

    events.push({
      id: `GDACS:${eventId || `${lat},${lon}`}${episode ? `.${episode}` : ""}`,
      source: "GDACS",
      kind,
      title: `${label} — ${wide && countryCount > 3 ? `${countryCount} European countries` : where}`,
      summary:
        (ageDays > 14 ? `Ongoing since ${fmtDate(started)}. ` : "") +
        [sevText, popText ? `Exposed population: ${popText.replace(/^\s*/, "")}` : ""]
          .filter(Boolean)
          .join(". ")
          .trim() +
        `. GDACS alert level: ${cap(alert)}.` +
        (wide ? ` Spans ${where} — too wide to place on the map as a single point.` : ""),
      lat,
      lon,
      xy: wide ? null : projectLonLat(lon, lat),
      countryIso2: wide ? null : countryOf(lon, lat),
      severity,
      magnitude: Number.isFinite(sevValue) ? sevValue : null,
      unit: sevUnit || null,
      at: started.toISOString(),
      url: link,
      pillars: PILLARS_BY_KIND[kind],
    });
  }

  return {
    events,
    status: {
      ...base,
      state: events.length ? "live" : "empty",
      detail: events.length
        ? `${events.length} current events inside the European/Mediterranean frame.`
        : "Connected, but GDACS currently lists no active events inside the European frame.",
      fetchedAt: new Date().toISOString(),
      count: events.length,
    },
  };
}

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${escape(name)}[^>]*>([\\s\\S]*?)</${escape(name)}>`, "i"));
  if (!m) return "";
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

function attr(xml: string, name: string, attrName: string): string {
  const m = xml.match(new RegExp(`<${escape(name)}[^>]*\\b${attrName}="([^"]*)"`, "i"));
  return m ? m[1] : "";
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decode(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/* GDACS bbox is "minlon maxlon minlat maxlat". A continental-scale event —
   a drought across twenty countries — must not be pinned to a single point,
   so we measure the span and refuse to plot the wide ones. */
function bboxSpan(raw: string): number | null {
  const n = raw.trim().split(/\s+/).map(Number);
  if (n.length !== 4 || n.some((v) => !Number.isFinite(v))) return null;
  return Math.max(Math.abs(n[1] - n[0]), Math.abs(n[3] - n[2]));
}

const ORDER: Severity[] = ["info", "watch", "elevated", "severe"];
function down(sev: Severity): Severity {
  return ORDER[Math.max(0, ORDER.indexOf(sev) - 1)];
}

/* "Germany, Spain, France and 17 others" rather than a wall of country names. */
function shortCountries(raw: string): { label: string; count: number } {
  const parts = raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (parts.length <= 3) return { label: parts.join(", ") || "Europe / Mediterranean", count: parts.length };
  return { label: `${parts.slice(0, 3).join(", ")} and ${parts.length - 3} others`, count: parts.length };
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function parseDate(s: string): string {
  const d = new Date(s);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
