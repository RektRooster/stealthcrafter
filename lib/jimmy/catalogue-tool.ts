// Jimmy's catalogue tool.
//
// Shop questions must never go near the knowledge base. The knowledge base is
// preparedness doctrine written by SC 03; the catalogue is a table of what we
// actually stock. Routing a stock question through doctrine is how Jimmy ended
// up declining to say whether we sell tents.
//
// It is a tool in effect rather than in protocol: the provider layer has no
// function-calling yet. The lookup is deterministic, cheap and testable, and
// swapping it for a real tool call later touches only this file.
//
// v2 — after live testing. Jimmy listed eight tents, was asked which suited
// "me, my son, my wife and a dog", and said we had "no specific family tent
// options" before sending the customer to "our store" and "local options". He
// is the store. Three separate faults sat behind that one sentence and all
// three are answered here:
//
//   * he searched again instead of reasoning over what he had just retrieved
//     — so results now travel forward and arrive back as carried context;
//   * he searched on SPELLING, and nothing is named "family tent" — so a
//     household is read out of the question and turned into a capacity filter;
//   * an empty result told him to say we have nothing — so an empty result now
//     escalates to the nearest thing we DO have, plus the size of the shortfall.
//
// DEMO SCOPE. Reads the fuller product set rather than the `approved_products`
// view — only ~83 rows are approved and the 58 super-heroes are still drafts —
// with `rejected` excluded. Every row carries its own status and research stage
// so Jimmy can tell stock from research and say which.

import { supabaseAdmin } from "../supabase";

/* Local copy of service.ts's normaliser rather than an import: service.ts
   imports this file, and a two-way import is the kind of cycle that survives
   tsc and bites at bundle time. */
function normaliseText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const FIELDS =
  "id,slug,sc_product_name,product_name,brand,category_id,subcategory,selling_price," +
  "currency,product_status,research_stage,hero_product,super_hero,ce_certified," +
  "dangerous_goods,eu_sourcing,description,people_capacity,weight_grams,season_rating," +
  "packed_size,attributes_source";

export type CatalogueHit = {
  /** the product row's own id — carried so an offer made this turn can be
      acted on next turn without re-matching a name */
  id: string;
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
  dangerousGoods: boolean;
  capacity: number | null;
  weightGrams: number | null;
  season: string | null;
  packedSize: string | null;
  /** true when this row was offered as the nearest thing rather than a match */
  nearest?: boolean;
  slug: string | null;
  description: string | null;
};

export type Household = {
  people: number;
  pets: number;
  /** what we read it from, so the model can correct us out loud if we misread */
  read: string;
};

export type RangeGap = {
  asked: string;
  missing: string;
  category: string | null;
  requestedCapacity: number | null;
  bestAvailableCapacity: number | null;
};

export type CatalogueResult = {
  hits: CatalogueHit[];
  size: { products: number; categories: string[] };
  household: Household | null;
  /** capacity the question implies, once a household has been read out of it */
  needCapacity: number | null;
  /** set ONLY when nothing in the whole category meets needCapacity — a real
      range gap, not merely a miss against the list already shown */
  shortfall: { requested: number; bestAvailable: number | null; scope: string } | null;
  /** set when the shown list could not take them but something else in the
      category can — a redirect within our own range, not a gap */
  widened: { from: string; requested: number } | null;
  /** categories the conversation is anchored to, from what was already shown */
  scope: string[];
  gap: RangeGap | null;
};

/* ---------------- intent ---------------- */

/* Deliberately generous. A false positive costs a few hundred tokens of product
   rows the model can ignore; a false negative is Jimmy saying he cannot help
   with the shop he works in. */
const SHOP_INTENT =
  /\b(sell|stock|stocked|carry|have you got|do you have|available|buy|purchase|order|price|prices|pricing|cost|costs|how much|cheap|cheapest|expensive|budget|recommend|recommendation|suggest|best|which|what.{0,12}(do you|have you)|catalogue|catalog|range|product|products|brand|brands|in stock)\b/i;

/* A follow-up rarely repeats the noun. "which of those?", "the best one for
   us", "is it any good?" are all shop questions ONLY in the light of what came
   before — which is exactly the turn Jimmy got wrong. */
