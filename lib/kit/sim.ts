// KIT BUILDER — the survival simulator.
//
// Deterministic, pure, and fast enough to re-run on every click. It models a
// household consuming resources hour by hour under a scenario, and reports the
// hour each pillar fails. That failure clock is the whole product: "Preparedness
// 68/100" means nothing, "your water runs out at hour 61 of a 72-hour event"
// means everything.
//
// Two kinds of item matter, and keeping them separate is what makes the model
// feel real: some SUPPLY a resource (a 20L container, a 2400 kcal ration), and
// some REDUCE DEMAND (a four-season sleeping bag does not generate heat — it
// lowers the amount you need).

import type { KitAttrs } from "./attributes";

export type Household = {
  adults: number;
  children: number; // 4–17
  infants: number; // under 4
  pets: number;
  /** Someone dependent on powered medical equipment. */
  medicalPower: boolean;
  countryIso2: string;
};

export type Scenario = {
  id: string;
  label: string;
  summary: string;
  hours: number;
  /** Outdoor temperature driving heat demand. */
  tempC: number;
  gridDown: boolean;
  mainsWaterDown: boolean;
  evacuation: boolean;
  /** Carry limit applies, and only what you can grab counts. */
  noticeHours?: number;
  /** Physical exertion multiplier on water and calories. */
  exertion: number;
  hazardHint?: string;
};

export type Pillar = "water" | "food" | "heat" | "power" | "light" | "medical";

export const PILLARS: Pillar[] = ["water", "food", "heat", "power", "light", "medical"];

export const PILLAR_LABEL: Record<Pillar, string> = {
  water: "Water",
  food: "Food",
  heat: "Warmth",
  power: "Power",
  light: "Light",
  medical: "Medical",
};

export type KitItem = {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  category: string;
  price: number | null;
  weightKg: number | null;
  shelfMonths: number | null;
  attrs: KitAttrs;
  qty: number;
};

/* -------------------------------------------------------------------------- */
/* Demand                                                                      */
/* -------------------------------------------------------------------------- */

export type Demand = {
  waterLPerDay: number;
  kcalPerDay: number;
  heatKwhPerDay: number;
  whPerDay: number;
  lumenHoursPerDay: number;
  /** Degrees of heating demand removed by insulation already in the kit. */
  insulationC: number;
  people: number;
};

/** Sum of insulation, with diminishing returns — a fifth blanket adds little. */
function insulationFrom(items: KitItem[], people: number): number {
  const values: number[] = [];
  for (const it of items) {
    const c = it.attrs.insulationC;
    if (!c) continue;
    for (let i = 0; i < it.qty; i++) values.push(c);
  }
  values.sort((a, b) => b - a);
  // Only the best `people` items really count; the rest contribute a tail.
  let total = 0;
  values.forEach((v, i) => {
    total += i < people ? v : v * 0.15;
  });
  return Math.min(total, 22);
}

export function computeDemand(h: Household, s: Scenario, items: KitItem[]): Demand {
  const people = h.adults + h.children + h.infants;

  // Water: WHO planning figure is 3 L/person/day for drinking and basic
  // hygiene, uprated for heat and exertion.
  let waterPer = 3.0 * h.adults + 2.0 * h.children + 1.2 * h.infants + 0.7 * h.pets;
  if (s.tempC > 25) waterPer *= 1.5;
  else if (s.tempC > 20) waterPer *= 1.2;
  waterPer *= s.exertion;

  // Calories.
  let kcal = 2200 * h.adults + 1500 * h.children + 700 * h.infants;
  if (s.tempC < 5 && s.gridDown) kcal *= 1.15; // shivering costs
  kcal *= s.exertion;

  // Heat. A home does not fall to outdoor temperature the moment the boiler
  // stops: the building's thermal mass and the people inside it hold roughly
  // 6°C above outside, and insulation adds to that. Below 12°C indoors is where
  // cold stops being uncomfortable and starts being dangerous.
  const insulationC = insulationFrom(items, people);
  const passiveIndoorC = s.tempC + 6 + insulationC;
  const heatKwhPerDay = s.gridDown && passiveIndoorC < 12 ? (12 - passiveIndoorC) * 0.55 : 0;

  // Power: lighting, phones, radio, plus any powered medical equipment.
  let whPerDay = s.gridDown ? 35 + 12 * people : 0;
  if (h.medicalPower && s.gridDown) whPerDay += 240;

  // Light: five dark hours at a usable level, per occupied space.
  const lumenHoursPerDay = s.gridDown ? 5 * 220 * Math.max(1, Math.ceil(people / 3)) : 0;

  return {
    waterLPerDay: waterPer,
    kcalPerDay: kcal,
    heatKwhPerDay,
    whPerDay,
    lumenHoursPerDay,
    insulationC,
    people,
  };
}

