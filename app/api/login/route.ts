import { NextRequest, NextResponse } from "next/server";
import { sessionToken, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const password = String(form.get("password") || "");
  const expected = process.env.ADMIN_PASSWORD || "";
  const origin = new URL(req.url).origin;

  if (password && expected && password === expected) {
    const token = await sessionToken(process.env.SESSION_SECRET || "");
    const res = NextResponse.redirect(new URL("/admin", origin), { status: 303 });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  }
  return NextResponse.redirect(new URL("/login?error=1", origin), { status: 303 });
}
