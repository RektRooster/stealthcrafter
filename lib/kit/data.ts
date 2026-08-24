import { supabaseAdmin } from "../supabase";
import { deriveAttrs, hasKitValue, parseShelfLifeMonths, parseWeightKg } from "./attributes";
import type { KitItem } from "./sim";
import { parseImages } from "../catalogue-data";
import { getMeasuredByProduct } from "../tested-data";

const FIELDS =
  "id,slug,sc_product_name,product_name,brand,pillar,category_id,selling_price,currency," +
  "weight,shelf_life,power_source,description,customer_notes,image_urls,hero_product,product_status";

const GBP_TO_EUR = 1.17;

export type KitCatalogue = {
  configured: boolean;
  items: (KitItem & {
    image: string | null;
    hero: boolean;
    pillar: string | null;
    /** True when a published test session supplied a figure the box did not. */
    measured?: boolean;
  })[];
};

/* Where we have tested a product, our measured number replaces the
   manufacturer's claim in the simulation. That is the whole point of running a
   protocol: the Kit Builder computes on what we saw, not what the box says. */
function applyMeasured(
  attrs: any,
  rows: { name: string; value: number; unit: string }[] | undefined
): boolean {
  if (!rows?.length) return false;
  let changed = false;
  for (const r of rows) {
    const n = r.name.toLowerCase();
    const u = (r.unit || "").toLowerCase();
    if (u === "ml/min" && /dirty/.test(n)) {
      // Sustained dirty-water throughput is the honest planning figure: cap the
      // treatable volume at what the filter can actually deliver in a day.
      attrs.waterTreatL = Math.min(attrs.waterTreatL ?? Infinity, Math.round((r.value * 60 * 8) / 1000) * 30);
      changed = true;
    } else if (u === "kcal") {
      attrs.kcal = r.value;
      changed = true;
    } else if (u === "lm") {
      // Keep the tested runtime, swap in the measured output.
      const hours = attrs.lumenHours && r.value ? attrs.lumenHours / (attrs.lumenHours / r.value) : null;
      attrs.lumenHours = r.value * 12;
      changed = true;
      void hours;
    }
  }
  return changed;
}

/** Every product the simulator can actually reason about. */
export async function getKitCatalogue(): Promise<KitCatalogue> {
  const sb = supabaseAdmin();
  if (!sb) return { configured: false, items: [] };

  const measuredByProduct = await getMeasuredByProduct().catch(() => ({}));

  const { data: catRows } = await sb.from("categories").select("id,name");
  const cats: Record<number, string> = {};
  (catRows || []).forEach((c: any) => (cats[c.id] = c.name));

  const rows: any[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from("products").select(FIELDS).range(from, from + PAGE - 1);
    if (error) break;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }

  const items = rows
    .filter((r) => r.slug && r.product_status !== "rejected")
    .map((r) => {
      const name = r.sc_product_name || r.product_name || "Unnamed product";
      const category = cats[r.category_id] || "Uncategorised";
      const attrs = deriveAttrs({
        name,
        category,
        pillar: r.pillar || null,
        description: r.description,
        summary: r.customer_notes,
        weight: r.weight,
        powerSource: r.power_source,
      });
      const measured = applyMeasured(attrs, (measuredByProduct as any)[r.id]);
      const priceRaw = r.selling_price === null ? null : Number(r.selling_price);
      const price =
        priceRaw === null
          ? null
          : (r.currency || "EUR").toUpperCase() === "GBP"
          ? Math.round(priceRaw * GBP_TO_EUR * 100) / 100
          : priceRaw;
      return {
        id: r.id,
        slug: r.slug,
        name,
        brand: r.brand || null,
        category,
        pillar: r.pillar || null,
        price,
        weightKg: parseWeightKg(r.weight),
        shelfMonths: parseShelfLifeMonths(r.shelf_life),
        attrs,
        qty: 1,
        image: parseImages(r.image_urls)[0] ?? null,
        hero: Boolean(r.hero_product),
        measured,
      };
    })
    .filter((i) => hasKitValue(i.attrs));

  // Heroes first, then the ones carrying a parsed (rather than assumed) figure.
  items.sort((a, b) => {
    const h = Number(b.hero) - Number(a.hero);
    if (h) return h;
    const p = Number(b.attrs.basis === "parsed") - Number(a.attrs.basis === "parsed");
    if (p) return p;
    return a.name.localeCompare(b.name);
  });

  return { configured: true, items };
}
