import { supabaseAdmin } from "./supabase";
import { isComplianceHold } from "./mutations";
import { loadSettings } from "./jimmy/service";

// ---- COMPLIANCE module (exposure console + SC 08 register) ------------------
// One server fetch feeding /admin/compliance: the compliance_items register
// with live affected-product counts, every flagged product, restriction facts
// and the Jimmy AI-safety rollup. The platform computes exposure — rulings
// stay with SC 08 (Compliance & Credibility).

export type ComplianceStatus = "open" | "in_review" | "cleared" | "blocked";
export type ComplianceSeverity = "gate" | "watch";
export type ComplianceCategory =
  | "medicine"
  | "biocide"
  | "ppe"
  | "medical-device"
  | "ai-safety"
  | "governance";

export type ComplianceProductRef = {
  id: string;
  name: string;
  pillar: string | null;
  product_status: string | null;
};

export type ComplianceItem = {
  id: string;
  title: string;
  category: ComplianceCategory | string;
  detail: string | null;
  status: ComplianceStatus;
  severity: ComplianceSeverity;
  owner: string | null;
  product_match: string | null;
  ruling: string | null;
  ruled_by: string | null;
  ruled_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  /** live count of catalogue products the ilike pattern hits; null = not product-specific ('%') */
  affectedCount: number | null;
  /** first 10 affected products, for the detail drawer */
  affected: ComplianceProductRef[];
};

export type FlaggedProduct = {
  id: string;
  name: string;
  pillar: string | null;
  product_status: string | null;
  dangerous_goods: boolean;
  safety_critical: boolean;
  ce_certified: boolean;
  hold: boolean; // isComplianceHold() — the product-console approval hard-block
};

export type RestrictedProduct = {
  id: string;
  name: string;
  shipping: string | null;
  export: string | null;
};

export type ComplianceConsoleData = {
  items: ComplianceItem[];
  flagged: FlaggedProduct[];
  restrictions: {
    shippingCount: number;
    exportCount: number;
    list: RestrictedProduct[]; // first 8
  };
  stats: {
    total: number;
    holds: number;
    dangerousGoods: number;
    safetyCritical: number;
    ceCertified: number;
    ageRestricted: number;
    openItems: number; // register status open + in_review
    openGateItems: number; // of those, severity = gate
  };
  jimmy: {
    knowledgeTotal: number;
    knowledgeSigned: number;
    promptVersion: string | null;
    promptStatus: string | null;
    triggersActive: number;
    evalGraded: number;
    evalPassed: number;
    passRate: number | null; // null until at least one graded run
  };
};

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

// Replicate Postgres ILIKE semantics in JS so register counts match what an
// ilike query against the live catalogue would return.
function ilikeMatcher(pattern: string): (v: string | null | undefined) => boolean {
  const rx = new RegExp(
    "^" +
      pattern
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/%/g, "[\\s\\S]*")
        .replace(/_/g, "[\\s\\S]") +
      "$",
    "i"
  );
  return (v) => rx.test(String(v ?? ""));
}

const PRODUCT_FIELDS =
  "id,sc_product_name,product_name,example_product,pillar,product_status," +
  "dangerous_goods,safety_critical,ce_certified,age_restricted,needs_review," +
  "internal_notes,shipping_restrictions,export_restrictions,hero_product";

