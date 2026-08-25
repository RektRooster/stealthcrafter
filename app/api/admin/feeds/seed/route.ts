import { NextRequest, NextResponse } from "next/server";
import { requestIsAuthed } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { REGISTRY } from "@/lib/feeds/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Seed or re-seed the feed registry from the committed registry.json.
//
// Idempotent: upsert by id. Run it after every SC 13 register revision.
// Deliberately does NOT touch enabled/priority on rows that already exist —
// switching a feed on is an operational decision made in the database, and a
// re-seed must never silently re-disable something we turned on, nor re-enable
// something we turned off because it was misbehaving.
export async function POST(req: NextRequest) {
  if (!(await requestIsAuthed(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "supabase not configured" }, { status: 500 });

  const { data: existing } = await sb.from("feeds").select("id");
  const known = new Set((existing || []).map((r: any) => r.id));

  let inserted = 0;
  let updated = 0;
  const errors: string[] = [];

  for (let i = 0; i < REGISTRY.length; i += 100) {
    const chunk = REGISTRY.slice(i, i + 100).map((f) => {
      const row: Record<string, unknown> = {
        id: f.id,
        country_iso2: f.country_iso2,
        kind: f.kind,
        authority: f.authority,
        endpoint: f.endpoint,
        parser: f.parser,
        auth_env: f.auth_env ?? null,
        cadence_s: f.cadence_s,
        licence: f.licence,
        attribution: f.attribution,
        licence_state: f.licence_state,
        access_state: f.access_state,
        access_url: f.access_url,
        access_contact: f.access_contact,
        register_ref: f.register_ref,
        register_status: f.register_status,
        notes: f.notes,
        updated_at: new Date().toISOString(),
      };
      // Only set the operational columns when the row is new.
      if (!known.has(f.id)) {
        row.enabled = f.enabled;
        row.priority = f.priority;
        inserted++;
      } else {
        updated++;
      }
      return row;
    });
    const { error } = await sb.from("feeds").upsert(chunk, { onConflict: "id" });
    if (error) errors.push(error.message);
  }

  return NextResponse.json({ ok: !errors.length, total: REGISTRY.length, inserted, updated, errors });
}
