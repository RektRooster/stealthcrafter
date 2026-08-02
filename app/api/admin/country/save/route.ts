import { NextRequest, NextResponse } from "next/server";
import { requestIsAuthed } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_COLUMNS = new Set([
  "market_status",
  "market_readiness",
  "priority",
  "favourite",
  "compliance_notes",
  "shipping_notes",
  "notes",
]);

const STATUSES = new Set(["researching", "supplier_ready", "active", "compliance_hold"]);

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
  const iso2 = String(body?.iso2 || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(iso2)) {
    return NextResponse.json({ error: "bad iso2" }, { status: 400 });
  }
  const patch = body?.patch || {};
  const update: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!ALLOWED_COLUMNS.has(k)) continue;
    if (k === "market_status") {
      if (!STATUSES.has(String(v))) return NextResponse.json({ error: "bad market_status" }, { status: 400 });
      update[k] = v;
    } else if (k === "market_readiness") {
      if (v === null || v === "") update[k] = null;
      else {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 100) {
          return NextResponse.json({ error: "market_readiness must be 0-100" }, { status: 400 });
        }
        update[k] = Math.round(n);
      }
    } else if (k === "priority" || k === "favourite") {
      update[k] = Boolean(v);
    } else {
      update[k] = v === null || v === "" ? null : String(v);
    }
  }
  if (!Object.keys(update).length) {
    return NextResponse.json({ error: "no allowed fields in patch" }, { status: 400 });
  }
  update.updated_at = new Date().toISOString();

  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "supabase not configured" }, { status: 500 });
  const { error } = await sb.from("country_markets").update(update).eq("iso2", iso2);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, iso2 });
}