export async function getComplianceConsole(): Promise<ComplianceConsoleData | null> {
  const sb = supabaseAdmin();
  if (!sb) return null;

  const [products, itemRows] = await Promise.all([
    fetchAll(sb, "products", PRODUCT_FIELDS),
    fetchAll(sb, "compliance_items", "*"),
  ]);

  // ---- live exposure stats (same hold rule the product console enforces) ----
  const holds = products.filter((p) => isComplianceHold(p));
  const stats = {
    total: products.length,
    holds: holds.length,
    dangerousGoods: products.filter((p) => p.dangerous_goods === true).length,
    safetyCritical: products.filter((p) => p.safety_critical === true).length,
    ceCertified: products.filter((p) => p.ce_certified === true).length,
    ageRestricted: products.filter((p) => p.age_restricted === true).length,
    openItems: 0,
    openGateItems: 0,
  };

  // ---- register items with live affected-product counts ----
  const STATUS_ORD: Record<string, number> = { open: 0, in_review: 1, blocked: 2, cleared: 3 };
  const items: ComplianceItem[] = itemRows
    .map((r: any) => {
      const pattern = r.product_match == null ? null : String(r.product_match);
      // A pattern that is nothing but wildcards ('%') is register-wide, not
      // product-specific — render '—' instead of a misleading full-catalogue count.
      const generic = !pattern || pattern.replace(/[%_]/g, "") === "";
      let affectedCount: number | null = null;
      let affected: ComplianceProductRef[] = [];
      if (!generic && pattern) {
        const match = ilikeMatcher(pattern);
        const hits = products.filter(
          (p) => match(p.sc_product_name) || match(p.product_name) || match(p.internal_notes)
        );
        affectedCount = hits.length;
        affected = hits.slice(0, 10).map((p) => ({
          id: String(p.id),
          name: productName(p),
          pillar: p.pillar ?? null,
          product_status: p.product_status ?? null,
        }));
      }
      return {
        id: String(r.id),
        title: r.title || "Untitled item",
        category: r.category || "governance",
        detail: r.detail ?? null,
        status: (r.status as ComplianceStatus) || "open",
        severity: (r.severity as ComplianceSeverity) || "watch",
        owner: r.owner ?? null,
        product_match: pattern,
        ruling: r.ruling ?? null,
        ruled_by: r.ruled_by ?? null,
        ruled_at: r.ruled_at ?? null,
        created_at: r.created_at ?? null,
        updated_at: r.updated_at ?? null,
        affectedCount,
        affected,
      };
    })
    .sort(
      (a, b) =>
        (STATUS_ORD[a.status] ?? 9) - (STATUS_ORD[b.status] ?? 9) ||
        (a.severity === "gate" ? 0 : 1) - (b.severity === "gate" ? 0 : 1) ||
        String(b.updated_at || "").localeCompare(String(a.updated_at || ""))
    );

  const openRegister = items.filter((i) => i.status === "open" || i.status === "in_review");
  stats.openItems = openRegister.length;
  stats.openGateItems = openRegister.filter((i) => i.severity === "gate").length;

  // ---- flagged products (union of DG / safety-critical / hold) ----
  const flagged: FlaggedProduct[] = products
    .filter((p) => p.dangerous_goods === true || p.safety_critical === true || isComplianceHold(p))
    .map((p) => ({
      id: String(p.id),
      name: productName(p),
      pillar: p.pillar ?? null,
      product_status: p.product_status ?? null,
      dangerous_goods: p.dangerous_goods === true,
      safety_critical: p.safety_critical === true,
      ce_certified: p.ce_certified === true,
      hold: isComplianceHold(p),
    }));

  // ---- shipping / export restrictions ----
  const restricted = products.filter(
    (p) =>
      (p.shipping_restrictions && String(p.shipping_restrictions).trim()) ||
      (p.export_restrictions && String(p.export_restrictions).trim())
  );
  const restrictions = {
    shippingCount: products.filter((p) => p.shipping_restrictions && String(p.shipping_restrictions).trim()).length,
    exportCount: products.filter((p) => p.export_restrictions && String(p.export_restrictions).trim()).length,
    list: restricted.slice(0, 8).map((p) => ({
      id: String(p.id),
      name: productName(p),
      shipping: p.shipping_restrictions ?? null,
      export: p.export_restrictions ?? null,
    })),
  };

  // ---- AI safety (Jimmy) rollup — degrade to zeros, never crash the page ----
  let jimmy: ComplianceConsoleData["jimmy"] = {
    knowledgeTotal: 0,
    knowledgeSigned: 0,
    promptVersion: null,
    promptStatus: null,
    triggersActive: 0,
    evalGraded: 0,
    evalPassed: 0,
    passRate: null,
  };
  try {
    const settings = await loadSettings(sb);
    const [knowRes, promptRes, trigRes, evalRes] = await Promise.all([
      sb.from("jimmy_knowledge").select("id,status").limit(2000),
      sb.from("jimmy_prompts").select("version,status").eq("version", settings.prompt_version).maybeSingle(),
      sb.from("jimmy_triggers").select("id", { count: "exact", head: true }).eq("active", true),
      sb.from("jimmy_eval_runs").select("id,passed").limit(2000),
    ]);
    const know = knowRes.data || [];
    const evals = (evalRes.data || []).filter((r: any) => r.passed !== null);
    const passed = evals.filter((r: any) => r.passed === true);
    jimmy = {
      knowledgeTotal: know.length,
      knowledgeSigned: know.filter((k: any) => String(k.status || "").toUpperCase() === "SIGNED").length,
      promptVersion: promptRes.data?.version ?? settings.prompt_version ?? null,
      promptStatus: promptRes.data?.status ?? null,
      triggersActive: trigRes.count ?? 0,
      evalGraded: evals.length,
      evalPassed: passed.length,
      passRate: evals.length > 0 ? Math.round((passed.length / evals.length) * 100) : null,
    };
  } catch {
    // Jimmy tables unavailable — the panel renders its zero/pending state.
  }

  return { items, flagged, restrictions, stats, jimmy };
}
