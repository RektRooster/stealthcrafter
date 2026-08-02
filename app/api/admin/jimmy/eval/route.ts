import { NextRequest, NextResponse } from "next/server";
import { requestIsAuthed } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Human grading of a challenge run: sets passed true/false on jimmy_eval_runs.
export async function POST(req: NextRequest) {
  if (!(await requestIsAuthed(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const { evalRunId, passed, notes } = body || {};
  if (evalRunId == null) return NextResponse.json({ error: "evalRunId required" }, { status: 400 });
  if (typeof passed !== "boolean")
    return NextResponse.json({ error: "passed must be boolean" }, { status: 400 });

  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "supabase not configured" }, { status: 503 });

  const patch: Record<string, any> = { passed, grader: "human" };
  if (typeof notes === "string" && notes.trim()) patch.notes = notes.trim();

  const { error } = await sb.from("jimmy_eval_runs").update(patch).eq("id", evalRunId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, evalRunId, passed });
}
