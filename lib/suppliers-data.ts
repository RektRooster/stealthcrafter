import { supabaseAdmin } from "./supabase";
import { countryToIso2 } from "./map-data";

// ---- SUPPLIERS module (Supplier Intelligence) -------------------------------
// One server fetch feeding the /admin/suppliers console: every supplier with
// its workflow fields, every product_suppliers route (with product name/pillar
// joined in JS), plus honest coverage facts computed against the full catalogue.

export type TradeStatus = "none" | "to_open" | "applied" | "open";
export type Reliability = "unknown" | "low" | "medium" | "high";

export type SupplierRow = {
  id: string;
  name: string;
  type: string | null;
  website: string | null;
  contact: string | null;
  trade_account: boolean;
  authorised_distributor: boolean;
  reliability: Reliability | null;
  country: string | null; // free text as entered
  iso2: string | null; // EU-27 mapping via countryToIso2 (null outside EU)
  notes: string | null;
  trade_status: TradeStatus | null;
  last_contact: string | null; // YYYY-MM-DD
  next_action: string | null;
  next_action_date: string | null; // YYYY-MM-DD
  created_at: string | null;
  updated_at: string | null;
};

export type SupplierRoute = {
  id: string;
  product_id: string;
  supplier_id: string;
  role: string | null;
  moq: number | null;
  lead_time: string | null;
  wholesale_price: number | null;
  currency: string | null;
  vat_included: boolean | null;
  delivery_charge: number | null;
  stock_status: string | null;
  trade_discount_pct: number | null;
  ships_from_country: string | null;
  import_duty_risk: string | null;
  landed_cost: number | null;
  source_url: string | null;
  fulfilment_region: string | null;
  product_name: string;
  product_pillar: string | null;
  product_hero: boolean;
  product_eu_sourcing: string | null;
};

export type UncoveredHero = { id: string; name: string; pillar: string | null };

export type SuppliersConsoleData = {
  suppliers: SupplierRow[];
  routes: SupplierRoute[];
  productsTotal: number; // full catalogue size
  coveredProducts: number; // distinct product_id across all routes
  uncoveredCount: number; // products with zero routes
  uncoveredHeroes: UncoveredHero[]; // first 6 hero products with no route
  uncoveredHeroCount: number; // all hero products with no route
  reverifyRouteCount: number; // routes whose product notes flag "reverify"
};

// Supabase returns numeric columns as strings — coerce defensively.
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function productName(p: any): string {
  return p?.sc_product_name || p?.product_name || p?.example_product || "Unnamed product";
}

