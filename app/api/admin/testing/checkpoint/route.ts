import { NextRequest, NextResponse } from "next/server";
import { requestIsAuthed } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESULTS = ["waiting", "in_progress", "pass", "fail", "na"];

/* POST /api/admin/testing/checkpoint  { id, result?, notes_evidence? } */
export async function POST(req: NextRequest) {
  if (!(await requestIsAuthed(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const id = body?.id ? String(body.id) : null;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if ("result" in (body || {})) {
    if (!RESULTS.includes(body.result))
      return NextResponse.json({ error: "invalid result" }, { status: 400 });
    patch.result = body.result;
  }
  if ("notes_evidence" in (body || {})) {
    patch.notes_evidence = body.notes_evidence === "" ? null : String(body.notes_evidence ?? "");
  }

  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "supabase not configured" }, { status: 503 });

  // never mutate checkpoints of an ended session
  const { data: cp } = await sb.from("test_checkpoints").select("session_id").eq("id", id).maybeSingle();
  if (!cp) return NextResponse.json({ error: "checkpoint not found" }, { status: 404 });
  const { data: session } = await sb
    .from("test_sessions")
    .select("status")
    .eq("id", cp.session_id)
    .maybeSingle();
  if (session && session.status !== "in_progress")
    return NextResponse.json({ error: "session ended — read only" }, { status: 409 });

  const { error } = await sb.from("test_checkpoints").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, updated_at: patch.updated_at });
}
