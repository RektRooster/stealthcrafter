import { NextRequest, NextResponse } from "next/server";
import { requestIsAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORARY diagnostic (SC 05). The EFFIS WFS is reachable from Vercel but not
// from the build sandbox, so this route probes a FIXED set of request shapes
// from production to find the one that returns current active-fire detections.
// No caller-supplied URL — the variants are hard-coded, so this cannot be used
// as an open proxy. Delete once the working layer is pinned.

const BASE = "https://maps.effis.emergency.copernicus.eu/effis";
const GWIS = "https://maps.effis.emergency.copernicus.eu/gwis";

function since(days: number): string {
  const d = new Date(Date.now() - days * 864e5);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} 00:00:00`;
}

const dateFilter = (days: number) =>
  `<Filter><PropertyIsGreaterThan><PropertyName>acq_at</PropertyName><Literal>${since(days)}</Literal></PropertyIsGreaterThan></Filter>`;

const dateBoxFilter = (days: number) =>
  `<Filter><And><PropertyIsGreaterThan><PropertyName>acq_at</PropertyName><Literal>${since(
    days
  )}</Literal></PropertyIsGreaterThan>` +
  `<PropertyIsBetween><PropertyName>lat</PropertyName><LowerBoundary><Literal>32</Literal></LowerBoundary><UpperBoundary><Literal>72</Literal></UpperBoundary></PropertyIsBetween>` +
  `<PropertyIsBetween><PropertyName>lon</PropertyName><LowerBoundary><Literal>-26</Literal></LowerBoundary><UpperBoundary><Literal>46</Literal></UpperBoundary></PropertyIsBetween>` +
  `</And></Filter>`;

const wfs = (base: string, layer: string, extra: string) =>
  `${base}?service=WFS&version=1.1.0&request=getfeature&typename=${encodeURIComponent(
    layer
  )}&outputformat=geojson&${extra}`;

const VARIANTS: { label: string; url: string }[] = [
  { label: "capabilities /effis", url: `${BASE}?service=WFS&version=1.1.0&request=getcapabilities` },
  { label: "capabilities /gwis", url: `${GWIS}?service=WFS&version=1.1.0&request=getcapabilities` },
  { label: "modis.hs date-only 3d n=50", url: wfs(BASE, "ms:modis.hs", `maxfeatures=50&filter=${encodeURIComponent(dateFilter(3))}`) },
  { label: "modis.hs date+box 3d n=50", url: wfs(BASE, "ms:modis.hs", `maxfeatures=50&filter=${encodeURIComponent(dateBoxFilter(3))}`) },
  { label: "viirs.hs date-only 3d n=50", url: wfs(BASE, "ms:viirs.hs", `maxfeatures=50&filter=${encodeURIComponent(dateFilter(3))}`) },
  { label: "modis.hs date-only 30d n=50", url: wfs(BASE, "ms:modis.hs", `maxfeatures=50&filter=${encodeURIComponent(dateFilter(30))}`) },
  { label: "modis.hs plain n=3", url: wfs(BASE, "ms:modis.hs", "maxfeatures=3") },
  { label: "viirs.hs plain n=3", url: wfs(BASE, "ms:viirs.hs", "maxfeatures=3") },
];

export async function GET(req: NextRequest) {
  if (!(await requestIsAuthed(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const iRaw = req.nextUrl.searchParams.get("i");
  const i = Number(iRaw);
  if (!Number.isInteger(i) || i < 0 || i >= VARIANTS.length) {
    return NextResponse.json({ variants: VARIANTS.map((v, n) => ({ i: n, label: v.label })) });
  }

  const v = VARIANTS[i];
  const t0 = Date.now();
  try {
    const res = await fetch(v.url, {
      headers: { "user-agent": "StealthCrafter/1.0 (+https://stealthcrafter.com)" },
      signal: AbortSignal.timeout(45000),
      cache: "no-store",
    });
    const text = await res.text();
    const ms = Date.now() - t0;

    if (/getcapabilities/i.test(v.url)) {
      const names = [...text.matchAll(/<Name>([^<]+)<\/Name>/gi)].map((m) => m[1]);
      const hs = names.filter((n) => /hs|hotspot|fire|active|current/i.test(n));
      return NextResponse.json({ label: v.label, ms, status: res.status, total: names.length, hotspotLike: hs.slice(0, 60), all: names.slice(0, 200) });
    }

    let firstAcq: string | null = null;
    let count: number | null = null;
    try {
      const json = JSON.parse(text);
      count = Array.isArray(json?.features) ? json.features.length : null;
      firstAcq = json?.features?.[0]?.properties?.acq_at ?? null;
    } catch {
      /* not json */
    }
    return NextResponse.json({
      label: v.label,
      ms,
      status: res.status,
      count,
      firstAcq,
      head: text.slice(0, 400),
    });
  } catch (e: any) {
    return NextResponse.json({ label: v.label, ms: Date.now() - t0, error: e?.name || String(e), message: e?.message });
  }
}
