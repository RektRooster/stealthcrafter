import { NextRequest, NextResponse } from "next/server";
import { requestIsAuthed } from "@/lib/auth";
import { updateProduct, createProduct } from "@/lib/mutations";

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
  const { id, patch } = body || {};
  try {
    if (id) {
      await updateProduct(String(id), patch || {});
      return NextResponse.json({ ok: true, id });
    }
    const res = await createProduct(patch || {});
    return NextResponse.json(res);
  } catch (e: any) {
    const msg = e?.message || String(e);
    const status = msg.startsWith("compliance_hold") ? 409 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
