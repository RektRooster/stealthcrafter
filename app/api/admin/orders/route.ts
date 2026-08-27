// Command Center: move an order along its lifecycle.
import { NextRequest, NextResponse } from "next/server";
import { requestIsAuthed } from "@/lib/auth";
import { advanceStatus } from "@/lib/commerce/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!(await requestIsAuthed(req)))
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Bad request." }, { status: 400 });
  }
  try {
    const out = await advanceStatus(
      String(body?.orderId || ""),
      String(body?.status || ""),
      "Ace (Command Center)",
      body?.note ? String(body.note) : undefined
    );
    return NextResponse.json(out);
  } catch {
    return NextResponse.json({ ok: false, message: "That status change did not save." });
  }
}
