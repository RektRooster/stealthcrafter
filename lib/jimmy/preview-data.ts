// Server fetchers + pure scoring math for the Jimmy CUSTOMER EXPERIENCE
// PREVIEW (/admin/jimmy/preview). Same degradation contract as data.ts:
// every fetcher returns an empty result rather than crashing, so the page
// renders honest "NOT YET ASSESSED" states while tables are empty.

import { supabaseAdmin } from "../supabase";
import type { JimmyProfile } from "./data";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type PillarName = "Water" | "Fire" | "Shelter" | "Medical" | "Food";

export const PILLARS: { key: PillarName; label: string }[] = [
  { key: "Water", label: "Water" },
  { key: "Fire", label: "Fire / Heat" },
  { key: "Shelter", label: "Shelter" },
  { key: "Medical", label: "Medical" },
  { key: "Food", label: "Food" },
];

export type JimmyAssessment = {
  id: string | number;
  profile_id: string | number;
  pillar: string;
  score: number | null;
  band: string | null;
  critical_gap: boolean | null;
  recommended_score: number | null;
  next_action: string | null;
  assessed_at: string | null;
  meta: any;
};

export type JimmyPreviewData = {
  configured: boolean;
  profiles: JimmyProfile[];
  /** live count of SIGNED knowledge chunks — drives the banner parenthetical */
  signedCount: number;
  /** latest assessment per (profile, pillar) — keyed by String(profile_id) */
  assessmentsByProfile: Record<string, JimmyAssessment[]>;
  /** OPENAI_API_KEY present → voice-out (TTS) can work */
  ttsAvailable: boolean;
};

/* ------------------------------------------------------------------ */
/* Roll-up — the floor rule (Preparedness Score Roll-up v1.0)          */
/* ------------------------------------------------------------------ */

// DRAFT base weights from the Roll-up methodology ("rule of three",
// pending methodology review): Water 28 · Shelter 22 · Fire/Heat 20 ·
// Medical 18 · Food 12. Renormalised across ASSESSED pillars only.
export const BASE_WEIGHTS: Record<PillarName, number> = {
  Water: 28,
  Shelter: 22,
  Fire: 20,
  Medical: 18,
  Food: 12,
};

// The floor: a critical (red) gap in ANY assessed pillar caps the overall
// at the top of red. Tunable DRAFT parameter per the methodology doc.
export const CRITICAL_CAP = 40;

export function bandFor(score: number): "red" | "amber" | "green" {
  if (score <= 40) return "red";
  if (score <= 70) return "amber";
  return "green";
}

/** Red band ⇔ critical gap, per the Roll-up doc §2. */
export function isCritical(a: JimmyAssessment): boolean {
  if (a.critical_gap === true) return true;
  if (typeof a.score === "number" && a.score <= 40) return true;
  return /red/i.test(a.band || "");
}

export type HouseholdRollup = {
  /** pillars with at least one assessment */
  assessedCount: number;
  /** null until at least one pillar is assessed */
  overall: number | null;
  band: "red" | "amber" | "green" | null;
  /** Rule 1 result before the floor was applied */
  base: number | null;
  /** true when Rule 2 (the floor) capped the number */
  floorApplied: boolean;
  criticalPillars: PillarName[];
  coverageLabel: string;
};

/**
 * The two governing rules, implemented exactly as the Roll-up doc states:
 *   Rule 1 — Base = Σ (pillar score × normalised weight) over ASSESSED pillars.
 *   Rule 2 — Floor: if ANY assessed pillar is critical (red), the overall is
 *            capped at 40 and banded red: Overall = min(Base, 40).
 * Unassessed pillars sit OUTSIDE the number — never counted as 0, never as
 * fine — and the coverage label always says how many of 5 were assessed.
 * A danger is never averaged away.
 */
export function rollupHousehold(latest: JimmyAssessment[]): HouseholdRollup {
  const byPillar = new Map<PillarName, JimmyAssessment>();
  for (const a of latest) {
    const p = PILLARS.find((x) => x.key.toLowerCase() === String(a.pillar || "").toLowerCase());
    if (p && typeof a.score === "number" && !byPillar.has(p.key)) byPillar.set(p.key, a);
  }
  const assessed = Array.from(byPillar.entries());
  const coverageLabel = `assessed ${assessed.length} of 5 areas`;
  if (assessed.length === 0) {
    return {
      assessedCount: 0,
      overall: null,
      band: null,
      base: null,
      floorApplied: false,
      criticalPillars: [],
      coverageLabel,
    };
  }
  const weightSum = assessed.reduce((s, [k]) => s + BASE_WEIGHTS[k], 0);
  const base = Math.round(
    assessed.reduce((s, [k, a]) => s + (a.score as number) * (BASE_WEIGHTS[k] / weightSum), 0)
  );
  const criticalPillars = assessed.filter(([, a]) => isCritical(a)).map(([k]) => k);
  const floorApplied = criticalPillars.length > 0 && base > CRITICAL_CAP;
  const overall = criticalPillars.length > 0 ? Math.min(base, CRITICAL_CAP) : base;
  const band = criticalPillars.length > 0 ? "red" : bandFor(overall);
  return {
    assessedCount: assessed.length,
    overall,
    band,
    base,
    floorApplied,
    criticalPillars,
    coverageLabel,
  };
}

/* ------------------------------------------------------------------ */
/* Fetcher                                                             */
/* ------------------------------------------------------------------ */

export async function getJimmyPreviewData(): Promise<JimmyPreviewData> {
  const ttsAvailable = Boolean(process.env.OPENAI_API_KEY);
  const sb = supabaseAdmin();
  if (!sb) {
    return { configured: false, profiles: [], signedCount: 0, assessmentsByProfile: {}, ttsAvailable };
  }

  const [profilesRes, signedRes, assessRes] = await Promise.all([
    sb.from("jimmy_profiles").select("id,name,is_test,household,equipment,notes").limit(200),
    sb.from("jimmy_knowledge").select("id", { count: "exact", head: true }).eq("status", "SIGNED"),
    sb
      .from("jimmy_assessments")
      .select("id,profile_id,pillar,score,band,critical_gap,recommended_score,next_action,assessed_at,meta")
      .order("assessed_at", { ascending: false })
      .limit(2000),
  ]);

  // latest per (profile, pillar) — rows arrive newest-first
  const assessmentsByProfile: Record<string, JimmyAssessment[]> = {};
  const seen = new Set<string>();
  for (const row of (assessRes.data || []) as JimmyAssessment[]) {
    const key = `${String(row.profile_id)}::${String(row.pillar || "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    (assessmentsByProfile[String(row.profile_id)] ||= []).push(row);
  }

  return {
    configured: true,
    profiles: (profilesRes.data || []) as JimmyProfile[],
    signedCount: signedRes.count ?? 0,
    assessmentsByProfile,
    ttsAvailable,
  };
}
