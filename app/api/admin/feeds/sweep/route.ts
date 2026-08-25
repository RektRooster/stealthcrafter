import { NextRequest, NextResponse } from "next/server";
import { requestIsAuthed } from "@/lib/auth";
import { sweep } from "@/lib/feeds/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// One ingest pass over every feed that is due.
//
// Driven by a scheduler rather than by page renders. Deliberately a plain
// authenticated HTTP route so it does not care WHICH scheduler: Vercel Cron,
// Supabase pg_cron, or an external one all work, and we are not locked to a
// platform feature for something this central.
//
// Two ways in: an operator session cookie, or a CRON_SECRET bearer token for
// the scheduler. The secret lives only in the environment.
async function authorised(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") || "";
    if (auth === `Bearer ${secret}`) return true;
  }
  return requestIsAuthed(req);
}

async function handle(req: NextRequest) {
  if (!(await authorised(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const limit = Number(new URL(req.url).searchParams.get("limit") || 60);
  const result = await sweep(Number.isFinite(limit) ? limit : 60);
  return NextResponse.json({
    ok: true,
    ran: result.ran,
    ok_count: result.ok,
    empty: result.empty,
    errors: result.errors,
    alerts: result.alerts,
    ms: result.ms,
    // Failures are named. A sweep that silently drops a feed is the thing we
    // are trying to make impossible.
    failed: result.runs
      .filter((r) => r.status === "error" || r.status === "needs-key")
      .map((r) => ({ feed: r.feedId, status: r.status, detail: r.detail })),
  });
}

export const GET = handle;
export const POST = handle;
