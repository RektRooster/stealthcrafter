// THE BASKET.
//
// Server-side only; every function takes an owner rather than reading cookies,
// so the same code serves a page render, an API route and one of Jimmy's tools
// without three versions of the truth.
//
// The load-bearing rule is the PRICE SNAPSHOT. unit_price is written when the
// line is created and is never read from `products` again — not on the basket
// page, not at checkout, not in the order. A price that moves under a customer
// mid-journey is the oldest bug in commerce and it is also a broken promise.

import { supabaseAdmin } from "../supabase";
import { parseImages } from "../catalogue-data";
import { round2, totalsFor, type Totals } from "./vat";

export type BasketOwner = { customerId?: string | null; guestKey?: string | null };

export type BasketLine = {
  id: string;
  productId: string;
  name: string;
  slug: string | null;
  image: string | null;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  pricedAt: string;
  /** the product's own status now — shown honestly, never used for pricing */
  productStatus: string | null;
  /** true when the live price has moved since this line was added */
  priceMoved: boolean;
  livePrice: number | null;
};

export type BasketView = {
  basketId: string | null;
  lines: BasketLine[];
  count: number;
  goodsTotal: number;
  totals: Totals;
  currency: "EUR";
};

export const EMPTY_BASKET: BasketView = {
  basketId: null,
  lines: [],
  count: 0,
  goodsTotal: 0,
  totals: totalsFor(0, null),
  currency: "EUR",
};

function ownerFilter(q: any, owner: BasketOwner) {
  return owner.customerId ? q.eq("customer_id", owner.customerId) : q.eq("session_key", owner.guestKey);
}

/** Finds the open basket for this owner. Does not create one. */
export async function findBasket(owner: BasketOwner): Promise<string | null> {
  const sb = supabaseAdmin();
  if (!sb || (!owner.customerId && !owner.guestKey)) return null;
  const { data } = await ownerFilter(
    sb.from("baskets").select("id").eq("status", "open"),
    owner
  )
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as any)?.id ?? null;
}

export async function getOrCreateBasket(owner: BasketOwner): Promise<string | null> {
  const existing = await findBasket(owner);
  if (existing) return existing;
  const sb = supabaseAdmin();
  if (!sb || (!owner.customerId && !owner.guestKey)) return null;
  const { data, error } = await sb
    .from("baskets")
    .insert({
      customer_id: owner.customerId ?? null,
      session_key: owner.customerId ? null : owner.guestKey,
      status: "open",
      currency: "EUR",
    })
    .select("id")
    .single();
  if (error) return null;
  return (data as any).id;
}

/* ---------------- resolving what the customer means ---------------- */

export type ResolvedProduct = {
  id: string;
  name: string;
  slug: string | null;
  price: number | null;
  status: string | null;
  image: string | null;
};

const SELECT =
  "id,slug,sc_product_name,product_name,selling_price,currency,product_status,image_urls";

function shape(p: any): ResolvedProduct {
  return {
    id: p.id,
    name: p.sc_product_name || p.product_name || "Product",
    slug: p.slug ?? null,
    price: p.selling_price === null || p.selling_price === undefined ? null : Number(p.selling_price),
    status: p.product_status ?? null,
    image: parseImages(p.image_urls)[0] ?? null,
  };
}

/**
 * Turn "it", a slug, a uuid or a half-remembered product name into one row.
 *
 * Ambiguity is returned rather than guessed at: adding the wrong tent to
 * somebody's basket because two names looked similar is worse than asking.
 */
export async function resolveProduct(
  ref: string
): Promise<{ product: ResolvedProduct | null; candidates: ResolvedProduct[] }> {
  const sb = supabaseAdmin();
  if (!sb || !ref?.trim()) return { product: null, candidates: [] };
  const needle = ref.trim();

  const byId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(needle);
  if (byId) {
    const { data } = await sb.from("products").select(SELECT).eq("id", needle).maybeSingle();
    return { product: data ? shape(data) : null, candidates: [] };
  }

  const { data: bySlug } = await sb.from("products").select(SELECT).eq("slug", needle).maybeSingle();
  if (bySlug) return { product: shape(bySlug), candidates: [] };

  // Name match. `or` across both name columns, rejected excluded.
  const safe = needle.replace(/[,()*%]/g, " ").trim();
  const { data: rows } = await sb
    .from("products")
    .select(SELECT)
    .neq("product_status", "rejected")
    .or(`sc_product_name.ilike.%${safe}%,product_name.ilike.%${safe}%`)
    .limit(6);
  const list = ((rows as any[]) || []).map(shape);
  if (list.length === 1) return { product: list[0], candidates: [] };
  return { product: null, candidates: list };
}

