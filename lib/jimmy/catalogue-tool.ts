// Jimmy's catalogue tool.
//
// Shop questions — "do you sell tents", "how much is the Sawyer", "what have you
// got for water" — must never go near the knowledge base. The knowledge base is
// preparedness doctrine written by SC 03; the catalogue is a table of what we
// actually stock. Routing a stock question through doctrine is how Jimmy ended
// up declining to answer whether we sell tents.
//
// So this reads `products` directly and hands the model real rows. It is a tool
// in effect rather than in protocol: the provider layer has no function-calling
// yet, and adding it would be a larger change than this problem needs. The
// lookup is deterministic, cheap and testable, and swapping it for a real tool
// call later touches only this file.
//
// DEMO SCOPE. It deliberately reads the FULL product set rather than the
// `approved_products` view. Only ~83 rows are approved and the 58 super-heroes
// are still drafts, so an approved-only tool would answer "no" to most of what
// Ace wants to test. Everything a row says about itself travels with it — its
// product_status and research_stage go into the block — so Jimmy can tell the
// difference between something we stock and something we are still looking at,
// and say so.

import { supabaseAdmin } from "../supabase";

/* Deliberately a local copy of service.ts's normaliser rather than an import.
   service.ts imports THIS file, and a two-way import between them is the kind
   of cycle that survives tsc and then bites at bundle time. Six lines is a
   cheaper price than that class of bug. */
function normaliseText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const FIELDS =
  "id,slug,sc_product_name,product_name,brand,category_id,subcategory,selling_price," +
  "currency,product_status,research_stage,hero_product,super_hero,ce_certified," +
  "dangerous_goods,eu_sourcing,description";

export type CatalogueHit = {
  name: string;
  brand: string | null;
  category: string;
  subcategory: string | null;
  price: number | null;
  currency: string | null;
  status: string | null;
  stage: string | null;
  ce: boolean;
  euRoute: boolean;
  /* Carried because it changes the answer, not as trivia: a customer asking
     about stoves, fuel or power banks is asking about something that may not
     be postable by every route. Jimmy should be able to say so. */
  dangerousGoods: boolean;
  slug: string | null;
  description: string | null;
};

/* ---------------- intent ---------------- */

/* Deliberately generous. A false positive costs a few hundred tokens of product
   rows the model can ignore; a false negative is Jimmy saying he cannot help
   with the shop he works in. */
const SHOP_INTENT =
  /\b(sell|stock|stocked|carry|have you got|do you have|available|buy|purchase|order|price|prices|pricing|cost|costs|how much|cheap|cheapest|expensive|budget|recommend|recommendation|suggest|best|which|what.{0,12}(do you|have you)|catalogue|catalog|range|product|products|brand|brands|in stock)\b/i;

export function looksLikeShopQuestion(message: string): boolean {
  return SHOP_INTENT.test(message);
}

/* ---------------- product cache ---------------- */

let cache: { at: number; rows: any[]; cats: Record<number, string> } | null = null;
const TTL_MS = 5 * 60_000;

async function load(): Promise<{ rows: any[]; cats: Record<number, string> }> {
  if (cache && Date.now() - cache.at < TTL_MS) return { rows: cache.rows, cats: cache.cats };
  const sb = supabaseAdmin();
  if (!sb) return { rows: [], cats: {} };

  const { data: catRows } = await sb.from("categories").select("id,name");
  const cats: Record<number, string> = {};
  for (const c of catRows || []) cats[(c as any).id] = (c as any).name;

  // Paged: the table is over a thousand rows and PostgREST caps a page at 1,000.
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("products").select(FIELDS).range(from, from + 999);
    if (error) break;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < 1000) break;
  }

  cache = { at: Date.now(), rows, cats };
  return { rows, cats };
}

/* ---------------- lookup ---------------- */

function nameOf(p: any): string {
  return String(p.sc_product_name || p.product_name || "").trim();
}

/** Words that match almost everything in a preparedness catalogue and would
    otherwise drown the real signal. */
const STOP = new Set([
  "the","and","you","for","with","have","has","are","any","can","что","what","how",
  "much","does","did","your","our","this","that","from","get","got","need","want",
  "sell","sells","stock","buy","price","cost","product","products","item","items",
  "emergency","survival","kit","kits","best","good","recommend","looking","about",
]);

