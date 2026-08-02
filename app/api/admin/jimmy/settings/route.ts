import { NextRequest, NextResponse } from "next/server";
import { requestIsAuthed } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WHITELIST = new Set([
  "provider_primary",
  "provider_fallback",
  "model_primary",
  "model_fallback",
  "kill_switch",
  "rate_limit_per_hour",
  "daily_cost_cap_cents",
  "temperature",
]);

const PROVIDERS = new Set(["openai", "anthropic"]);

export async function POST(req: NextRequest) {
  if (!(await requestIsAuthed(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const patch = body?.patch;
  if (!patch || typeof patch !== "object")
    return NextResponse.json({ error: "patch required" }, { status: 400 });

  // Customer web search is LOCKED OFF by the grounding rule — no API path can flip it.
  if ("customer_web_search" in patch)
    return NextResponse.json({ error: "locked by grounding rule" }, { status: 403 });

  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!WHITELIST.has(k)) continue;
    if (k === "provider_primary" || k === "provider_fallback") {
      if (!PROVIDERS.has(String(v))) return NextResponse.json({ error: `invalid ${k}` }, { status: 400 });
      clean[k] = String(v);
    } else if (k === "model_primary" || k === "model_fallback") {
      if (typeof v !== "string" || !v.trim())
        return NextResponse.json({ error: `invalid ${k}` }, { status: 400 });
      clean[k] = v.trim();
    } else if (k === "kill_switch") {
      clean[k] = Boolean(v);
    } else if (k === "rate_limit_per_hour" || k === "daily_cost_cap_cents") {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0)
        return NextResponse.json({ error: `invalid ${k}` }, { status: 400 });
      clean[k] = Math.round(n);
    } else if (k === "temperature") {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 2)
        return NextResponse.json({ error: "invalid temperature" }, { status: 400 });
      clean[k] = n;
    }
  }
  if (Object.keys(clean).length === 0)
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  clean.updated_at = new Date().toISOString();

  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "supabase not configured" }, { status: 503 });

  const { error } = await sb.from("jimmy_settings").update(clean).eq("id", 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, applied: Object.keys(clean).filter((k) => k !== "updated_at") });
}
