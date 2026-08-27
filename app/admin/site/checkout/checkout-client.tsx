"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { BasketView } from "@/lib/commerce/basket";
import { SHIP_COUNTRIES, eur, totalsFor } from "@/lib/commerce/vat";

type Step = "address" | "payment" | "done";

export default function CheckoutClient({
  basket,
  email: initialEmail,
  signedIn,
  savedAddress,
}: {
  basket: BasketView;
  email: string;
  signedIn: boolean;
  savedAddress: any | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("address");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [order, setOrder] = useState<any>(null);

  const [email, setEmail] = useState(initialEmail);
  const [f, setF] = useState({
    full_name: savedAddress?.full_name || "",
    line1: savedAddress?.line1 || "",
    line2: savedAddress?.line2 || "",
    city: savedAddress?.city || "",
    region: savedAddress?.region || "",
    postcode: savedAddress?.postcode || "",
    country_iso2: savedAddress?.country_iso2 || "DE",
    phone: savedAddress?.phone || "",
  });
  const [saveAddress, setSaveAddress] = useState(signedIn);

  // VAT follows the country field live, because a customer choosing Hungary and
  // then seeing a German rate at the end is exactly the kind of surprise that
  // loses the sale.
  const totals = useMemo(
    () => totalsFor(basket.goodsTotal, f.country_iso2),
    [basket.goodsTotal, f.country_iso2]
  );

  function set(k: keyof typeof f, v: string) {
    setF((prev) => ({ ...prev, [k]: v }));
  }

  async function place(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/shop/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, ship: f, saveAddress }),
      });
      const b = await r.json();
      if (b?.ok) {
        setOrder(b.order);
        setStep("payment");
      } else setErr(b?.message || "We could not place that order just now.");
    } catch {
      setErr("We could not reach the checkout just now. Your basket is untouched.");
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/shop/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "pay", orderId: order.id }),
      });
      const b = await r.json();
      if (b?.ok) {
        router.push(`/admin/site/order/${b.order.reference}`);
      } else setErr(b?.message || "The payment step did not complete.");
    } catch {
      setErr("We could not complete the demo payment just now. Your order is saved.");
    } finally {
      setBusy(false);
    }
  }

  if (!basket.lines.length && step === "address") {
    return (
      <div className="sf-bkempty">
        <h2>Nothing to check out</h2>
        <p>Your basket is empty.</p>
        <Link className="sf-cta" href="/admin/site/catalogue">
          Browse the catalogue
        </Link>
      </div>
    );
  }

  return (
    <div className="sf-cogrid">
      <div className="sf-coform">
        <ol className="sf-costeps">
          <li className={step === "address" ? "on" : "done"}>Address</li>
          <li className={step === "payment" ? "on" : step === "done" ? "done" : ""}>Payment</li>
          <li className={step === "done" ? "on" : ""}>Confirmation</li>
        </ol>

        {step === "address" ? (
          <form onSubmit={place}>
            <h2>Where is it going?</h2>
            <label className="sf-cofield">
              <span>Email for the confirmation</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>
            <label className="sf-cofield">
              <span>Full name</span>
              <input value={f.full_name} onChange={(e) => set("full_name", e.target.value)} />
            </label>
            <label className="sf-cofield">
              <span>Address</span>
              <input required value={f.line1} onChange={(e) => set("line1", e.target.value)} />
            </label>
            <label className="sf-cofield">
              <span>Address line 2 (optional)</span>
              <input value={f.line2} onChange={(e) => set("line2", e.target.value)} />
            </label>
            <div className="sf-corow">
              <label className="sf-cofield">
                <span>Town or city</span>
                <input required value={f.city} onChange={(e) => set("city", e.target.value)} />
              </label>
              <label className="sf-cofield">
                <span>Postcode</span>
                <input value={f.postcode} onChange={(e) => set("postcode", e.target.value)} />
              </label>
            </div>
            <div className="sf-corow">
              <label className="sf-cofield">
                <span>Region (optional)</span>
                <input value={f.region} onChange={(e) => set("region", e.target.value)} />
              </label>
              <label className="sf-cofield">
                <span>Country</span>
                <select
                  value={f.country_iso2}
                  onChange={(e) => set("country_iso2", e.target.value)}
                >
                  {SHIP_COUNTRIES.map((c) => (
                    <option key={c.iso2} value={c.iso2}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="sf-cofield">
              <span>Phone (optional, for the courier)</span>
              <input value={f.phone} onChange={(e) => set("phone", e.target.value)} />
            </label>

            {signedIn ? (
              <label className="sf-cocheck">
                <input
                  type="checkbox"
                  checked={saveAddress}
                  onChange={(e) => setSaveAddress(e.target.checked)}
                />
                <span>Save this address to my account</span>
              </label>
            ) : (
              <p className="sf-conote">
                Checking out as a guest. <Link href="/admin/site/account">Create an account</Link> if
                you want your order history and household profile kept.
              </p>
            )}

            {err ? <div className="sf-coerr">{err}</div> : null}
            <button className="sf-cta full" type="submit" disabled={busy}>
              {busy ? "Placing your order…" : "Continue to payment"}
            </button>
          </form>
        ) : null}

        {step === "payment" && order ? (
          <div className="sf-copay">
            <h2>Payment</h2>
            <div className="sf-codemo">
              <strong>This is a demo payment.</strong> No card is taken and no money moves.
              StealthCrafter has no payment provider connected yet — pressing the button below marks
              order <code>{order.reference}</code> as paid so the rest of the journey can be walked
              end to end.
            </div>
            <div className="sf-copayline">
              <span>Amount</span>
              <strong>{eur(order.grandTotal)}</strong>
            </div>
            {err ? <div className="sf-coerr">{err}</div> : null}
            <button className="sf-cta full" type="button" onClick={pay} disabled={busy}>
              {busy ? "Completing…" : `Complete demo payment — ${eur(order.grandTotal)}`}
            </button>
            <p className="sf-conote">
              Your order already exists and is saved as <code>placed</code>. If you close this page
              now, nothing is lost.
            </p>
          </div>
        ) : null}
      </div>

      <aside className="sf-cosummary">
        <h2>Your order</h2>
        {basket.lines.map((l) => (
          <div className="sf-corowline" key={l.id}>
            <span>
              {l.qty} × {l.name}
            </span>
            <span>{eur(l.lineTotal)}</span>
          </div>
        ))}
        <div className="sf-bkrow">
          <span>Goods</span>
          <span>{eur(totals.goodsTotal)}</span>
        </div>
        <div className="sf-bkrow sub">
          <span>of which VAT at {(totals.vatRate * 100).toFixed(totals.vatRate * 100 % 1 ? 1 : 0)}%</span>
          <span>{eur(totals.vatAmount)}</span>
        </div>
        <div className="sf-bkrow">
          <span>Delivery</span>
          <span>{totals.freeDelivery ? "Free" : eur(totals.deliveryTotal)}</span>
        </div>
        <div className="sf-bkrow total">
          <span>Total</span>
          <span>{eur(totals.grandTotal)}</span>
        </div>
        <p className="sf-bkvatnote">
          VAT is shown at the standard rate for the delivery country and is already included in the
          prices — it is not added on top.
        </p>
      </aside>
    </div>
  );
}
