// KIT BUILDER — capacity derivation.
//
// The simulator needs rates and capacities: litres, kcal, burn hours, watt
// hours, lumen hours. Those columns do not exist on `products` yet, so this
// module DERIVES them from what we do hold — the product name, its category,
// its weight and its description. Names in this catalogue carry real numbers
// ("Seven Oceans Standard Emergency Ration (500g / 2400 kcal)", "Reliance
// Aqua-Tainer 26 L", "LifeStraw Mission 12L"), which is what makes this work.
//
// Everything here is an ESTIMATE and is labelled as one in the UI. The point of
// building it this way round is that the demo tells us exactly which columns
// SC 01 needs to fill, instead of us guessing at a spec in the abstract.

export type FuelType =
  | "butane"
  | "spirit"
  | "solid"
  | "wood"
  | "liquid-fuel"
  | "petrol"
  | "aa"
  | "aaa"
  | "18650"
  | "cr123"
  | "usb"
  | "solar"
  | "mains"
  | "none";

export type KitAttrs = {
  waterStoreL?: number;
  waterTreatL?: number;
  kcal?: number;
  burnHours?: number;
  heatKwh?: number;
  wh?: number;
  whPerDay?: number;
  lumenHours?: number;
  /** Degrees C of heating demand this removes (sleeping bags, blankets). */
  insulationC?: number;
  shelterPersons?: number;
  medical?: string[];
  fuel?: FuelType;
  /** How the figure was arrived at — surfaced in the UI. */
  basis: "parsed" | "typical" | "none";
};

const num = (s: string) => Number(s.replace(/,/g, "."));

function grab(text: string, re: RegExp): number | null {
  const m = text.match(re);
  if (!m) return null;
  const v = num(m[1]);
  return Number.isFinite(v) ? v : null;
}

