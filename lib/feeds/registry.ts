// The feed registry: SC 13's Feed Register, as data this codebase can run.
//
// registry.json is GENERATED from "SC 13 - Live Data & Feeds - Feed Register"
// and committed, so the registry is versioned alongside the code and a change
// to it shows up in a diff. Change control belongs to SC 13: when they publish
// v1.1 we regenerate and re-seed. We do not hand-patch an endpoint here,
// because then the register and the runtime quietly disagree and nobody knows
// which is true.
//
// Seeding is idempotent — the seed route upserts by id — so re-running after a
// register revision is safe and is the intended workflow.
import raw from "./registry.json";
import type { Feed } from "./types";

export const REGISTRY = raw as unknown as Feed[];

export function registryById(id: string): Feed | undefined {
  return REGISTRY.find((f) => f.id === id);
}

/** Everything that needs something from a human before it can run. This is the
    source for the access report — generated from the registry rather than
    written by hand, so it cannot drift out of date while we build. */
export function blockedFeeds(): Feed[] {
  return REGISTRY.filter(
    (f) =>
      f.register_status !== "NOT-FOUND" &&
      f.register_status !== "NO-PUBLIC-FEED" &&
      (f.access_state === "needs-key" ||
        f.access_state === "needs-registration" ||
        f.access_state === "needs-contract" ||
        f.licence_state === "blocked" ||
        f.licence_state === "unknown")
  );
}

export function registryStats() {
  const by = <T extends string>(pick: (f: Feed) => T) =>
    REGISTRY.reduce<Record<string, number>>((acc, f) => {
      const k = pick(f);
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
  return {
    total: REGISTRY.length,
    enabled: REGISTRY.filter((f) => f.enabled).length,
    countries: new Set(REGISTRY.map((f) => f.country_iso2).filter(Boolean)).size,
    byLicence: by((f) => f.licence_state),
    byAccess: by((f) => f.access_state),
    byStatus: by((f) => f.register_status || "UNKNOWN"),
    byKind: by((f) => f.kind),
  };
}
