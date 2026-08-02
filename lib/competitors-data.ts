import { supabaseAdmin } from "./supabase";

// One closest rival per EU-27 state, from the founder's research spreadsheet
// ("Closest Rival by EU-27 State" v1.0). Threat levels start NULL = NOT
// ASSESSED — the founder sets them in the War Room UI. No invented metrics.

export type MatchStrength = "direct" | "partial" | "proxy";
export type ThreatLevel = "low" | "medium" | "high" | "critical";

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
  threat_level: ThreatLevel | null;
  watch: boolean;
  created_at: string | null;
  updated_at: string | null;
};

export async function getCompetitors(): Promise<Competitor[] | null> {
  const sb = supabaseAdmin();
  if (!sb) return null;
  const { data, error } = await sb.from("competitors").select("*").order("country_iso2");
  if (error) throw error;
  return (data || []) as Competitor[];
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
  return (data as Competitor) || null;
}
