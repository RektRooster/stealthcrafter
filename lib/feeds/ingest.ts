// The ingest worker.
//
// Until now every hazard source was fetched on every page render. That works
// for five pan-European feeds and does not survive forty — not in latency, and
// not in how it treats the authorities. Polling GeoSphere or ČHMÚ once per
// visitor is abusive, it is the fastest way to be blocked, and it would be a
// poor way to behave toward services we are simultaneously asking for
// redistribution permission.
//
// So ingest is decoupled from render. This runs on a schedule, writes to
// `alerts`, and the page reads one indexed query.
//
// Four rules the worker holds to:
//   * Every request identifies us and gives a contact address.
//   * A feed is fetched no more often than its own cadence says.
//   * A feed whose licence does not permit display is never fetched at all —
//     there is no reason to take an authority's bandwidth for data we cannot
//     legally show.
//   * Every attempt is recorded, successful or not. "N feeds live" on the
//     storefront is then a reading of what happened, not an inference from
//     whether an array came back non-empty.

import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { parserFor, hasParser } from "./parsers";
import { mayDisplay } from "./types";
import { resolveArea } from "@/lib/geo/regions";
import type { Alert, Feed, FeedRun, FeedRunStatus } from "./types";

const USER_AGENT = "StealthCrafter/1.0 (+https://stealthcrafter.com; ops@stealthcrafter.com)";
const FETCH_TIMEOUT_MS = 15_000;

/** How many feeds we hold open at once. Deliberately small: the point is to be
    a well-behaved client of forty different public agencies, not to finish the
    sweep half a second sooner. */
const CONCURRENCY = 4;

/** A feed that has failed repeatedly is backed off rather than hammered. */
function dueAt(feed: Feed): number {
  const last = feed.last_run_at ? Date.parse(feed.last_run_at) : 0;
  const backoff = Math.min(2 ** (feed.consecutive_failures ?? 0), 32);
  return last + feed.cadence_s * 1000 * backoff;
}

export async function selectDueFeeds(limit = 60): Promise<Feed[]> {
  const sb = supabaseAdmin();
  if (!sb) return [];
  const { data, error } = await sb
    .from("feeds")
    .select("*")
    .eq("enabled", true)
    .order("priority", { ascending: true })
    .limit(400);
  if (error || !data) return [];
  const now = Date.now();
  return (data as Feed[]).filter((f) => dueAt(f) <= now).slice(0, limit);
}

/* ------------------------------------------------------------------ */

/* One result shape rather than a discriminated union: this project compiles
   with `strict: false`, which turns off strictNullChecks, and without it
   TypeScript will not narrow `{ok:true;…} | {ok:false;…}` on the literal. That
   is exactly why the five original hazard adapters each carry a "Property
   'detail' does not exist" error today. A flat shape sidesteps it. */
type FetchResult = { ok: boolean; body: string; status: number; detail: string };

