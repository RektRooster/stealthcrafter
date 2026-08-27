// JIMMY'S BASKET TOOLS — add_to_basket, view_basket, remove_from_basket.
//
// Tools in effect, not in protocol: the provider layer still has no function
// calling. So intent is detected deterministically, the action is PERFORMED
// before the model is called, and the result is handed to it as a fact to
// narrate. That ordering matters — a model that is asked to "call a tool" it
// cannot call will instead describe having called it, which is worse than not
// having the feature at all.
//
// "Can you add it to my basket" is the exact sentence that failed in testing.
// Everything here exists to make that one work, including the awkward part:
// "it" refers to something said in an earlier turn.

import type { CatalogueHit } from "./catalogue-tool";
import {
  addToBasket,
  basketView,
  removeFromBasket,
  type BasketOwner,
  type BasketView,
} from "../commerce/basket";
import { eur } from "../commerce/vat";

export type BasketAction = "add" | "view" | "remove" | null;

export type BasketIntent = {
  action: BasketAction;
  /** what the customer named, if they named anything */
  ref: string | null;
  qty: number;
  /** true when a bare number could mean EITHER a quantity or a position in the
      list we just showed — "yes add 2" against two options. Never guessed. */
  numberAmbiguous: boolean;
};

/* Two tiers, and the split matters.
   STRONG works from a cold start because the customer said "basket" or "cart"
   or "I'll take it" — the instruction is unambiguous on its own.
   LOOSE is "add 2", "get me one", "grab the Vango": an instruction ONLY in the
   light of something already on the table, so it is gated on that context.
   This gate is the bug from live testing: "yes add 2" matched nothing, no tool
   ran, and the model reported an add that had never happened. */
