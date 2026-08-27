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
};

const ADD =
  /\b(add|put|chuck|stick|pop)\b[^.?!]{0,40}\b(basket|cart|order)\b|\b(basket|cart)\b[^.?!]{0,20}\b(please|it|that)\b|\bi(?:'| a)?ll take\b|\bbuy (?:it|that|this)\b/i;
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

export function detectBasketIntent(message: string, carried: CatalogueHit[] = []): BasketIntent {
  const qty = qtyIn(message);
  if (REMOVE.test(message)) return { action: "remove", ref: namedIn(message, carried), qty };
  if (ADD.test(message)) return { action: "add", ref: namedIn(message, carried), qty };
  if (VIEW.test(message)) return { action: "view", ref: null, qty };
  return { action: null, ref: null, qty: 1 };
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
    "\nTell the customer what happened in your own words, plainly and briefly. " +
    "Do not offer to add it 'if they would like' — it is already done. " +
    "Do not invent items, prices or totals beyond what is written above. " +
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
      // Genuinely ambiguous. Asking is better than adding the wrong tent.
      return {
        block:
          head +
          `The customer asked to ${intent.action} something, but did not say which — and ` +
          `${carried.length} products were shown. NOTHING HAS BEEN CHANGED. Ask which one they ` +
          `mean, listing them briefly by name:\n` +
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
  return { block: head + out.message + statusNote + "\n" + basketSummary(out.view) + tail, changed: true };
}
