// DEMO TAX MODEL — deliberately small, and labelled so nobody mistakes it for
// a tax engine.
//
// Standard rates only. No reduced or zero rates, no OSS thresholds, no
// distance-selling registration logic, no B2B reverse charge. SC 08 owns real
// VAT and will replace this wholesale. What it does do correctly is the one
// thing that would otherwise be wrong on every screen: our prices are
// VAT-INCLUSIVE, EU retail convention, so VAT is EXTRACTED from the price
// rather than added on top of it. Adding it on top would overcharge the
// customer by roughly a fifth and make every total in the demo a lie.

export const EU_VAT: Record<string, number> = {
  AT: 0.20, BE: 0.21, BG: 0.20, CY: 0.19, CZ: 0.21, DE: 0.19, DK: 0.25,
  EE: 0.22, ES: 0.21, FI: 0.255, FR: 0.20, GR: 0.24, HR: 0.25, HU: 0.27,
  IE: 0.23, IT: 0.22, LT: 0.21, LU: 0.17, LV: 0.21, MT: 0.18, NL: 0.21,
  PL: 0.23, PT: 0.23, RO: 0.19, SE: 0.25, SI: 0.22, SK: 0.23,
};

/** Fallback for a country we do not hold a rate for. Stated, not hidden. */
export const DEFAULT_VAT = 0.21;

export function vatRateFor(iso2: string | null | undefined): number {
  if (!iso2) return DEFAULT_VAT;
  return EU_VAT[iso2.toUpperCase()] ?? DEFAULT_VAT;
}

export const DELIVERY_FLAT = 5.95;
export const DELIVERY_FREE_OVER = 75;
export const DELIVERY_LABEL = "Standard EU delivery — 3-5 working days";

export function deliveryFor(goodsTotal: number): number {
  return goodsTotal >= DELIVERY_FREE_OVER ? 0 : DELIVERY_FLAT;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type Totals = {
  goodsTotal: number;
  vatRate: number;
  vatAmount: number;
  deliveryTotal: number;
  grandTotal: number;
  freeDelivery: boolean;
  awayFromFreeDelivery: number;
};

/** goodsTotal is VAT-inclusive; vatAmount is the tax already inside it. */
export function totalsFor(goodsTotal: number, countryIso2: string | null): Totals {
  const goods = round2(goodsTotal);
  const rate = vatRateFor(countryIso2);
  const vat = round2(goods - goods / (1 + rate));
  const delivery = deliveryFor(goods);
  return {
    goodsTotal: goods,
    vatRate: rate,
    vatAmount: vat,
    deliveryTotal: delivery,
    grandTotal: round2(goods + delivery),
    freeDelivery: delivery === 0,
    awayFromFreeDelivery: goods >= DELIVERY_FREE_OVER ? 0 : round2(DELIVERY_FREE_OVER - goods),
  };
}

export function eur(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return "€" + n.toFixed(2);
}

/* EU-27 plus the EEA/EFTA neighbours we would ship to. Country selection at
   checkout is a real decision, not a free-text box: it sets the VAT rate. */
export const SHIP_COUNTRIES: { iso2: string; name: string }[] = [
  { iso2: "AT", name: "Austria" }, { iso2: "BE", name: "Belgium" },
  { iso2: "BG", name: "Bulgaria" }, { iso2: "HR", name: "Croatia" },
  { iso2: "CY", name: "Cyprus" }, { iso2: "CZ", name: "Czechia" },
  { iso2: "DK", name: "Denmark" }, { iso2: "EE", name: "Estonia" },
  { iso2: "FI", name: "Finland" }, { iso2: "FR", name: "France" },
  { iso2: "DE", name: "Germany" }, { iso2: "GR", name: "Greece" },
  { iso2: "HU", name: "Hungary" }, { iso2: "IE", name: "Ireland" },
  { iso2: "IT", name: "Italy" }, { iso2: "LV", name: "Latvia" },
  { iso2: "LT", name: "Lithuania" }, { iso2: "LU", name: "Luxembourg" },
  { iso2: "MT", name: "Malta" }, { iso2: "NL", name: "Netherlands" },
  { iso2: "PL", name: "Poland" }, { iso2: "PT", name: "Portugal" },
  { iso2: "RO", name: "Romania" }, { iso2: "SK", name: "Slovakia" },
  { iso2: "SI", name: "Slovenia" }, { iso2: "ES", name: "Spain" },
  { iso2: "SE", name: "Sweden" },
];