/* -------------------------------------------------------------------------- */
/* Supply                                                                      */
/* -------------------------------------------------------------------------- */

export type Supply = {
  waterL: number;
  kcal: number;
  heatKwh: number;
  wh: number;
  whPerDay: number;
  lumenHours: number;
  medicalTags: Set<string>;
  shelterPersons: number;
};

export function computeSupply(items: KitItem[]): Supply {
  const s: Supply = {
    waterL: 0,
    kcal: 0,
    heatKwh: 0,
    wh: 0,
    whPerDay: 0,
    lumenHours: 0,
    medicalTags: new Set(),
    shelterPersons: 0,
  };
  for (const it of items) {
    const a = it.attrs;
    const q = it.qty;
    // Treatment capacity only helps if there is a source to treat; in a mains
    // outage there generally is (rain, tanks, watercourses), so it counts —
    // but heavily discounted against stored water you can simply drink.
    s.waterL += (a.waterStoreL ?? 0) * q + Math.min((a.waterTreatL ?? 0) * q, 400) * 0.5;
    s.kcal += (a.kcal ?? 0) * q;
    s.heatKwh += (a.heatKwh ?? 0) * q;
    s.wh += (a.wh ?? 0) * q;
    s.whPerDay += (a.whPerDay ?? 0) * q;
    s.lumenHours += (a.lumenHours ?? 0) * q;
    s.shelterPersons += (a.shelterPersons ?? 0) * q;
    a.medical?.forEach((t) => s.medicalTags.add(t));
  }
  return s;
}

/* -------------------------------------------------------------------------- */
/* The simulation                                                              */
/* -------------------------------------------------------------------------- */

export type PillarResult = {
  pillar: Pillar;
  /** Hours until this pillar is exhausted. Infinity when there is no demand. */
  runwayHours: number;
  /** 0–1 against the scenario length. */
  coverage: number;
  supplyLabel: string;
  demandLabel: string;
  /** Non-depleting pillars (medical) report a coverage score instead. */
  note?: string;
};

export type SimResult = {
  demand: Demand;
  supply: Supply;
  pillars: PillarResult[];
  /** The floor rule: the household is only as ready as its weakest pillar. */
  failureHour: number;
  weakest: Pillar;
  scenarioHours: number;
  survived: boolean;
  totalWeightKg: number;
  totalCost: number;
};

const MED_REQUIRED = ["trauma", "wound-care", "pain", "antisepsis", "gi-hydration", "burns"];

function runway(stock: number, perDay: number): number {
  if (perDay <= 0) return Infinity;
  if (stock <= 0) return 0;
  return (stock / perDay) * 24;
}

