// STOREFRONT CATALOGUE — data layer.
//
// The organising idea: every product carries an evidence state, and the state
// is a first-class field rather than something hidden. A product we have only
// identified says so. A product we assessed and rejected says so, and why.
// Nobody in this market admits what they have not verified; doing it from day
// one is the credibility asset.
import { supabaseAdmin } from "./supabase";

export type EvidenceState = "listed" | "tested" | "approved" | "sourcing" | "identified" | "rejected";

export const EVIDENCE_ORDER: EvidenceState[] = [
  "listed",
  "tested",
  "approved",
  "sourcing",
  "identified",
  "rejected",
];

export const EVIDENCE_META: Record<
  EvidenceState,
  { label: string; short: string; blurb: string; tone: "go" | "warm" | "mid" | "low" | "stop" }
> = {
  listed: {
    label: "Listed",
    short: "Ready to buy",
    blurb: "Approved, tested by us, sourced and priced.",
    tone: "go",
  },
  tested: {
    label: "Tested",
    short: "Tested by us",
    blurb: "We have put this through a StealthCrafter test session and published the result.",
    tone: "go",
  },
  approved: {
    label: "Approved",
    short: "Approved, not yet tested",
    blurb: "It has cleared our product review. We have not run it through a test session yet.",
    tone: "warm",
  },
  sourcing: {
    label: "Sourcing",
    short: "Supply route found",
    blurb: "We have a supplier route we trust. The product itself is still in review.",
    tone: "mid",
  },
  identified: {
    label: "Identified",
    short: "On our research list",
    blurb: "It is on our list to assess. We have not verified anything about it yet — treat nothing here as a recommendation.",
    tone: "low",
  },
  rejected: {
    label: "Rejected",
    short: "We said no",
    blurb: "We assessed this and decided against carrying it.",
    tone: "stop",
  },
};

export type CatalogueProduct = {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  category: string;
  categoryId: number | null;
  pillar: string | null;
  subcategory: string | null;
  image: string | null;
  price: number | null;
  priceBasis: string | null;
  currency: string;
  state: EvidenceState;
  hero: boolean;
  superHero: boolean;
  ce: boolean;
  safetyCritical: boolean;
  dangerousGoods: boolean;
  ageRestricted: boolean;
  euSourcing: string | null;
  routes: number;
  summary: string | null;
  tested: boolean;
};

export type CatalogueCategory = { id: number; name: string; count: number; listed: number };

/* GBP rows are converted for display only. The currency column itself is an
   open cross-team decision (canon is ex-VAT EUR) and is deliberately untouched. */
const GBP_TO_EUR = 1.17;

export function toEur(price: number | null, currency: string | null): number | null {
  if (price === null || !Number.isFinite(price)) return null;
  return (currency || "EUR").toUpperCase() === "GBP" ? Math.round(price * GBP_TO_EUR * 100) / 100 : price;
}

