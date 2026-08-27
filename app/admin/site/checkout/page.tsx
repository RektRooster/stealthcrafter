import { basketView } from "@/lib/commerce/basket";
import { defaultAddress } from "@/lib/commerce/account";
import { currentCustomer, currentGuestKey } from "@/lib/customer-auth";
import CheckoutClient from "./checkout-client";

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const customer = await currentCustomer();
  const guestKey = await currentGuestKey();
  const view = await basketView({ customerId: customer?.id ?? null, guestKey });
  const saved = customer ? await defaultAddress(customer.id) : null;

  return (
    <main className="sf-page banded">
      <header className="sf-band">
        <div className="sf-bandin">
          <div className="sf-bandkicker">Checkout</div>
          <h1>Where is it going?</h1>
          <p className="sf-bandlede">
            One delivery option, one page, no account required. VAT is already inside the prices at
            the standard rate for the country you choose — it is shown so you can see it, not added
            on at the end.
          </p>
        </div>
      </header>

      <div className="sf-catwrap">
        <CheckoutClient
          basket={view}
          email={customer?.email || ""}
          signedIn={Boolean(customer)}
          savedAddress={saved}
        />
      </div>
    </main>
  );
}