const FOLLOW_UP =
  /\b(that one|those|these|them|it|the best|best one|which|any of|instead|cheaper|lighter|bigger|smaller|warmer|for (my|our|us)|suits?|suitable|fits?|difference|compare|vs\b)\b/i;

export function looksLikeShopQuestion(message: string, hasCarried = false): boolean {
  if (SHOP_INTENT.test(message)) return true;
  return hasCarried && FOLLOW_UP.test(message);
}

/* ---------------- reading a household out of a sentence ---------------- */

const NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, a: 1, an: 1,
};

function asCount(word: string | undefined): number {
  if (!word) return 1;
  const w = word.trim().toLowerCase();
  if (/^\d+$/.test(w)) {
    const n = parseInt(w, 10);
    return n > 0 && n < 40 ? n : 1;
  }
  return NUMBERS[w] ?? 1;
}

const PERSON_NOUN =
  /(?:^|\s)(?:(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|a|an)\s+)?(people|persons|person|adults|adult|kids|kid|children|child|sons|son|daughters|daughter|wife|husband|partner|babies|baby|toddlers|toddler|teenagers|teenager|parents|parent|grandparents|grandparent|mother|mum|mom|father|dad)\b/g;

const PET_NOUN = /(?:^|\s)(?:(\d{1,2}|one|two|three|a|an)\s+)?(dogs|dog|cats|cat|pets|pet|puppy|puppies)\b/g;

/** Turn "me, my son, my wife and a dog" into { people: 3, pets: 1 }.
 *  This is the whole point of fix 2: nothing in the catalogue is NAMED "family
 *  tent", but a household is a capacity, and capacity is a column. */
export function readHousehold(text: string): Household | null {
  const t = " " + text.toLowerCase().replace(/[^a-z0-9\s+]/g, " ").replace(/\s+/g, " ") + " ";

  // "family of four" / "household of 5" states it outright — trust it and stop.
  const explicit = t.match(/\b(?:family|household|group|party)\s+of\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b/);
  let people = 0;
  const parts: string[] = [];

  if (explicit) {
    people = asCount(explicit[1]);
    parts.push(`"${explicit[0].trim()}"`);
  } else {
    let m: RegExpExecArray | null;
    PERSON_NOUN.lastIndex = 0;
    while ((m = PERSON_NOUN.exec(t))) {
      const n = asCount(m[1]);
      people += n;
      parts.push(n > 1 ? `${n} ${m[2]}` : m[2]);
    }
    // The speaker counts too, and almost never says "one adult" about themselves.
    if (/\b(?:me|myself|i'?m|i am|i have|i've|we|us|our)\b/.test(t)) {
      people += 1;
      parts.push("themselves");
    }
    if (/\bcouple\b/.test(t) && people < 2) {
      people = 2;
      parts.push("a couple");
    }
  }

  let pets = 0;
  let pm: RegExpExecArray | null;
  PET_NOUN.lastIndex = 0;
  while ((pm = PET_NOUN.exec(t))) {
    const n = asCount(pm[1]);
    pets += n;
    parts.push(n > 1 ? `${n} ${pm[2]}` : `a ${pm[2]}`);
  }

  // "family" with no arithmetic behind it: a real word with a real minimum.
  if (people === 0 && pets === 0) {
    if (/\bfamil(?:y|ies)\b/.test(t)) return { people: 4, pets: 0, read: 'the word "family", with no numbers given — assumed four' };
    return null;
  }
  if (people === 0) people = 1;
  return { people, pets, read: parts.join(", ") };
}

/** A dog needs floor space like a person does. This is the "family of 3 + dog
 *  -> capacity >= 4" mapping, written down in one place. */
