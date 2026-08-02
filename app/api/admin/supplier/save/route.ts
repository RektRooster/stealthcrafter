import { NextRequest, NextResponse } from "next/server";
import { requestIsAuthed } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Founder workflow fields editable from the Supplier Intelligence console.
const ALLOWED_COLUMNS = new Set([
  "trade_status",
  "last_contact",
  "next_action",
  "next_action_date",
  "notes",
  "reliability",
  "contact",
  "website",
]);

const TRADE_STATUSES = new Set(["none", "to_open", "applied", "open"]);
const RELIABILITIES = new Set(["unknown", "low", "medium", "high"]);
const DATE_COLUMNS = new Set(["last_contact", "next_action_date"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const id = String(body?.id || "");
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "bad supplier id" }, { status: 400 });
  }
  const patch = body?.patch || {};
  const update: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!ALLOWED_COLUMNS.has(k)) continue;
    if (k === "trade_status") {
      if (v === null || v === "") update[k] = "none";
      else if (!TRADE_STATUSES.has(String(v))) {
        return NextResponse.json({ error: "bad trade_status" }, { status: 400 });
      } else update[k] = v;
    } else if (k === "reliability") {
      if (v === null || v === "") update[k] = null;
      else if (!RELIABILITIES.has(String(v))) {
        return NextResponse.json({ error: "bad reliability" }, { status: 400 });
      } else update[k] = v;
    } else if (DATE_COLUMNS.has(k)) {
      if (v === null || v === "") update[k] = null;
      else if (!DATE_RE.test(String(v))) {
        return NextResponse.json({ error: `${k} must be YYYY-MM-DD` }, { status: 400 });
      } else update[k] = v;
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
  const { error } = await sb.from("suppliers").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, id });
}
