import { NextRequest, NextResponse } from "next/server";
import { requestIsAuthed } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_COLUMNS = new Set([
  "threat_level",
  "watch",
  "notes",
  "style",
  "positioning",
  "approx_scale",
  "name",
  "domain",
  "website_url",
]);

const THREAT_LEVELS = new Set(["low", "medium", "high", "critical"]);
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
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  const patch = body?.patch || {};
  const update: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!ALLOWED_COLUMNS.has(k)) continue;
    if (k === "threat_level") {
      // null/"" = back to NOT ASSESSED — the founder sets levels, never the system.
      if (v === null || v === "") update[k] = null;
      else if (THREAT_LEVELS.has(String(v))) update[k] = v;
      else return NextResponse.json({ error: "bad threat_level" }, { status: 400 });
    } else if (k === "watch") {
      update[k] = Boolean(v);
    } else if (k === "name") {
      const s = String(v ?? "").trim();
      if (!s) return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
      update[k] = s;
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
  const { error } = await sb.from("competitors").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, id });
}