/* ---------------- reading ---------------- */

export async function basketView(owner: BasketOwner, countryIso2: string | null = null): Promise<BasketView> {
  const sb = supabaseAdmin();
  const basketId = await findBasket(owner);
  if (!sb || !basketId) return { ...EMPTY_BASKET, totals: totalsFor(0, countryIso2) };

  const { data: itemRows } = await sb
    .from("basket_items")
    .select("id,product_id,qty,unit_price,priced_at,name_snapshot,slug_snapshot")
    .eq("basket_id", basketId)
    .order("created_at", { ascending: true });
  const items = (itemRows as any[]) || [];
  if (!items.length) return { ...EMPTY_BASKET, basketId, totals: totalsFor(0, countryIso2) };

  const { data: prodRows } = await sb
    .from("products")
    .select(SELECT)
    .in("id", items.map((i) => i.product_id));
  const byId: Record<string, any> = {};
  for (const p of (prodRows as any[]) || []) byId[p.id] = p;

  const lines: BasketLine[] = items.map((i) => {
    const p = byId[i.product_id];
    const unit = Number(i.unit_price);
    const live = p?.selling_price === null || p?.selling_price === undefined ? null : Number(p.selling_price);
    return {
      id: i.id,
      productId: i.product_id,
      // Snapshot name first: if a product is renamed after it was added, the
      // customer should still recognise what they put in their basket.
      name: i.name_snapshot || p?.sc_product_name || p?.product_name || "Product",
      slug: i.slug_snapshot || p?.slug || null,
      image: p ? parseImages(p.image_urls)[0] ?? null : null,
      qty: i.qty,
      unitPrice: unit,
      lineTotal: round2(unit * i.qty),
      pricedAt: i.priced_at,
      productStatus: p?.product_status ?? null,
      priceMoved: live !== null && Math.abs(live - unit) >= 0.01,
      livePrice: live,
    };
  });

  const goods = round2(lines.reduce((a, l) => a + l.lineTotal, 0));
  return {
    basketId,
    lines,
    count: lines.reduce((a, l) => a + l.qty, 0),
    goodsTotal: goods,
    totals: totalsFor(goods, countryIso2),
    currency: "EUR",
  };
}

/** Cheap enough to call in a layout on every request. */
export async function basketCount(owner: BasketOwner): Promise<number> {
  const sb = supabaseAdmin();
  const basketId = await findBasket(owner);
  if (!sb || !basketId) return 0;
  const { data } = await sb.from("basket_items").select("qty").eq("basket_id", basketId);
  return ((data as any[]) || []).reduce((a, r) => a + (r.qty || 0), 0);
}

/* ---------------- writing ---------------- */

/* Flat, per the house pattern under `strict: false` — see lib/commerce/payment.ts. */
export type BasketOutcome = {
  ok: boolean;
  message: string;
  view: BasketView;
  product?: ResolvedProduct;
  /** set when a name matched more than one product and we would rather ask */
  candidates?: ResolvedProduct[];
};

export async function addToBasket(
  owner: BasketOwner,
  ref: string,
  qty = 1
): Promise<BasketOutcome> {
  const sb = supabaseAdmin();
  if (!sb) return { ok: false, view: EMPTY_BASKET, message: "The shop is not connected to its database right now." };

  const { product, candidates } = await resolveProduct(ref);
  if (!product) {
    if (candidates.length)
      return {
        ok: false,
        view: EMPTY_BASKET,
        message: `More than one product matches "${ref}".`,
        candidates,
      };
    return { ok: false, view: EMPTY_BASKET, message: `I could not find "${ref}" in our range.` };
  }
  if (product.status === "rejected")
    return { ok: false, view: EMPTY_BASKET, message: `${product.name} is not something we sell.` };
  if (product.price === null)
    return { ok: false, view: EMPTY_BASKET, message: `${product.name} has no price set yet, so it cannot go in a basket.` };

  const basketId = await getOrCreateBasket(owner);
  if (!basketId) return { ok: false, view: EMPTY_BASKET, message: "We could not open a basket for you just now." };

  const { data: existing } = await sb
    .from("basket_items")
    .select("id,qty")
    .eq("basket_id", basketId)
    .eq("product_id", product.id)
    .maybeSingle();

  if (existing) {
    // Quantity change only. The ORIGINAL snapshot price stands — a second unit
    // added a week later is charged at the price the customer first saw.
    await sb
      .from("basket_items")
      .update({ qty: (existing as any).qty + qty })
      .eq("id", (existing as any).id);
  } else {
    await sb.from("basket_items").insert({
      basket_id: basketId,
      product_id: product.id,
      qty,
      unit_price: product.price,
      currency: "EUR",
      name_snapshot: product.name,
      slug_snapshot: product.slug,
    });
  }
  await sb.from("baskets").update({ updated_at: new Date().toISOString() }).eq("id", basketId);

  const view = await basketView(owner);
  return {
    ok: true,
    view,
    product,
    message: `Added ${qty > 1 ? `${qty} × ` : ""}${product.name} to your basket.`,
  };
}