async function fetchFeed(feed: Feed): Promise<FetchResult> {
  const headers: Record<string, string> = { "user-agent": USER_AGENT, accept: "*/*" };

  // The env var NAME lives in the registry; the value only ever lives in the
  // environment. If it is missing the feed reports that plainly and is skipped.
  if (feed.auth_env) {
    const key = process.env[feed.auth_env];
    if (!key) return { ok: false, body: "", status: 0, detail: `missing credential — ${feed.auth_env} is not set` };
    // Header style varies by authority; the common ones are covered and the
    // rest are handled by the feed's own module when it gets written.
    if (/fingrid/i.test(feed.authority)) headers["x-api-key"] = key;
    else if (/digitraffic/i.test(feed.authority)) headers["Digitraffic-User"] = "StealthCrafter/1.0";
    else headers["authorization"] = `Bearer ${key}`;
  }

  try {
    const res = await fetch(feed.endpoint, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    // 204 is the correct answer for "nothing is happening", which is the normal
    // state of a public-warning feed and must not read as a failure.
    if (res.status === 204) return { ok: true, body: "", status: 204, detail: "" };
    if (!res.ok) return { ok: false, body: "", status: res.status, detail: `HTTP ${res.status}` };
    return { ok: true, body: await res.text(), status: res.status, detail: "" };
  } catch (e: any) {
    const detail =
      e?.name === "TimeoutError"
        ? `no response within ${FETCH_TIMEOUT_MS / 1000}s`
        : e?.message || String(e);
    return { ok: false, body: "", status: 0, detail };
  }
}

/* ------------------------------------------------------------------ */

export async function runFeed(feed: Feed): Promise<FeedRun> {
  const t0 = Date.now();
  const done = (status: FeedRunStatus, itemCount: number, detail: string, contentHash: string | null = null): FeedRun => ({
    feedId: feed.id,
    status,
    itemCount,
    detail,
    contentHash,
    durationMs: Date.now() - t0,
  });

  if (!mayDisplay(feed)) {
    return done("blocked", 0, `licence is ${feed.licence_state} — not fetched`);
  }
  if (!hasParser(feed)) {
    return done("skipped", 0, `no parser implemented for "${feed.parser}"`);
  }

  const r = await fetchFeed(feed);
  if (!r.ok) {
    const needsKey = /missing credential/.test(r.detail);
    return done(needsKey ? "needs-key" : "error", 0, r.detail);
  }

  const hash = createHash("sha1").update(r.body).digest("hex");

  // Unchanged body: nothing to write, and we say so rather than re-upserting
  // several hundred identical rows.
  if (hash === feed.last_hash) {
    await touchFeed(feed.id, "ok", hash, true);
    return done("ok", 0, "unchanged since last poll", hash);
  }

  if (!r.body.trim()) {
    await touchFeed(feed.id, "empty", hash, true);
    return done("empty", 0, "feed reported nothing active", hash);
  }

  const parsed = parserFor(feed)(r.body, feed);
  if (!parsed.alerts.length) {
    await touchFeed(feed.id, "empty", hash, true);
    return done(
      "empty",
      0,
      parsed.note || (parsed.skipped ? `${parsed.skipped} items could not be read` : "nothing active"),
      hash
    );
  }

  // Most CAP alerts identify their area by CODE, not by polygon. Where the code
  // is one we hold geometry for, the shape is attached here, once, at ingest —
  // so it is stored with the alert and queryable, rather than recomputed on
  // every render. Codes we cannot draw are left alone: the alert keeps the
  // authority's own area name and is never given an approximate shape.
  let drawn = 0;
  for (const a of parsed.alerts) {
    if (a.area.geom) continue;
    const r = resolveArea(a.area.geocodes);
    if (!r) continue;
    a.area.geom = r.geom;
    a.area.bbox = r.bbox;
    a.area.lat = r.lat;
    a.area.lon = r.lon;
    drawn++;
  }

  const written = await writeAlerts(feed, parsed.alerts);
  await touchFeed(feed.id, "ok", hash, true);
  const note = parsed.skipped ? ` (${parsed.skipped} skipped)` : "";
  const geo = drawn ? `, ${drawn} area shapes resolved` : "";
  return done("ok", written, `${written} alerts${note}${geo}`, hash);
}

/* ------------------------------------------------------------------ */

async function writeAlerts(feed: Feed, alerts: Alert[]): Promise<number> {
  const sb = supabaseAdmin();
  if (!sb) return 0;

  const now = new Date().toISOString();
  const rows = alerts.map((a) => ({
    id: a.id,
    feed_id: a.feedId,
    country_iso2: a.countryIso2,
    kind: a.kind,
    severity: a.severity,
    upstream_severity: a.upstreamSeverity,
    upstream_urgency: a.upstreamUrgency,
    upstream_certainty: a.upstreamCertainty,
    headline: a.headline,
    description: a.description,
    instruction: a.instruction,
    onset: a.onset,
    expires: a.expires,
    sent: a.sent,
    area_desc: a.area.desc,
    geocodes: a.area.geocodes,
    geom: a.area.geom,
    bbox: a.area.bbox,
    lat: a.area.lat,
    lon: a.area.lon,
    langs: a.langs,
    url: a.url,
    attribution: a.attribution,
    dedupe_key: a.dedupeKey,
    raw: a.raw,
    last_seen: now,
  }));

  // Chunked so one large national feed cannot blow the request size.
  let written = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await sb.from("alerts").upsert(chunk, { onConflict: "id" });
    if (!error) written += chunk.length;
  }

  // Anything this feed published before and has now stopped publishing has
  // been withdrawn upstream. We expire it rather than delete it: the record of
  // what was warned about, and when, is worth keeping.
  const ids = new Set(alerts.map((a) => a.id));
  const { data: stale } = await sb
    .from("alerts")
    .select("id")
    .eq("feed_id", feed.id)
    .or(`expires.is.null,expires.gt.${now}`)
    .limit(2000);
  const gone = (stale || []).map((r: any) => r.id).filter((id: string) => !ids.has(id));
  if (gone.length) {
    await sb.from("alerts").update({ expires: now }).in("id", gone);
  }

  return written;
}