export function simulate(h: Household, s: Scenario, items: KitItem[]): SimResult {
  const demand = computeDemand(h, s, items);
  const supply = computeSupply(items);

  // Power: batteries plus whatever can be regenerated each day.
  const powerRunway =
    demand.whPerDay <= 0
      ? Infinity
      : supply.whPerDay >= demand.whPerDay
      ? Infinity
      : runway(supply.wh, demand.whPerDay - supply.whPerDay);

  const medCovered = MED_REQUIRED.filter((t) => supply.medicalTags.has(t)).length;
  const medCoverage = medCovered / MED_REQUIRED.length;

  const pillars: PillarResult[] = [
    {
      pillar: "water",
      runwayHours: runway(supply.waterL, demand.waterLPerDay),
      coverage: 0,
      supplyLabel: `${supply.waterL.toFixed(1)} L available`,
      demandLabel: `${demand.waterLPerDay.toFixed(1)} L/day needed`,
    },
    {
      pillar: "food",
      runwayHours: runway(supply.kcal, demand.kcalPerDay),
      coverage: 0,
      supplyLabel: `${Math.round(supply.kcal).toLocaleString("en-GB")} kcal stored`,
      demandLabel: `${Math.round(demand.kcalPerDay).toLocaleString("en-GB")} kcal/day needed`,
    },
    {
      pillar: "heat",
      // Insulation buys hours whether or not you have fuel — a household with
      // sleeping bags and no stove is not at zero, it is on borrowed time.
      // Fuel extends that; it does not replace it.
      runwayHours:
        demand.heatKwhPerDay <= 0
          ? Infinity
          : demand.insulationC * 8 + runway(supply.heatKwh, demand.heatKwhPerDay),
      coverage: 0,
      supplyLabel:
        demand.heatKwhPerDay <= 0
          ? "Warm enough without a heat source in this scenario"
          : supply.heatKwh > 0
          ? `${supply.heatKwh.toFixed(1)} kWh of fuel, plus ${Math.round(demand.insulationC * 8)} h from insulation`
          : `No heating fuel — ${Math.round(demand.insulationC * 8)} h of cover from insulation alone`,
      demandLabel:
        demand.heatKwhPerDay <= 0
          ? "—"
          : `${demand.heatKwhPerDay.toFixed(1)} kWh/day to hold 12°C indoors · insulation adds ${demand.insulationC.toFixed(1)}°C`,
    },
    {
      pillar: "power",
      runwayHours: powerRunway,
      coverage: 0,
      supplyLabel:
        supply.whPerDay > 0
          ? `${Math.round(supply.wh)} Wh stored + ${Math.round(supply.whPerDay)} Wh/day generated`
          : `${Math.round(supply.wh)} Wh stored`,
      demandLabel: demand.whPerDay <= 0 ? "—" : `${Math.round(demand.whPerDay)} Wh/day needed`,
    },
    {
      pillar: "light",
      runwayHours: runway(supply.lumenHours, demand.lumenHoursPerDay),
      coverage: 0,
      supplyLabel: `${Math.round(supply.lumenHours).toLocaleString("en-GB")} lumen-hours`,
      demandLabel:
        demand.lumenHoursPerDay <= 0
          ? "—"
          : `${Math.round(demand.lumenHoursPerDay).toLocaleString("en-GB")} lm·h/day needed`,
    },
    {
      pillar: "medical",
      // Medical does not deplete — it is coverage, not a store. Missing whole
      // categories shortens how long you can go before it bites, but a household
      // with nothing is at serious risk rather than dead at hour zero, so the
      // runway floors at a quarter of the scenario instead of collapsing to 0.
      runwayHours:
        medCoverage >= 0.999 ? Infinity : s.hours * (0.25 + 0.75 * medCoverage),
      coverage: medCoverage,
      supplyLabel: `${medCovered} of ${MED_REQUIRED.length} core capabilities`,
      demandLabel: MED_REQUIRED.filter((t) => !supply.medicalTags.has(t)).join(", ") || "complete",
      note:
        medCoverage >= 0.999
          ? "Every core capability is present."
          : `Missing: ${MED_REQUIRED.filter((t) => !supply.medicalTags.has(t)).join(", ")}`,
    },
  ];

  for (const p of pillars) {
    p.coverage = Math.max(0, Math.min(1, p.runwayHours / s.hours));
  }

  // The floor rule from SC 03 applies to SURVIVAL pillars. Water, food, warmth
  // and medical will kill you; running out of phone charge will not. Light and
  // power degrade the situation badly and are reported in full, but they only
  // set the household floor when someone actually depends on powered medical
  // equipment. Without this the model reported "0 hours" for a family who owned
  // food, water, warmth and a first aid kit but no battery bank.
  const survival: Pillar[] = ["water", "food", "heat", "medical"];
  if (h.medicalPower) survival.push("power");

  let failureHour = Infinity;
  let weakest: Pillar = "water";
  for (const p of pillars) {
    if (!survival.includes(p.pillar)) continue;
    if (p.runwayHours < failureHour) {
      failureHour = p.runwayHours;
      weakest = p.pillar;
    }
  }

  const totalWeightKg = items.reduce((t, i) => t + (i.weightKg ?? 0) * i.qty, 0);
  const totalCost = items.reduce((t, i) => t + (i.price ?? 0) * i.qty, 0);

  return {
    demand,
    supply,
    pillars,
    failureHour,
    weakest,
    scenarioHours: s.hours,
    survived: failureHour >= s.hours,
    totalWeightKg,
    totalCost,
  };
}

