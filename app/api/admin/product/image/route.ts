import { NextRequest, NextResponse } from "next/server";
import { requestIsAuthed } from "@/lib/auth";
import { uploadImageBytes, addImageFromUrl, removeImage, setPrimaryImage } from "@/lib/mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!(await requestIsAuthed(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const ct = req.headers.get("content-type") || "";
  try {
    // File upload from the user's computer
    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const id = String(form.get("id") || "");
      const file = form.get("file") as File | null;
      if (!id || !file) return NextResponse.json({ error: "id and file required" }, { status: 400 });
      const bytes = new Uint8Array(await file.arrayBuffer());
      const res = await uploadImageBytes(id, bytes, file.type || "image/jpeg");
      return NextResponse.json(res);
    }

    const body = await req.json();
    const { id, action, url } = body || {};
    if (!id || !action) return NextResponse.json({ error: "id and action required" }, { status: 400 });
    if (action === "add-url") return NextResponse.json(await addImageFromUrl(String(id), String(url)));
    if (action === "delete") return NextResponse.json(await removeImage(String(id), String(url)));
    if (action === "primary") return NextResponse.json(await setPrimaryImage(String(id), String(url)));
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}
