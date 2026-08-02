import { NextRequest, NextResponse } from "next/server";
import { requestIsAuthed } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { runJimmyChat } from "@/lib/jimmy/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!(await requestIsAuthed(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const { conversationId, profileId, message, idempotencyKey, includeDraft, surface } = body || {};
  if (!message || typeof message !== "string" || !message.trim())
    return NextResponse.json({ error: "message required" }, { status: 400 });
  if (!idempotencyKey || typeof idempotencyKey !== "string")
    return NextResponse.json({ error: "idempotencyKey required" }, { status: 400 });

  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "supabase not configured" }, { status: 503 });

  try {
    let convId = conversationId ?? null;
    if (!convId) {
      const { data, error } = await sb
        .from("jimmy_conversations")
        .insert({ profile_id: profileId ?? null, surface: "console", meta: {} })
        .select("id")
        .single();
      if (error) throw error;
      convId = data.id;
    }
    const answer = await runJimmyChat({
      conversationId: convId,
      profileId: profileId ?? null,
      message: message.trim(),
      idempotencyKey,
      includeDraft: Boolean(includeDraft),
      surface: surface === "preview" ? "preview" : "console",
    });
    return NextResponse.json({ ok: true, conversationId: convId, answer });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