async function touchFeed(id: string, status: string, hash: string | null, success: boolean) {
  const sb = supabaseAdmin();
  if (!sb) return;
  const patch: Record<string, unknown> = {
    last_run_at: new Date().toISOString(),
    last_status: status,
    updated_at: new Date().toISOString(),
  };
  if (success) {
    patch.last_success_at = new Date().toISOString();
    patch.consecutive_failures = 0;
    if (hash) patch.last_hash = hash;
  }
  await sb.from("feeds").update(patch).eq("id", id);
}

async function recordFailure(id: string, status: string, failures: number) {
  const sb = supabaseAdmin();
  if (!sb) return;
  await sb
    .from("feeds")
    .update({
      last_run_at: new Date().toISOString(),
      last_status: status,
      consecutive_failures: failures + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
}

async function logRun(run: FeedRun) {
  const sb = supabaseAdmin();
  if (!sb) return;
  await sb.from("feed_runs").insert({
    feed_id: run.feedId,
    finished_at: new Date().toISOString(),
    status: run.status,
    item_count: run.itemCount,
    detail: run.detail.slice(0, 1000),
    content_hash: run.contentHash,
    duration_ms: run.durationMs,
  });
}

/* ------------------------------------------------------------------ */

export type SweepResult = {
  ran: number;
  ok: number;
  empty: number;
  errors: number;
  alerts: number;
  runs: FeedRun[];
  ms: number;
};

/** One pass over everything that is due. Bounded concurrency, and a single
    slow authority cannot stall the rest. */
export async function sweep(limit = 60): Promise<SweepResult> {
  const t0 = Date.now();
  const feeds = await selectDueFeeds(limit);
  const runs: FeedRun[] = [];

  let cursor = 0;
  async function worker() {
    while (cursor < feeds.length) {
      const feed = feeds[cursor++];
      let run: FeedRun;
      try {
        run = await runFeed(feed);
      } catch (e: any) {
        run = {
          feedId: feed.id,
          status: "error",
          itemCount: 0,
          detail: `worker threw — ${e?.message || e}`,
          contentHash: null,
          durationMs: 0,
        };
      }
      if (run.status === "error" || run.status === "needs-key") {
        await recordFailure(feed.id, run.status, feed.consecutive_failures ?? 0);
      }
      await logRun(run);
      runs.push(run);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, feeds.length) }, worker));

  return {
    ran: runs.length,
    ok: runs.filter((r) => r.status === "ok").length,
    empty: runs.filter((r) => r.status === "empty").length,
    errors: runs.filter((r) => r.status === "error" || r.status === "needs-key").length,
    alerts: runs.reduce((n, r) => n + r.itemCount, 0),
    runs,
    ms: Date.now() - t0,
  };
}
