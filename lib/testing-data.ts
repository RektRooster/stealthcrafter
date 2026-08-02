import { supabaseAdmin } from "./supabase";
import { getCatalogue, getProduct } from "./data";

/* ---------- Test Lab data helpers (server only) ---------- */

export type CheckpointRow = {
  id: string;
  session_id: string;
  section: number;
  section_name: string;
  seq: number;
  name: string;
  method: string | null;
  expected: string | null;
  result: "waiting" | "in_progress" | "pass" | "fail" | "na";
  notes_evidence: string | null;
  updated_at: string;
};

export type SessionRow = {
  id: string;
  test_code: string | null;
  product_id: string;
  started_by: string;
  status: "in_progress" | "completed" | "abandoned";
  verdict: "pass" | "review" | "fail" | null;
  location: string | null;
  temperature: number | null;
  humidity: number | null;
  planned_minutes: number | null;
  notes: string | null;
  started_at: string;
  completed_at: string | null;
  meta: any;
};

export const RESOLVED = new Set(["pass", "fail", "na"]);

export type TestLabHome = {
  active: (SessionRow & { product: any | null; done: number; total: number })[];
  history: (SessionRow & { product: any | null })[];
  queue: any[]; // untested products, priority-sorted
  testedIds: string[]; // product ids with a completed PASS session
};

export async function getTestLabHome(): Promise<TestLabHome | null> {
  const sb = supabaseAdmin();
  if (!sb) return null;

  const [{ data: sessions }, products] = await Promise.all([
    sb.from("test_sessions").select("*").order("started_at", { ascending: false }),
    getCatalogue(),
  ]);
  const all = (sessions || []) as SessionRow[];
  const prodList = products || [];
  const prodById: Record<string, any> = {};
  for (const p of prodList) prodById[p.id] = p;

  const active = all.filter((s) => s.status === "in_progress");
  const completed = all.filter((s) => s.status === "completed");

  // progress for active sessions
  const progress: Record<string, { done: number; total: number }> = {};
  if (active.length) {
    const ids = active.map((s) => s.id);
    const { data: cps } = await sb
      .from("test_checkpoints")
      .select("session_id,result")
      .in("session_id", ids);
    for (const c of cps || []) {
      const e = (progress[c.session_id] ||= { done: 0, total: 0 });
      e.total++;
      if (RESOLVED.has(c.result)) e.done++;
    }
  }

  const completedProductIds = new Set(completed.map((s) => s.product_id));
  const passedProductIds = new Set(
    completed.filter((s) => s.verdict === "pass").map((s) => s.product_id)
  );

  const rank = (p: any): number => {
    if (p.hero_product || p.safety_critical) return 0;
    if (p.product_status === "approved" || p.product_status === "listed") return 1;
    return 2;
  };
  const queue = prodList
    .filter((p) => !completedProductIds.has(p.id))
    .sort((a, b) => rank(a) - rank(b));

  return {
    active: active.map((s) => ({
      ...s,
      product: prodById[s.product_id] || null,
      done: progress[s.id]?.done || 0,
      total: progress[s.id]?.total || 0,
    })),
    history: completed.map((s) => ({ ...s, product: prodById[s.product_id] || null })),
    queue,
    testedIds: [...passedProductIds],
  };
}

export type TestSessionFull = {
  session: SessionRow | null;
  checkpoints: CheckpointRow[];
  product: any | null;
  routes: any[];
};

export async function getTestSessionFull(id: string): Promise<TestSessionFull | null> {
  const sb = supabaseAdmin();
  if (!sb) return null;
  const { data: session } = await sb.from("test_sessions").select("*").eq("id", id).maybeSingle();
  if (!session) return { session: null, checkpoints: [], product: null, routes: [] };
  const [{ data: checkpoints }, productResult] = await Promise.all([
    sb
      .from("test_checkpoints")
      .select("*")
      .eq("session_id", id)
      .order("section", { ascending: true })
      .order("seq", { ascending: true }),
    getProduct(session.product_id),
  ]);
  return {
    session: session as SessionRow,
    checkpoints: (checkpoints || []) as CheckpointRow[],
    product: productResult?.product || null,
    routes: productResult?.routes || [],
  };
}
