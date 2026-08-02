import { supabaseAdmin } from "./supabase";

export async function getCategories(): Promise<Record<number, string>> {
  const sb = supabaseAdmin();
  if (!sb) return {};
  const { data } = await sb.from("categories").select("id,name");
  const map: Record<number, string> = {};
  (data || []).forEach((c: any) => {
    map[c.id] = c.name;
  });
  return map;
}

export async function getCategoryList(): Promise<{ id: number; name: string }[]> {
  const sb = supabaseAdmin();
  if (!sb) return [];
  const { data } = await sb.from("categories").select("id,name").order("name", { ascending: true });
  return (data || []) as { id: number; name: string }[];
}

const LIST_FIELDS =
  "id,sc_product_name,product_name,example_product,brand,pillar,category_id,subcategory,product_type,research_stage,research_confidence,needs_review,product_status,wholesale_price,landed_cost,retail_price_rrp,selling_price,currency,image_urls,hero_product,safety_critical,dangerous_goods,ce_certified,images_complete,sku,eu_sourcing,created_at";

// Full catalogue (every product), category name resolved. Paged to beat the
// PostgREST 1000-row default cap so all ~1,099 rows come through.
export async function getCatalogue(): Promise<any[] | null> {
  const sb = supabaseAdmin();
  if (!sb) return null;
  const cats = await getCategories();
  const all: any[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("products")
      .select(LIST_FIELDS)
      .order("category_id", { ascending: true })
      .order("sc_product_name", { ascending: true, nullsFirst: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = data || [];
    all.push(...batch);
    if (batch.length < PAGE) break;
  }
  return all.map((p: any) => ({ ...p, category: cats[p.category_id] || "—" }));
}

// ---- Supplier-route summary per product (Command Center) --------------------
// One paged query over product_suppliers + a supplier-name lookup, joined in JS.
const SUPPLY_FIELDS =
  "product_id,supplier_id,role,stock_status,wholesale_price,currency,ships_from_country,fulfilment_region";

export type SupplySummary = { count: number; primary: any | null };

const ROLE_RANK: Record<string, number> = {
  primary: 0,
  secondary: 1,
  distributor: 2,
  backup: 3,
  emergency_retail: 4,
};

export async function getSupplyIndex(): Promise<Record<string, SupplySummary>> {
  const sb = supabaseAdmin();
  if (!sb) return {};
  const rows: any[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("product_suppliers")
      .select(SUPPLY_FIELDS)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  const supIds = [...new Set(rows.map((r) => r.supplier_id).filter(Boolean))];
  const supNames: Record<string, string> = {};
  for (let i = 0; i < supIds.length; i += 200) {
    const { data } = await sb.from("suppliers").select("id,name").in("id", supIds.slice(i, i + 200));
    (data || []).forEach((s: any) => (supNames[s.id] = s.name));
  }
  const idx: Record<string, SupplySummary> = {};
  for (const r of rows) {
    if (!r.product_id) continue;
    const entry = idx[r.product_id] || (idx[r.product_id] = { count: 0, primary: null });
    entry.count++;
    const rank = ROLE_RANK[r.role] ?? 9;
    const curRank = entry.primary ? ROLE_RANK[entry.primary.role] ?? 9 : 99;
    if (rank < curRank) entry.primary = { ...r, supplier_name: supNames[r.supplier_id] || null };
  }
  return idx;
}

// Full catalogue with supplier-route summary joined in (supplier_count + primary_route).
export async function getCatalogueWithSupply(): Promise<any[] | null> {
  const products = await getCatalogue();
  if (products === null) return null;
  let supply: Record<string, SupplySummary> = {};
  try {
    supply = await getSupplyIndex();
  } catch {
    supply = {};
  }
  return products.map((p) => {
    const s = supply[p.id];
    return { ...p, supplier_count: s?.count || 0, primary_route: s?.primary || null };
  });
}

// Kept for compatibility: heroes only.
export async function getHeroes(): Promise<any[] | null> {
  const sb = supabaseAdmin();
  if (!sb) return null;
  const cats = await getCategories();
  const { data, error } = await sb
    .from("products")
    .select(LIST_FIELDS)
    .eq("hero_product", true)
    .order("category_id", { ascending: true });
  if (error) throw error;
  return (data || []).map((p: any) => ({ ...p, category: cats[p.category_id] || "—" }));
}

export async function getProduct(id: string): Promise<any | null> {
  const sb = supabaseAdmin();
  if (!sb) return null;
  const { data: product, error } = await sb.from("products").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!product) return { product: null, routes: [], sources: [] };
  const cats = await getCategories();

  let routes: any[] = [];
  try {
    const { data: r } = await sb.from("product_suppliers").select("*").eq("product_id", id);
    routes = r || [];
    const supIds = [...new Set(routes.map((x) => x.supplier_id).filter(Boolean))];
    if (supIds.length) {
      const { data: sups } = await sb.from("suppliers").select("*").in("id", supIds);
      const supMap: Record<string, any> = {};
      (sups || []).forEach((s: any) => (supMap[s.id] = s));
      routes = routes.map((x) => ({ ...x, supplier: supMap[x.supplier_id] || null }));
    }
  } catch {
    routes = [];
  }

  let sources: any[] = [];
  try {
    const { data: s } = await sb.from("data_sources").select("*").eq("entity_id", id);
    sources = s || [];
  } catch {
    sources = [];
  }

  return { product: { ...product, category: cats[product.category_id] || "—" }, routes, sources };
}