/* -------------------------------------------------------------------------- */
/* Marginal value — "what is the best next €40?"                               */
/* -------------------------------------------------------------------------- */

export type Recommendation = {
  item: KitItem;
  /** Hours added to the household failure clock. */
  hoursGained: number;
  hoursPerEuro: number;
  pillar: Pillar;
  reason: string;
};

/**
 * Demand is constant per hour in this model, so the effect of adding capacity
 * is exact arithmetic rather than a re-simulation — which is what lets the
 * whole catalogue be ranked instantly on every change.
 */
export function recommend(
  h: Household,
  s: Scenario,
  kit: KitItem[],
  candidates: KitItem[],
  limit = 8
): Recommendation[] {
  const base = simulate(h, s, kit);
  const weakest = base.weakest;
  const cap = s.hours * 2;
  const basePillar = base.pillars.find((p) => p.pillar === weakest)!;
  const before = Math.min(basePillar.runwayHours, cap);
  const baseMin = Math.min(base.failureHour, cap);

  const inKit = new Set(kit.map((i) => i.id));
  const out: Recommendation[] = [];

  for (const c of candidates) {
    if (inKit.has(c.id)) continue;
    const price = c.price ?? 0;
    if (price <= 0) continue;

    const next = simulate(h, s, [...kit, { ...c, qty: 1 }]);

    // Rank against the WEAKEST PILLAR's own runway, not the household minimum.
    // With the floor rule, an empty kit has every pillar at zero, so nothing
    // can ever raise the minimum and a naive greedy optimiser never starts.
    const nextPillar = next.pillars.find((p) => p.pillar === weakest)!;
    let gained = Math.min(nextPillar.runwayHours, cap) - before;

    if (gained <= 0.25) {
      // Nothing for the weak pillar — but it may still have lifted the floor.
      const lift = Math.min(next.failureHour, cap) - baseMin;
      if (lift > 0.25) gained = lift;
      else continue;
    }

    out.push({
      item: { ...c, qty: 1 },
      hoursGained: gained,
      hoursPerEuro: gained / price,
      pillar: weakest,
      reason: reasonFor(c, weakest),
    });
  }

  out.sort((a, b) => b.hoursPerEuro - a.hoursPerEuro);
  return out.slice(0, limit);
}

