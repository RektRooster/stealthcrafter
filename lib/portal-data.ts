// CUSTOMER PORTAL — "your household, right now".
//
// Not an account page. A living readiness state: the Kit Builder engine pointed
// at what the household ACTUALLY owns, the hazard map filtered to where they
// live, and an equipment register that decays on its own and says so.
import { supabaseAdmin } from "./supabase";
import { parseImages } from "./catalogue-data";
import { deriveAttrs, parseShelfLifeMonths, parseWeightKg } from "./kit/attributes";
import { getMeasuredByProduct } from "./tested-data";
import type { Household, KitItem, Scenario } from "./kit/sim";
import { PILLAR_LABEL, projectDecay, recommend, simulate } from "./kit/sim";
import { SCENARIOS } from "./kit/scenarios";
import { getHazardSnapshot } from "./hazards";
import type { HazardEvent } from "./hazards";

export type OwnedItem = KitItem & {
  ownedId: string;
  kit: "home" | "go_bag" | "vehicle" | "work";
  acquiredAt: string | null;
  expiresAt: string | null;
  condition: string | null;
  image: string | null;
  slug: string | null;
  /** Months until this item lapses, negative when it already has. */
  monthsLeft: number | null;
};

export type PillarAssessment = {
  pillar: string;
  score: number;
  band: string | null;
  critical: boolean;
  recommended: number | null;
  nextAction: string | null;
  assessedAt: string | null;
};

export type PortalHousehold = {
  id: string;
  name: string;
  location: string | null;
  countryIso2: string | null;
  setting: string | null;
  home: string | null;
  experience: string | null;
  budget: number | null;
  worries: string[];
  adults: number;
  children: number;
  infants: number;
  pets: number;
};

export type PortalData = {
  configured: boolean;
  households: { id: string; name: string }[];
  household: PortalHousehold | null;
  equipment: OwnedItem[];
  assessments: PillarAssessment[];
  /** Simulation of the OWNED kit under the chosen scenario. */
  sim: ReturnType<typeof simulate> | null;
  scenario: Scenario;
  scenarios: { id: string; label: string; hours: number }[];
  nextBuy: {
    name: string;
    slug: string;
    price: number;
    hoursGained: number;
    reason: string;
  } | null;
  attention: OwnedItem[];
  decay: { month: number; failureHour: number }[];
  localEvents: HazardEvent[];
  conversations: number;
  lastActivity: string | null;
};

const COUNTRY_BY_HINT: [RegExp, string][] = [
  [/poland|polska|krak|warsaw/i, "PL"],
  [/german|deutsch|bavaria|bayern|berlin|munich/i, "DE"],
  [/portug|porto|lisbon/i, "PT"],
  [/spain|espa|madrid|barcelona/i, "ES"],
  [/france|paris/i, "FR"],
  [/italy|ital|rome|milan/i, "IT"],
  [/sweden|stockholm/i, "SE"],
  [/finland|helsinki/i, "FI"],
  [/netherlands|amsterdam/i, "NL"],
  [/slovak|presov|bratislava/i, "SK"],
];

function countryFrom(location: string | null): string | null {
  if (!location) return null;
  for (const [re, iso] of COUNTRY_BY_HINT) if (re.test(location)) return iso;
  return null;
}

function shapeHousehold(p: any): PortalHousehold {
  const h = (p.household && typeof p.household === "object" ? p.household : {}) as any;
  const kids: any[] = Array.isArray(h.children) ? h.children : [];
  const location = h.location ?? null;
  return {
    id: p.id,
    name: String(p.name || "Household").replace(/^TEST\s*—\s*/, ""),
    location,
    countryIso2: countryFrom(location),
    setting: h.setting ?? null,
    home: h.home ?? null,
    experience: h.experience ?? null,
    budget: typeof h.budget_eur === "number" ? h.budget_eur : null,
    worries: Array.isArray(h.worries) ? h.worries : [],
    adults: typeof h.adults === "number" ? h.adults : 1,
    children: kids.filter((a) => typeof a !== "number" || a >= 4).length,
    infants: kids.filter((a) => typeof a === "number" && a < 4).length,
    pets: Array.isArray(h.pets) ? h.pets.length : 0,
  };
}

const PRODUCT_FIELDS =
  "id,slug,sc_product_name,product_name,brand,pillar,category_id,selling_price,currency," +
  "weight,shelf_life,power_source,description,customer_notes,image_urls";

