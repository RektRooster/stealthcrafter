import { supabaseAdmin } from "../supabase";
import { deriveAttrs, hasKitValue, parseShelfLifeMonths, parseWeightKg } from "./attributes";
import type { KitItem } from "./sim";
import { parseImages } from "../catalogue-data";

const FIELDS =
  "id,slug,sc_product_name,product_name,brand,pillar,category_id,selling_price,currency," +
  "weight,shelf_life,power_source,description,customer_notes,image_urls,hero_product,product_status";

const GBP_TO_EUR = 1.17;

export type KitCatalogue = {
  configured: boolean;
  items: (KitItem & { image: string | null; hero: boolean; pillar: string | null })[];
};

/** Every product the simulator can actually reason about. */
export async function getKitCatalogue(): Promise<KitCatalogue> {
  const sb = supabaseAdmin();
  if (!sb) return { configured: false, items: [] };

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
