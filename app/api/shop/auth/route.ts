// Customer sign-up / sign-in / sign-out / demo password reset.
//
// Still behind the founder password gate — requestIsAuthed() checks the ADMIN
// cookie, because the whole preview site is gated. The customer session is a
// second, separate cookie set on top of it.

import { NextRequest, NextResponse } from "next/server";
import { requestIsAuthed } from "@/lib/auth";
import {
  CUSTOMER_COOKIE,
  GUEST_COOKIE,
  cookieOptions,
  demoResetPassword,
  guestKeyFromRequest,
  mintCustomerToken,
  signInCustomer,
  signUpCustomer,
} from "@/lib/customer-auth";
import { mergeGuestBasket } from "@/lib/commerce/basket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: NextRequest) {
  if (!(await requestIsAuthed(req))) return bad("unauthorized", 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("We could not read that request.");
  }

  const action = String(body?.action || "");
  const email = String(body?.email || "").trim();
  const password = String(body?.password || "");

  if (action === "logout") {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(CUSTOMER_COOKIE, "", { ...cookieOptions, maxAge: 0 });
    return res;
  }

  if (!email) return bad("Please enter your email address.");
  if (action !== "reset" && password.length < 8)
    return bad("Please use a password of at least eight characters.");

  if (action === "signup") {
    const out = await signUpCustomer({ email, password, name: body?.name });
    if (!out.ok) return bad(out.error);
    // The basket they filled before making an account comes with them.
    await mergeGuestBasket(out.customerId, guestKeyFromRequest(req));
    const res = NextResponse.json({ ok: true, customerId: out.customerId });
    res.cookies.set(CUSTOMER_COOKIE, mintCustomerToken(out.customerId), cookieOptions);
    res.cookies.set(GUEST_COOKIE, "", { ...cookieOptions, maxAge: 0 });
    return res;
  }

  if (action === "login") {
    const out = await signInCustomer(email, password);
    if (!out.ok) return bad(out.error);
    await mergeGuestBasket(out.customerId, guestKeyFromRequest(req));
    const res = NextResponse.json({ ok: true, customerId: out.customerId });
    res.cookies.set(CUSTOMER_COOKIE, mintCustomerToken(out.customerId), cookieOptions);
    res.cookies.set(GUEST_COOKIE, "", { ...cookieOptions, maxAge: 0 });
    return res;
  }

  if (action === "reset") {
    const next = String(body?.newPassword || "");
    if (next.length < 8) return bad("Please use a new password of at least eight characters.");
    const out = await demoResetPassword(email, next);
    if (!out.ok) return bad(out.error);
    return NextResponse.json({ ok: true });
  }

  return bad("That is not something this endpoint can do.");
}
