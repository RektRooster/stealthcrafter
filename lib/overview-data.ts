import { supabaseAdmin } from "./supabase";
import { countryToIso2 } from "./map-data";
import { EU27_ISO2 } from "./eu-map";
import { getCompetitors } from "./competitors-data";
import { loadSettings } from "./jimmy/service";

// ---- OVERVIEW module (Command Center landing) -------------------------------
// One lean server fetch feeding /admin/overview. Every figure is computed from
// Supabase — count-only head queries where possible, tiny-table pulls where a
// rollup needs the rows (test_sessions, suppliers, compliance_items). Nothing
// here is invented; sections whose tables are unreachable degrade to null and
// the page renders an honest empty state.

export type OverviewProducts = {
  total: number;
  approved: number; // product_status approved | listed (product-console rule)
  needsReview: number;
  heroes: number;
  imagesComplete: number;
};

export type OverviewTesting = {
  active: number;
  completed: number;
  pass: number;
  review: number;
  fail: number;
  untested: number; // products with no completed session (Test Lab queue rule)
};

export type OverviewSuppliers = {
  total: number;
  tradeOpen: number;
  toOpen: number;
  applied: number;
  covered: number; // distinct products with >=1 supplier route
  productsTotal: number;
  uncoveredHeroes: number; // hero products with zero routes
};

export type OverviewMarkets = {
  tracked: number; // rows in country_markets
  active: number;
  withSuppliers: number; // EU-27 states with >=1 supplier based there
  priority: number;
  assessed: number; // market_readiness recorded
};

export type OverviewWarRoom = {
  tracked: number;
  topName: string | null;
  topLabel: string | null; // founder band label, or "AUTO n/100"
  advertising: number; // rivals with paid keywords in the latest pull
  totalTraffic: number; // sum of org_traffic across latest pulls
  lastPulled: string | null; // most recent Ahrefs pull timestamp
};

export type OverviewJimmy = {
  online: boolean; // !kill_switch
  provider: string;
  model: string;
  knowledgeTotal: number;
  knowledgeSigned: number;
  evalGraded: number;
  evalPassRate: number | null; // null until at least one graded run
  conversations: number | null;
  safetyFires: number | null; // deterministic safety-trigger fires
};

export type OverviewCompliance = {
  holds: number; // isComplianceHold() rule, computed server-side
  dangerousGoods: number;
  openItems: number; // register status open | in_review
  openGateItems: number;
  ceCertified: number;
  productsTotal: number;
  gateItems: { id: string; title: string }[]; // open gate items, for actions
};

export type OverviewData = {
  products: OverviewProducts;
  testing: OverviewTesting;
  suppliers: OverviewSuppliers;
  markets: OverviewMarkets | null;
  warRoom: OverviewWarRoom | null;
  jimmy: OverviewJimmy | null;
  compliance: OverviewCompliance;
};

const APPROVED_STATUSES = ["approved", "listed"];

// Same OR the product console's isComplianceHold() applies per-product, pushed
// down to Postgres so no product rows are pulled.
const HOLD_OR =
  "dangerous_goods.eq.true," +
  "internal_notes.ilike.%compliance%," +
  "internal_notes.ilike.%medicine%," +
  "internal_notes.ilike.%potassium iodide%";

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

function headCount(sb: any, table: string) {
  return sb.from(table).select("id", { count: "exact", head: true });
}

// Founder threat_level OVERRIDE outranks the auto score (War Room rule).
const LEVEL_SORT: Record<string, number> = { low: 20, medium: 50, high: 70, critical: 90 };

