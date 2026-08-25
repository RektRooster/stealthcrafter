// Server half of the market layer. Kept apart from lib/market.ts because that
// module is imported by the country chooser, which is a client component, and
// `next/headers` anywhere in a client component's import graph fails the build.
import { cookies } from "next/headers";
import { MARKET_COOKIE, isMarket, marketOf } from "./market";
import type { Market } from "./market";

/**
 * The market for this request.
 *
 * `explicit` is what a future `/xx/` route prefix will pass. Until then it is
 * undefined and the cookie decides. Returns null for "all of Europe", which is
 * a real answer and the honest default: we do not guess someone's country from
 * their IP and then quietly reshape the shop around the guess.
 */
export async function getMarket(explicit?: string): Promise<Market | null> {
  if (explicit && isMarket(explicit)) return marketOf(explicit);
  try {
    const jar = await cookies();
    return marketOf(jar.get(MARKET_COOKIE)?.value ?? null);
  } catch {
    return null;
  }
}
