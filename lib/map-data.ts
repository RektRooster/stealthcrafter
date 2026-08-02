import { supabaseAdmin } from "./supabase";
import { EU27_ISO2 } from "./eu-map";

// ---- Free-text country name -> ISO2 (EU-27) --------------------------------
// suppliers.country and product_suppliers.ships_from_country are free text.
// Non-EU names resolve to null and are counted in an "outside EU" bucket.
const NAME_TO_ISO2: Record<string, string> = {
  austria: "AT",
  belgium: "BE",
  bulgaria: "BG",
  croatia: "HR",
  cyprus: "CY",
  czechia: "CZ",
  "czech republic": "CZ",
  "the czech republic": "CZ",
  denmark: "DK",
  estonia: "EE",
  finland: "FI",
  france: "FR",
  germany: "DE",
  greece: "GR",
  hungary: "HU",
  ireland: "IE",
  "republic of ireland": "IE",
  italy: "IT",
  latvia: "LV",
  lithuania: "LT",
  luxembourg: "LU",
  malta: "MT",
  netherlands: "NL",
  "the netherlands": "NL",
  holland: "NL",
  poland: "PL",
  portugal: "PT",
  romania: "RO",
  slovakia: "SK",
  "slovak republic": "SK",
  slovenia: "SI",
  spain: "ES",
  sweden: "SE",
};

function lookupOne(key: string): string | null {
  if (NAME_TO_ISO2[key]) return NAME_TO_ISO2[key];
  const up = key.toUpperCase();
  if (up.length === 2 && up !== "EU" && EU27_ISO2.includes(up)) return up; // already ISO2
  return null;
}

export function countryToIso2(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = String(raw).trim().toLowerCase();
  if (!key) return null;
  const direct = lookupOne(key);
  if (direct) return direct;
  // Compound values like "Netherlands/EU" -> try the first named part.
  if (key.includes("/")) {
    const first = lookupOne(key.split("/")[0].trim());
    if (first) return first;
  }
  // "EU", "EU (unspecified)", "Unconfirmed (…)", UK, USA, … -> no EU-27 pin.
  return null;
}

// ---- country_markets --------------------------------------------------------
export type CountryMarket = {
  iso2: string;
  name: string;
  languages: string | null;
  currency: string | null;
  market_status: "researching" | "supplier_ready" | "active" | "compliance_hold";
  market_readiness: number | null;
  priority: boolean;
  favourite: boolean;
  compliance_notes: string | null;
  shipping_notes: string | null;
  notes: string | null;
  updated_at: string | null;
};

export async function getCountryMarkets(): Promise<CountryMarket[] | null> {
  const sb = supabaseAdmin();
  if (!sb) return null;
  const { data, error } = await sb.from("country_markets").select("*").order("name");
  if (error) throw error;
  return (data || []) as CountryMarket[];
}

export async function getCountryMarket(iso2: string): Promise<CountryMarket | null> {
  const sb = supabaseAdmin();
  if (!sb) return null;
  const { data, error } = await sb
    .from("country_markets")
    .select("*")
    .eq("iso2", iso2.toUpperCase())
    .maybeSingle();
  if (error) throw error;
  return (data as CountryMarket) || null;
}

// ---- Computed per-country supply stats -------------------------------------
export type CountrySupply = {
  suppliers: number;
  routes: number;
  products: number; // distinct products with a route shipping from this country
};

export type SupplyStats = {
  byIso2: Record<string, CountrySupply>;
  outsideEu: { suppliers: number; routes: number };
};

type SupplierRow = {
  id: string;
  name: string;
  country: string | null;
  trade_account: boolean | null;
  reliability: string | null;
};

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

export async function getSupplyStats(): Promise<SupplyStats | null> {
  const sb = supabaseAdmin();
  if (!sb) return null;
  const suppliers: SupplierRow[] = await fetchAll(sb, "suppliers", "id,name,country,trade_account,reliability");
  const routes = await fetchAll(sb, "product_suppliers", "product_id,supplier_id,ships_from_country");

  const supplierIso: Record<string, string | null> = {};
  const byIso2: Record<string, CountrySupply> = {};
  for (const c of EU27_ISO2) byIso2[c] = { suppliers: 0, routes: 0, products: 0 };
  const outsideEu = { suppliers: 0, routes: 0 };

  for (const s of suppliers) {
    const iso = countryToIso2(s.country);
    supplierIso[s.id] = iso;
    if (iso) byIso2[iso].suppliers++;
    else if (s.country) outsideEu.suppliers++;
  }

  const productsByIso: Record<string, Set<string>> = {};
  for (const r of routes) {
    // Route origin: explicit ships_from_country, else the supplier's country.
    const iso = countryToIso2(r.ships_from_country) ?? supplierIso[r.supplier_id] ?? null;
    if (!iso) {
      // Origin named but not an EU-27 member (UK, CH, CN, …) -> outside-EU bucket.
      if (r.ships_from_country) outsideEu.routes++;
      continue;
    }
    byIso2[iso].routes++;
    if (r.product_id) {
      (productsByIso[iso] ||= new Set()).add(String(r.product_id));
    }
  }
  for (const [iso, set] of Object.entries(productsByIso)) byIso2[iso].products = set.size;

  return { byIso2, outsideEu };
}

// ---- Country profile detail -------------------------------------------------
export type CountryDetail = {
  suppliers: { id: string; name: string; trade_account: boolean; reliability: string | null }[];
  routeCount: number;
  products: { id: string; name: string; hero: boolean }[];
  productCount: number;
};

export async function getCountryDetail(iso2: string): Promise<CountryDetail | null> {
  const sb = supabaseAdmin();
  if (!sb) return null;
  const suppliers: SupplierRow[] = await fetchAll(sb, "suppliers", "id,name,country,trade_account,reliability");
  const routes = await fetchAll(sb, "product_suppliers", "product_id,supplier_id,ships_from_country");

  const supplierIso: Record<string, string | null> = {};
  for (const s of suppliers) supplierIso[s.id] = countryToIso2(s.country);

  const here = suppliers
    .filter((s) => supplierIso[s.id] === iso2)
    .map((s) => ({
      id: s.id,
      name: s.name,
      trade_account: Boolean(s.trade_account),
      reliability: s.reliability ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const productIds = new Set<string>();
  let routeCount = 0;
  for (const r of routes) {
    const iso = countryToIso2(r.ships_from_country) ?? supplierIso[r.supplier_id] ?? null;
    if (iso !== iso2) continue;
    routeCount++;
    if (r.product_id) productIds.add(String(r.product_id));
  }

  const ids = [...productIds];
  const products: { id: string; name: string; hero: boolean }[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb
      .from("products")
      .select("id,sc_product_name,product_name,example_product,hero_product")
      .in("id", ids.slice(i, i + 200));
    (data || []).forEach((p: any) =>
      products.push({
        id: p.id,
        name: p.sc_product_name || p.product_name || p.example_product || "Unnamed product",
        hero: Boolean(p.hero_product),
      })
    );
  }
  products.sort((a, b) => Number(b.hero) - Number(a.hero) || a.name.localeCompare(b.name));

  return { suppliers: here, routeCount, products, productCount: ids.length };
}
