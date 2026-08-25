// Parsers. Each turns one fetched payload into alerts.
//
// A parser never touches the network and never touches the database. It is a
// pure function of (body, feed), which means every one of them can be tested
// against a saved sample without a fixture server — and when an authority
// changes its format we can prove where it broke.
//
// A parser must never throw on bad upstream data. Malformed items are skipped
// and counted; the count surfaces in feed_runs so a feed that starts silently
// dropping half its items is visible rather than merely quieter.

import { capToAlert, parseCapXml, bboxOf, pointOf, dedupeKey, toUtc, kindFromCap, severityFromCap } from "./cap";
import type { Alert, Feed, ParseResult } from "./types";

export type Parser = (body: string, feed: Feed) => ParseResult;

/* ------------------------------------------------------------------ */
/* Meteoalarm — 33 of our 39 countries, in one adapter                 */
/* ------------------------------------------------------------------ */

/* Shape: {"warnings":[{"uuid":"…","alert":{ …full CAP 1.2 as JSON… }}]}
   The CAP inside is the same tree the XML would give, so it goes straight to
   the shared normaliser. */
const meteoalarm: Parser = (body, feed) => {
  let json: any;
  try {
    json = JSON.parse(body);
  } catch (e: any) {
    return { alerts: [], skipped: 0, note: `unparseable JSON — ${e?.message || e}` };
  }
  const warnings: any[] = Array.isArray(json?.warnings) ? json.warnings : [];
  const alerts: Alert[] = [];
  let skipped = 0;
  for (const w of warnings) {
    const a = capToAlert(w?.alert, {
      feedId: feed.id,
      countryIso2: feed.country_iso2,
      attribution: feed.attribution,
      url: w?.uuid ? `${feed.endpoint}/${w.uuid}` : null,
    });
    if (a) alerts.push(a);
    else skipped++;
  }
  return { alerts, skipped };
};

/* ------------------------------------------------------------------ */
/* CAP — XML on the wire, or a JSON array/object of CAP documents      */
/* ------------------------------------------------------------------ */

const cap: Parser = (body, feed) => {
  const trimmed = body.trimStart();
  const ctx = {
    feedId: feed.id,
    countryIso2: feed.country_iso2,
    attribution: feed.attribution,
  };

  // JSON form (Iceland's capbroker, warnung.bund.de).
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let json: any;
    try {
      json = JSON.parse(body);
    } catch (e: any) {
      return { alerts: [], skipped: 0, note: `unparseable JSON — ${e?.message || e}` };
    }
    const docs: any[] = Array.isArray(json)
      ? json
      : Array.isArray(json?.alerts)
      ? json.alerts
      : json?.alert
      ? [json.alert]
      : [json];
    const alerts: Alert[] = [];
    let skipped = 0;
    for (const d of docs) {
      const a = capToAlert(d?.alert ?? d, ctx);
      if (a) alerts.push(a);
      else skipped++;
    }
    return { alerts, skipped };
  }

  // XML form.
  const doc = parseCapXml(body);
  if (!doc) return { alerts: [], skipped: 0, note: "body was neither CAP XML nor JSON" };
  const docs = Array.isArray(doc) ? doc : [doc];
  const alerts: Alert[] = [];
  let skipped = 0;
  for (const d of docs) {
    const a = capToAlert(d, ctx);
    if (a) alerts.push(a);
    else skipped++;
  }
  return { alerts, skipped };
};

/* ------------------------------------------------------------------ */
/* GeoJSON — LHP flood alerts, and the shape most national portals use */
/* ------------------------------------------------------------------ */

const geojson: Parser = (body, feed) => {
  let json: any;
  try {
    json = JSON.parse(body);
  } catch (e: any) {
    return { alerts: [], skipped: 0, note: `unparseable JSON — ${e?.message || e}` };
  }
  const feats: any[] = Array.isArray(json?.features) ? json.features : [];
  const alerts: Alert[] = [];
  let skipped = 0;

  for (const f of feats) {
    const p = f?.properties || {};
    const id = String(p.id ?? p.identifier ?? p.uuid ?? p.name ?? "").trim();
    if (!id) {
      skipped++;
      continue;
    }
    const geom = f?.geometry ?? null;
    const bbox = bboxOf(geom);
    const { lat, lon } = pointOf(bbox);

    const headline = String(
      p.headline ?? p.title ?? p.event ?? p.name ?? p.label ?? "Alert"
    ).slice(0, 500);
    const sent = toUtc(p.sent ?? p.updated ?? p.timestamp ?? p.date ?? null) ?? new Date().toISOString();
    const kind = kindFromCap(String(p.event ?? p.type ?? headline), String(p.category ?? feed.kind));
    const upstream = p.severity !== undefined && p.severity !== null ? String(p.severity) : null;

    alerts.push({
      id: `${feed.id}:${id}`,
      feedId: feed.id,
      countryIso2: feed.country_iso2,
      kind,
      severity: severityFromCap(upstream, String(p.urgency ?? ""), String(p.certainty ?? "")),
      upstreamSeverity: upstream,
      upstreamUrgency: p.urgency ? String(p.urgency) : null,
      upstreamCertainty: p.certainty ? String(p.certainty) : null,
      headline,
      description: p.description ? String(p.description) : null,
      instruction: p.instruction ? String(p.instruction) : null,
      onset: toUtc(p.onset ?? p.effective ?? null),
      expires: toUtc(p.expires ?? null),
      sent,
      area: {
        geom,
        bbox,
        geocodes: [],
        desc: p.areaDesc ? String(p.areaDesc) : p.region ? String(p.region) : null,
        lat,
        lon,
      },
      langs: {},
      url: p.url ? String(p.url) : p.link ? String(p.link) : null,
      attribution: feed.attribution,
      dedupeKey: dedupeKey(feed.country_iso2, kind, p.onset ?? sent, [], lat, lon),
      raw: f,
    });
  }
  return { alerts, skipped };
};

/* ------------------------------------------------------------------ */

/**
 * Parsers that exist but are not written yet.
 *
 * This is deliberate and it is not a stub that lies. A feed whose parser is
 * `none` records a `skipped` run with this note, so the registry can carry all
 * 412 rows from day one without any of them pretending to work. The access
 * report reads these the same way it reads a missing API key: as a stated
 * reason this feed is not contributing.
 */
const notBuilt: Parser = (_body, feed) => ({
  alerts: [],
  skipped: 0,
  note: `no parser implemented for "${feed.parser}" yet`,
});

export const PARSERS: Record<string, Parser> = {
  meteoalarm,
  cap,
  "atom-cap": cap,
  geojson,
};

export function parserFor(feed: Feed): Parser {
  return PARSERS[feed.parser] ?? notBuilt;
}

export function hasParser(feed: Feed): boolean {
  return Boolean(PARSERS[feed.parser]);
}