export async function setQty(owner: BasketOwner, itemId: string, qty: number): Promise<BasketOutcome> {
  const sb = supabaseAdmin();
  const basketId = await findBasket(owner);
  if (!sb || !basketId) return { ok: false, view: EMPTY_BASKET, message: "Your basket is empty." };
  // Scoped by basket id as well as item id: an item id from someone else's
  // basket must not be editable by guessing it.
  if (qty <= 0) {
    await sb.from("basket_items").delete().eq("id", itemId).eq("basket_id", basketId);
  } else {
    await sb.from("basket_items").update({ qty }).eq("id", itemId).eq("basket_id", basketId);
  }
  return { ok: true, view: await basketView(owner), message: "Basket updated." };
}

export async function removeFromBasket(owner: BasketOwner, ref: string): Promise<BasketOutcome> {
  const sb = supabaseAdmin();
  const basketId = await findBasket(owner);
  if (!sb || !basketId) return { ok: false, view: EMPTY_BASKET, message: "Your basket is empty." };

  const view = await basketView(owner);
  const needle = ref.trim().toLowerCase();
  const line =
    view.lines.find((l) => l.id === ref) ||
    view.lines.find((l) => l.productId === ref) ||
    view.lines.find((l) => l.slug === needle) ||
    view.lines.find((l) => l.name.toLowerCase().includes(needle));
  if (!line) return { ok: false, view: EMPTY_BASKET, message: `I could not find "${ref}" in your basket.` };

  await sb.from("basket_items").delete().eq("id", line.id).eq("basket_id", basketId);
  return { ok: true, view: await basketView(owner), message: `Removed ${line.name} from your basket.` };
}

export async function clearBasket(owner: BasketOwner): Promise<BasketOutcome> {
  const sb = supabaseAdmin();
  const basketId = await findBasket(owner);
  if (!sb || !basketId) return { ok: true, view: EMPTY_BASKET, message: "Your basket is already empty." };
  await sb.from("basket_items").delete().eq("basket_id", basketId);
  return { ok: true, view: await basketView(owner), message: "Basket emptied." };
}

/**
 * Sign-in merge. Someone who filled a basket and THEN made an account must not
 * lose it — that is the moment they were most willing to buy.
 *
 * Where both baskets hold the same product the quantities add and the ACCOUNT
 * basket's snapshot price wins, because it is the older promise.
 */
export async function mergeGuestBasket(customerId: string, guestKey: string | null): Promise<void> {
  if (!guestKey) return;
  const sb = supabaseAdmin();
  if (!sb) return;

  const guestId = await findBasket({ guestKey });
  if (!guestId) return;

  const { data: guestItems } = await sb
    .from("basket_items")
    .select("product_id,qty,unit_price,currency,name_snapshot,slug_snapshot,priced_at")
    .eq("basket_id", guestId);
  const items = (guestItems as any[]) || [];

  if (!items.length) {
    await sb.from("baskets").update({ status: "abandoned" }).eq("id", guestId);
    return;
  }

  const accountId = await getOrCreateBasket({ customerId });
  if (!accountId) return;

  const { data: mineRows } = await sb
    .from("basket_items")
    .select("id,product_id,qty")
    .eq("basket_id", accountId);
  const mine: Record<string, any> = {};
  for (const r of (mineRows as any[]) || []) mine[r.product_id] = r;

  for (const g of items) {
    const existing = mine[g.product_id];
    if (existing) {
      await sb.from("basket_items").update({ qty: existing.qty + g.qty }).eq("id", existing.id);
    } else {
      await sb.from("basket_items").insert({
        basket_id: accountId,
        product_id: g.product_id,
        qty: g.qty,
        unit_price: g.unit_price,
        currency: g.currency || "EUR",
        priced_at: g.priced_at,
        name_snapshot: g.name_snapshot,
        slug_snapshot: g.slug_snapshot,
      });
    }
  }

  await sb.from("basket_items").delete().eq("basket_id", guestId);
  await sb.from("baskets").update({ status: "abandoned" }).eq("id", guestId);
}
