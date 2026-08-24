// STOREFRONT — Tested Reports.
//
// The report IS the evidence, not a summary of it. Every checkpoint we ran is
// published with the method, what we expected BEFORE opening the box, what
// happened, and what we saw. Failures included — especially failures.
import { supabaseAdmin } from "./supabase";
import { parseImages } from "./catalogue-data";

export type Verdict = "pass" | "review" | "fail";
export type CpResult = "pass" | "fail" | "na" | "waiting" | "in_progress";

export type Checkpoint = {
  id: string;
  section: number;
  sectionName: string;
  seq: number;
  name: string;
  method: string;
  expected: string;
  result: CpResult;
  notes: string | null;
  measured: number | null;
  measuredUnit: string | null;
};

export type ReportSummary = {
  code: string;
  productId: string;
  productName: string;
  productSlug: string | null;
  brand: string | null;
  category: string;
  image: string | null;
  verdict: Verdict | null;
  completedAt: string | null;
  location: string | null;
  temperature: number | null;
  humidity: number | null;
  minutes: number | null;
  revision: string | null;
  summary: string | null;
  demo: boolean;
  total: number;
  passed: number;
  failed: number;
  na: number;
};

export type Report = ReportSummary & {
  checkpoints: Checkpoint[];
  supersededNote: string | null;
};

const SESSION_FIELDS =
  "id,test_code,product_id,verdict,status,location,temperature,humidity,planned_minutes," +
  "completed_at,started_at,summary,product_revision,superseded_note,published,started_by,meta";

async function productIndex(sb: any, ids: string[]) {
  const map: Record<string, any> = {};
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb
      .from("products")
      .select("id,sc_product_name,product_name,slug,brand,category_id,image_urls")
      .in("id", ids.slice(i, i + 200));
    (data || []).forEach((p: any) => (map[p.id] = p));
  }
  return map;
}

function shapeSummary(s: any, p: any, cats: Record<number, string>, counts: any): ReportSummary {
  return {
    code: s.test_code,
    productId: s.product_id,
    productName: p?.sc_product_name || p?.product_name || "Unknown product",
    productSlug: p?.slug ?? null,
    brand: p?.brand ?? null,
    category: cats[p?.category_id] || "Uncategorised",
    image: parseImages(p?.image_urls)[0] ?? null,
    verdict: (s.verdict as Verdict) ?? null,
    completedAt: s.completed_at ?? null,
    location: s.location ?? null,
    temperature: s.temperature === null ? null : Number(s.temperature),
    humidity: s.humidity === null ? null : Number(s.humidity),
    minutes: s.planned_minutes ?? null,
    revision: s.product_revision ?? null,
    summary: s.summary ?? null,
    demo: s.started_by === "DEMO SPECIMEN" || s.meta?.demo === true,
    total: counts.total,
    passed: counts.passed,
    failed: counts.failed,
    na: counts.na,
  };
}

export type TestedIndex = {
  configured: boolean;
  reports: ReportSummary[];
  categories: string[];
  stats: { tested: number; passed: number; failed: number; checkpoints: number };
  comparisons: Comparison[];
};

/** Head-to-head on identical measurements — only possible because every
    product runs the same protocol. */
export type Comparison = {
  category: string;
  metric: string;
  unit: string;
  higherIsBetter: boolean;
  expected: string;
  rows: { code: string; product: string; value: number; verdict: Verdict | null }[];
};

const HIGHER_IS_BETTER = /flow|output|runtime|lumen|kcal|capacity/i;

