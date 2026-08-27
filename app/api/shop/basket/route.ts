// Basket writes. One endpoint, one action field — the basket is small enough
// that four routes would be four places to keep the owner logic identical.

import { NextRequest, NextResponse } from "next/server";
import { requestIsAuthed } from "@/lib/auth";
import {
  GUEST_COOKIE,
  cookieOptions,
  customerIdFromRequest,
  guestKeyFromRequest,
  newGuestKey,
} from "@/lib/customer-auth";
import { addToBasket, basketView, clearBasket, removeFromBasket, setQty } from "@/lib/commerce/basket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!(await requestIsAuthed(req)))
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "We could not read that request." }, { status: 400 });
  }

  const customerId = customerIdFromRequest(req);
  // A guest gets a key the moment they need one, not on every page view.
  let guestKey = guestKeyFromRequest(req);
  let issuedGuestKey: string | null = null;
  if (!customerId && !guestKey) {
    guestKey = newGuestKey();
    issuedGuestKey = guestKey;
  }
  const owner = { customerId, guestKey };

  const action = String(body?.action || "");
  let out;
  try {
    if (action === "add") out = await addToBasket(owner, String(body?.ref || ""), Number(body?.qty) || 1);
    else if (action === "setQty") out = await setQty(owner, String(body?.itemId || ""), Number(body?.qty));
    else if (action === "remove") out = await removeFromBasket(owner, String(body?.ref || ""));
    else if (action === "clear") out = await clearBasket(owner);
    else if (action === "view") out = { ok: true, view: await basketView(owner), message: "" };
    else
      out = { ok: false, message: "That is not something the basket can do." };
  } catch {
    // Never a raw 500 in a customer's face.
    out = { ok: false, message: "We could not update your basket just now. Nothing has been lost." };
  }

  const res = NextResponse.json(out);
  if (issuedGuestKey) res.cookies.set(GUEST_COOKIE, issuedGuestKey, cookieOptions);
  return res;
}
