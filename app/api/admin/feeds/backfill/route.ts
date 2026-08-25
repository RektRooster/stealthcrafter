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

  const { data, error } = await sb
    .from("alerts")
    .select("id, geocodes")
    .is("geom", null)
    .not("geocodes", "eq", "[]")
    .limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data || []) as { id: string; geocodes: any }[];
  let resolved = 0;
  const unresolvedSchemes: Record<string, number> = {};

  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const patches: any[] = [];
    for (const r of chunk) {
      const area = resolveArea(r.geocodes);
      if (!area) {
        for (const g of r.geocodes || []) {
          const k = String(g?.scheme || "?").toUpperCase();
          unresolvedSchemes[k] = (unresolvedSchemes[k] || 0) + 1;
        }
        continue;
      }
      patches.push({
        id: r.id,
        geom: area.geom,
        bbox: area.bbox,
        lat: area.lat,
        lon: area.lon,
      });
    }
    if (patches.length) {
      // Only the geometry columns are touched; everything else the authority
      // published stays exactly as it arrived.
      for (const p of patches) {
        const { id, ...patch } = p;
        await sb.from("alerts").update(patch).eq("id", id);
      }
      resolved += patches.length;
    }
  }

  return NextResponse.json({
    ok: true,
    examined: rows.length,
    resolved,
    // Named rather than counted: this is the evidence for how much of Europe is
    // still waiting on the Meteoalarm Metadata API.
    stillUndrawable: unresolvedSchemes,
  });
}
