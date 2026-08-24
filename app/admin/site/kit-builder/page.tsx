import { getKitCatalogue } from "@/lib/kit/data";
import { getHazardSnapshot } from "@/lib/hazards";
import KitBuilder from "./kit-builder";

export const dynamic = "force-dynamic";

// STOREFRONT PREVIEW — Kit Builder.
// A survival simulator with a shopping list attached: it runs the household's
// resources down hour by hour under a scenario, reports the hour each pillar
// fails, and ranks the whole catalogue by hours-of-survival gained per euro.
export default async function KitBuilderPage() {
  const [cat, snapshot] = await Promise.all([
    getKitCatalogue(),
    getHazardSnapshot().catch(() => null),
  ]);

  if (!cat.configured) {
    return (
      <main className="sf-page">
        <div className="sf-inner">
          <div className="cc-notice">
            <strong>Kit Builder is offline.</strong> Supabase is not configured.
          </div>
        </div>
      </main>
    );
  }

  // Scenarios whose hazard source is currently reporting something get flagged
  // in the picker, so the builder points at what is actually happening.
  const liveHints = (snapshot?.sources || [])
    .filter((s) => s.state === "live" && s.count > 0)
    .map((s) => s.source as string);

  return <KitBuilder catalogue={cat.items} liveHints={liveHints} />;
}