/** "3-pack", "(12 x 27 g)", "box of 100" → multiplier. */
function packCount(text: string): number {
  const m =
    text.match(/(\d+)\s*[-\s]?(?:pack|pk\b|pcs|count|ct\b|tablets|tabs|sachets|pouches|candles|cubes|bags)/i) ||
    text.match(/\(\s*(\d+)\s*[x×]\s*\d/i) ||
    text.match(/box of\s*(\d+)/i);
  const n = m ? Number(m[1]) : 1;
  return Number.isFinite(n) && n > 0 && n < 2000 ? n : 1;
}

function litres(text: string): number | null {
  const l = grab(text, /(\d+(?:[.,]\d+)?)\s*(?:l|ltr|litre|liter)s?\b/i);
  if (l !== null && l <= 2000) return l;
  const ml = grab(text, /(\d+(?:[.,]\d+)?)\s*ml\b/i);
  if (ml !== null) return ml / 1000;
  const gal = grab(text, /(\d+(?:[.,]\d+)?)\s*(?:gal|gallon)/i);
  if (gal !== null) return gal * 3.785;
  const oz = grab(text, /(\d+(?:[.,]\d+)?)\s*oz\b/i);
  if (oz !== null) return (oz * 29.57) / 1000;
  const qt = grab(text, /(\d+(?:[.,]\d+)?)\s*(?:qt|quart)/i);
  if (qt !== null) return qt * 0.946;
  return null;
}

export function parseWeightKg(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const t = String(raw).toLowerCase();
  const kg = grab(t, /(\d+(?:[.,]\d+)?)\s*kg/);
  if (kg !== null) return kg;
  const g = grab(t, /(\d+(?:[.,]\d+)?)\s*g\b/);
  if (g !== null) return g / 1000;
  const lb = grab(t, /(\d+(?:[.,]\d+)?)\s*(?:lb|lbs|pound)/);
  if (lb !== null) return lb * 0.4536;
  return null;
}

/** Months of shelf life, for the decay projection. */
export function parseShelfLifeMonths(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const t = String(raw).toLowerCase();
  if (/indefinite|unlimited|no expiry|does not expire/.test(t)) return null;
  const y = grab(t, /(\d+(?:[.,]\d+)?)\s*(?:year|yr)/);
  if (y !== null) return Math.round(y * 12);
  const m = grab(t, /(\d+(?:[.,]\d+)?)\s*month/);
  if (m !== null) return Math.round(m);
  return null;
}

function detectFuel(t: string): FuelType | undefined {
  if (/\b(butane|isobutane|isopro|gas canister|gas cartridge|power gas|c500|227\s*g|230\s*g)\b/i.test(t)) return "butane";
  if (/\b(spirit|meths|methylated|denatured|alcohol stove|bioethanol|trangia)\b/i.test(t)) return "spirit";
  if (/\b(esbit|solid fuel|firedragon|hexamine|fuel tab)/i.test(t)) return "solid";
  if (/\b(wood[- ]burning|wood stove|firewood|kelly kettle|solo stove|bushbox|fire box)/i.test(t)) return "wood";
  if (/\b(multi[- ]?fuel|whisperlite|omnifuel|optifuel|polaris)\b/i.test(t)) return "liquid-fuel";
  if (/\bsolar\b/i.test(t)) return "solar";
  if (/\b(aaa)\b/i.test(t)) return "aaa";
  if (/\b(aa)\b/i.test(t)) return "aa";
  if (/\b(18650|21700)\b/i.test(t)) return "18650";
  if (/\bcr123\b/i.test(t)) return "cr123";
  if (/\b(usb|rechargeable|li-?ion|lithium|power bank|power station)\b/i.test(t)) return "usb";
  if (/\b(mains|230v|plug)\b/i.test(t)) return "mains";
  return undefined;
}

const MED_TAGS: [RegExp, string][] = [
  [/tourniquet|c-a-t\b|bleeding control|haemostatic|hemostatic|combat gauze|israeli bandage|chest seal|ifak|trauma/i, "trauma"],
  [/burn(shield)?|hydrogel|water-?jel/i, "burns"],
  [/paracetamol|ibuprofen|painkiller|panadol|analgesic/i, "pain"],
  [/antihistamine|acrivastine|allergy|epipen|adrenaline/i, "allergy"],
  [/loperamide|diarrhoea|rehydration|electrolyte|elotrans|ors\b/i, "gi-hydration"],
  [/antiseptic|betadine|chlorhexidine|alcohol prep|wipes|iodine solution/i, "antisepsis"],
  [/plaster|dressing|bandage|gauze|steri-?strip|melolin|jelonet|tape/i, "wound-care"],
  [/splint|sam splint/i, "fracture"],
  [/thermometer|oximeter|blood pressure|stethoscope|glucose/i, "diagnostics"],
  [/cpr|resuscitation|pocket mask|face shield/i, "resuscitation"],
  [/potassium iodide|\bki\b tablets|radiation/i, "radiological"],
  [/first aid kit|first-aid|erste hilfe|din 13157/i, "kit-general"],
];

export type AttrInput = {
  name: string;
  category: string;
  pillar: string | null;
  description?: string | null;
  summary?: string | null;
  weight?: string | null;
  powerSource?: string | null;
};

export function deriveAttrs(p: AttrInput): KitAttrs {
  const t = `${p.name} ${p.summary ?? ""} ${p.description ?? ""}`;
  const n = p.name.toLowerCase();
  const cat = p.category;
  const packs = packCount(p.name);
  const fuel = detectFuel(`${p.name} ${p.powerSource ?? ""}`);
  let basis: KitAttrs["basis"] = "none";
  const a: KitAttrs = { fuel, basis };

  /* ---------------- WATER ---------------- */
  if (cat === "Water" || /water|hydration|canteen|bottle|jerrycan|aqua/i.test(n)) {
    const isTreatment = /filter|purif|steripen|uv|tablet|aquatab|micropur|chlorine|drops|straw|squeeze|gravity|lifestraw|grayl|befree/i.test(n);
    const isStorage = /bottle|canteen|container|jerrycan|water can|tank|bag|cell|cube|bladder|reservoir|carry|vecto|dromedary|aqua-?tainer|flask|kanteen|bucket|pouch/i.test(n);

    if (isTreatment) {
      const L = litres(p.name);
      // Filters are rated in thousands of litres; the name usually says so.
      if (/lifestraw personal|personal water filter/i.test(n)) a.waterTreatL = 4000;
      else if (/lifestraw|mission|gravity|sawyer|squeeze|versa flow|go flow|gravityworks|sp160/i.test(n)) a.waterTreatL = 1500;
      else if (/guardian|miniworks|pocket water filter|katadyn hiker|micro filter|microfilter/i.test(n)) a.waterTreatL = 2000;
      else if (/grayl|befree|steripen|crazycap|brita|filter bottle/i.test(n)) a.waterTreatL = 300;
      else if (/tablet|aquatab|micropur|germicidal|potable aqua|drops|aquamira|preserver/i.test(n)) a.waterTreatL = packs * 1;
      else a.waterTreatL = 200;
      if (/10\.?000/i.test(n)) a.waterTreatL = 10000;
      if (L && L > 3 && /gravity|mission|jerrycan|lifesaver/i.test(n)) a.waterStoreL = L;
      basis = "parsed";
    }
    if (isStorage) {
      const L = litres(p.name);
      if (L !== null && L > 0) {
        a.waterStoreL = (a.waterStoreL ?? 0) + L * (packs > 1 && L < 1 ? packs : 1);
        basis = "parsed";
      } else if (!a.waterStoreL) {
        a.waterStoreL = 1;
        basis = basis === "parsed" ? basis : "typical";
      }
    }
    if (/emergency drinking water|water pouch|water sachet/i.test(n)) {
      const L = litres(p.name) ?? 0.125;
      a.waterStoreL = L * (packs > 1 ? packs : 12);
      basis = "parsed";
    }
  }

  /* ---------------- FOOD ---------------- */
  if (cat === "Food" || /ration|meal|food|kcal|calorie/i.test(n)) {
    const kcal = grab(p.name, /(\d[\d.,]*)\s*kcal/i);
    if (kcal !== null) {
      a.kcal = kcal * (packs > 1 ? packs : 1);
      basis = "parsed";
    } else if (/ration|mre|epa\b|nrg-?5|datrex|emergency food/i.test(n)) {
      const g = grab(p.name, /(\d[\d.,]*)\s*g\b/i);
      a.kcal = g !== null ? Math.round(g * 4.8) : 2400;
      basis = g !== null ? "parsed" : "typical";
    } else if (/freeze-?dried|mountain house|expedition foods|tactical foodpack|pouch meal/i.test(n)) {
      a.kcal = 800;
      basis = "typical";
    } else if (/30-day|30 day/i.test(n)) {
      a.kcal = 30 * 1800;
      basis = "parsed";
    } else if (/72-?hour|3-day/i.test(n)) {
      a.kcal = 3 * 1800;
      basis = "parsed";
    }
  }

  /* ---------------- FIRE / HEAT / COOK ---------------- */
  if (cat === "Fire & Cooking" || /stove|fuel|candle|firelighter|tinder|burner/i.test(n)) {
    const hours = grab(p.name, /(\d+(?:[.,]\d+)?)\s*[-\s]?hour/i);
    if (/candle/i.test(n)) {
      a.burnHours = (hours ?? 8) * packs;
      a.lumenHours = 12 * (a.burnHours ?? 0);
      basis = hours !== null ? "parsed" : "typical";
    }
    // Fuel energy: butane ~12.7 kWh/kg, spirit ~6.1, solid ~7.
    const g = grab(p.name, /(\d[\d.,]*)\s*g\b/i);
    if (/canister|cartridge|isopro|power gas|c500/i.test(n)) {
      const grams = g ?? 230;
      a.heatKwh = (grams / 1000) * 12.7;
      a.burnHours = a.heatKwh / 1.5;
      basis = "parsed";
    } else if (/methylated|denatured|bioethanol|spirit(?!\s*stove)/i.test(n)) {
      const L = litres(p.name) ?? 1;
      a.heatKwh = L * 5.9;
      a.burnHours = a.heatKwh / 1.2;
      basis = "parsed";
    } else if (/esbit|solid fuel|firedragon|hexamine/i.test(n)) {
      const grams = g ?? 27;
      a.heatKwh = ((grams * packs) / 1000) * 7;
      a.burnHours = a.heatKwh / 0.8;
      basis = "parsed";
    }
    if (/heater|gas heater|qlima/i.test(n)) {
      a.heatKwh = 0; // appliance, not a store
    }
  }

  /* ---------------- POWER / LIGHT ---------------- */
  if (cat === "Lighting & Power" || /torch|lantern|headlamp|head torch|power bank|power station|battery|solar|inverter|radio/i.test(n)) {
    const wh = grab(p.name, /(\d[\d.,]*)\s*wh\b/i);
    const mah = grab(p.name, /(\d[\d.,]*)\s*mah/i);
    const w = grab(p.name, /(\d[\d.,]*)\s*w\b/i);
    if (wh !== null) {
      a.wh = wh;
      basis = "parsed";
    } else if (mah !== null) {
      a.wh = Math.round((mah * 3.7) / 1000);
      basis = "parsed";
    } else if (/power station|delta|jackery|river/i.test(n)) {
      a.wh = /delta 2/i.test(n) ? 1024 : /1000/i.test(n) ? 1000 : 256;
      basis = "typical";
    } else if (/aa\b|aaa\b|18650|21700|cr123/i.test(n) && /batter/i.test(n)) {
      a.wh = 3 * packs;
      basis = "typical";
    }
    if (/solar/i.test(n) && w !== null) {
      a.whPerDay = Math.round(w * 3.5); // conservative EU peak-sun hours
      basis = "parsed";
    } else if (/solar/i.test(n)) {
      a.whPerDay = 60;
      basis = "typical";
    }
    if (/wind-?up|crank|dynamo/i.test(n)) {
      a.whPerDay = 6;
      basis = "typical";
    }
    if (/torch|flashlight|headlamp|head torch|lantern|light|glow stick|chemlight/i.test(n)) {
      const lm = grab(p.name, /(\d[\d.,]*)\s*(?:lumen|lm)\b/i);
      const hrs = grab(p.name, /(\d+(?:[.,]\d+)?)\s*[-\s]?hour/i);
      if (/glow stick|chemlight/i.test(n)) {
        a.lumenHours = (hrs ?? 12) * 8 * packs;
        basis = "parsed";
      } else {
        a.lumenHours = (lm ?? 250) * (hrs ?? 12);
        basis = lm !== null ? "parsed" : "typical";
      }
    }
  }

  /* ---------------- SHELTER / WARMTH ---------------- */
  if (cat === "Shelter & Warmth" || cat === "Clothing / PPE") {
    if (/sleeping bag|schlafsack|softie|down bag|carinthia|snugpak softie|grüezi/i.test(n)) {
      const c = grab(p.name, /-\s*(\d+)\s*°?c/i);
      a.insulationC = c !== null ? Math.min(18, 4 + c) : /expedition|1000|antarctica|defence 6/i.test(n) ? 16 : 9;
      basis = c !== null ? "parsed" : "typical";
    } else if (/bivvy|bivy|bothy|survival bag|blizzard/i.test(n)) {
      a.insulationC = 5;
      basis = "typical";
    } else if (/emergency blanket|survival blanket|foil blanket|sol\b/i.test(n)) {
      a.insulationC = 2.5;
      basis = "typical";
    } else if (/wool blanket|fleece blanket|camp blanket|underblanket|underquilt/i.test(n)) {
      a.insulationC = 4;
      basis = "typical";
    } else if (/sleeping pad|sleeping mat|neoair|z lite|klymit|exped/i.test(n)) {
      a.insulationC = 3;
      basis = "typical";
    } else if (/hand warmer|foot warmer|hothands|thermopad/i.test(n)) {
      a.insulationC = 1;
      basis = "typical";
    } else if (/jacket|fleece|base layer|beanie|gloves|socks|down|puff/i.test(n)) {
      a.insulationC = 2;
      basis = "typical";
    }
    const persons = grab(p.name, /(\d+)\s*[-\s]?person/i);
    if (/tent|tarp|shelter|hammock|bothy|poncho/i.test(n)) {
      a.shelterPersons = persons ?? 2;
      basis = persons !== null ? "parsed" : "typical";
    }
  }

  /* ---------------- MEDICAL ---------------- */
  if (cat === "Medical" || p.pillar === "Medical") {
    const tags = MED_TAGS.filter(([re]) => re.test(t)).map(([, tag]) => tag);
    if (tags.length) {
      a.medical = [...new Set(tags)];
      basis = "parsed";
    }
  }

  a.basis = basis;
  return a;
}

/** Does this product contribute anything the simulator can use? */
export function hasKitValue(a: KitAttrs): boolean {
  return Boolean(
    a.waterStoreL ||
      a.waterTreatL ||
      a.kcal ||
      a.heatKwh ||
      a.burnHours ||
      a.wh ||
      a.whPerDay ||
      a.lumenHours ||
      a.insulationC ||
      a.shelterPersons ||
      (a.medical && a.medical.length)
  );
}
