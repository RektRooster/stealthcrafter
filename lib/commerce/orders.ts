// ORDERS.
//
// A demo order is still a real record: it is written once, it keeps its own
// copy of what was bought and at what price, and its status history is kept
// rather than overwritten. When a PSP arrives, what changes is how `paid`
// happens — not the shape of any of this.

import { supabaseAdmin } from "../supabase";
import { basketView, type BasketOwner } from "./basket";
import { paymentProvider } from "./payment";
import { DELIVERY_LABEL, round2, totalsFor, vatRateFor } from "./vat";

export const ORDER_STATUSES = [
  "placed",
  "paid",
  "picking",
  "shipped",
  "delivered",
  "cancelled",
  "returned",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const STATUS_LABEL: Record<OrderStatus, string> = {
  placed: "Placed",
  paid: "Paid",
  picking: "Picking",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  returned: "Returned",
};

/** What may follow what. Kept as data so the console can only offer moves that
 *  are actually legal, rather than showing every status and failing on save. */
export const NEXT_STATUS: Record<OrderStatus, OrderStatus[]> = {
  placed: ["paid", "cancelled"],
  paid: ["picking", "cancelled"],
  picking: ["shipped", "cancelled"],
  shipped: ["delivered", "returned"],
  delivered: ["returned"],
  cancelled: [],
  returned: [],
};

export function isStatus(s: string): s is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(s);
}

export type Address = {
  full_name?: string | null;
  line1: string;
  line2?: string | null;
  city: string;
  region?: string | null;
  postcode?: string | null;
  country_iso2: string;
  phone?: string | null;
};

export type OrderLine = {
  id: string;
  productId: string | null;
  name: string;
  slug: string | null;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  statusAtOrder: string | null;
};

export type OrderRecord = {
  id: string;
  reference: string;
  customerId: string | null;
  email: string;
  status: OrderStatus;
  currency: string;
  goodsTotal: number;
  vatRate: number;
  vatAmount: number;
  deliveryTotal: number;
  grandTotal: number;
  shipAddress: Address | null;
  billAddress: Address | null;
  deliveryOption: string | null;
  paymentMethod: string | null;
  paymentRef: string | null;
  paidAt: string | null;
  placedAt: string;
  demo: boolean;
  lines: OrderLine[];
  events: { status: string; note: string | null; actor: string | null; at: string }[];
};

/* Reference: readable aloud, obviously a demo, and short enough to type.
   "SC-D" rather than "SC-" so no demo order can ever be mistaken for a real
   one in a spreadsheet later. */