export function capacityFor(h: Household | null): number | null {
  if (!h) return null;
  const n = h.people + (h.pets > 0 ? 1 : 0);
  return n > 1 ? n : null; // one person needs no filter
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

  // Paged: 1,173 products and PostgREST caps a page at 1,000.
  //
  // REJECTED is the one status excluded. "The full set, not just
  // approved_products" means Jimmy should see what we are still working
  // through — not that he should offer something the business turned down.
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("products")
      .select(FIELDS)
      .neq("product_status", "rejected")
      .range(from, from + 999);
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
  "the","and","you","for","with","have","has","are","any","can","what","how",
  "much","does","did","your","our","this","that","from","get","got","need","want",
  "sell","sells","stock","stocks","buy","buys","price","prices","cost","costs",
  "product","products","item","items","thing","things","something","anything",
  "emergency","survival","kit","kits","best","good","recommend","looking","about",
  // household words: they steer the CAPACITY filter, and as search terms they
  // match nothing and crowd out the real noun.
  "family","families","household","people","person","adult","adults","kid","kids",
  "child","children","son","daughter","wife","husband","partner","baby","dog",
  "cat","pet","pets","group",
]);

/* Crude singular stem, and the difference between this tool working and not.
   Matching is substring-based, and the catalogue has twelve products with
   "tent" in the name and ZERO with "tents" — so an unstemmed "do you sell
   tents" scores nothing on every row. Stemming only the QUERY side covers both
   directions, since the stem is a substring of the plural too. Conservative:
   nothing stripped from ss/us/is endings ("gas", "lens") or below four
   characters. */
function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("sses")) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("es") && !w.endsWith("ses")) return w.slice(0, -1);
  if (w.length >= 4 && w.endsWith("s") && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

function tokensOf(message: string): string[] {
  return Array.from(
    new Set(
      normaliseText(message)
        .split(" ")
        .filter((w) => w.length >= 3 && !STOP.has(w))
        .map(stem)
        .filter((w) => w.length >= 3 && !STOP.has(w))
    )
  );
}

function toHit(p: any, cats: Record<number, string>): CatalogueHit {
  return {
    id: p.id,
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
    capacity: p.people_capacity ?? null,
    weightGrams: p.weight_grams ?? null,
    season: p.season_rating || null,
    packedSize: p.packed_size || null,
    slug: p.slug || null,
    description: p.description ? String(p.description).slice(0, 260) : null,
  };
}

function scoreRow(p: any, cats: Record<number, string>, tokens: string[]): number {
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
    if (p.product_status === "approved") score += 1;
  }
  return score;
}

export type SearchOpts = {
  /** rows already shown to this customer earlier in the conversation */
  carried?: CatalogueHit[];
  /** earlier user turns, so "the best one" still knows the subject is tents */
  priorText?: string;
  limit?: number;
};

