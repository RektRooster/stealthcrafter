import { NextRequest, NextResponse } from "next/server";
import { requestIsAuthed } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* POST /api/admin/testing/session  { productId }
   Creates a test session + copies checkpoint templates into test_checkpoints.
   Sections 1,2,4,5,6 always come from the generic set; section 3 comes from the
   'Water' functional set when the product's pillar is Water, else generic. */
export async function POST(req: NextRequest) {
  if (!(await requestIsAuthed(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const productId = body?.productId ? String(body.productId) : null;
  if (!productId) return NextResponse.json({ error: "productId required" }, { status: 400 });

  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "supabase not configured" }, { status: 503 });

  try {
    const { data: product, error: pErr } = await sb
      .from("products")
      .select("id,pillar")
      .eq("id", productId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!product) return NextResponse.json({ error: "product not found" }, { status: 404 });

    // templates
    const { data: generic, error: gErr } = await sb
      .from("test_checkpoint_templates")
      .select("*")
      .is("category_hint", null)
      .order("section", { ascending: true })
      .order("seq", { ascending: true });
    if (gErr) throw gErr;
    let templates = generic || [];
    if (product.pillar === "Water") {
      const { data: water, error: wErr } = await sb
        .from("test_checkpoint_templates")
        .select("*")
        .eq("category_hint", "Water")
        .order("seq", { ascending: true });
      if (wErr) throw wErr;
      if (water && water.length) {
        templates = templates.filter((t: any) => t.section !== 3).concat(water);
        templates.sort((a: any, b: any) => a.section - b.section || a.seq - b.seq);
      }
    }
    if (!templates.length)
      return NextResponse.json({ error: "no checkpoint templates seeded" }, { status: 500 });

    // test code: TEST-YYYY-MM-DD-NNN, NNN = count started today + 1 (retry on unique clash)
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const dayStart = `${day}T00:00:00.000Z`;
    const dayEnd = `${day}T23:59:59.999Z`;
    const { count } = await sb
      .from("test_sessions")
      .select("id", { count: "exact", head: true })
      .gte("started_at", dayStart)
      .lte("started_at", dayEnd);
    let session: any = null;
    let lastErr: any = null;
    for (let attempt = 0; attempt < 3 && !session; attempt++) {
      const nnn = String((count || 0) + 1 + attempt).padStart(3, "0");
      const testCode = `TEST-${day}-${nnn}`;
      const { data, error } = await sb
        .from("test_sessions")
        .insert({
          test_code: testCode,
          product_id: productId,
          started_by: "admin",
          status: "in_progress",
          location: "Lab Bench 01",
          planned_minutes: 60,
          meta: {},
        })
        .select("*")
        .single();
      if (!error) session = data;
      else lastErr = error;
    }
    if (!session) throw lastErr || new Error("could not create session");

    const rows = templates.map((t: any) => ({
      session_id: session.id,
      section: t.section,
      section_name: t.section_name,
      seq: t.seq,
      name: t.name,
      method: t.method,
      expected: t.expected,
      result: "waiting",
    }));
    const { error: cErr } = await sb.from("test_checkpoints").insert(rows);
    if (cErr) {
      // roll back the orphan session so the queue stays clean
      await sb.from("test_sessions").delete().eq("id", session.id);
      throw cErr;
    }

    return NextResponse.json({ ok: true, id: session.id, test_code: session.test_code });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