export async function getPortalData(
  profileId?: string,
  scenarioId?: string
): Promise<PortalData> {
  const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];
  const scenarios = SCENARIOS.map((s) => ({ id: s.id, label: s.label, hours: s.hours }));
  const empty: PortalData = {
    configured: false,
    households: [],
    household: null,
    equipment: [],
    assessments: [],
    sim: null,
    scenario,
    scenarios,
    nextBuy: null,
    attention: [],
    decay: [],
    localEvents: [],
    conversations: 0,
    lastActivity: null,
  };

  const sb = supabaseAdmin();
  if (!sb) return empty;

  const { data: profiles } = await sb
    .from("jimmy_profiles")
    .select("id,name,household,created_at")
    .order("created_at", { ascending: true });
  const list: any[] = (profiles as any[]) || [];
  if (!list.length) return { ...empty, configured: true };

  const chosen = list.find((p) => p.id === profileId) ?? list[0];
  const household = shapeHousehold(chosen);

  /* ---------------- equipment register ---------------- */
  const { data: ownedRows } = await sb
    .from("owned_equipment")
    .select("id,product_id,label,qty,kit,acquired_at,expires_at,condition")
    .eq("profile_id", chosen.id);
  const owned: any[] = (ownedRows as any[]) || [];

  const productIds = owned.map((o) => o.product_id).filter(Boolean);
  const products: Record<string, any> = {};
  if (productIds.length) {
    const { data } = await sb.from("products").select(PRODUCT_FIELDS).in("id", productIds);
    (data || []).forEach((p: any) => (products[p.id] = p));
  }

  const { data: catRows } = await sb.from("categories").select("id,name");
  const cats: Record<number, string> = {};
  (catRows || []).forEach((c: any) => (cats[c.id] = c.name));

  const measured = await getMeasuredByProduct().catch(() => ({}));
  const now = Date.now();

  const equipment: OwnedItem[] = owned.map((o) => {
    const p = products[o.product_id] || {};
    const name = p.sc_product_name || p.product_name || o.label || "Unlisted item";
    const category = cats[p.category_id] || "Other";
    const attrs = deriveAttrs({
      name,
      category,
      pillar: p.pillar ?? null,
      description: p.description,
      summary: p.customer_notes,
      weight: p.weight,
      powerSource: p.power_source,
    });
    const shelfMonths = parseShelfLifeMonths(p.shelf_life);

    // An explicit expiry beats the generic shelf life; otherwise project from
    // the date it was acquired, which is the honest way round.
    let monthsLeft: number | null = null;
    if (o.expires_at) {
      monthsLeft = Math.round((new Date(o.expires_at).getTime() - now) / (30.44 * 864e5));
    } else if (shelfMonths && o.acquired_at) {
      const elapsed = (now - new Date(o.acquired_at).getTime()) / (30.44 * 864e5);
      monthsLeft = Math.round(shelfMonths - elapsed);
    }

    const priceRaw = p.selling_price === null || p.selling_price === undefined ? null : Number(p.selling_price);
    const price =
      priceRaw === null
        ? null
        : (p.currency || "EUR").toUpperCase() === "GBP"
        ? Math.round(priceRaw * 1.17 * 100) / 100
        : priceRaw;

    return {
      id: p.id || o.id,
      ownedId: o.id,
      slug: p.slug ?? null,
      name,
      brand: p.brand ?? null,
      category,
      price,
      weightKg: parseWeightKg(p.weight),
      shelfMonths,
      attrs,
      qty: o.qty ?? 1,
      kit: o.kit,
      acquiredAt: o.acquired_at ?? null,
      expiresAt: o.expires_at ?? null,
      condition: o.condition ?? null,
      image: parseImages(p.image_urls)[0] ?? null,
      monthsLeft,
    };
  });
  void measured;

  /* ---------------- assessments ---------------- */
  const { data: assessRows } = await sb
    .from("jimmy_assessments")
    .select("pillar,score,band,critical_gap,recommended_score,next_action,assessed_at")
    .eq("profile_id", chosen.id)
    .order("assessed_at", { ascending: false });
  const seen = new Set<string>();
  const assessments: PillarAssessment[] = [];
  for (const a of (assessRows as any[]) || []) {
    if (seen.has(a.pillar)) continue;
    seen.add(a.pillar);
    assessments.push({
      pillar: a.pillar,
      score: a.score,
      band: a.band ?? null,
      critical: Boolean(a.critical_gap),
      recommended: a.recommended_score ?? null,
      nextAction: a.next_action ?? null,
      assessedAt: a.assessed_at ?? null,
    });
  }

  /* ---------------- simulation over the OWNED kit ---------------- */
  const hh: Household = {
    adults: household.adults,
    children: household.children,
    infants: household.infants,
    pets: household.pets,
    medicalPower: false,
    countryIso2: household.countryIso2 ?? "DE",
  };
  const sim = simulate(hh, scenario, equipment);
  const decay = projectDecay(hh, scenario, equipment, 36).map((d) => ({
    month: d.month,
    failureHour: d.failureHour,
  }));

  /* ---------------- the single next action ---------------- */
  let nextBuy: PortalData["nextBuy"] = null;
  try {
    const { getKitCatalogue } = await import("./kit/data");
    const cat = await getKitCatalogue();
    const rec = recommend(hh, scenario, equipment, cat.items, 1)[0];
    if (rec)
      nextBuy = {
        name: rec.item.name,
        slug: rec.item.slug,
        price: rec.item.price ?? 0,
        hoursGained: rec.hoursGained,
        reason: rec.reason,
      };
  } catch {
    nextBuy = null;
  }

  /* ---------------- what needs attention ---------------- */
  const attention = equipment
    .filter((e) => e.monthsLeft !== null && e.monthsLeft <= 6)
    .sort((a, b) => (a.monthsLeft ?? 0) - (b.monthsLeft ?? 0));

  /* ---------------- local conditions ---------------- */
  let localEvents: HazardEvent[] = [];
  try {
    const snap = await getHazardSnapshot();
    localEvents = snap.events
      .filter((e) => !household.countryIso2 || e.countryIso2 === household.countryIso2)
      .slice(0, 4);
  } catch {
    localEvents = [];
  }

  /* ---------------- Jimmy continuity ---------------- */
  const { count: convCount } = await sb
    .from("jimmy_conversations")
    .select("id", { head: true, count: "exact" })
    .eq("profile_id", chosen.id);

  const lastActivity =
    assessments.map((a) => a.assessedAt).filter(Boolean).sort().reverse()[0] ?? null;

  return {
    configured: true,
    households: list.map((p) => ({
      id: p.id,
      name: String(p.name || "Household").replace(/^TEST\s*—\s*/, ""),
    })),
    household,
    equipment,
    assessments,
    sim,
    scenario,
    scenarios,
    nextBuy,
    attention,
    decay,
    localEvents,
    conversations: convCount ?? 0,
    lastActivity,
  };
}

export { PILLAR_LABEL };
