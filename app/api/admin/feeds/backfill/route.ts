import { NextRequest, NextResponse } from "next/server";
import { requestIsAuthed } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveArea } from "@/lib/geo/regions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Attach region geometry to alerts already in the table.
//
// Ingest resolves geometry as it writes, so this is only for rows that landed
// before a geometry source existed — and it is the reason a later source (the
// Meteoalarm Metadata API, once Ace's A1 registration lands) can be switched on
// without re-fetching a single feed. Run it, and every historical alert whose
// codes the new table understands gains its shape.
export async function POST(req: NextRequest) {
  if (!(await requestIsAuthed(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "supabase not configured" }, { status: 500 });

  // Paged by id rather than by offset. PostgREST caps a page at 1,000 rows, and
  // most of what this route examines can NEVER resolve — EMMA_ID and CISORP have
  // no geometry source until Meteoalarm's Metadata API arrives — so an unpaged
  // query returns the same unresolvable first thousand every time and the run
  // makes no progress. The cursor walks past them.
  const url = new URL(req.url);
  const after = url.searchParams.get("after") || "";
  const pages = Math.min(Number(url.searchParams.get("pages") || 1) || 1, 20);

  let cursor = after;
  let examined = 0;
  let resolved = 0;
  const unresolvedSchemes: Record<string, number> = {};

  for (let page = 0; page < pages; page++) {
    let q = sb
      .from("alerts")
      .select("id, geocodes")
      .is("geom", null)
      .not("geocodes", "eq", "[]")
      .order("id", { ascending: true })
      .limit(1000);
    if (cursor) q = q.gt("id", cursor);

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const batch = (data || []) as { id: string; geocodes: any }[];
    if (!batch.length) {
      cursor = "";
      break;
    }
    examined += batch.length;
    cursor = batch[batch.length - 1].id;

    for (const r of batch) {
      const area = resolveArea(r.geocodes);
      if (!area) {
        for (const g of r.geocodes || []) {
          const k = String(g?.scheme || "?").toUpperCase();
          unresolvedSchemes[k] = (unresolvedSchemes[k] || 0) + 1;
        }
        continue;
      }
      // Only the geometry columns are touched; everything else the authority
      // published stays exactly as it arrived.
      await sb
        .from("alerts")
        .update({ geom: area.geom, bbox: area.bbox, lat: area.lat, lon: area.lon })
        .eq("id", r.id);
      resolved++;
    }
  }

  return NextResponse.json({
    ok: true,
    examined,
    resolved,
    nextAfter: cursor || null,
    // Named rather than counted: this is the evidence for how much of Europe is
    // still waiting on the Meteoalarm Metadata API.
    stillUndrawable: unresolvedSchemes,
  });
}
