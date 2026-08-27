import Link from "next/link";
import { notFound } from "next/navigation";
import { STATUS_LABEL, orderByReference } from "@/lib/commerce/orders";
import { eur } from "@/lib/commerce/vat";

export const dynamic = "force-dynamic";

/* Confirmation AND order detail — the same page. What a customer wants to see
   thirty seconds after ordering and what they want three weeks later are the
   same facts in the same order; two pages would only drift apart. */
export default async function OrderPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  const order = await orderByReference(reference);
  if (!order) notFound();

  const paid = Boolean(order.paidAt);

  return (
    <main className="sf-page banded">
      <header className="sf-band">
        <div className="sf-bandin">
          <div className="sf-bandkicker">Order {order.reference}</div>
          <h1>{paid ? "Thank you — that is confirmed." : "Order placed."}</h1>
          <p className="sf-bandlede">
            {paid
              ? "We have your order. Nothing is being shipped — this is a demo environment and no money moved — but everything below is a real record you can come back to."
              : "Your order is saved but not yet paid. You can complete the demo payment from your basket at any time."}
          </p>
          <div className="sf-bandstats">
            <div className="sf-bandstat">
              <b>{order.reference}</b>
              <span>reference</span>
            </div>
            <div className="sf-bandstat">
              <b>{STATUS_LABEL[order.status]}</b>
              <span>status</span>
            </div>
            <div className="sf-bandstat">
              <b>{eur(order.grandTotal)}</b>
              <span>total</span>
            </div>
          </div>
        </div>
      </header>

      <div className="sf-catwrap">
        <div className="sf-ordgrid">
          <section className="sf-ordpanel">
            <h2>What you ordered</h2>
            {order.lines.map((l) => (
              <div className="sf-corowline" key={l.id}>
                <span>
                  {l.qty} ×{" "}
                  {l.slug ? <Link href={`/admin/site/catalogue/${l.slug}`}>{l.name}</Link> : l.name}
                  {l.statusAtOrder && l.statusAtOrder !== "approved" ? (
                    <em className="sf-ordstatus"> — {l.statusAtOrder} when you ordered</em>
                  ) : null}
                </span>
                <span>{eur(l.lineTotal)}</span>
              </div>
            ))}
            <div className="sf-bkrow">
              <span>Goods</span>
              <span>{eur(order.goodsTotal)}</span>
            </div>
            <div className="sf-bkrow sub">
              <span>of which VAT at {(order.vatRate * 100).toFixed(order.vatRate * 100 % 1 ? 1 : 0)}%</span>
              <span>{eur(order.vatAmount)}</span>
            </div>
            <div className="sf-bkrow">
              <span>Delivery</span>
              <span>{order.deliveryTotal === 0 ? "Free" : eur(order.deliveryTotal)}</span>
            </div>
            <div className="sf-bkrow total">
              <span>Total</span>
              <span>{eur(order.grandTotal)}</span>
            </div>
          </section>

          <aside className="sf-ordside">
            <section className="sf-ordpanel">
              <h2>Delivery</h2>
              {order.shipAddress ? (
                <address>
                  {order.shipAddress.full_name ? <>{order.shipAddress.full_name}<br /></> : null}
                  {order.shipAddress.line1}<br />
                  {order.shipAddress.line2 ? <>{order.shipAddress.line2}<br /></> : null}
                  {order.shipAddress.city}
                  {order.shipAddress.postcode ? ` ${order.shipAddress.postcode}` : ""}<br />
                  {order.shipAddress.country_iso2}
                </address>
              ) : (
                <p>No address recorded.</p>
              )}
              <p className="sf-conote">{order.deliveryOption}</p>
            </section>

            <section className="sf-ordpanel">
              <h2>Payment</h2>
              <p>
                {paid ? (
                  <>
                    {order.paymentMethod === "demo" ? "Demo payment" : order.paymentMethod} ·{" "}
                    <code>{order.paymentRef}</code>
                    <br />
                    <span className="sf-conote">
                      No money moved. There is no payment provider connected yet.
                    </span>
                  </>
                ) : (
                  "Not yet paid."
                )}
              </p>
            </section>

            <section className="sf-ordpanel">
              <h2>History</h2>
              <ol className="sf-ordevents">
                {order.events.map((e, i) => (
                  <li key={i}>
                    <b>{STATUS_LABEL[e.status as keyof typeof STATUS_LABEL] || e.status}</b>
                    <span>{new Date(e.at).toLocaleString("en-GB")}</span>
                    {e.note ? <em>{e.note}</em> : null}
                  </li>
                ))}
              </ol>
            </section>
          </aside>
        </div>

        <div className="sf-ordfoot">
          <p className="sf-conote">
            A confirmation email would normally arrive now. Transactional email is not connected in
            this environment, so this page is the confirmation — it was logged, not sent.
          </p>
          <Link className="sf-cta" href="/admin/site/account">
            My account
          </Link>
        </div>
      </div>
    </main>
  );
}
