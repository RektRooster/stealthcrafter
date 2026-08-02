import { NextRequest, NextResponse } from "next/server";
import { requestIsAuthed } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATCHABLE = ["notes", "location", "temperature", "humidity"] as const;

/* PATCH — update session fields (notes, location, temperature, humidity). */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requestIsAuthed(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const patch: Record<string, any> = {};
  for (const k of PATCHABLE) {
    if (k in (body || {})) {
      let v = body[k];
      if ((k === "temperature" || k === "humidity") && v !== null && v !== "") {
        const n = Number(v);
        v = Number.isFinite(n) ? n : null;
      }
      if (v === "") v = null;
      patch[k] = v;
    }
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "supabase not configured" }, { status: 503 });
  const { error } = await sb.from("test_sessions").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/* POST — lifecycle actions:
   { action: "complete", verdict: "pass" | "review" | "fail" }
   { action: "abandon" }
   Completion best-effort writes a summary row into the legacy test_records table. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requestIsAuthed(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const action = body?.action;
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "supabase not configured" }, { status: 503 });

  const { data: session, error: sErr } = await sb
    .from("test_sessions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  if (session.status !== "in_progress")
    return NextResponse.json({ error: "session already ended" }, { status: 409 });

  if (action === "abandon") {
    const { error } = await sb
      .from("test_sessions")
      .update({ status: "abandoned", completed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, status: "abandoned" });
  }

  if (action === "complete") {
    const verdict = body?.verdict;
    if (!["pass", "review", "fail"].includes(verdict))
      return NextResponse.json({ error: "verdict must be pass, review or fail" }, { status: 400 });
    const completedAt = new Date().toISOString();
    const { error } = await sb
      .from("test_sessions")
      .update({ status: "completed", verdict, completed_at: completedAt })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Best-effort legacy summary row (test_records) — never blocks completion.
    let legacyRecord = false;
    try {
      const { count: fails } = await sb
        .from("test_checkpoints")
        .select("id", { count: "exact", head: true })
        .eq("session_id", id)
        .eq("result", "fail");
      const { error: lErr } = await sb.from("test_records").insert({
        product_id: session.product_id,
        tested_status: "personally_tested",
        personally_tested: true,
        test_date: completedAt.slice(0, 10),
        tester: session.started_by || "admin",
        test_notes: `${session.test_code || id} — Test Lab session verdict: ${verdict.toUpperCase()}${
          fails ? ` (${fails} failed checkpoint${fails === 1 ? "" : "s"})` : ""
        }.${session.notes ? ` Notes: ${session.notes}` : ""}`,
      });
      legacyRecord = !lErr;
    } catch {
      legacyRecord = false;
    }
    return NextResponse.json({ ok: true, status: "completed", verdict, legacyRecord });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
