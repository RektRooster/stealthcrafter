import { supabaseAdmin } from "./supabase";

// One closest rival per EU-27 state, from the founder's research spreadsheet
// ("Closest Rival by EU-27 State" v1.0), now joined with live Ahrefs metrics
// cached in Supabase (view `latest_competitor_metrics`, pulled by SC 05).
//
// threat_level (founder enum) remains the OVERRIDE; threat_score (0-100) is
// the auto-computed signal from the Ahrefs pull. When threat_level is set it
// takes precedence in every display.

export type MatchStrength = "direct" | "partial" | "proxy";
export type ThreatLevel = "low" | "medium" | "high" | "critical";

export type CompetitorMetrics = {
  competitor_id: string;
  source: string | null; // 'ahrefs'
  pulled_at: string | null;
  domain_rating: number | null; // 0-100
  org_traffic: number | null; // monthly organic visits
  org_keywords: number | null;
  top_country: string | null; // ISO2, nullable
  top_country_traffic: number | null;
  paid_keywords: number | null;
  paid_traffic: number | null;
  paid_cost: number | null; // USD CENTS
  refdomains: number | null; // from raw jsonb {refdomains: N}
  note: string | null;
};

export type Competitor = {
  id: string;
  name: string;
  domain: string | null;
  website_url: string | null;
  country_iso2: string | null;
  match_strength: MatchStrength | null;
  style: string | null;
  positioning: string | null;
  notes: string | null;
  approx_scale: string | null;
  source_url: string | null;
  threat_level: ThreatLevel | null; // founder OVERRIDE — takes precedence
  threat_score: number | null; // auto-computed 0-100
  threat_score_at: string | null;
  threat_score_inputs: { weights?: string; [k: string]: unknown } | null;
  watch: boolean;
  created_at: string | null;
  updated_at: string | null;
};

// Merged shape the War Room renders. metrics is null when no pull exists yet.
export type CompetitorWithMetrics = Competitor & { metrics: CompetitorMetrics | null };

// Supabase returns numeric/bigint columns as strings — coerce defensively.
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toMetrics(row: any): CompetitorMetrics {
  const raw = row?.raw && typeof row.raw === "object" ? row.raw : null;
  return {
    competitor_id: String(row.competitor_id),
    source: row.source ?? null,
    pulled_at: row.pulled_at ?? null,
    domain_rating: num(row.domain_rating),
    org_traffic: num(row.org_traffic),
    org_keywords: num(row.org_keywords),
    top_country: row.top_country ?? null,
    top_country_traffic: num(row.top_country_traffic),
    paid_keywords: num(row.paid_keywords),
    paid_traffic: num(row.paid_traffic),
    paid_cost: num(row.paid_cost), // USD cents
    refdomains: num(raw?.refdomains),
    note: row.note ?? null,
  };
}

function toCompetitor(row: any): Competitor {
  return {
    ...row,
    threat_score: num(row.threat_score),
    threat_score_at: row.threat_score_at ?? null,
    threat_score_inputs:
      row.threat_score_inputs && typeof row.threat_score_inputs === "object" ? row.threat_score_inputs : null,
  } as Competitor;
}

export async function getCompetitors(): Promise<CompetitorWithMetrics[] | null> {
  const sb = supabaseAdmin();
  if (!sb) return null;

  const [compRes, metricsRes] = await Promise.all([
    sb.from("competitors").select("*").order("country_iso2"),
    // Best-effort: if the metrics view is missing or errors, the War Room
    // still renders with metrics = null everywhere.
    sb.from("latest_competitor_metrics").select("*"),
  ]);
  if (compRes.error) throw compRes.error;

  const metricsById = new Map<string, CompetitorMetrics>();
  if (!metricsRes.error && metricsRes.data) {
    for (const row of metricsRes.data) {
      if (row?.competitor_id) metricsById.set(String(row.competitor_id), toMetrics(row));
    }
  }

  return (compRes.data || []).map((row: any) => ({
    ...toCompetitor(row),
    metrics: metricsById.get(String(row.id)) || null,
  }));
}

export async function getCompetitorByCountry(iso2: string): Promise<Competitor | null> {
  const sb = supabaseAdmin();
  if (!sb) return null;
  const { data, error } = await sb
    .from("competitors")
    .select("*")
    .eq("country_iso2", iso2.toUpperCase())
    .maybeSingle();
  if (error) throw error;
  return data ? toCompetitor(data) : null;
}
