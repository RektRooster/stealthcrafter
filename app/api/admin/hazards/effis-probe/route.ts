import { NextRequest, NextResponse } from "next/server";
import { requestIsAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORARY diagnostic (SC 05). EFFIS is reachable from Vercel but not from
// the build sandbox, so this probes the WFS from production to find the layer
// and predicate that return current wildfire data. Every input is validated
// against a fixed allowlist, so this cannot be used as an open proxy.
// Delete once the layer is pinned.

const BASE = "https://maps.effis.emergency.copernicus.eu/effis";

const LAYERS = [
  "ms:modis.hs",
  "ms:viirs.hs",
  "ms:effis.hs",
  "ms:frp.hs",
  "ms:nrt.hs",
  "ms:hotspots",
  "ms:modis.ba.poly",
  "ms:viirs.ba.poly",
  "ms:effis.ba.poly",
];

const PROPS = ["acq_at", "acq_date", "lastupdate", "initialdate", "firedate", "date"];

function literal(days: number): string {
  const d = new Date(Date.now() - days * 864e5);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} 00:00:00`;
}

export async function GET(req: NextRequest) {
  if (!(await requestIsAuthed(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const q = req.nextUrl.searchParams;
  const layer = q.get("layer") || "";
  if (!LAYERS.includes(layer)) {
    return NextResponse.json({ usage: "?layer=<one of>&days=<int 0-4000>&prop=<one of>", LAYERS, PROPS });
  }
  const prop = q.get("prop") || "acq_at";
  if (!PROPS.includes(prop)) return NextResponse.json({ error: "bad prop", PROPS }, { status: 400 });

  const daysRaw = q.get("days");
  const days = daysRaw === null ? null : Number(daysRaw);
  if (days !== null && (!Number.isInteger(days) || days < 0 || days > 4000)) {
    return NextResponse.json({ error: "bad days" }, { status: 400 });
  }

  const filter =
    days === null
      ? ""
      : `&filter=${encodeURIComponent(
          `<Filter><PropertyIsGreaterThan><PropertyName>${prop}</PropertyName><Literal>${literal(
            days
          )}</Literal></PropertyIsGreaterThan></Filter>`
        )}`;

  const url =
    `${BASE}?service=WFS&version=1.1.0&request=getfeature&typename=${encodeURIComponent(layer)}` +
    `&outputformat=geojson&maxfeatures=5${filter}`;

  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "StealthCrafter/1.0 (+https://stealthcrafter.com)" },
      signal: AbortSignal.timeout(45000),
      cache: "no-store",
    });
    const text = await res.text();
    const ms = Date.now() - t0;
    let count: number | null = null;
    let props: any = null;
    try {
      const json = JSON.parse(text);
      count = Array.isArray(json?.features) ? json.features.length : null;
      props = json?.features?.[0]?.properties ?? null;
    } catch {
      /* not json */
    }
    return NextResponse.json({ layer, prop, days, ms, status: res.status, count, props, head: text.slice(0, 500) });
  } catch (e: any) {
    return NextResponse.json({ layer, prop, days, ms: Date.now() - t0, error: e?.name || String(e) });
  }
}