export async function getTestedIndex(): Promise<TestedIndex> {
  const sb = supabaseAdmin();
  if (!sb)
    return { configured: false, reports: [], categories: [], stats: { tested: 0, passed: 0, failed: 0, checkpoints: 0 }, comparisons: [] };

  const { data: sessions } = await sb
    .from("test_sessions")
    .select(SESSION_FIELDS)
    .eq("published", true)
    .eq("status", "completed")
    .order("completed_at", { ascending: false });

  const list: any[] = (sessions as any[]) || [];
  if (!list.length)
    return { configured: true, reports: [], categories: [], stats: { tested: 0, passed: 0, failed: 0, checkpoints: 0 }, comparisons: [] };

  const { data: catRows } = await sb.from("categories").select("id,name");
  const cats: Record<number, string> = {};
  (catRows || []).forEach((c: any) => (cats[c.id] = c.name));

  const products = await productIndex(sb, list.map((s: any) => s.product_id).filter(Boolean));

  const { data: cps } = await sb
    .from("test_checkpoints")
    .select("session_id,name,result,measured_value,measured_unit,expected")
    .in("session_id", list.map((s: any) => s.id));

  const bySession: Record<string, any[]> = {};
  (cps || []).forEach((c: any) => (bySession[c.session_id] ||= []).push(c));

  const reports = list.map((s: any) => {
    const rows = bySession[s.id] || [];
    return shapeSummary(s, products[s.product_id], cats, {
      total: rows.length,
      passed: rows.filter((r: any) => r.result === "pass").length,
      failed: rows.filter((r: any) => r.result === "fail").length,
      na: rows.filter((r: any) => r.result === "na").length,
    });
  });

  // Build comparisons: any measured metric shared by two or more products in
  // the same category.
  const byCatMetric: Record<string, Comparison> = {};
  for (const s of list) {
    const rep = reports.find((r) => r.code === s.test_code)!;
    for (const c of bySession[s.id] || []) {
      if (c.measured_value === null || c.measured_value === undefined) continue;
      const key = `${rep.category}::${c.name}`;
      const comp = (byCatMetric[key] ||= {
        category: rep.category,
        metric: c.name,
        unit: c.measured_unit || "",
        higherIsBetter: HIGHER_IS_BETTER.test(c.name),
        expected: c.expected || "",
        rows: [],
      });
      comp.rows.push({
        code: rep.code,
        product: rep.productName,
        value: Number(c.measured_value),
        verdict: rep.verdict,
      });
    }
  }
  const comparisons = Object.values(byCatMetric)
    .filter((c) => c.rows.length >= 2)
    .map((c) => ({
      ...c,
      rows: c.rows.sort((a, b) => (c.higherIsBetter ? b.value - a.value : a.value - b.value)),
    }));

  return {
    configured: true,
    reports,
    categories: [...new Set(reports.map((r) => r.category))].sort(),
    stats: {
      tested: reports.length,
      passed: reports.filter((r) => r.verdict === "pass").length,
      failed: reports.filter((r) => r.verdict === "fail").length,
      checkpoints: reports.reduce((t, r) => t + r.total, 0),
    },
    comparisons,
  };
}

export async function getReport(code: string): Promise<Report | null> {
  const sb = supabaseAdmin();
  if (!sb) return null;

  const { data: raw } = await sb
    .from("test_sessions")
    .select(SESSION_FIELDS)
    .eq("test_code", code)
    .eq("published", true)
    .maybeSingle();
  if (!raw) return null;
  const s: any = raw;

  const { data: catRows } = await sb.from("categories").select("id,name");
  const cats: Record<number, string> = {};
  (catRows || []).forEach((c: any) => (cats[c.id] = c.name));

  const products = await productIndex(sb, [s.product_id]);

  const { data: cpRows } = await sb
    .from("test_checkpoints")
    .select("id,section,section_name,seq,name,method,expected,result,notes_evidence,measured_value,measured_unit")
    .eq("session_id", s.id)
    .order("section", { ascending: true })
    .order("seq", { ascending: true });

  const checkpoints: Checkpoint[] = (cpRows || []).map((c: any) => ({
    id: c.id,
    section: c.section,
    sectionName: c.section_name,
    seq: c.seq,
    name: c.name,
    method: c.method,
    expected: c.expected,
    result: (c.result as CpResult) ?? "waiting",
    notes: c.notes_evidence ?? null,
    measured: c.measured_value === null ? null : Number(c.measured_value),
    measuredUnit: c.measured_unit ?? null,
  }));

  const base = shapeSummary(s, products[s.product_id], cats, {
    total: checkpoints.length,
    passed: checkpoints.filter((c) => c.result === "pass").length,
    failed: checkpoints.filter((c) => c.result === "fail").length,
    na: checkpoints.filter((c) => c.result === "na").length,
  });

  return { ...base, checkpoints, supersededNote: s.superseded_note ?? null };
}

/** The published protocol — what we run, on everything, every time. */
export async function getProtocol() {
  const sb = supabaseAdmin();
  if (!sb) return [];
  const { data } = await sb
    .from("test_checkpoint_templates")
    .select("category_hint,section,section_name,seq,name,method,expected")
    .order("section", { ascending: true })
    .order("seq", { ascending: true });
  return data || [];
}

/** Measured figures the Kit Builder consumes in place of a manufacturer claim. */
export async function getMeasuredByProduct(): Promise<Record<string, { name: string; value: number; unit: string }[]>> {
  const sb = supabaseAdmin();
  if (!sb) return {};
  const { data: rawSessions } = await sb
    .from("test_sessions")
    .select("id,product_id")
    .eq("published", true)
    .eq("status", "completed");
  const sessions: any[] = (rawSessions as any[]) || [];
  if (!sessions.length) return {};
  const { data: cps } = await sb
    .from("test_checkpoints")
    .select("session_id,name,measured_value,measured_unit")
    .in("session_id", sessions.map((s: any) => s.id))
    .not("measured_value", "is", null);
  const byProduct: Record<string, { name: string; value: number; unit: string }[]> = {};
  for (const c of cps || []) {
    const pid = sessions.find((s: any) => s.id === c.session_id)?.product_id;
    if (!pid) continue;
    (byProduct[pid] ||= []).push({
      name: c.name,
      value: Number(c.measured_value),
      unit: c.measured_unit || "",
    });
  }
  return byProduct;
}
