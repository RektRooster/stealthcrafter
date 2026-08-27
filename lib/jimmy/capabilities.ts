// WHAT JIMMY CANNOT DO YET, SAID OUT LOUD.
//
// The rule Ace set: a capability that does not exist must produce a plain
// sentence explaining it, never a server error. "Something went wrong on our
// side" is the worst possible answer to "can you track my order" — it reads as
// a broken shop rather than an unbuilt feature, and it tells the customer
// nothing about what to do instead.
//
// Each entry is a thing people genuinely ask a shop assistant, a truthful
// sentence about where it stands, and — where there is one — the thing they can
// actually do today. Delete an entry the day it ships.

export type CapabilityGap = { id: string; test: RegExp; say: string };

export const CAPABILITY_GAPS: CapabilityGap[] = [
  {
    id: "order-tracking",
    test: /\b(track|tracking number|where('s| is) my (order|parcel|delivery)|delivery status|when will (it|my order) arrive)\b/i,
    say:
      "Live courier tracking is not connected yet. What I can tell you is where the order itself has " +
      "got to — its status is on the order page in your account, and it updates as we move it along.",
  },
  {
    id: "cancel-change",
    test: /\b(cancel|change|amend|edit)\b[^.?!]{0,30}\b(my )?(order|address|delivery)\b/i,
    say:
      "I cannot change or cancel an order myself yet — that has to be done by a person, and the " +
      "handover for it is not built. Nothing is actually shipping in this environment, so nothing " +
      "is lost either way.",
  },
  {
    id: "returns",
    test: /\b(return|refund|send (it )?back|money back|exchange)\b/i,
    say:
      "There is no returns portal yet. When it exists it will live in your account alongside the " +
      "order; for now I can tell you what our returns position will be, but I cannot start one.",
  },
  {
    id: "discount",
    test: /\b(discount|promo|voucher|coupon|offer code|sale)\b/i,
    say:
      "We do not run discount codes, and there is no field to enter one. Prices are what they are — " +
      "and delivery is free over €75, which is the only concession the shop makes.",
  },
  {
    id: "membership",
    test: /\b(membership|subscribe|subscription|monthly plan|premium)\b/i,
    say:
      "Memberships are planned but not built — there is nothing to sign up to yet, so I would rather " +
      "not take your details for something that does not exist.",
  },
  {
    id: "stock",
    test: /\b(in stock|stock level|how many (do you )?have|back ?order|when.{0,15}back in)\b/i,
    say:
      "I cannot see live stock levels — we have no warehouse feed yet. What I can tell you honestly " +
      "is where each product sits in our own process, which is on every product page.",
  },
  {
    id: "human",
    test: /\b(speak to|talk to|call|phone|email)\b[^.?!]{0,20}\b(someone|a human|a person|support|customer service|you)\b/i,
    say:
      "There is no support desk to put you through to yet — no phone line, no inbox being watched. " +
      "I would rather say that than take a message nobody reads.",
  },
  {
    id: "invoice",
    test: /\b(invoice|receipt|vat receipt|proof of purchase)\b/i,
    say:
      "There is no invoice document to send yet. Your order page has the full breakdown including " +
      "the VAT, which is the same information — it just is not a PDF.",
  },
];

/** Returns the block to inject, or "" when nothing applies. */
export function capabilityBlock(message: string): string {
  const hits = CAPABILITY_GAPS.filter((g) => g.test.test(message));
  if (!hits.length) return "";
  return (
    "\n\n=== SOMETHING THEY ASKED FOR THAT WE HAVE NOT BUILT ===\n" +
    "Say this plainly, in your own words. Do NOT apologise at length, do NOT say something went " +
    "wrong, and do NOT invent a workaround. An honest 'not yet, here is what I can do instead' is " +
    "the whole point:\n" +
    hits.map((h) => `  - ${h.say}`).join("\n") +
    "\n"
  );
}