export async function searchCatalogue(message: string, limit = 8): Promise<CatalogueHit[]> {
  const { rows, cats } = await load();
  if (!rows.length) return [];

  const tokens = Array.from(
    new Set(
      normaliseText(message)
        .split(" ")
        .filter((w) => w.length >= 3 && !STOP.has(w))
    )
  );
  if (!tokens.length) return [];

  const scored = rows
    .map((p) => {
      const name = normaliseText(nameOf(p));
      const brand = normaliseText(p.brand || "");
      const cat = normaliseText(cats[p.category_id] || "");
      const sub = normaliseText(p.subcategory || "");
      const desc = normaliseText(p.description || "");
      let score = 0;
      for (const t of tokens) {
        if (name.includes(t)) score += 5;
        if (brand.includes(t)) score += 4;
        if (cat.includes(t)) score += 3;
        if (sub.includes(t)) score += 2;
        if (desc.includes(t)) score += 1;
      }
      // Nudge, not override: where a question matches many things equally, show
      // the ones we have actually decided about first.
      if (score > 0) {
        if (p.super_hero) score += 2;
        else if (p.hero_product) score += 1;
        if (p.product_status === "listed" || p.product_status === "approved") score += 1;
      }
      return { p, score };
    })
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ p }) => ({
    name: nameOf(p),
    brand: p.brand || null,
    category: cats[p.category_id] || "Uncategorised",
    subcategory: p.subcategory || null,
    price: p.selling_price === null || p.selling_price === undefined ? null : Number(p.selling_price),
    currency: p.currency || null,
    status: p.product_status || null,
    stage: p.research_stage || null,
    ce: Boolean(p.ce_certified),
    euRoute: p.eu_sourcing === "trade_confirmed" || p.eu_sourcing === "wholesaler_available",
    dangerousGoods: Boolean(p.dangerous_goods),
    slug: p.slug || null,
    description: p.description ? String(p.description).slice(0, 260) : null,
  }));
}

/** Total range size, so "what do you sell" can be answered with a real number
    rather than a shrug. */
export async function catalogueSize(): Promise<{ products: number; categories: string[] }> {
  const { rows, cats } = await load();
  return { products: rows.length, categories: Object.values(cats) };
}

/** The block handed to the model. Every row states what it is AND how settled
    it is, so Jimmy can distinguish stock from research and say which. */
export function formatCatalogueBlock(hits: CatalogueHit[], size: { products: number; categories: string[] }): string {
  const head =
    `\n\n=== CATALOGUE (live, read from our own product table) ===\n` +
    `Range: ${size.products.toLocaleString("en-GB")} products across ${size.categories.length} categories ` +
    `(${size.categories.slice(0, 19).join(", ")}).\n`;

  if (!hits.length) {
    return (
      head +
      `No product in our range matched this question. Say so plainly — do not invent a product, ` +
      `and do not imply we stock something we do not.\n`
    );
  }

  const lines = hits.map((h) => {
    const price =
      h.price === null ? "no price on file" : `${h.currency === "GBP" ? "£" : "€"}${h.price.toFixed(2)}`;
    const flags = [
      h.ce ? "CE" : null,
      h.euRoute ? "EU supply route" : null,
      h.dangerousGoods ? "carriage-restricted" : null,
    ].filter(Boolean);
    return (
      `- ${h.brand ? h.brand + " " : ""}${h.name} — ${h.category}${h.subcategory ? " / " + h.subcategory : ""}` +
      ` · ${price} · status: ${h.status || "unknown"}${h.stage ? ` (${h.stage})` : ""}` +
      (flags.length ? ` · ${flags.join(", ")}` : "") +
      (h.description ? `\n  ${h.description}` : "")
    );
  });

  return (
    head +
    `Products matching this question:\n${lines.join("\n")}\n` +
    `Answer shop questions from THESE ROWS ONLY. Prices and status are real. ` +
    `If a row is not "listed" or "approved", it is something we are still working through — ` +
    `say that rather than presenting it as available to buy.\n`
  );
}
