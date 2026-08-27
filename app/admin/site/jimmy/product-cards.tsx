"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type ChatProduct = {
  id: string;
  name: string;
  brand: string | null;
  price: number | null;
  currency: string | null;
  status: string | null;
  image: string | null;
  slug: string | null;
  capacity: number | null;
  weightGrams: number | null;
  nearest?: boolean;
};

/* PRODUCT CARDS IN THE CONVERSATION.
 *
 * Ace's call, and it is the right one: the fix for "he offered me 1 and 2, I
 * said add 2, and he added two tents" is not a better clarifying question — it
 * is removing the ambiguity from the interface. A card with a picture, a price
 * and its own Add button cannot be misread. Nobody types "2" at a button.
 *
 * The text answer stays exactly as it was. Jimmy still recommends in prose and
 * still makes his one natural offer; the cards sit underneath as the thing you
 * act on. He is the guide, these are the shelves.
 */
export default function ProductCards({ products }: { products: ChatProduct[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState("");

  if (!products?.length) return null;
  // Cap it. Eight cards under one reply is a catalogue page, not an answer.
  const shown = products.filter((p) => p.id).slice(0, 4);
  const more = products.length - shown.length;

  async function add(p: ChatProduct) {
    setBusy(p.id);
    setErr("");
    try {
      const r = await fetch("/api/shop/basket", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "add", ref: p.id, qty: 1 }),
      });
      const b = await r.json();
      if (b?.ok) {
        setAdded((a) => ({ ...a, [p.id]: true }));
        router.refresh();
      } else setErr(b?.message || "We could not add that just now.");
    } catch {
      setErr("We could not reach the basket just now. Nothing has been lost.");
    } finally {
      setBusy(null);
    }
  }

  const money = (p: ChatProduct) =>
    p.price === null ? "no price yet" : `${p.currency === "GBP" ? "£" : "€"}${p.price.toFixed(2)}`;

  return (
    <div className="sf-jcards">
      {shown.map((p) => (
        <div className="sf-jcard" key={p.id}>
          <div className="sf-jcardimg">
            {p.image ? <img src={p.image} alt="" loading="lazy" /> : <span>—</span>}
          </div>
          <div className="sf-jcardbody">
            <div className="sf-jcardname">
              {p.slug ? (
                <Link href={`/admin/site/catalogue/${p.slug}`}>{p.name}</Link>
              ) : (
                p.name
              )}
            </div>
            <div className="sf-jcardmeta">
              {[
                p.capacity !== null ? `sleeps ${p.capacity}` : null,
                p.weightGrams !== null
                  ? p.weightGrams >= 1000
                    ? `${(p.weightGrams / 1000).toFixed(2)} kg`
                    : `${p.weightGrams} g`
                  : null,
                /* Said on the card, not buried in the prose: most of the range
                   is still being worked through and the customer should see
                   that at the moment they are deciding. */
                p.status && p.status !== "approved" ? p.status : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
            <div className="sf-jcardfoot">
              <strong>{money(p)}</strong>
              <button
                type="button"
                disabled={busy === p.id || p.price === null}
                onClick={() => add(p)}
                className={added[p.id] ? "in" : ""}
              >
                {busy === p.id ? "Adding…" : added[p.id] ? "In basket ✓" : "Add to basket"}
              </button>
            </div>
          </div>
        </div>
      ))}
      {more > 0 ? (
        <div className="sf-jcardmore">
          {more} more in the range —{" "}
          <Link href="/admin/site/catalogue">see the full catalogue</Link>
        </div>
      ) : null}
      {err ? <div className="sf-jcarderr">{err}</div> : null}
    </div>
  );
}
