import { basketView } from "@/lib/commerce/basket";
import { currentCustomer, currentGuestKey } from "@/lib/customer-auth";
import BasketClient from "./basket-client";

export const dynamic = "force-dynamic";

export default async function BasketPage() {
  const customer = await currentCustomer();
  const guestKey = await currentGuestKey();
  const view = await basketView({ customerId: customer?.id ?? null, guestKey });

  return (
    <main className="sf-page banded">
      <header className="sf-band">
        <div className="sf-bandin">
          <div className="sf-bandkicker">Your basket</div>
          <h1>
            {view.count === 0
              ? "Nothing in it yet."
              : `${view.count} item${view.count === 1 ? "" : "s"}, held at the price you were shown.`}
          </h1>
          <p className="sf-bandlede">
            Prices are captured the moment you add something and do not move afterwards — not on
            this page, not at checkout. Whatever a product costs next week, you pay what you were
            quoted.
          </p>
        </div>
      </header>

      <div className="sf-catwrap">
        <BasketClient initial={view} />
      </div>
    </main>
  );
}
