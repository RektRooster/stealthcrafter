// JIMMY OFFERS THE BASKET.
//
// Up to now he would put something in the basket if asked and otherwise leave
// the customer to find the button. That is a guide who stops one step short: a
// person who has just been told "this is the one for your household" should not
// then have to go and hunt for it.
//
// The whole difficulty is restraint. An assistant that offers on every message
// is a nag, an assistant that offers a list is useless, and an assistant that
// offers a substitute as though it were the thing asked for is dishonest. So the
// decision is made HERE, deterministically, and the model is only told to make
// the offer when all of those are already ruled out. It gets to choose the
// words; it does not get to choose whether.

import type { CatalogueHit, CatalogueResult } from "./catalogue-tool";

export type BasketOffer = {
  productId: string;
  name: string;
  price: number | null;
  /** true when this was the nearest thing rather than a match — it must then be
      offered as what it actually is, in the same sentence */
  nearest: boolean;
};

/* ---------------- is the customer heading towards buying? ---------------- */

/* Not "are they interested" — that would fire on every question. These are the
   moments where a person has narrowed to ONE thing and is weighing it: asking
   what it costs, asking which to pick, or saying they like the sound of it. */
const BUYING_INTENT = new RegExp(
  [
    // price and cost
    "\\bhow much\\b", "\\bwhat does it cost\\b", "\\bwhat'?s the price\\b", "\\bprice of\\b",
    // choosing between things already on the table
    "\\bwhich (?:one |is |would |do )?", "\\bbest (?:one|for)\\b", "\\bwhat should i (?:get|buy|go for)\\b",
    "\\brecommend\\b", "\\bwould you (?:go for|pick|choose)\\b",
    // assent to something just described
    "\\bthat sounds (?:right|good|great|perfect|ideal)\\b", "\\bsounds (?:right|good|great)\\b",
    "\\bthat looks (?:right|good|great)\\b", "\\bthat'?s the one\\b", "\\bthat'?ll do\\b",
    // suitability for their own household — the product page's Ask Jimmy link
    "\\bis it right for\\b", "\\bwould (?:it|that) suit\\b", "\\bsuitable for (?:my|our|us)\\b",
    "\\bgood enough for\\b", "\\bwork for (?:my|our|us)\\b",
  ].join("|"),
  "i"
);

export function looksLikeBuyingIntent(message: string): boolean {
  return BUYING_INTENT.test(message);
}

/* ---------------- answering an offer ---------------- */

/* Anchored at the start. "yes" in the middle of a sentence is usually part of a
   longer thought ("yes but what about..."), and treating that as a purchase
   instruction is exactly the kind of overreach that loses trust. */
/* An optional hedge in front — "actually yes", "well, go on then" — because
   people rarely start a sentence with the operative word. The group is optional
   and the alternation backtracks, so a bare "ok" still matches. */
const HEDGE = "(?:actually|alright|right(?: then)?|well|hmm+|erm|um|i think|i guess|then)?[,\\s]*";

const ACCEPT = new RegExp(
  "^\\s*" + HEDGE +
    "(?:yes|yeah|yep|yup|sure|ok|okay|please|please do|go on|go ahead|do it|add it|add that|" +
    "let'?s do it|why not|alright|sounds good|that'?s great|perfect|great)\\b",
  "i"
);

const DECLINE = new RegExp(
  "^\\s*" + HEDGE +
    "(?:no|nah|nope|not (?:yet|now|right now|for me)|maybe later|i'?ll think|leave it|hold on|" +
    "not just yet)\\b",
  "i"
);

export function acceptsOffer(message: string): boolean {
  if (DECLINE.test(message)) return false;
  return ACCEPT.test(message);
}

export function declinesOffer(message: string): boolean {
  return DECLINE.test(message);
}

/* ---------------- should we offer at all? ---------------- */

export type OfferContext = {
  message: string;
  result: CatalogueResult | null;
  carried: CatalogueHit[];
  /** product ids already offered anywhere in this conversation */
  alreadyOffered: string[];
  /** product ids already sitting in the basket */
  inBasket: string[];
  /** true when this turn already added, removed or showed the basket */
  basketActed: boolean;
};

/**
 * Every reason NOT to offer, in one place, each with the reason written down.
 * Returns null far more often than it returns an offer, and that is correct.
 */
export function decideOffer(ctx: OfferContext): BasketOffer | null {
  // 1. The basket was already touched this turn. Adding an offer on top of
  //    "added to your basket" is noise at best.
  if (ctx.basketActed) return null;

  // 2. No buying intent — they are still reading, not choosing.
  if (!looksLikeBuyingIntent(ctx.message)) return null;

  // 3. THE HONESTY GATE. shortfall means we hold nothing that meets the need;
  //    widened means the only things big enough are a different kind of thing.
  //    In both cases the truthful answer is "we do not have the right product",
  //    and an offer in the same breath turns that into a sales move. Honest
  //    curation beats a sale — the offer can come later, once they have heard
  //    what it actually is and said they still want it.
  if (ctx.result?.shortfall || ctx.result?.widened) return null;

  // 4. A GENUINE SINGLE RECOMMENDATION. Where several are on the table the
  //    customer has not chosen and neither should we — that case is handled by
  //    offerInvitation() below, which lets the model nominate the one its own
  //    answer lands on rather than guessing ahead of it.
  const pool = ctx.result?.hits?.length ? ctx.result.hits : ctx.carried;
  if (!pool || pool.length !== 1) return null;
  const hit = pool[0];
  if (!hit?.id) return null; // pre-offer rows carried no id; nothing to act on

  // 5. It has to be something a basket can actually hold.
  if (hit.price === null || hit.price === undefined) return null;
  if (hit.status === "rejected") return null;

  // 6. Once per recommendation. Never twice, in either direction.
  if (ctx.alreadyOffered.includes(hit.id)) return null;
  if (ctx.inBasket.includes(hit.id)) return null;

  return {
    productId: hit.id,
    name: hit.name,
    price: hit.price,
    nearest: Boolean(hit.nearest),
  };
}

