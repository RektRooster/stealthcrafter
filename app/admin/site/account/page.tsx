import Link from "next/link";
import { accountData } from "@/lib/commerce/account";
import { STATUS_LABEL } from "@/lib/commerce/orders";
import { eur } from "@/lib/commerce/vat";
import { currentCustomer } from "@/lib/customer-auth";
import AccountClient from "./account-client";
import SignOut from "./sign-out";

export const dynamic = "force-dynamic";

function householdLine(h: any): string {
  if (!h || typeof h !== "object" || !Object.keys(h).length)
    return "Nothing recorded yet — Jimmy builds this as you talk to him.";
  return Object.entries(h)
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

export default async function AccountPage() {
  const customer = await currentCustomer();

  if (!customer) {
    return (
      <main className="sf-page banded">
        <header className="sf-band">
          <div className="sf-bandin">
            <div className="sf-bandkicker">Your account</div>
            <h1>One household, remembered.</h1>
            <p className="sf-bandlede">
              Preparedness advice is only worth anything if it knows who it is for. An account keeps
              your household, the kit you already own, and what you have ordered — so Jimmy stops
              asking the same questions and starts giving answers that fit.
            </p>
          </div>
        </header>
        <div className="sf-catwrap">
          <AccountClient nextHref="/admin/site/account" />
        </div>
      </main>
    );
  }

  const data = await accountData(customer);
  const paidOrders = data.orders.filter((o) => o.status !== "cancelled");

  return (
    <main className="sf-page banded">
      <header className="sf-band">
        <div className="sf-bandin">
          <div className="sf-bandkicker">Your account</div>
          <h1>{customer.name ? `Hello, ${customer.name}.` : "Your account"}</h1>
          <p className="sf-bandlede">{customer.email}</p>
          <div className="sf-bandstats">
            <div className="sf-bandstat">
              <b>{data.orders.length}</b>
              <span>order{data.orders.length === 1 ? "" : "s"}</span>
            </div>
            <div className="sf-bandstat">
              <b>{data.kit.length}</b>
              <span>items in your kit</span>
            </div>
            <div className="sf-bandstat">
              <b>{data.addresses.length}</b>
              <span>saved address{data.addresses.length === 1 ? "" : "es"}</span>
            </div>
          </div>
        </div>
      </header>

      <div className="sf-catwrap">
        <div className="sf-acgrid">
          <section className="sf-ordpanel">
            <h2>My orders</h2>
            {!paidOrders.length ? (
              <p className="sf-conote">
                No orders yet. <Link href="/admin/site/catalogue">Browse the catalogue</Link>.
              </p>
            ) : (
              <div className="sf-actable">
                {data.orders.map((o) => (
                  <Link className="sf-acorder" key={o.id} href={`/admin/site/order/${o.reference}`}>
                    <span className="ref">{o.reference}</span>
                    <span className="when">{new Date(o.placedAt).toLocaleDateString("en-GB")}</span>
                    <span className={`st s-${o.status}`}>{STATUS_LABEL[o.status]}</span>
                    <span className="items">
                      {o.lines.reduce((a, l) => a + l.qty, 0)} item
                      {o.lines.reduce((a, l) => a + l.qty, 0) === 1 ? "" : "s"}
                    </span>
                    <span className="tot">{eur(o.grandTotal)}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="sf-ordpanel">
            <h2>My household</h2>
            <p className="sf-conote">
              This is the same profile Jimmy uses — there is one household record, not a shop copy
              and a Jimmy copy.
            </p>
            <p>{householdLine(data.profile?.household)}</p>
            <Link className="sf-bkghost" href="/admin/site/jimmy">
              Talk to Jimmy about my household
            </Link>
          </section>

          <section className="sf-ordpanel">
            <h2>My kit</h2>
            {!data.kit.length ? (
              <p className="sf-conote">
                Nothing credited yet. When you tell Jimmy what you already own, he records it here
                and stops recommending you buy it twice.
              </p>
            ) : (
              <ul className="sf-ackit">
                {data.kit.map((k) => (
                  <li key={k.id} className={k.expired ? "expired" : ""}>
                    <b>
                      {k.qty > 1 ? `${k.qty} × ` : ""}
                      {k.productSlug ? (
                        <Link href={`/admin/site/catalogue/${k.productSlug}`}>{k.label}</Link>
                      ) : (
                        k.label
                      )}
                    </b>
                    <span>
                      {k.kit ? k.kit.replace(/_/g, " ") : "kit"}
                      {k.expiresAt
                        ? k.expired
                          ? ` · expired ${k.expiresAt}`
                          : ` · expires ${k.expiresAt}`
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="sf-ordpanel">
            <h2>Saved addresses</h2>
            {!data.addresses.length ? (
              <p className="sf-conote">
                None saved. Tick the box at checkout and the address is kept for next time.
              </p>
            ) : (
              <ul className="sf-acaddr">
                {data.addresses.map((a) => (
                  <li key={a.id}>
                    {a.defaultShipping ? <span className="tag">Default</span> : null}
                    <address>
                      {a.fullName ? <>{a.fullName}<br /></> : null}
                      {a.line1}
                      {a.line2 ? <>, {a.line2}</> : null}
                      <br />
                      {a.city}
                      {a.postcode ? ` ${a.postcode}` : ""} · {a.countryIso2}
                    </address>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="sf-ordfoot">
          <p className="sf-conote">
            Demo environment. Your household profile is flagged fictional, and every order carries a
            DEMO reference so nothing here is ever mistaken for a real sale.
          </p>
          <SignOut />
        </div>
      </div>
    </main>
  );
}
