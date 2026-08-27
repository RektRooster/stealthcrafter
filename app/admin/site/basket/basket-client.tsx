"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { BasketView } from "@/lib/commerce/basket";
import { eur } from "@/lib/commerce/vat";

export default function BasketClient({ initial }: { initial: BasketView }) {
  const router = useRouter();
  const [view, setView] = useState<BasketView>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  async function send(payload: Record<string, unknown>, key: string) {
    setBusy(key);
    setErr("");
    try {
      const r = await fetch("/api/shop/basket", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const b = await r.json();
      if (b?.ok && b.view) setView(b.view);
      else setErr(b?.message || "That did not save.");
      router.refresh();
    } catch {
      setErr("We could not reach the basket just now. Nothing has been lost.");
    } finally {
      setBusy(null);
    }
  }

  if (!view.lines.length) {
    return (
      <div className="sf-bkempty">
        <h2>Your basket is empty</h2>
        <p>
          Nothing in it yet. Browse the catalogue, or ask Jimmy what your household actually needs —
          he can put things in here for you.
        </p>
        <div className="sf-bkemptyactions">
          <Link className="sf-cta" href="/admin/site/catalogue">
            Browse the catalogue
          </Link>
          <Link className="sf-bkghost" href="/admin/site/jimmy">
            Ask Jimmy
          </Link>
        </div>
      </div>
    );
  }

  const t = view.totals;

  return (
    <div className="sf-bkgrid">
      <div className="sf-bklines">
        {view.lines.map((l) => (
          <div className="sf-bkline" key={l.id}>
            <div className="sf-bkthumb">
              {l.image ? <img src={l.image} alt="" /> : <span className="sf-bknoimg">—</span>}
            </div>
            <div className="sf-bkbody">
              <div className="sf-bkname">
                {l.slug ? <Link href={`/admin/site/catalogue/${l.slug}`}>{l.name}</Link> : l.name}
              </div>
              {l.productStatus && l.productStatus !== "approved" ? (
                <div className="sf-bkstatus">
                  Still {l.productStatus} — we are working this one through, and we say so rather
                  than pretending it is on a shelf.
                </div>
              ) : null}
              {l.priceMoved ? (
                <div className="sf-bkheld">
                  Held at {eur(l.unitPrice)} — the price you were shown when you added it
                  {l.livePrice !== null ? ` (now ${eur(l.livePrice)})` : ""}.
                </div>
              ) : null}
            </div>
            <div className="sf-bkqty">
              <button
                type="button"
                aria-label="Reduce quantity"
                disabled={busy === l.id}
                onClick={() => send({ action: "setQty", itemId: l.id, qty: l.qty - 1 }, l.id)}
              >
                −
              </button>
              <span>{l.qty}</span>
              <button
                type="button"
                aria-label="Increase quantity"
                disabled={busy === l.id}
                onClick={() => send({ action: "setQty", itemId: l.id, qty: l.qty + 1 }, l.id)}
              >
                +
              </button>
            </div>
            <div className="sf-bkmoney">
              <strong>{eur(l.lineTotal)}</strong>
              <span>{eur(l.unitPrice)} each</span>
              <button
                type="button"
                className="sf-bkremove"
                disabled={busy === l.id}
                onClick={() => send({ action: "remove", ref: l.id }, l.id)}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        {err ? <div className="sf-bkerr">{err}</div> : null}
      </div>

      <aside className="sf-bksummary">
        <h2>Summary</h2>
        <div className="sf-bkrow">
          <span>Goods ({view.count} item{view.count === 1 ? "" : "s"})</span>
          <span>{eur(t.goodsTotal)}</span>
        </div>
        <div className="sf-bkrow sub">
          <span>of which VAT at {(t.vatRate * 100).toFixed(t.vatRate * 100 % 1 ? 1 : 0)}%</span>
          <span>{eur(t.vatAmount)}</span>
        </div>
        <div className="sf-bkrow">
          <span>Delivery</span>
          <span>{t.freeDelivery ? "Free" : eur(t.deliveryTotal)}</span>
        </div>
        {!t.freeDelivery ? (
          <div className="sf-bknudge">
            {eur(t.awayFromFreeDelivery)} more for free delivery.
          </div>
        ) : null}
        <div className="sf-bkrow total">
          <span>Total</span>
          <span>{eur(t.grandTotal)}</span>
        </div>
        <p className="sf-bkvatnote">
          Prices include VAT at the standard rate for the country you choose at checkout. Change the
          country there and this recalculates.
        </p>
        <Link className="sf-cta full" href="/admin/site/checkout">
          Checkout
        </Link>
        <button
          type="button"
          className="sf-bkghost full"
          disabled={busy === "clear"}
          onClick={() => send({ action: "clear" }, "clear")}
        >
          Empty basket
        </button>
      </aside>
    </div>
  );
}
