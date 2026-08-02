import { NextRequest, NextResponse } from "next/server";
import { requestIsAuthed } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PACKS = ["Water", "Fire", "Shelter", "Medical", "Food", "General"];
const TIERS = ["GREEN", "AMBER", "RED"];

// Knowledge lifecycle:
//   add  → creates a DRAFT chunk (optionally creating a new DRAFT source)
//   sign → the ONLY path to SIGNED; requires a non-empty reviewer name
//   edit → updates content/keywords and RESETS status to DRAFT (re-sign needed)
export async function POST(req: NextRequest) {
  if (!(await requestIsAuthed(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const action = body?.action;
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "supabase not configured" }, { status: 503 });

  try {
    if (action === "add") {
      const { pack, section, tier, content, keywords, sourceId, newSource } = body;
      if (!PACKS.includes(pack)) return NextResponse.json({ error: "invalid pack" }, { status: 400 });
      if (!TIERS.includes(tier)) return NextResponse.json({ error: "invalid tier" }, { status: 400 });
      if (!content || typeof content !== "string" || !content.trim())
        return NextResponse.json({ error: "content required" }, { status: 400 });

      let srcId = sourceId ?? null;
      if (!srcId && newSource && typeof newSource === "object" && newSource.title) {
        const { data: src, error: srcErr } = await sb
          .from("jimmy_sources")
          .insert({
            title: String(newSource.title).trim(),
            publisher: newSource.publisher ? String(newSource.publisher).trim() : null,
            url: newSource.url ? String(newSource.url).trim() : null,
            status: "DRAFT",
          })
          .select("id")
          .single();
        if (srcErr) throw srcErr;
        srcId = src.id;
      }

      const { data, error } = await sb
        .from("jimmy_knowledge")
        .insert({
          pack,
          section: section ? String(section).trim() : null,
          content: content.trim(),
          tier,
          status: "DRAFT",
          source_id: srcId,
          keywords: keywords ? String(keywords).trim() : null,
        })
        .select("id")
        .single();
      if (error) throw error;
      return NextResponse.json({ ok: true, id: data.id, status: "DRAFT" });
    }

    if (action === "sign") {
      const { id, signed_by } = body;
      if (id == null) return NextResponse.json({ error: "id required" }, { status: 400 });
      if (!signed_by || typeof signed_by !== "string" || !signed_by.trim())
        return NextResponse.json({ error: "signed_by (reviewer name) required" }, { status: 400 });
      const { error } = await sb
        .from("jimmy_knowledge")
        .update({ status: "SIGNED", signed_by: signed_by.trim(), signed_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      return NextResponse.json({ ok: true, id, status: "SIGNED" });
    }

    if (action === "edit") {
      const { id, content, keywords } = body;
      if (id == null) return NextResponse.json({ error: "id required" }, { status: 400 });
      const patch: Record<string, any> = {
        // Any edit invalidates the sign-off: back to DRAFT, re-sign required.
        status: "DRAFT",
        signed_by: null,
        signed_at: null,
      };
      if (typeof content === "string") patch.content = content.trim();
      if (typeof keywords === "string") patch.keywords = keywords.trim();
      const { error } = await sb.from("jimmy_knowledge").update(patch).eq("id", id);
      if (error) throw error;
      return NextResponse.json({ ok: true, id, status: "DRAFT" });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}
