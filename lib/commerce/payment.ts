// THE PAYMENT SEAM.
//
// There is no payment service provider and no trading entity, so the demo
// cannot take money and must not pretend to. What it CAN do is put the seam in
// the right place now, so that adding Stripe later is a new file implementing
// this interface plus a webhook route — not a rewrite of checkout.
//
// Everything a real provider needs is already in the shape: an intent created
// before the customer commits, a reference we can reconcile against, and a
// confirm step that is allowed to fail.

export type PaymentIntent = {
  provider: string;
  reference: string;
  amount: number;
  currency: string;
  /** where a real provider would send the customer; null when none is needed */
  redirectUrl: string | null;
};

/* Flat rather than a discriminated union, and not by preference: this project
   compiles with `strict: false`, which turns off strictNullChecks, which turns
   off narrowing on unions like this one. A `{ok:true}|{ok:false}` result reads
   nicely and then fails to compile at every use site. The ingest spine learned
   this the hard way; the same shape is used here for the same reason. */
export type PaymentResult = {
  ok: boolean;
  reference: string;
  provider: string;
  paidAt: string;
  reason: string;
};

export interface PaymentProvider {
  readonly id: string;
  readonly displayName: string;
  /** true when no real money can move — the UI must say so out loud */
  readonly isDemo: boolean;
  createIntent(input: { amount: number; currency: string; orderRef: string }): Promise<PaymentIntent>;
  confirm(intent: PaymentIntent): Promise<PaymentResult>;
}

/** The only provider that exists today. It succeeds, and it says why. */
export const demoPayment: PaymentProvider = {
  id: "demo",
  displayName: "Demo payment (no money moves)",
  isDemo: true,
  async createIntent({ amount, currency, orderRef }) {
    return {
      provider: "demo",
      reference: `DEMO-${orderRef}`,
      amount,
      currency,
      redirectUrl: null,
    };
  },
  async confirm(intent) {
    return {
      ok: true,
      reference: intent.reference,
      provider: "demo",
      paidAt: new Date().toISOString(),
      reason: "",
    };
  },
};

/* One place to change when a real provider arrives. Selection is by env so the
   switch is a deployment decision rather than a code change:
     COMMERCE_PAYMENT_PROVIDER=stripe  ->  register it here. */
export function paymentProvider(): PaymentProvider {
  return demoPayment;
}