export async function getOverview(): Promise<OverviewData | null> {
  const sb = supabaseAdmin();
  if (!sb) return null;

  const [
    totalRes,
    approvedRes,
    reviewRes,
    imagesRes,
    ceRes,
    dgRes,
    holdsRes,
    heroRes,
    sessionRows,
    supplierRows,
    routeRows,
    itemRows,
  ] = await Promise.all([
    headCount(sb, "products"),
    headCount(sb, "products").in("product_status", APPROVED_STATUSES),
    headCount(sb, "products").eq("needs_review", true),
    headCount(sb, "products").eq("images_complete", true),
    headCount(sb, "products").eq("ce_certified", true),
    headCount(sb, "products").eq("dangerous_goods", true),
    headCount(sb, "products").or(HOLD_OR),
    // Hero ids (needed for the uncovered-heroes fact — small, id-only pull).
    sb.from("products").select("id").eq("hero_product", true),
    fetchAll(sb, "test_sessions", "status,verdict,product_id"),
    fetchAll(sb, "suppliers", "id,country,trade_status"),
    fetchAll(sb, "product_suppliers", "product_id"),
    fetchAll(sb, "compliance_items", "id,title,status,severity"),
  ]);
  if (totalRes.error) throw totalRes.error;
  if (heroRes.error) throw heroRes.error;
  const heroIds = (heroRes.data || []).map((p: any) => String(p.id));

  const productsTotal = totalRes.count ?? 0;

  const products: OverviewProducts = {
    total: productsTotal,
    approved: approvedRes.count ?? 0,
    needsReview: reviewRes.count ?? 0,
    heroes: heroIds.length,
    imagesComplete: imagesRes.count ?? 0,
  };

  // ---- testing (mirrors Test Lab queue/verdict rules) ----
  const sessions = sessionRows as { status: string; verdict: string | null; product_id: string }[];
  const completed = sessions.filter((s) => s.status === "completed");
  const completedProductIds = new Set(completed.map((s) => String(s.product_id)));
  const testing: OverviewTesting = {
    active: sessions.filter((s) => s.status === "in_progress").length,
    completed: completed.length,
    pass: completed.filter((s) => s.verdict === "pass").length,
    review: completed.filter((s) => s.verdict === "review").length,
    fail: completed.filter((s) => s.verdict === "fail").length,
    untested: Math.max(0, productsTotal - completedProductIds.size),
  };

  // ---- suppliers + coverage ----
  const coveredSet = new Set(
    routeRows.map((r: any) => r.product_id).filter(Boolean).map(String)
  );
  const suppliers: OverviewSuppliers = {
    total: supplierRows.length,
    tradeOpen: supplierRows.filter((s: any) => s.trade_status === "open").length,
    toOpen: supplierRows.filter((s: any) => s.trade_status === "to_open").length,
    applied: supplierRows.filter((s: any) => s.trade_status === "applied").length,
    covered: coveredSet.size,
    productsTotal,
    uncoveredHeroes: heroIds.filter((id) => !coveredSet.has(id)).length,
  };

  // ---- markets (country_markets + supplier countries, same rule as the map) ----
  let markets: OverviewMarkets | null = null;
  try {
    const marketRows = await fetchAll(
      sb,
      "country_markets",
      "iso2,market_status,priority,market_readiness"
    );
    const supplierStates = new Set<string>();
    for (const s of supplierRows as any[]) {
      const iso = countryToIso2(s.country);
      if (iso && EU27_ISO2.includes(iso)) supplierStates.add(iso);
    }
    markets = {
      tracked: marketRows.length,
      active: marketRows.filter((m: any) => m.market_status === "active").length,
      withSuppliers: marketRows.filter((m: any) => supplierStates.has(m.iso2)).length,
      priority: marketRows.filter((m: any) => m.priority === true).length,
      assessed: marketRows.filter((m: any) => m.market_readiness !== null).length,
    };
  } catch {
    markets = null;
  }

  // ---- war room (reuses the competitors fetcher — 27 rows + metrics view) ----
  let warRoom: OverviewWarRoom | null = null;
  try {
    const rows = await getCompetitors();
    if (rows) {
      let top: (typeof rows)[number] | null = null;
      let topKey = -1;
      for (const r of rows) {
        const key =
          r.threat_level != null
            ? (LEVEL_SORT[r.threat_level] ?? 0) + 0.5
            : r.threat_score != null
            ? r.threat_score
            : null;
        if (key !== null && key > topKey) {
          topKey = key;
          top = r;
        }
      }
      let lastPulled: string | null = null;
      for (const r of rows) {
        const p = r.metrics?.pulled_at || null;
        if (p && (!lastPulled || p > lastPulled)) lastPulled = p;
      }
      warRoom = {
        tracked: rows.length,
        topName: top ? top.name : null,
        topLabel: top
          ? top.threat_level
            ? top.threat_level.toUpperCase()
            : top.threat_score != null
            ? `AUTO ${Math.round(top.threat_score)}/100`
            : null
          : null,
        advertising: rows.filter((r) => (r.metrics?.paid_keywords ?? 0) > 0).length,
        totalTraffic: rows.reduce((a, r) => a + (r.metrics?.org_traffic ?? 0), 0),
        lastPulled,
      };
    }
  } catch {
    warRoom = null;
  }

  // ---- jimmy (settings + count-only / tiny pulls; degrades to null) ----
  let jimmy: OverviewJimmy | null = null;
  try {
    const settings = await loadSettings(sb);
    const [knowRes, evalRes, convRes, fireRes] = await Promise.all([
      sb.from("jimmy_knowledge").select("id,status").limit(2000),
      sb.from("jimmy_eval_runs").select("id,passed").limit(2000),
      sb.from("jimmy_conversations").select("id", { count: "exact", head: true }),
      sb
        .from("jimmy_messages")
        .select("id", { count: "exact", head: true })
        .eq("safety_triggered", true),
    ]);
    const know = knowRes.data || [];
    const graded = (evalRes.data || []).filter((r: any) => r.passed !== null);
    const passed = graded.filter((r: any) => r.passed === true);
    jimmy = {
      online: !settings.kill_switch,
      provider: settings.provider_primary,
      model: settings.model_primary,
      knowledgeTotal: know.length,
      knowledgeSigned: know.filter(
        (k: any) => String(k.status || "").toUpperCase() === "SIGNED"
      ).length,
      evalGraded: graded.length,
      evalPassRate:
        graded.length > 0 ? Math.round((passed.length / graded.length) * 100) : null,
      conversations: convRes.count ?? null,
      safetyFires: fireRes.count ?? null,
    };
  } catch {
    jimmy = null;
  }

  // ---- compliance register rollup ----
  const openRegister = itemRows.filter(
    (i: any) => i.status === "open" || i.status === "in_review"
  );
  const gateItems = openRegister
    .filter((i: any) => i.severity === "gate")
    .map((i: any) => ({ id: String(i.id), title: i.title || "Untitled item" }));
  const compliance: OverviewCompliance = {
    holds: holdsRes.count ?? 0,
    dangerousGoods: dgRes.count ?? 0,
    openItems: openRegister.length,
    openGateItems: gateItems.length,
    ceCertified: ceRes.count ?? 0,
    productsTotal,
    gateItems,
  };

  return { products, testing, suppliers, markets, warRoom, jimmy, compliance };
}
