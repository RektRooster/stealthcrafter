import { NextRequest, NextResponse } from "next/server";
import { requestIsAuthed } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Register writes from the Compliance console. Two actions:
//  - update (default): land a ruling / move status on an existing item
//  - add: create a new register item for SC 08 to rule on
// The console surfaces exposure; the ruling text itself is SC 08's decision.

const STATUSES = new Set(["open", "in_review", "cleared", "blocked"]);
const SEVERITIES = new Set(["gate", "watch"]);
const CATEGORIES = new Set(["medicine", "biocide", "ppe", "medical-device", "ai-safety", "governance"]);
const ALLOWED_COLUMNS = new Set(["status", "ruling", "ruled_by", "detail", "severity"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
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

  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "supabase not configured" }, { status: 500 });

  // ---- action: add — new register item ----
  if (body?.action === "add") {
    const title = str(body?.title);
    if (!title) return NextResponse.json({ error: "a title is required" }, { status: 400 });
    const category = str(body?.category) || "governance";
    if (!CATEGORIES.has(category)) {
      return NextResponse.json({ error: "bad category" }, { status: 400 });
    }
    const severity = str(body?.severity) || "watch";
    if (!SEVERITIES.has(severity)) {
      return NextResponse.json({ error: "bad severity" }, { status: 400 });
    }
    const now = new Date().toISOString();
    const insert = {
      title,
      category,
      severity,
      detail: str(body?.detail),
      product_match: str(body?.product_match) || "%",
      status: "open",
      owner: "SC 08",
      created_at: now,
      updated_at: now,
    };
    const { data, error } = await sb.from("compliance_items").insert(insert).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, id: data.id });
  }

  // ---- action: update (default) — ruling / status on an existing item ----
  const id = String(body?.id || "");
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "bad item id" }, { status: 400 });
  }
  const patch = body?.patch || {};
  const update: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!ALLOWED_COLUMNS.has(k)) continue;
    if (k === "status") {
      if (!STATUSES.has(String(v))) {
        return NextResponse.json({ error: "bad status" }, { status: 400 });
      }
      update[k] = v;
    } else if (k === "severity") {
      if (!SEVERITIES.has(String(v))) {
        return NextResponse.json({ error: "bad severity" }, { status: 400 });
      }
      update[k] = v;
    } else {
      update[k] = str(v);
    }
  }
  if (!Object.keys(update).length) {
    return NextResponse.json({ error: "no allowed fields in patch" }, { status: 400 });
  }
  // A ruling only lands with a name on it — timestamp when both are present.
  if (update.ruling && !update.ruled_by) {
    return NextResponse.json({ error: "ruled_by is required to save a ruling" }, { status: 400 });
  }
  if (update.ruling && update.ruled_by) {
    update.ruled_at = new Date().toISOString();
  }
  update.updated_at = new Date().toISOString();

  const { error } = await sb.from("compliance_items").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, id });
}
