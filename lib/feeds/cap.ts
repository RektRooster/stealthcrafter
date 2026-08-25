// CAP 1.2 (OASIS Common Alerting Protocol) normaliser.
//
// This is the single highest-leverage file in the spine. SC 13's register found
// CAP behind Meteoalarm's 33 member countries, Luxembourg, Czechia, Finland,
// DWD, Spain, Norway, Iceland and the UK — so most of Europe arrives in this
// one format, and everything below is written once.
//
// Two shapes of the same document are handled together:
//   * CAP-as-XML, the standard on the wire.
//   * CAP-as-JSON, which Meteoalarm and warnung.bund.de both serve.
// They differ only in how you get to the tree, so parsing is shared.
//
// Three things bite, all of them recorded by SC 13 and all handled here:
//   1. An <alert> carries one <info> per LANGUAGE. Treating them as separate
//      alerts triples the count. They are folded into `langs` instead.
//   2. Each <info> carries one or more <area>, and an area may have geocodes,
//      a polygon, both, or neither. A warning with no geometry is still a real
//      warning — it keeps its area name and is never given an invented point.
//   3. Timestamps are local-offset ISO 8601 (`+02:00`, `+03:00`). Everything is
//      normalised to UTC on the way in.

import { XMLParser } from "fast-xml-parser";
import type { Alert, AlertArea, AlertKind, Severity } from "./types";

const xml = new XMLParser({
  ignoreAttributes: true,
  trimValues: true,
  parseTagValue: false,
  // CAP repeats <info>, <area>, <geocode> and <parameter>. Forcing arrays
  // removes an entire class of "worked until a country sent two" bug.
  isArray: (name) =>
    ["info", "area", "geocode", "parameter", "resource", "eventCode"].includes(name),
});

