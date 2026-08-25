// The market layer: which country a visitor is in, and what that changes.
//
// Ace: "we need flags or a country chooser on the first home page so you can
// just click your flag then eventually we will serve the products based on
// location to that user."
//
// The flag row is the visible half. The half that matters is that ONE choice
// has to reach everything downstream — the map, the conditions rail, the
// catalogue, currency, language, and Jimmy's sense of where a household lives
// — without each of those inventing its own idea of "where you are".
//
// So the choice lives in a cookie, which is readable on the server during
// render. That matters: a market read on the client would mean every page
// flashes the European default and then rearranges, and the catalogue would
// have to fetch twice.
//
// ONE THING TO GET RIGHT NOW so it does not need redoing. SC 02 owns the
// multilingual URL architecture — `/xx/` language prefixes with hreflang — and
// a cookie-only market is invisible to a search engine, which would make every
// market's page the same URL. The cookie is therefore the INTERIM mechanism,
// not the destination: `marketFrom()` already prefers an explicit market passed
// in (which a route prefix will supply) and falls back to the cookie. When SC
// 02's prefixes land, routing hands the market in and nothing else changes.
//
// This module is SHARED — the chooser is a client component and imports the
// country list and the flag path from here. The cookie read lives next door in
// market-server.ts, because `next/headers` in a module a client component
// touches fails the build outright.

import { countryName } from "./iso-ids";

export const MARKET_COOKIE = "sc_market";

/** A market is a country we can meaningfully serve: we have conditions for it,
    or we intend to sell into it. Ordered for a chooser, not alphabetically —
    the EU-27 first because that is the trading area, then the near neighbours. */
export type MarketGroup = { label: string; note: string; codes: string[] };

export const MARKET_GROUPS: MarketGroup[] = [
  {
    label: "European Union",
    note: "Our trading area. Free movement of goods, one set of product rules.",
    codes: [
      "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT",
      "LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE",
    ],
  },
  {
    label: "Europe, outside the EU",
    note: "We watch conditions here. Shipping and product rules differ.",
    codes: ["GB","NO","CH","IS","UA","RS","BA","AL","MK","ME","MD","TR"],
  },
  {
    label: "Microstates",
    note: "Served through a neighbour's supply route.",
    codes: ["AD","LI","MC","SM","XK"],
  },
];

export const ALL_MARKETS: string[] = MARKET_GROUPS.flatMap((g) => g.codes);

export function isMarket(code: string | null | undefined): boolean {
  return Boolean(code && ALL_MARKETS.includes(code.toUpperCase()));
}

export type Market = {
  iso2: string;
  name: string;
  /** Inside the EU-27 — decides duty, product rules and, later, the supply route. */
  eu: boolean;
  /** True when the visitor picked this rather than us defaulting to all of Europe. */
  chosen: boolean;
};

const EU27 = new Set(MARKET_GROUPS[0].codes);

export function marketOf(iso2: string | null): Market | null {
  if (!isMarket(iso2)) return null;
  const code = iso2!.toUpperCase();
  return { iso2: code, name: countryName(code) || code, eu: EU27.has(code), chosen: true };
}

/** Flag artwork path. Rasterised at 96x72 rather than shipped as SVG: several
    national flags carry a coat of arms whose path data runs to 175 KB and is
    invisible at the 28px a chooser draws it. 44 flags come to 35 KB this way,
    against 455 KB as SVG. */
export function flagSrc(iso2: string): string {
  return `/flags/${iso2.toLowerCase()}.png`;
}