export function fmtEur(price: number | null): string {
  if (price === null) return "—";
  return `€${price.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* image_urls is a JSON array stored in a text column — ["https://…", …].
   Parse it properly, and fall back to scraping URLs out of whatever shape the
   row actually holds. */
export function parseImages(raw: string | null): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) {
        return arr.map((u) => String(u).trim()).filter((u) => /^https?:\/\//.test(u));
      }
    } catch {
      /* fall through to the scrape below */
    }
  }
  return (trimmed.match(/https?:\/\/[^\s",'\]]+/g) || []).map((u) => u.trim());
}

function firstImage(raw: string | null): string | null {
  return parseImages(raw)[0] ?? null;
}

function stateOf(p: any, testedIds: Set<string>): EvidenceState {
  if (p.product_status === "rejected") return "rejected";
  const isTested = testedIds.has(p.id);
  const approved = p.product_status === "approved" || p.product_status === "listed";
  if (approved && isTested && p.selling_price !== null) return "listed";
  if (isTested) return "tested";
  if (approved) return "approved";
  if (p.research_stage === "supplier_route_approved") return "sourcing";
  return "identified";
}

const FIELDS =
  "id,slug,sc_product_name,product_name,example_product,brand,pillar,category_id,subcategory," +
  "image_urls,selling_price,price_basis,currency,product_status,research_stage,hero_product,super_hero," +
  "ce_certified,safety_critical,dangerous_goods,age_restricted,eu_sourcing,customer_notes,description";

function shape(p: any, cats: Record<number, string>, testedIds: Set<string>, routes: Record<string, number>): CatalogueProduct {
  return {
    id: p.id,
    slug: p.slug,
    name: p.sc_product_name || p.product_name || p.example_product || "Unnamed product",
    brand: p.brand || null,
    category: cats[p.category_id] || "Uncategorised",
    categoryId: p.category_id ?? null,
    pillar: p.pillar || null,
    subcategory: p.subcategory || null,
    image: firstImage(p.image_urls),
    price: p.selling_price === null ? null : Number(p.selling_price),
    priceBasis: p.price_basis || null,
    currency: p.currency || "EUR",
    state: stateOf(p, testedIds),
    hero: Boolean(p.hero_product),
    superHero: Boolean(p.super_hero),
    ce: Boolean(p.ce_certified),
    safetyCritical: Boolean(p.safety_critical),
    dangerousGoods: Boolean(p.dangerous_goods),
    ageRestricted: Boolean(p.age_restricted),
    euSourcing: p.eu_sourcing || null,
    routes: routes[p.id] || 0,
    summary: (p.customer_notes || p.description || null)?.trim() || null,
    tested: testedIds.has(p.id),
  };
}

async function testedProductIds(sb: any): Promise<Set<string>> {
  try {
    const { data } = await sb.from("test_sessions").select("product_id").eq("status", "completed");
    return new Set((data || []).map((r: any) => r.product_id).filter(Boolean));
  } catch {
    return new Set();
  }
}

async function routeCounts(sb: any): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  try {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from("product_suppliers").select("product_id").range(from, from + PAGE - 1);
      if (error) break;
      const batch = data || [];
      for (const r of batch) if (r.product_id) out[r.product_id] = (out[r.product_id] || 0) + 1;
      if (batch.length < PAGE) break;
    }
  } catch {
    /* routes are additive detail; absence is not fatal */
  }
  return out;
}

async function categoryMap(sb: any): Promise<Record<number, string>> {
  const { data } = await sb.from("categories").select("id,name");
  const map: Record<number, string> = {};
  (data || []).forEach((c: any) => (map[c.id] = c.name));
  return map;
}

export type CatalogueData = {
  configured: boolean;
  products: CatalogueProduct[];
  categories: CatalogueCategory[];
  brands: string[];
  counts: Record<EvidenceState, number>;
};

export async function getCatalogueData(): Promise<CatalogueData> {
  const sb = supabaseAdmin();
  if (!sb)
    return { configured: false, products: [], categories: [], brands: [], counts: emptyCounts() };

  const [cats, testedIds, routes] = await Promise.all([
    categoryMap(sb),
    testedProductIds(sb),
    routeCounts(sb),
  ]);

  const rows: any[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("products")
      .select(FIELDS)
      .order("category_id", { ascending: true })
      .order("sc_product_name", { ascending: true, nullsFirst: false })
      .range(from, from + PAGE - 1);
    if (error) break;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }

  const products = rows.filter((r) => r.slug).map((r) => shape(r, cats, testedIds, routes));

  const counts = emptyCounts();
  const byCat: Record<number, CatalogueCategory> = {};
  const brands = new Set<string>();
  for (const p of products) {
    counts[p.state]++;
    if (p.brand) brands.add(p.brand);
    if (p.categoryId === null) continue;
    const c = (byCat[p.categoryId] ||= {
      id: p.categoryId,
      name: p.category,
      count: 0,
      listed: 0,
    });
    c.count++;
    if (p.state === "listed" || p.state === "tested" || p.state === "approved") c.listed++;
  }

  return {
    configured: true,
    products,
    categories: Object.values(byCat).sort((a, b) => b.count - a.count),
    brands: [...brands].sort((a, b) => a.localeCompare(b)),
    counts,
  };
}

function emptyCounts(): Record<EvidenceState, number> {
  return { listed: 0, tested: 0, approved: 0, sourcing: 0, identified: 0, rejected: 0 };
}

/* ---------------- single product (evidence page) ---------------- */

export type ProductRoute = {
  supplier: string;
  role: string | null;
  stock: string | null;
  shipsFrom: string | null;
  region: string | null;
};

export type ProductDetail = CatalogueProduct & {
  sku: string | null;
  model: string | null;
  manufacturer: string | null;
  countryOfManufacture: string | null;
  description: string | null;
  safetyNotes: string | null;
  shippingRestrictions: string | null;
  certificationsNotes: string | null;
  includedContents: string | null;
  materials: string | null;
  specs: { label: string; value: string }[];
  flags: { ukca: boolean; fda: boolean; iso: boolean; maintenance: boolean };
  shelfLife: string | null;
  warranty: string | null;
  researchStage: string | null;
  researchConfidence: string | null;
  productStatus: string | null;
  routeList: ProductRoute[];
  imagesAll: string[];
};

const SPEC_FIELDS: [string, string][] = [
  ["weight", "Weight"],
  ["dimensions", "Dimensions"],
  ["materials", "Materials"],
  ["power_source", "Power source"],
  ["waterproof_rating", "Waterproof rating"],
  ["operating_temperature", "Operating temperature"],
  ["indoor_outdoor", "Indoor / outdoor"],
  ["colour_options", "Colour options"],
  ["size_options", "Size options"],
  ["shelf_life", "Shelf life"],
  ["barcode_ean", "EAN"],
];

export async function getProductBySlug(slug: string): Promise<ProductDetail | null> {
  const sb = supabaseAdmin();
  if (!sb) return null;

  const { data, error } = await sb.from("products").select("*").eq("slug", slug).maybeSingle();
  if (error || !data) return null;

  const [cats, testedIds] = await Promise.all([categoryMap(sb), testedProductIds(sb)]);

  let routeList: ProductRoute[] = [];
  try {
    const { data: rs } = await sb
      .from("product_suppliers")
      .select("supplier_id,role,stock_status,ships_from_country,fulfilment_region")
      .eq("product_id", data.id);
    const ids = [...new Set((rs || []).map((r: any) => r.supplier_id).filter(Boolean))];
    const names: Record<string, string> = {};
    if (ids.length) {
      const { data: sup } = await sb.from("suppliers").select("id,name").in("id", ids);
      (sup || []).forEach((s: any) => (names[s.id] = s.name));
    }
    routeList = (rs || []).map((r: any) => ({
      supplier: names[r.supplier_id] || "Unnamed supplier",
      role: r.role || null,
      stock: r.stock_status || null,
      shipsFrom: r.ships_from_country || null,
      region: r.fulfilment_region || null,
    }));
  } catch {
    routeList = [];
  }

  const base = shape(data, cats, testedIds, { [data.id]: routeList.length });

  const specs = SPEC_FIELDS.map(([k, label]) => ({ label, value: String(data[k] ?? "").trim() })).filter(
    (s) => s.value.length > 0
  );

  const imagesAll = parseImages(data.image_urls);

  return {
    ...base,
    routes: routeList.length,
    sku: data.sku || null,
    model: data.model || null,
    manufacturer: data.manufacturer || null,
    countryOfManufacture: data.country_of_manufacture || null,
    description: (data.description || "").trim() || null,
    safetyNotes: (data.safety_notes || "").trim() || null,
    shippingRestrictions: (data.shipping_restrictions || "").trim() || null,
    certificationsNotes: (data.certifications_notes || "").trim() || null,
    includedContents: (data.included_contents || "").trim() || null,
    materials: (data.materials || "").trim() || null,
    specs,
    flags: {
      ukca: Boolean(data.ukca_certified),
      fda: Boolean(data.fda_approved),
      iso: Boolean(data.iso_certified),
      maintenance: Boolean(data.maintenance_required),
    },
    shelfLife: (data.shelf_life || "").trim() || null,
    warranty: (data.warranty || "").trim() || null,
    researchStage: data.research_stage || null,
    researchConfidence: data.research_confidence || null,
    productStatus: data.product_status || null,
    routeList,
    imagesAll,
  };
}