function makeReference(): string {
  const ALPHABET = "ACDEFGHJKLMNPQRTUVWXY3479"; // no O/0, I/1, S/5, B/8
  let s = "";
  for (let i = 0; i < 6; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return `SC-D${s}`;
}

function shapeOrder(o: any, lines: any[], events: any[]): OrderRecord {
  return {
    id: o.id,
    reference: o.reference,
    customerId: o.customer_id ?? null,
    email: o.email,
    status: (isStatus(o.status) ? o.status : "placed") as OrderStatus,
    currency: o.currency || "EUR",
    goodsTotal: Number(o.goods_total || 0),
    vatRate: Number(o.vat_rate || 0),
    vatAmount: Number(o.vat_amount || 0),
    deliveryTotal: Number(o.delivery_total || 0),
    grandTotal: Number(o.grand_total || 0),
    shipAddress: (o.ship_address as Address) ?? null,
    billAddress: (o.bill_address as Address) ?? null,
    deliveryOption: o.delivery_option ?? null,
    paymentMethod: o.payment_method ?? null,
    paymentRef: o.payment_ref ?? null,
    paidAt: o.paid_at ?? null,
    placedAt: o.placed_at,
    demo: o.demo !== false,
    lines: (lines || []).map((l) => ({
      id: l.id,
      productId: l.product_id ?? null,
      name: l.name,
      slug: l.slug ?? null,
      qty: l.qty,
      unitPrice: Number(l.unit_price),
      lineTotal: Number(l.line_total),
      statusAtOrder: l.product_status_at_order ?? null,
    })),
    events: (events || []).map((e) => ({
      status: e.status,
      note: e.note ?? null,
      actor: e.actor ?? null,
      at: e.at,
    })),
  };
}

/* ---------------- placing ---------------- */

/* Flat for the same reason as everywhere else in this codebase: `strict: false`
   disables the narrowing that would make a discriminated union readable. */
export type PlaceResult = { ok: boolean; order: OrderRecord | null; message: string };

export async function placeOrder(input: {
  owner: BasketOwner;
  email: string;
  ship: Address;
  bill?: Address | null;
}): Promise<PlaceResult> {
  const sb = supabaseAdmin();
  if (!sb) return { ok: false, order: null, message: "The shop is not connected to its database right now." };

  const view = await basketView(input.owner, input.ship.country_iso2);
  if (!view.lines.length) return { ok: false, order: null, message: "Your basket is empty." };

  // Totals are computed HERE, from the snapshot prices already on the lines.
  // Nothing is re-read from `products`, so the total is exactly the sum of what
  // the customer was shown.
  const goods = round2(view.lines.reduce((a, l) => a + l.lineTotal, 0));
  const t = totalsFor(goods, input.ship.country_iso2);

  let reference = makeReference();
  let order: any = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await sb
      .from("orders")
      .insert({
        reference,
        customer_id: input.owner.customerId ?? null,
        email: input.email.trim().toLowerCase(),
        status: "placed",
        currency: "EUR",
        goods_total: t.goodsTotal,
        vat_rate: t.vatRate,
        vat_amount: t.vatAmount,
        delivery_total: t.deliveryTotal,
        grand_total: t.grandTotal,
        ship_address: input.ship,
        bill_address: input.bill ?? input.ship,
        delivery_option: DELIVERY_LABEL,
        payment_method: null,
        demo: true,
      })
      .select("*")
      .single();
    if (!error) {
      order = data;
      break;
    }
    // Only a reference collision is worth retrying; anything else is real.
    if (!String(error.message || "").includes("orders_reference_key")) {
      return { ok: false, order: null, message: "We could not place that order just now." };
    }
    reference = makeReference();
  }
  if (!order) return { ok: false, order: null, message: "We could not place that order just now." };

  const itemRows = view.lines.map((l) => ({
    order_id: order.id,
    product_id: l.productId,
    name: l.name,
    slug: l.slug,
    qty: l.qty,
    unit_price: l.unitPrice,
    line_total: l.lineTotal,
    product_status_at_order: l.productStatus,
  }));
  await sb.from("order_items").insert(itemRows);
  await sb.from("order_events").insert({
    order_id: order.id,
    status: "placed",
    note: `${view.count} item${view.count === 1 ? "" : "s"}, ${DELIVERY_LABEL}`,
    actor: "customer",
  });

  // The basket becomes the order and is closed. A fresh one is created next
  // time something is added, so history is never rewritten.
  if (view.basketId) {
    await sb.from("baskets").update({ status: "ordered" }).eq("id", view.basketId);
  }

  const placed = await orderById(order.id);
  return placed
    ? { ok: true, order: placed, message: "" }
    : { ok: false, order: null, message: "Order placed but could not be read back." };
}

/* ---------------- paying ---------------- */