function reasonFor(c: KitItem, weakest: Pillar): string {
  const a = c.attrs;
  // Describe what the item ACTUALLY contributes. Describing it by the pillar it
  // was ranked for produced nonsense like a water filter "adding 2,400 kcal".
  const claims: [Pillar, string | null][] = [
    [
      "water",
      a.waterStoreL
        ? `Adds ${a.waterStoreL.toFixed(1)} L of stored water`
        : a.waterTreatL
        ? `Treats up to ${a.waterTreatL.toLocaleString("en-GB")} L`
        : null,
    ],
    ["food", a.kcal ? `Adds ${Math.round(a.kcal).toLocaleString("en-GB")} kcal` : null],
    [
      "heat",
      a.heatKwh
        ? `Adds ${a.heatKwh.toFixed(1)} kWh of fuel`
        : a.insulationC
        ? `Cuts heating demand by ${a.insulationC.toFixed(1)}°C`
        : null,
    ],
    [
      "power",
      a.wh
        ? `Adds ${Math.round(a.wh)} Wh of stored power`
        : a.whPerDay
        ? `Generates ${Math.round(a.whPerDay)} Wh/day`
        : null,
    ],
    ["light", a.lumenHours ? `Adds ${Math.round(a.lumenHours).toLocaleString("en-GB")} lumen-hours` : null],
    ["medical", a.medical?.length ? `Covers ${a.medical.join(", ")}` : null],
  ];
  const preferred = claims.find(([p, text]) => p === weakest && text);
  if (preferred) return preferred[1] as string;
  const any = claims.filter(([, text]) => text).map(([, text]) => text as string);
  return any.length ? any.join(" · ") : "Improves your weakest pillar";
}

/* -------------------------------------------------------------------------- */
/* Single points of failure                                                    */
/* -------------------------------------------------------------------------- */

export type Spof = { fuel: string; share: number; count: number; pillar: string };

const FUEL_LABEL: Record<string, string> = {
  butane: "butane / isobutane canisters",
  spirit: "methylated spirit",
  solid: "solid fuel tablets",
  wood: "burnable wood",
  "liquid-fuel": "liquid fuel",
  aa: "AA cells",
  aaa: "AAA cells",
  "18650": "18650 / 21700 cells",
  cr123: "CR123A cells",
  usb: "USB recharging",
  solar: "solar generation",
  mains: "mains electricity",
};

export function findSpofs(items: KitItem[]): Spof[] {
  const heat = items.filter((i) => (i.attrs.heatKwh ?? 0) > 0 || (i.attrs.burnHours ?? 0) > 0);
  const power = items.filter((i) => (i.attrs.wh ?? 0) > 0 || (i.attrs.lumenHours ?? 0) > 0);
  const out: Spof[] = [];

  for (const [group, label] of [
    [heat, "heat and cooking"],
    [power, "power and light"],
  ] as [KitItem[], string][]) {
    if (group.length < 2) continue;
    const byFuel: Record<string, number> = {};
    for (const i of group) {
      const f = i.attrs.fuel;
      if (!f || f === "none") continue;
      byFuel[f] = (byFuel[f] || 0) + 1;
    }
    for (const [fuel, count] of Object.entries(byFuel)) {
      const share = count / group.length;
      if (share >= 0.6 && count >= 2) {
        out.push({ fuel: FUEL_LABEL[fuel] || fuel, share, count, pillar: label });
      }
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Decay — the kit ages                                                        */
/* -------------------------------------------------------------------------- */

export type DecayPoint = { month: number; failureHour: number; expiring: string[] };

export function projectDecay(
  h: Household,
  s: Scenario,
  kit: KitItem[],
  months = 36
): DecayPoint[] {
  const out: DecayPoint[] = [];
  for (let m = 0; m <= months; m += 3) {
    const alive = kit.filter((i) => i.shelfMonths === null || i.shelfMonths > m);
    const expiring = kit
      .filter((i) => i.shelfMonths !== null && i.shelfMonths <= m && i.shelfMonths > m - 3)
      .map((i) => i.name);
    const r = simulate(h, s, alive);
    out.push({ month: m, failureHour: Math.min(r.failureHour, s.hours * 2), expiring });
  }
  return out;
}
