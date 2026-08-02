import { NextRequest, NextResponse } from "next/server";
import { requestIsAuthed } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { runJimmyChat } from "@/lib/jimmy/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Runs a challenge scenario through the SAME pipeline the chat uses (fresh
// conversation, meta {scenario:true}) and records a jimmy_eval_runs row for
// human grading.
export async function POST(req: NextRequest) {
  if (!(await requestIsAuthed(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const { scenarioId, profileId } = body || {};
  if (scenarioId == null) return NextResponse.json({ error: "scenarioId required" }, { status: 400 });

  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "supabase not configured" }, { status: 503 });

  try {
    const { data: scenario, error: scErr } = await sb
      .from("jimmy_scenarios")
      .select("id,name,category,prompt,expected_behaviour")
      .eq("id", scenarioId)
      .maybeSingle();
    if (scErr) throw scErr;
    if (!scenario) return NextResponse.json({ error: "scenario not found" }, { status: 404 });

    const { data: conv, error: convErr } = await sb
      .from("jimmy_conversations")
      .insert({
        profile_id: profileId ?? null,
        surface: "console",
        meta: { scenario: true, scenario_id: scenario.id, scenario_name: scenario.name },
      })
      .select("id")
      .single();
    if (convErr) throw convErr;

    const answer = await runJimmyChat({
      conversationId: conv.id,
      profileId: profileId ?? null,
      message: scenario.prompt,
      idempotencyKey: `scenario-${scenario.id}-${crypto.randomUUID()}`,
      includeDraft: true,
      surface: "console",
    });

    const { data: evalRun, error: evalErr } = await sb
      .from("jimmy_eval_runs")
      .insert({
        scenario_id: scenario.id,
        provider: answer.provider,
        model: answer.model,
        passed: null,
        grader: "human",
        response: answer.text,
      })
      .select("id")
      .single();
    if (evalErr) throw evalErr;

    return NextResponse.json({
      ok: true,
      conversationId: conv.id,
      evalRunId: evalRun.id,
      answer,
      expected_behaviour: scenario.expected_behaviour,
      scenarioName: scenario.name,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