async function fetchAll(sb: any, table: string, fields: string): Promise<any[]> {
  const rows: any[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select(fields).range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

const ROUTE_FIELDS =
  "id,product_id,supplier_id,role,moq,lead_time,wholesale_price,currency,vat_included," +
  "delivery_charge,stock_status,trade_discount_pct,ships_from_country,import_duty_risk," +
  "landed_cost,source_url,fulfilment_region";

export async function getSuppliersConsole(): Promise<SuppliersConsoleData | null> {
  const sb = supabaseAdmin();
  if (!sb) return null;

  const [supplierRows, routeRows, totalRes, heroRes, reverifyRes] = await Promise.all([
    fetchAll(sb, "suppliers", "*"),
    fetchAll(sb, "product_suppliers", ROUTE_FIELDS),
    sb.from("products").select("id", { count: "exact", head: true }),
    sb
      .from("products")
      .select("id,sc_product_name,product_name,example_product,pillar")
      .eq("hero_product", true),
    // Real fact for the alerts panel: products whose internal notes flag a
    // price/spec reverify at purchase time, counted as affected routes.
    sb.from("products").select("id").ilike("internal_notes", "%reverify%"),
  ]);
  if (totalRes.error) throw totalRes.error;

  const suppliers: SupplierRow[] = supplierRows
    .map((s: any) => ({
      id: String(s.id),
      name: s.name || "Unnamed supplier",
      type: s.type ?? null,
      website: s.website ?? null,
      contact: s.contact ?? null,
      trade_account: Boolean(s.trade_account),
      authorised_distributor: Boolean(s.authorised_distributor),
      reliability: (s.reliability as Reliability) ?? null,
      country: s.country ?? null,
      iso2: countryToIso2(s.country),
      notes: s.notes ?? null,
      trade_status: (s.trade_status as TradeStatus) ?? null,
      last_contact: s.last_contact ?? null,
      next_action: s.next_action ?? null,
      next_action_date: s.next_action_date ?? null,
      created_at: s.created_at ?? null,
      updated_at: s.updated_at ?? null,
    }))
    .sort((a: SupplierRow, b: SupplierRow) => a.name.localeCompare(b.name));

  // ---- join product names onto routes (chunked id lookup) ----
  const coveredIds = [...new Set(routeRows.map((r: any) => r.product_id).filter(Boolean).map(String))];
  const prodMap: Record<string, { name: string; pillar: string | null; hero: boolean; eu_sourcing: string | null }> = {};
  for (let i = 0; i < coveredIds.length; i += 200) {
    const { data, error } = await sb
      .from("products")
      .select("id,sc_product_name,product_name,example_product,pillar,hero_product,eu_sourcing")
      .in("id", coveredIds.slice(i, i + 200));
    if (error) throw error;
    (data || []).forEach((p: any) => {
      prodMap[String(p.id)] = {
        name: productName(p),
        pillar: p.pillar ?? null,
        hero: Boolean(p.hero_product),
        eu_sourcing: p.eu_sourcing ?? null,
      };
    });
  }

  const routes: SupplierRoute[] = routeRows
    .filter((r: any) => r.product_id && r.supplier_id)
    .map((r: any) => {
      const p = prodMap[String(r.product_id)];
      return {
        id: String(r.id),
        product_id: String(r.product_id),
        supplier_id: String(r.supplier_id),
        role: r.role ?? null,
        moq: num(r.moq),
        lead_time: r.lead_time ?? null,
        wholesale_price: num(r.wholesale_price),
        currency: r.currency ?? null,
        vat_included: r.vat_included === null || r.vat_included === undefined ? null : Boolean(r.vat_included),
        delivery_charge: num(r.delivery_charge),
        stock_status: r.stock_status ?? null,
        trade_discount_pct: num(r.trade_discount_pct),
        ships_from_country: r.ships_from_country ?? null,
        import_duty_risk: r.import_duty_risk ?? null,
        landed_cost: num(r.landed_cost),
        source_url: r.source_url ?? null,
        fulfilment_region: r.fulfilment_region ?? null,
        product_name: p?.name || "Unknown product",
        product_pillar: p?.pillar ?? null,
        product_hero: Boolean(p?.hero),
        product_eu_sourcing: p?.eu_sourcing ?? null,
      };
    });

  // ---- coverage facts ----
  const coveredSet = new Set(routes.map((r) => r.product_id));
  const productsTotal = totalRes.count ?? 0;
  const uncoveredCount = Math.max(0, productsTotal - coveredSet.size);

  const heroes = (heroRes.error ? [] : heroRes.data || []) as any[];
  const uncoveredHeroesAll: UncoveredHero[] = heroes
    .filter((p) => !coveredSet.has(String(p.id)))
    .map((p) => ({ id: String(p.id), name: productName(p), pillar: p.pillar ?? null }))
    .sort((a, b) => (a.pillar || "~").localeCompare(b.pillar || "~") || a.name.localeCompare(b.name));

  const reverifyIds = new Set(
    (reverifyRes.error ? [] : reverifyRes.data || []).map((p: any) => String(p.id))
  );
  const reverifyRouteCount = routes.filter((r) => reverifyIds.has(r.product_id)).length;

  return {
    suppliers,
    routes,
    productsTotal,
    coveredProducts: coveredSet.size,
    uncoveredCount,
    uncoveredHeroes: uncoveredHeroesAll.slice(0, 6),
    uncoveredHeroCount: uncoveredHeroesAll.length,
    reverifyRouteCount,
  };
}