/**
 * The several-options case.
 *
 * "Which is best?" with eight tents on the table is the most commercial moment
 * in the conversation, and it is also the one place a deterministic rule cannot
 * help: which product to offer depends on the answer the model is about to
 * write, which has not been written yet. So it nominates — it ends with a tag
 * naming the one its own recommendation landed on, we resolve that against the
 * list it was actually shown, and anything that does not resolve is dropped
 * silently. It chooses WHICH; it still does not choose WHETHER.
 */
export function offerInvitation(ctx: OfferContext): CatalogueHit[] | null {
  if (ctx.basketActed) return null;
  if (!looksLikeBuyingIntent(ctx.message)) return null;
  if (ctx.result?.shortfall || ctx.result?.widened) return null;
  const pool = ctx.result?.hits?.length ? ctx.result.hits : ctx.carried;
  if (!pool || pool.length < 2 || pool.length > 8) return null;
  const eligible = pool.filter(
    (h) =>
      h?.id &&
      h.price !== null &&
      h.price !== undefined &&
      h.status !== "rejected" &&
      !h.nearest &&
      !ctx.alreadyOffered.includes(h.id) &&
      !ctx.inBasket.includes(h.id)
  );
  return eligible.length ? eligible : null;
}

/** Resolve a model-nominated name back to a row it was actually shown. */
export function resolveNomination(name: string, pool: CatalogueHit[]): BasketOffer | null {
  const want = name.trim().toLowerCase();
  if (!want) return null;
  const hit =
    pool.find((h) => h.name.trim().toLowerCase() === want) ||
    pool.find((h) => h.name.trim().toLowerCase().includes(want) && want.length >= 6);
  if (!hit?.id || hit.price === null || hit.price === undefined) return null;
  return { productId: hit.id, name: hit.name, price: hit.price, nearest: Boolean(hit.nearest) };
}

/* ---------------- what the model is told ---------------- */

export function offerBlock(offer: BasketOffer): string {
  const honesty = offer.nearest
    ? "This one came up as the NEAREST thing we have rather than an exact match. If you offer it, " +
      "say what it actually is in the same breath — never let the offer imply it is the thing they " +
      "asked for. If that makes the offer feel wrong, leave it out; you are allowed to.\n"
    : "";

  return (
    "\n\n=== OFFER TO ADD IT ===\n" +
    `They are weighing up one product: ${offer.name}` +
    (offer.price !== null ? ` (€${offer.price.toFixed(2)})` : "") +
    ".\n" +
    honesty +
    "Answer their question properly FIRST — that is still the job. Then close with a short, natural " +
    "offer to put it in their basket, in your own words and in your own voice.\n" +
    "  - One sentence. Part of the conversation, not a button in prose. No bold, no bullet, no " +
    "'click here', no 'would you like me to proceed'.\n" +
    "  - Ask once. Do not repeat it, do not soften it and ask again, do not follow it with a nudge.\n" +
    "  - If your honest answer turns out to be that this is not right for them, say that and DROP " +
    "the offer entirely. A recommendation you do not believe is worth less than no sale.\n"
  );
}

export function invitationBlock(pool: CatalogueHit[]): string {
  return (
    "\n\n=== YOU MAY OFFER TO ADD ONE ===\n" +
    "Several products are on the table and the customer is weighing them up. Answer properly first. " +
    "IF — and only if — your answer lands on ONE of them as the recommendation, close with a short, " +
    "natural offer to put that one in their basket, in your own words.\n" +
    "  - One sentence, in your own voice. Not a button in prose, not 'would you like me to proceed'.\n" +
    "  - If you are genuinely torn, or the honest answer is that none of them is right, say THAT and " +
    "make no offer. An offer you do not believe is worth less than no sale.\n" +
    "  - When you do offer, end your whole message with the tag <offer>EXACT PRODUCT NAME</offer>, " +
    "copied character for character from this list. The tag is stripped before the customer sees it " +
    "and is how we know what a 'yes' means. No tag, no offer — that is a valid choice.\n" +
    "Eligible to offer:\n" +
    pool.map((h) => `  - ${h.name}`).join("\n") +
    "\n"
  );
}

export function acceptanceBlock(name: string): string {
  return (
    "\n\n=== THEY SAID YES ===\n" +
    `The customer has accepted your offer of ${name}. It has been added — see the BASKET TOOL block ` +
    "for what is in there now. Confirm it plainly and briefly, say what the basket now holds, and " +
    "stop. No upsell, no second recommendation, no asking whether they want anything else.\n"
  );
}

export function declineBlock(name: string): string {
  return (
    "\n\n=== THEY SAID NO ===\n" +
    `The customer has turned down your offer of ${name}. Take it gracefully in half a sentence and ` +
    "carry on being useful. Do not ask again, do not offer an alternative unless they ask, and do " +
    "not explain why they should reconsider.\n"
  );
}