export async function searchCatalogue(message: string, opts: SearchOpts = {}): Promise<CatalogueResult> {
  const limit = opts.limit ?? 8;
  const carried = opts.carried || [];
  const { rows, cats } = await load();
  const size = { products: rows.length, categories: Object.values(cats) };
  const household = readHousehold([message, opts.priorText || ""].join(" "));
  const needCapacity = capacityFor(household);

  const base: CatalogueResult = {
    hits: [], size, household, needCapacity, shortfall: null, widened: null, scope: [], gap: null,
  };
  if (!rows.length) return base;

  // The conversation's subject, taken from what was already shown. This is what
  // lets "which is best for my family" stay a question about TENTS.
  const scope = Array.from(new Set(carried.map((h) => h.category).filter(Boolean)));
  base.scope = scope;

  // 1) Ordinary term search on this turn's message, widened by prior turns.
  const tokens = tokensOf(message).length ? tokensOf(message) : tokensOf(opts.priorText || "");
  let working: any[] = [];
  if (tokens.length) {
    working = rows
      .map((p) => ({ p, score: scoreRow(p, cats, tokens) }))
      .filter((x) => x.score >= 3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40)
      .map((x) => x.p);
  }

  // 2) Nothing matched by name, but the customer is plainly still talking about
  //    the last list. Reason over what we already showed rather than denying it.
  const fromCarried = !working.length && carried.length > 0;
  if (fromCarried) {
    const shown = new Set(carried.map((h) => h.name));
    working = rows.filter((p) => shown.has(nameOf(p)));
  }

  if (!needCapacity) {
    base.hits = working.slice(0, limit).map((p) => toHit(p, cats));
    return base;
  }

  // 3) A household was read out of the question, so capacity is now a filter.
  const fits = working.filter((p) => (p.people_capacity ?? 0) >= needCapacity);
  if (fits.length) {
    base.hits = fits
      .sort((a, b) => (a.people_capacity ?? 0) - (b.people_capacity ?? 0))
      .slice(0, limit)
      .map((p) => toHit(p, cats));
    return base;
  }

  // 4) NOTHING FITS. Never an empty result — this is the branch that produced
  //    "no specific family tent options, check with our store". Widen to the
  //    whole category and offer the nearest thing we actually have, with the
  //    size of the shortfall stated so the answer can be honest about it.
  const inScope = (p: any) =>
    !scope.length || scope.includes(cats[p.category_id] || "Uncategorised");

  const roomier = rows
    .filter((p) => inScope(p) && (p.people_capacity ?? 0) >= needCapacity)
    .sort((a, b) => (a.people_capacity ?? 0) - (b.people_capacity ?? 0));

  const bestAvailable = rows
    .filter(inScope)
    .reduce<number | null>((mx, p) => {
      const c = p.people_capacity ?? null;
      return c !== null && (mx === null || c > mx) ? c : mx;
    }, null);

  const scopeLabel = scope.length ? scope.join(" / ") : "the range";

  if (roomier.length) {
    // Something in the category DOES take the household, even though nothing in
    // the list already shown did — a group bothy when they were shown tents.
    // Not a range gap: a redirect inside our own range. It still needs saying
    // that it is not the same kind of thing they asked for, which is what the
    // `widened` flag tells the model to do.
    base.hits = roomier.slice(0, limit).map((p) => ({ ...toHit(p, cats), nearest: true }));
    base.widened = { from: scopeLabel, requested: needCapacity };

    // Still logged. A group bothy that sleeps four is not a family tent, and the
    // fact that we could only answer with a substitute is exactly the signal
    // SC 01 wants: customers are asking for something we do not sell.
    const subject = carried.find((h) => h.subcategory)?.subcategory || scopeLabel;
    base.gap = {
      asked: message.slice(0, 400),
      missing:
        `No ${subject} for ${needCapacity} (${household ? household.read : "a larger household"}). ` +
        `Offered instead: ${base.hits.map((h) => h.name).join("; ")}.`,
      category: scope[0] || null,
      requestedCapacity: needCapacity,
      bestAvailableCapacity: bestAvailable,
    };
    return base;
  }

  // Genuinely nothing in the category. Offer the largest we hold, marked as
  // falling short, and log it — this is the branch that is worth money to SC 01.
  base.hits = working
    .sort((a, b) => (b.people_capacity ?? 0) - (a.people_capacity ?? 0))
    .slice(0, limit)
    .map((p) => ({ ...toHit(p, cats), nearest: true }));

  base.shortfall = { requested: needCapacity, bestAvailable, scope: scopeLabel };
  base.gap = {
    asked: message.slice(0, 400),
    missing:
      `Nothing in ${scopeLabel} for ${needCapacity} ` +
      `(${household ? household.read : "a larger household"}). Largest held: ` +
      (bestAvailable === null ? "capacity not recorded" : `${bestAvailable}`) + ".",
    category: scope[0] || null,
    requestedCapacity: needCapacity,
    bestAvailableCapacity: bestAvailable,
  };
  return base;
}

/** Total range size, so "what do you sell" can be answered with a real number
    rather than a shrug. */
export async function catalogueSize(): Promise<{ products: number; categories: string[] }> {
  const { rows, cats } = await load();
  return { products: rows.length, categories: Object.values(cats) };
}

/* ---------------- the block handed to the model ---------------- */

