// The customer account area, read in one place.
//
// "My kit" is the point worth noticing: it comes from `owned_equipment`, which
// keys on `jimmy_profiles.id`. A customer's household IS a Jimmy profile, so
// equipment Jimmy has credited during a conversation shows up here without any
// syncing between two systems — because there is only one system.

import { supabaseAdmin } from "../supabase";
import { parseImages } from "../catalogue-data";
import { ordersForCustomer, type OrderRecord } from "./orders";
import type { CustomerRow } from "../customer-auth";

export type KitItem = {
  id: string;
  label: string;
  kit: string | null;
  qty: number;
  acquiredAt: string | null;
  expiresAt: string | null;
  condition: string | null;
  productSlug: string | null;
  image: string | null;
  /** true when a stored expiry date has already passed */
  expired: boolean;
};

export type SavedAddress = {
  id: string;
  label: string | null;
  fullName: string | null;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postcode: string | null;
  countryIso2: string;
  phone: string | null;
  defaultShipping: boolean;
};

export type AccountData = {
  customer: CustomerRow;
  profile: { id: string; name: string; household: any; equipment: any } | null;
  kit: KitItem[];
  addresses: SavedAddress[];
  orders: OrderRecord[];
};

export async function accountData(customer: CustomerRow): Promise<AccountData> {
  const sb = supabaseAdmin();
  const empty: AccountData = { customer, profile: null, kit: [], addresses: [], orders: [] };
  if (!sb) return empty;

  const orders = await ordersForCustomer(customer.id);

  let profile: AccountData["profile"] = null;
  let kit: KitItem[] = [];
  if (customer.profile_id) {
    const { data: p } = await sb
      .from("jimmy_profiles")
      .select("id,name,household,equipment")
      .eq("id", customer.profile_id)
      .maybeSingle();
    profile = (p as any) ?? null;

    const { data: owned } = await sb
      .from("owned_equipment")
      .select("id,label,kit,qty,acquired_at,expires_at,condition,product_id")
      .eq("profile_id", customer.profile_id)
      .order("created_at", { ascending: false })
      .limit(200);
    const rows = (owned as any[]) || [];
    const ids = rows.map((r) => r.product_id).filter(Boolean);
    const byId: Record<string, any> = {};
    if (ids.length) {
      const { data: prods } = await sb
        .from("products")
        .select("id,slug,sc_product_name,product_name,image_urls")
        .in("id", ids);
      for (const pr of (prods as any[]) || []) byId[pr.id] = pr;
    }
    const today = new Date().toISOString().slice(0, 10);
    kit = rows.map((r) => {
      const pr = r.product_id ? byId[r.product_id] : null;
      return {
        id: r.id,
        label: r.label || pr?.sc_product_name || pr?.product_name || "Item",
        kit: r.kit ?? null,
        qty: r.qty ?? 1,
        acquiredAt: r.acquired_at ?? null,
        expiresAt: r.expires_at ?? null,
        condition: r.condition ?? null,
        productSlug: pr?.slug ?? null,
        image: pr ? parseImages(pr.image_urls)[0] ?? null : null,
        expired: Boolean(r.expires_at && r.expires_at < today),
      };
    });
  }

  const { data: addrRows } = await sb
    .from("customer_addresses")
    .select("*")
    .eq("customer_id", customer.id)
    .order("is_default_shipping", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(20);
  const addresses: SavedAddress[] = ((addrRows as any[]) || []).map((a) => ({
    id: a.id,
    label: a.label ?? null,
    fullName: a.full_name ?? null,
    line1: a.line1,
    line2: a.line2 ?? null,
    city: a.city,
    region: a.region ?? null,
    postcode: a.postcode ?? null,
    countryIso2: a.country_iso2,
    phone: a.phone ?? null,
    defaultShipping: Boolean(a.is_default_shipping),
  }));

  return { customer, profile, kit, addresses, orders };
}

/** The most recent saved address, used to prefill checkout. */
export async function defaultAddress(customerId: string): Promise<any | null> {
  const sb = supabaseAdmin();
  if (!sb) return null;
  const { data } = await sb
    .from("customer_addresses")
    .select("*")
    .eq("customer_id", customerId)
    .order("is_default_shipping", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}
