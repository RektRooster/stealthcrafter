import { NextRequest, NextResponse } from "next/server";
import { requestIsAuthed } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { runJimmyChat } from "@/lib/jimmy/service";
import {
  GUEST_COOKIE,
  cookieOptions,
  customerIdFromRequest,
  guestKeyFromRequest,
  newGuestKey,
} from "@/lib/customer-auth";

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

  /* A signed-out visitor asking Jimmy to put something in their basket needs a
     basket to put it in. Issue the guest key HERE rather than on page load, so
     nobody gets a tracking cookie for reading, and set it on the way out. */
  const customerId = customerIdFromRequest(req);
  let guestKey = guestKeyFromRequest(req);
  let issuedGuestKey: string | null = null;
  if (!customerId && !guestKey) {
    guestKey = newGuestKey();
    issuedGuestKey = guestKey;
  }

  try {
    let convId = conversationId ?? null;
    if (!convId) {
      const { data, error } = await sb
        .from("jimmy_conversations")
        .insert({
          profile_id: profileId ?? null,
          surface: surface === "preview" ? "preview" : "console",
          meta: {},
        })
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
      // Who is shopping. Lets Jimmy act on a real basket rather than describe one.
      customerId,
      guestKey,
    });
    const res = NextResponse.json({ ok: true, conversationId: convId, answer });
    if (issuedGuestKey) res.cookies.set(GUEST_COOKIE, issuedGuestKey, cookieOptions);
    return res;
  } catch (e: any) {
    /* NEVER a bare 500 into a customer conversation. A thrown error here used to
       surface as "Something went wrong on our side", which reads as a broken
       shop — and most of the time it was an unbuilt feature, not a fault. The
       reply still comes back as a message, in plain words, and the detail goes
       to the server log where it belongs. */
    console.error("[jimmy-chat] unhandled:", e?.message || e);
    return NextResponse.json({
      ok: true,
      conversationId: conversationId ?? null,
      answer: {
        text:
          "I could not get to an answer on that one — that is on us, not you, and your message is " +
          "saved. Try me again in a moment, or ask it a different way and I will have another go.",
        tier: null,
        sources: [],
        catalogue: [],
        provider: null,
        model: null,
        promptVersion: null,
        tokensIn: 0,
        tokensOut: 0,
        costCents: 0,
        safetyTriggered: false,
        basketChanged: false,
        notice: true,
        role: "system",
      },
    });
  }
}