export async function payOrder(orderId: string): Promise<PlaceResult> {
  const sb = supabaseAdmin();
  if (!sb) return { ok: false, order: null, message: "The shop is not connected to its database right now." };
  const existing = await orderById(orderId);
  if (!existing) return { ok: false, order: null, message: "That order could not be found." };
  if (existing.status !== "placed")
    return { ok: false, order: null, message: `That order is already ${STATUS_LABEL[existing.status].toLowerCase()}.` };

  const provider = paymentProvider();
  const intent = await provider.createIntent({
    amount: existing.grandTotal,
    currency: existing.currency,
    orderRef: existing.reference,
  });
  const result = await provider.confirm(intent);
  if (!result.ok) return { ok: false, order: null, message: `Payment did not complete: ${result.reason}` };

  await sb
    .from("orders")
    .update({
      status: "paid",
      payment_method: provider.id,
      payment_ref: result.reference,
      paid_at: result.paidAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);
  await sb.from("order_events").insert({
    order_id: orderId,
    status: "paid",
    note: provider.isDemo ? "Demo payment — no money moved" : `Paid via ${provider.displayName}`,
    actor: "customer",
  });

  const paid = await orderById(orderId);
  return paid
    ? { ok: true, order: paid, message: "" }
    : { ok: false, order: null, message: "Payment recorded but the order could not be read back." };
}

/* ---------------- reading ---------------- */

export async function orderById(id: string): Promise<OrderRecord | null> {
  const sb = supabaseAdmin();
  if (!sb) return null;
  const { data: o } = await sb.from("orders").select("*").eq("id", id).maybeSingle();
  if (!o) return null;
  const { data: lines } = await sb.from("order_items").select("*").eq("order_id", id);
  const { data: events } = await sb
    .from("order_events")
    .select("*")
    .eq("order_id", id)
    .order("at", { ascending: true });
  return shapeOrder(o, (lines as any[]) || [], (events as any[]) || []);
}

export async function orderByReference(reference: string): Promise<OrderRecord | null> {
  const sb = supabaseAdmin();
  if (!sb) return null;
  const { data: o } = await sb
    .from("orders")
    .select("id")
    .eq("reference", reference.trim().toUpperCase())
    .maybeSingle();
  return o ? orderById((o as any).id) : null;
}

export async function ordersForCustomer(customerId: string): Promise<OrderRecord[]> {
  const sb = supabaseAdmin();
  if (!sb) return [];
  const { data } = await sb
    .from("orders")
    .select("id")
    .eq("customer_id", customerId)
    .order("placed_at", { ascending: false })
    .limit(50);
  const out: OrderRecord[] = [];
  for (const r of ((data as any[]) || [])) {
    const o = await orderById(r.id);
    if (o) out.push(o);
  }
  return out;
}

export type AdminOrderRow = {
  id: string;
  reference: string;
  email: string;
  status: OrderStatus;
  grandTotal: number;
  currency: string;
  placedAt: string;
  itemCount: number;
  country: string | null;
  customerName: string | null;
};

export async function adminOrderList(): Promise<AdminOrderRow[]> {
  const sb = supabaseAdmin();
  if (!sb) return [];
  const { data: orders } = await sb
    .from("orders")
    .select("id,reference,email,status,grand_total,currency,placed_at,ship_address,customer_id")
    .order("placed_at", { ascending: false })
    .limit(200);
  const rows = (orders as any[]) || [];
  if (!rows.length) return [];

  const { data: items } = await sb
    .from("order_items")
    .select("order_id,qty")
    .in("order_id", rows.map((r) => r.id));
  const counts: Record<string, number> = {};
  for (const i of (items as any[]) || []) counts[i.order_id] = (counts[i.order_id] || 0) + (i.qty || 0);

  const custIds = Array.from(new Set(rows.map((r) => r.customer_id).filter(Boolean)));
  const names: Record<string, string> = {};
  if (custIds.length) {
    const { data: custs } = await sb.from("customers").select("id,name,email").in("id", custIds);
    for (const c of (custs as any[]) || []) names[c.id] = c.name || c.email;
  }

  return rows.map((o) => ({
    id: o.id,
    reference: o.reference,
    email: o.email,
    status: (isStatus(o.status) ? o.status : "placed") as OrderStatus,
    grandTotal: Number(o.grand_total || 0),
    currency: o.currency || "EUR",
    placedAt: o.placed_at,
    itemCount: counts[o.id] || 0,
    country: o.ship_address?.country_iso2 ?? null,
    customerName: o.customer_id ? names[o.customer_id] ?? null : null,
  }));
}

/* ---------------- moving it along ---------------- */

export async function advanceStatus(
  orderId: string,
  next: string,
  actor = "admin",
  note?: string
): Promise<{ ok: boolean; message: string; status?: OrderStatus }> {
  const sb = supabaseAdmin();
  if (!sb) return { ok: false, message: "Not connected to the database." };
  if (!isStatus(next)) return { ok: false, message: `"${next}" is not an order status.` };

  const current = await orderById(orderId);
  if (!current) return { ok: false, message: "That order could not be found." };
  if (!NEXT_STATUS[current.status].includes(next))
    return {
      ok: false,
      message: `An order that is ${STATUS_LABEL[current.status].toLowerCase()} cannot move to ${STATUS_LABEL[next].toLowerCase()}.`,
    };

  const patch: Record<string, any> = { status: next, updated_at: new Date().toISOString() };
  // Marking paid by hand in the console still records a payment, so an order
  // never sits in `paid` with no trace of how it got there.
  if (next === "paid" && !current.paidAt) {
    patch.paid_at = new Date().toISOString();
    patch.payment_method = current.paymentMethod || "demo";
    patch.payment_ref = current.paymentRef || `DEMO-${current.reference}`;
  }
  await sb.from("orders").update(patch).eq("id", orderId);
  await sb.from("order_events").insert({ order_id: orderId, status: next, note: note ?? null, actor });
  return { ok: true, message: `Order ${current.reference} is now ${STATUS_LABEL[next].toLowerCase()}.`, status: next };
}

export { vatRateFor };