const ADD_STRONG =
  /\b(add|put|chuck|stick|pop)\b[^.?!]{0,40}\b(basket|cart|order)\b|\b(basket|cart)\b[^.?!]{0,20}\b(please|it|that)\b|\bi(?:'| a)?ll take\b|\bbuy (?:it|that|this)\b/i;

const ADD_LOOSE = /\b(?:add|get me|grab)\b/i;
const VIEW =
  /\b(what(?:'s| is) in my|show me my|see my|check my|view my|open my)\s+(basket|cart)\b|\bmy basket\b|\bbasket total\b/i;
const REMOVE =
  /\b(remove|take|delete|drop|get rid of)\b[^.?!]{0,40}\b(?:out of|from)?\s*(?:my\s+)?(basket|cart)\b|\bdon'?t want\b[^.?!]{0,30}\banymore\b/i;

const QTY =
  /\b(\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:of\s+)?(?:them|these|those)?\b/i;
const WORD_QTY: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function qtyIn(message: string): number {
  const m = message.match(QTY);
  if (!m) return 1;
  const raw = m[1].toLowerCase();
  const n = /^\d+$/.test(raw) ? parseInt(raw, 10) : WORD_QTY[raw] ?? 1;
  return n > 0 && n <= 20 ? n : 1;
}

/** A named product inside the sentence, if there is one. Deliberately loose —
 *  resolution against the real catalogue happens downstream. */
function namedIn(message: string, carried: CatalogueHit[]): string | null {
  const lower = message.toLowerCase();
  // Longest carried name that appears in the sentence wins, so "the Nallo" and
  // "the Hilleberg Nallo 2" both land on the same row.
  let best: string | null = null;
  for (const h of carried) {
    const words = h.name.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const hit = words.filter((w) => lower.includes(w));
    // Two matching words, or one distinctive one — a model name rather than "tent".
    const distinctive = hit.filter((w) => !/tent|shelter|water|light|stove|bag|kit/.test(w));
    if (hit.length >= 2 || distinctive.length >= 1) {
      if (!best || h.name.length > best.length) best = h.name;
    }
  }
  if (best) return best;
  const quoted = message.match(/"([^"]{3,60})"/);
  return quoted ? quoted[1] : null;
}

/** A bare number with nothing marking it as a count — "add 2" rather than
 *  "add 2 of them" or "2 × the Vango". Against a list, that is as likely to
 *  mean "the second one". */
function bareNumber(message: string): boolean {
  if (!/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(message)) return false;
  return !/\b(?:of (?:them|these|those|the)|units?|packs?|pieces?|x\s*\d|copies)\b/i.test(message);
}

export function detectBasketIntent(
  message: string,
  carried: CatalogueHit[] = [],
  hasStandingOffer = false
): BasketIntent {
  const qty = qtyIn(message);
  const context = carried.length > 0 || hasStandingOffer;
  const ambiguous = bareNumber(message) && carried.length > 1;

  if (REMOVE.test(message))
    return { action: "remove", ref: namedIn(message, carried), qty, numberAmbiguous: false };

  if (ADD_STRONG.test(message) || (context && ADD_LOOSE.test(message)))
    return { action: "add", ref: namedIn(message, carried), qty, numberAmbiguous: ambiguous };

  if (VIEW.test(message)) return { action: "view", ref: null, qty, numberAmbiguous: false };
  return { action: null, ref: null, qty: 1, numberAmbiguous: false };
}

/* ---------------- performing it ---------------- */

function basketSummary(view: BasketView): string {
  if (!view.lines.length) return "The basket is now empty.";
  const lines = view.lines
    .map((l) => `  - ${l.qty} × ${l.name} @ ${eur(l.unitPrice)} = ${eur(l.lineTotal)}`)
    .join("\n");
  return (
    `Basket now holds ${view.count} item${view.count === 1 ? "" : "s"}:\n${lines}\n` +
    `  Goods ${eur(view.totals.goodsTotal)} · delivery ${
      view.totals.freeDelivery ? "free" : eur(view.totals.deliveryTotal)
    } · total ${eur(view.totals.grandTotal)}.`
  );
}

export type BasketToolResult = {
  /** injected into the prompt as something that HAS happened */
  block: string;
  /** whether an actual write took place, for logging and the UI badge */
  changed: boolean;
};

export async function runBasketTool(
  owner: BasketOwner,
  intent: BasketIntent,
  message: string,
  carried: CatalogueHit[]
): Promise<BasketToolResult | null> {
  if (!intent.action) return null;

  const head = "\n\n=== BASKET TOOL — THIS HAS ALREADY HAPPENED ===\n";
  const tail =
    "\nTell the customer what happened in your own words, plainly and briefly, AND say what the " +
    "basket now holds — the count and the total, from the figures above. " +
    "Do not offer to add it 'if they would like' — it is already done. " +
    "State the QUANTITY exactly as written above; if they asked for a number and it is not what " +
    "went in, say the real one. Never invent items, prices, quantities or totals. " +
    "You may point them at the basket page to check out when it makes sense.\n";

  if (intent.action === "view") {
    const view = await basketView(owner);
    return { block: head + basketSummary(view) + tail, changed: false };
  }

  // Work out WHICH product. "it" almost always means the thing just discussed.
  let ref = intent.ref;
  if (!ref) {
    if (carried.length === 1) ref = carried[0].name;
    else if (carried.length > 1) {
      // Genuinely ambiguous. Asking is better than adding the wrong tent — and
      // far better than the alternative we shipped, which was saying nothing
      // ran and letting the model invent an outcome.
      const numberNote = intent.numberAmbiguous
        ? `They used the number ${intent.qty}, which against a list could mean "item ${intent.qty}" ` +
          `OR "${intent.qty} of them". DO NOT PICK ONE — guessing costs them money.\n`
        : "";
      return {
        block:
          head +
          `The customer asked to ${intent.action} something but did not say which, and ` +
          `${carried.length} products are on the table. NOTHING HAS BEEN CHANGED — say nothing that ` +
          `implies anything was added.\n` +
          numberNote +
          `Ask which one they mean, BY NAME. Do not number them and do not ask for a number back — ` +
          `each of these is already a card under your last reply with its own Add button, so the ` +
          `shortest route is naming the one you would pick and letting them take it from there:\n` +
          carried.map((h) => `  - ${h.name} (${eur(h.price ?? 0)})`).join("\n") +
          "\n",
        changed: false,
      };
    }
  }

  if (!ref) {
    return {
      block:
        head +
        "The customer asked about their basket but there is nothing in the conversation to " +
        "identify a product. NOTHING HAS BEEN CHANGED. Ask them which product they mean.\n",
      changed: false,
    };
  }

  if (intent.action === "remove") {
    const out = await removeFromBasket(owner, ref);
    const view = out.ok ? out.view : await basketView(owner);
    return {
      block: head + (out.ok ? out.message : `That did not work: ${out.message}`) + "\n" + basketSummary(view) + tail,
      changed: out.ok,
    };
  }

  const out = await addToBasket(owner, ref, intent.qty);
  if (!out.ok && out.candidates?.length) {
    return {
      block:
        head +
        `NOTHING HAS BEEN ADDED — "${ref}" matches more than one product. Ask which one:\n` +
        out.candidates.map((c) => `  - ${c.name}${c.price !== null ? ` (${eur(c.price)})` : ""}`).join("\n") +
        "\n",
      changed: false,
    };
  }
  if (!out.ok) {
    return { block: head + `NOTHING HAS BEEN ADDED. ${out.message}\n`, changed: false };
  }

  const statusNote =
    out.product?.status && out.product.status !== "approved"
      ? `\nNote: ${out.product.name} is still ${out.product.status} — say so, briefly and without alarm.`
      : "";
  // Two 2-person tents for a household of two is a misread, not a big order.
  // Flag it rather than silently taking the money.
  const qtyNote =
    intent.qty > 1
      ? `\nThey asked for ${intent.qty}. If ${intent.qty} of this looks like more than their ` +
        `household needs — two tents that each sleep the whole family, say — mention it while you ` +
        `confirm, and offer to drop it to one. Do not lecture; one clause is enough.`
      : "";
  return {
    block: head + out.message + statusNote + qtyNote + "\n" + basketSummary(out.view) + tail,
    changed: true,
  };
}
