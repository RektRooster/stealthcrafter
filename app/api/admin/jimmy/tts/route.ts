import { NextRequest, NextResponse } from "next/server";
import { requestIsAuthed } from "@/lib/auth";

// POST /api/admin/jimmy/tts — Jimmy Voice v1, guardrails-preserving.
//
// ARCHITECTURE NOTE (load-bearing): Jimmy's voice deliberately does NOT use
// realtime speech-to-speech. A speech-to-speech loop would let audio bypass
// the deterministic safety pipeline (kill switch → store-before-AI →
// emergency triggers → rate limit → cost cap → SIGNED-only retrieval).
// Instead: speech is transcribed in the browser, the TEXT runs through the
// one Jimmy pipeline like any typed message, and only the final approved
// reply text arrives here to be spoken.
//
// PRIVACY: this route never logs and never stores the audio or the text —
// bytes are streamed straight back to the caller and dropped. The
// X-Jimmy-Audio-Logging: none response header states this contract.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TEXT_CHARS = 4000;
const TIMEOUT_MS = 30_000;

export async function GET() {
  return NextResponse.json({ error: "method not allowed" }, { status: 405 });
}

export async function POST(req: NextRequest) {
  if (!(await requestIsAuthed(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    // Client treats 503 as "voice unavailable" and falls back to text-only silently.
    return NextResponse.json({ error: "no tts key configured" }, { status: 503 });
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "tts-1",
        voice: "onyx",
        input: text.slice(0, MAX_TEXT_CHARS),
        response_format: "mp3",
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return NextResponse.json({ error: `tts provider error: HTTP ${res.status}` }, { status: 502 });
    }
    const audio = await res.arrayBuffer();
    // Streamed back and dropped — nothing persisted, nothing logged.
    return new NextResponse(audio, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "X-Jimmy-Audio-Logging": "none",
      },
    });
  } catch {
    return NextResponse.json({ error: "tts request failed" }, { status: 502 });
  } finally {
    clearTimeout(t);
  }
}
