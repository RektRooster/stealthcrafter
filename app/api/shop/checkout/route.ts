// Checkout: place the order, then take the (demo) payment.
//
// Two steps rather than one on purpose. A real provider puts a redirect, a 3-D
// Secure challenge or a webhook between them, and an order that exists before
// payment is what makes an abandoned payment recoverable instead of lost.

import { NextRequest, NextResponse } from "next/server";
import { requestIsAuthed } from "@/lib/auth";
import { customerIdFromRequest, guestKeyFromRequest } from "@/lib/customer-auth";
import { payOrder, placeOrder, type Address } from "@/lib/commerce/orders";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function required(a: any): string[] {
  const missing: string[] = [];
  if (!a?.line1) missing.push("address");
  if (!a?.city) missing.push("town or city");
  if (!a?.country_iso2) missing.push("country");
  return missing;
}

export async function POST(req: NextRequest) {
  if (!(await requestIsAuthed(req)))
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "We could not read that request." }, { status: 400 });
  }

  const customerId = customerIdFromRequest(req);
  const guestKey = guestKeyFromRequest(req);
  const owner = { customerId, guestKey };

  if (body?.action === "pay") {
    try {
      const out = await payOrder(String(body?.orderId || ""));
      return NextResponse.json(out.ok ? { ok: true, order: out.order } : { ok: false, message: out.message });
    } catch {
      return NextResponse.json({
        ok: false,
        message: "The payment step did not complete. Your order is saved — try again in a moment.",
      });
    }
  }

  const ship = body?.ship as Address;
  const missing = required(ship);
  if (missing.length)
    return NextResponse.json({ ok: false, message: `Please fill in your ${missing.join(", ")}.` });

  const email = String(body?.email || "").trim();
  if (!email.includes("@"))
    return NextResponse.json({ ok: false, message: "Please give an email address for the confirmation." });

  try {
    const out = await placeOrder({ owner, email, ship, bill: body?.bill ?? null });
    if (!out.ok) return NextResponse.json({ ok: false, message: out.message });

    // Save the address for next time — signed-in customers only, and only when
    // they asked. Nothing is stored quietly behind their back.
    if (customerId && body?.saveAddress) {
      try {
        const sb = supabaseAdmin();
        await sb?.from("customer_addresses").insert({
          customer_id: customerId,
          label: "Delivery address",
          full_name: ship.full_name ?? null,
          line1: ship.line1,
          line2: ship.line2 ?? null,
          city: ship.city,
          region: ship.region ?? null,
          postcode: ship.postcode ?? null,
          country_iso2: ship.country_iso2,
          phone: ship.phone ?? null,
          is_default_shipping: true,
        });
      } catch {
        /* an address we failed to save must not lose the order */
      }
    }

    // EMAIL IS STUBBED. There is no transactional email provider, so the
    // confirmation is the screen. Logged so the hook is visible in the code
    // rather than invented later.
    console.log(
      `[order-confirmation-email:STUB] to=${email} ref=${out.order.reference} total=EUR ${out.order.grandTotal.toFixed(2)}`
    );

    return NextResponse.json({ ok: true, order: out.order });
  } catch {
    return NextResponse.json({
      ok: false,
      message: "We could not place that order just now. Your basket is untouched.",
    });
  }
}