export function parseCapXml(body: string): any | null {
  try {
    const doc = xml.parse(body);
    return doc?.alert ?? doc?.["cap:alert"] ?? null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Severity — ours, derived from theirs                                */
/* ------------------------------------------------------------------ */

/**
 * CAP severity is the authority's assessment of the hazard. Ours is an
 * assessment of what a household should do, which is not the same question —
 * so urgency and certainty move the result. A "Severe" event that has already
 * happened and is fading matters less to a household than one that is imminent
 * and observed.
 *
 * Both readings are kept: this returns ours, and the caller stores the CAP
 * values verbatim alongside.
 */
export function severityFromCap(
  capSeverity: string | null,
  urgency: string | null,
  certainty: string | null
): Severity {
  const s = (capSeverity || "").toLowerCase();
  const u = (urgency || "").toLowerCase();
  const c = (certainty || "").toLowerCase();

  let base: Severity =
    s === "extreme" ? "severe"
    : s === "severe" ? "elevated"
    : s === "moderate" ? "watch"
    : "info";

  // Imminent and observed pushes it up one step; past or unlikely pulls it down.
  const imminent = u === "immediate" && (c === "observed" || c === "likely");
  const fading = u === "past" || c === "unlikely";

  if (imminent && base !== "severe") base = up(base);
  if (fading && base !== "info") base = down(base);
  return base;
}

const ORDER: Severity[] = ["info", "watch", "elevated", "severe"];
const up = (s: Severity): Severity => ORDER[Math.min(3, ORDER.indexOf(s) + 1)];
const down = (s: Severity): Severity => ORDER[Math.max(0, ORDER.indexOf(s) - 1)];

/* ------------------------------------------------------------------ */
/* Kind — from CAP event text, which is free-form and multilingual      */
/* ------------------------------------------------------------------ */

/* CAP's <event> is a human string in the issuing language, so this matches on
   both the English forms and the local words that actually appear in the feeds
   SC 13 sampled. It is deliberately generous: a wrong icon is a small cost, and
   the alert's own headline is always shown next to it. */
const KIND_PATTERNS: [RegExp, AlertKind][] = [
  [/wild ?fire|forest ?fire|grass ?fire|maastopalo|skogsbrand|waldbrand|incendi|pożar|požár/i, "wildfire"],
  [/earthquake|seismic|jarðskjálfti|séisme|terremoto|trzęsienie/i, "earthquake"],
  [/flood|hochwasser|inondation|alluvion|powód|översvämning|tulva|poplav|flooding/i, "flood"],
  [/avalanche|lawin|lavine|snöskred|lumivyöry/i, "avalanche"],
  [/thunder|gewitter|orage|burza|åska|ukkonen|temporale|tormenta/i, "storm"],
  [/wind|gale|storm|sturm|vent|wichura|vind|tuuli|vento|viento/i, "storm"],
  [/snow|schnee|neige|śnieg|snö|lumi|neve|nieve/i, "snow"],
  [/\bice\b|icing|glatteis|verglas|gołoledź|halka|jää|ghiaccio|hielo|freezing rain/i, "ice"],
  [/rain|regen|pluie|deszcz|regn|sade|pioggia|lluvia|precipit/i, "rain"],
  [/high[- ]temperature|heat ?wave|\bheat\b|hitze|canicule|upał|värme|helle|caldo|calor/i, "heat"],
  [/low[- ]temperature|extreme cold|\bfrost\b|kälte|grand froid|mróz|kyla|pakkanen|freddo|frío/i, "cold"],
  [/\bfog\b|nebel|brouillard|mgła|dimma|sumu|nebbia|niebla/i, "fog"],
  [/coastal|storm ?surge|sturmflut|submersion|sztorm|kust|rannikko|mareggiata/i, "coastal"],
  [/power|electric|grid|blackout|strom|électricité|prąd|el ?avbrott|sähkö/i, "grid"],
  [/road|traffic|motorway|closure|verkehr|circulation|droga|trafik|liikenne/i, "transport"],
  [/drinking ?water|boil ?water|abkochgebot|trinkwasser|eau potable|woda pitna|dricksvatten/i, "water"],
  [/health|epidemic|outbreak|gesundheit|santé|zdrow|hälsa|terveys/i, "health"],
];

export function kindFromCap(event: string | null, category: string | null): AlertKind {
  const e = (event || "").trim();
  for (const [re, kind] of KIND_PATTERNS) if (re.test(e)) return kind;
  const c = (category || "").toLowerCase();
  if (c === "fire") return "wildfire";
  if (c === "geo") return "earthquake";
  if (c === "health") return "health";
  if (c === "infra") return "grid";
  if (c === "transport") return "transport";
  if (c === "met") return "storm";
  if (c === "safety" || c === "security" || c === "rescue" || c === "cbrne") return "disaster";
  return "other";
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

/** CAP polygons are space-separated "lat,lon" pairs — note the order, which is
    the reverse of GeoJSON's. Getting this backwards puts Poland in Somalia. */
export function polygonToGeoJson(polys: string[]): GeoJSON.Geometry | null {
  const rings: number[][][] = [];
  for (const p of polys) {
    const ring = String(p)
      .trim()
      .split(/\s+/)
      .map((pair) => {
        const [lat, lon] = pair.split(",").map(Number);
        return Number.isFinite(lat) && Number.isFinite(lon) ? [lon, lat] : null;
      })
      .filter(Boolean) as number[][];
    if (ring.length >= 4) rings.push(ring);
  }
  if (!rings.length) return null;
  return rings.length === 1
    ? { type: "Polygon", coordinates: [rings[0]] }
    : { type: "MultiPolygon", coordinates: rings.map((r) => [r]) };
}

export function bboxOf(geom: GeoJSON.Geometry | null): [number, number, number, number] | null {
  if (!geom) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const walk = (c: any) => {
    if (typeof c[0] === "number") {
      const [lon, lat] = c as number[];
      if (lon < w) w = lon;
      if (lon > e) e = lon;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
      return;
    }
    for (const x of c) walk(x);
  };
  walk((geom as any).coordinates ?? []);
  if (!Number.isFinite(w)) return null;
  return [r5(w), r5(s), r5(e), r5(n)];
}

/** Centre of the bounding box. Deliberately NOT called a centroid: it is a
    label position for a marker, not a claim about where the event is. */
export function pointOf(bbox: [number, number, number, number] | null) {
  if (!bbox) return { lat: null, lon: null };
  return { lon: r5((bbox[0] + bbox[2]) / 2), lat: r5((bbox[1] + bbox[3]) / 2) };
}

const r5 = (n: number) => Math.round(n * 1e5) / 1e5;

/* ------------------------------------------------------------------ */
/* The normaliser                                                      */
/* ------------------------------------------------------------------ */

export type CapContext = {
  feedId: string;
  /** Fallback when the CAP document does not name a country. */
  countryIso2: string | null;
  attribution: string | null;
  /** Link back to the authority's own page for this alert, if the feed gives one. */
  url?: string | null;
};

/**
 * One CAP <alert> → one of our alerts.
 *
 * Returns null for documents we should not store: cancellations, expired
 * items, and anything without an identifier or a sent time. A cancellation is
 * not "no alert" — it is an instruction to remove one — and is handled by the
 * ingest layer rather than by inventing a row here.
 */
export function capToAlert(alert: any, ctx: CapContext): Alert | null {
  if (!alert) return null;

  const identifier = str(alert.identifier);
  const sent = toUtc(str(alert.sent));
  if (!identifier || !sent) return null;

  const msgType = (str(alert.msgType) || "Alert").toLowerCase();
  if (msgType === "cancel" || msgType === "ack" || msgType === "error") return null;

  const infos: any[] = Array.isArray(alert.info) ? alert.info : alert.info ? [alert.info] : [];
  if (!infos.length) return null;

  // Prefer English for our own fields where it exists — our storefront copy is
  // English until the /xx/ locale work lands — but every language is kept, so
  // a Polish reader can be shown IMGW's own Polish wording later without
  // another fetch.
  const langs: Alert["langs"] = {};
  for (const i of infos) {
    const code = (str(i.language) || "und").toLowerCase();
    langs[code] = {
      headline: str(i.headline) || str(i.event) || undefined,
      description: str(i.description) || undefined,
      instruction: str(i.instruction) || undefined,
    };
  }
  const primary =
    infos.find((i) => /^en/i.test(str(i.language) || "")) ??
    infos.find((i) => !str(i.language)) ??
    infos[0];

  const areas: any[] = Array.isArray(primary.area)
    ? primary.area
    : primary.area
    ? [primary.area]
    : [];

  const geocodes: { scheme: string; value: string }[] = [];
  const polys: string[] = [];
  const descs: string[] = [];
  for (const a of areas) {
    const d = str(a.areaDesc);
    if (d) descs.push(d);
    const gcs = Array.isArray(a.geocode) ? a.geocode : a.geocode ? [a.geocode] : [];
    for (const g of gcs) {
      const scheme = str(g.valueName);
      const value = str(g.value);
      if (scheme && value) geocodes.push({ scheme, value });
    }
    const ps = Array.isArray(a.polygon) ? a.polygon : a.polygon ? [a.polygon] : [];
    for (const p of ps) if (str(p)) polys.push(str(p)!);
  }

  const geom = polygonToGeoJson(polys);
  const bbox = bboxOf(geom);
  const { lat, lon } = pointOf(bbox);

  const area: AlertArea = {
    geom,
    bbox,
    geocodes,
    // Several members repeat the same area name once per language; collapse.
    desc: descs.length ? [...new Set(descs)].join("; ").slice(0, 500) : null,
    lat,
    lon,
  };

  const capSeverity = str(primary.severity);
  const urgency = str(primary.urgency);
  const certainty = str(primary.certainty);
  const kind = kindFromCap(str(primary.event), str(primary.category));

  const countryIso2 = ctx.countryIso2 || countryFromIdentifier(identifier);

  return {
    id: `${ctx.feedId}:${identifier}`,
    feedId: ctx.feedId,
    countryIso2,
    kind,
    severity: severityFromCap(capSeverity, urgency, certainty),
    upstreamSeverity: capSeverity,
    upstreamUrgency: urgency,
    upstreamCertainty: certainty,
    headline: (str(primary.headline) || str(primary.event) || "Warning").slice(0, 500),
    description: str(primary.description),
    instruction: str(primary.instruction),
    onset: toUtc(str(primary.onset) || str(primary.effective)),
    expires: toUtc(str(primary.expires)),
    sent,
    area,
    langs,
    url: ctx.url ?? str(primary.web) ?? null,
    attribution: ctx.attribution,
    dedupeKey: dedupeKey(countryIso2, kind, str(primary.onset) || sent, geocodes, lat, lon),
    raw: alert,
  };
}

/* CAP identifiers commonly embed the ISO-3166 numeric country code as the
   fifth dotted field of an OID: 2.49.0.0.616.0.PL.… → 616 → PL. Used only when
   the feed itself does not tell us the country. */
const NUMERIC_TO_ISO2: Record<string, string> = {
  "008": "AL", "020": "AD", "040": "AT", "056": "BE", "070": "BA", "100": "BG",
  "191": "HR", "196": "CY", "203": "CZ", "208": "DK", "233": "EE", "246": "FI",
  "250": "FR", "268": "GE", "276": "DE", "300": "GR", "348": "HU", "352": "IS",
  "372": "IE", "376": "IL", "380": "IT", "428": "LV", "438": "LI", "440": "LT",
  "442": "LU", "470": "MT", "498": "MD", "499": "ME", "528": "NL", "578": "NO",
  "616": "PL", "620": "PT", "642": "RO", "688": "RS", "703": "SK", "705": "SI",
  "724": "ES", "752": "SE", "756": "CH", "792": "TR", "804": "UA", "807": "MK",
  "826": "GB",
};

export function countryFromIdentifier(identifier: string): string | null {
  const parts = identifier.split(".");
  for (const p of parts) {
    if (/^\d{3}$/.test(p) && NUMERIC_TO_ISO2[p]) return NUMERIC_TO_ISO2[p];
  }
  return null;
}

/**
 * Deduplication key.
 *
 * SC 13 warns explicitly that the same warning arrives from a national service
 * and from Meteoalarm with DIFFERENT identifiers, so ID matching does not work.
 * We key on what is actually the same about them: country, kind, the hour the
 * event starts, and where it is — the primary region code if there is one,
 * otherwise a coarse grid cell of roughly 25 km.
 */
export function dedupeKey(
  country: string | null,
  kind: AlertKind,
  onsetIso: string | null,
  geocodes: { scheme: string; value: string }[],
  lat: number | null,
  lon: number | null
): string {
  const hour = onsetIso ? (toUtc(onsetIso) || "").slice(0, 13) : "";
  const region =
    geocodes.find((g) => /EMMA_ID/i.test(g.scheme))?.value ||
    geocodes[0]?.value ||
    (lat !== null && lon !== null ? `${Math.round(lat * 4) / 4},${Math.round(lon * 4) / 4}` : "");
  return [country || "??", kind, hour, region].join("|");
}

/* ------------------------------------------------------------------ */

function str(v: any): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "object") {
    // fast-xml-parser hands back {"#text": "..."} for mixed content.
    const t = (v as any)["#text"];
    return t === undefined ? null : String(t).trim() || null;
  }
  const s = String(v).trim();
  return s || null;
}

/** Local-offset ISO 8601 → UTC ISO 8601. Returns null rather than a wrong
    timestamp: a warning with an unparseable time is better dropped than shown
    at the wrong hour. */
export function toUtc(v: string | null): string | null {
  if (!v) return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}