function line(h: CatalogueHit): string {
  const price =
    h.price === null ? "no price on file" : `${h.currency === "GBP" ? "£" : "€"}${h.price.toFixed(2)}`;
  const facts = [
    h.capacity !== null ? `sleeps/serves ${h.capacity}` : null,
    h.weightGrams !== null
      ? h.weightGrams >= 1000
        ? `${(h.weightGrams / 1000).toFixed(2)} kg`
        : `${h.weightGrams} g`
      : null,
    h.season,
    h.packedSize,
    h.ce ? "CE" : null,
    h.euRoute ? "EU supply route" : null,
    h.dangerousGoods ? "carriage-restricted" : null,
  ].filter(Boolean);
  const brand =
    h.brand && !h.name.toLowerCase().includes(h.brand.toLowerCase()) ? h.brand + " " : "";
  return (
    `- ${brand}${h.name} — ${h.category}${h.subcategory ? " / " + h.subcategory : ""}` +
    ` · ${price} · status: ${h.status || "unknown"}${h.stage ? ` (${h.stage})` : ""}` +
    (facts.length ? ` · ${facts.join(" · ")}` : "") +
    (h.description ? `\n  ${h.description}` : "")
  );
}

export function formatCatalogueBlock(result: CatalogueResult, carried: CatalogueHit[] = []): string {
  const { size, hits, household, needCapacity, shortfall, widened } = result;

  let out =
    `\n\n=== CATALOGUE (live, read from our own product table) ===\n` +
    `Our range: ${size.products.toLocaleString("en-GB")} products across ${size.categories.length} categories ` +
    `(${size.categories.join(", ")}).\n` +
    `THIS IS OUR SHOP. You work here. Everything below is ours to sell.\n`;

  if (carried.length) {
    out +=
      `\nALREADY SHOWN TO THIS CUSTOMER EARLIER IN THIS CONVERSATION — they can see these, ` +
      `and a follow-up like "which is best?" almost certainly means one of them. Reason over ` +
      `this list before you decide you have nothing:\n` +
      carried.map(line).join("\n") +
      "\n";
  }

  if (household) {
    out +=
      `\nWHO THEY ARE BUYING FOR: ${household.people} ` +
      `${household.people === 1 ? "person" : "people"}` +
      (household.pets ? ` and ${household.pets} ${household.pets === 1 ? "animal" : "animals"}` : "") +
      ` — read from ${household.read}.` +
      (needCapacity ? ` Treat that as needing capacity ${needCapacity} or more.` : "") +
      ` If we have misread it, ask rather than assume.\n`;
  }

  if (widened) {
    out +=
      `\nNONE OF THE ONES ALREADY SHOWN TAKE ${widened.requested}. ` +
      `We DO hold these in ${widened.from}, which are big enough — but check they are the right ` +
      `kind of thing before recommending one, and say openly if they are not what was asked for. ` +
      `Do not tell the customer we have nothing.\n`;
  }

  if (shortfall) {
    out +=
      `\n*** NOTHING IN ${shortfall.scope.toUpperCase()} MEETS THIS. *** ` +
      `They need ${shortfall.requested}; the largest we hold in that area is ` +
      (shortfall.bestAvailable === null ? "not recorded" : String(shortfall.bestAvailable)) +
      `. The rows below are the NEAREST we have, not a match. Say that plainly.\n`;
  }

  if (hits.length) {
    out +=
      `\n${shortfall ? "NEAREST WE ACTUALLY HAVE" : widened ? "BIG ENOUGH, FROM ELSEWHERE IN OUR RANGE" : "MATCHING PRODUCTS"}:\n` +
      hits.map(line).join("\n") +
      "\n";
  } else if (!carried.length) {
    out += `\nNothing in our range matched this question.\n`;
  }

  out +=
    `\nHOW TO USE THIS:\n` +
    `- Prices and status are real. Quote them. Never invent a product, a price or a stock position.\n` +
    `- A row that is not "approved" is something we are still working through — say so rather than ` +
    `presenting it as ready to buy.\n` +
    `- YOU ARE STEALTHCRAFTER. Never tell a customer to "check with our store", "contact the shop", ` +
    `"try a local retailer" or "look elsewhere". There is no one else to ask. You are who they are asking.\n` +
    `- WHEN WE CANNOT MEET THE REQUEST, never dead-end. Answer in this shape:\n` +
    `    (a) say plainly what we do not have;\n` +
    `    (b) recommend the nearest thing we DO have, and be honest about how it falls short;\n` +
    `    (c) tell them what to look for so the advice is worth having anyway;\n` +
    `    (d) tell them you are flagging the gap to the buying team — we log it, and it is true.\n` +
    `  Being useful about a real range beats being vague about an imaginary one.\n`;

  return out;
}
