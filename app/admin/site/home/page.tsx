import Link from "next/link";
import { getEuroMapData } from "@/lib/euro-map";
import { getHazardSnapshot, summarise } from "@/lib/hazards";
import { getHomeData } from "@/lib/home-data";
import HazardMap from "./hazard-map";
import JimmyStarter from "./jimmy-starter";

export const dynamic = "force-dynamic";

// STOREFRONT PREVIEW — customer homepage.
//
// Rebuilt around a live European conditions map. The reasoning: the brand
// promise is "knowledge before commerce", and the honest way to open is to
// show what is actually happening on the continent this minute, from named
// public sources, then offer one next step — Jimmy.
//
// Nothing on this page is illustrative. Live counts that are still zero are
// suppressed; guides appear only once SIGNED; a hazard source that cannot be
// reached says so in its own words rather than quietly vanishing.
export default async function StorefrontHomePage() {
  const map = getEuroMapData();
  const [snapshot, home] = await Promise.all([getHazardSnapshot(), getHomeData()]);
  const { byCountry } = summarise(snapshot.events);

  return (
    <main className="sf-page">
      <div className="sf-inner">
        <section className="sf-hero">
          <h1>Protect the people you love.</h1>
          <p className="sf-sub">
            Every family is different. Let&apos;s build the preparedness system that&apos;s right
            for yours.
          </p>
          <JimmyStarter />
          <div className="sf-rule" />
        </section>
      </div>

      <section className="sf-wide">
        <HazardMap
          width={map.width}
          height={map.height}
          countries={map.countries}
          events={snapshot.events}
          sources={snapshot.sources}
          generatedAt={snapshot.generatedAt}
          byCountry={byCountry}
        />
      </section>

      <div className="sf-inner">
        <section className="sf-strips">
          <div className="sf-strip">
            <h3>Learn</h3>
            <p>
              Understand the risks and the concepts — explained as they become relevant, inside the
              conversation, never as a hurdle before you can act.
            </p>
          </div>
          <div className="sf-strip">
            <h3>Assess</h3>
            <p>
              Jimmy understands your household, environment and likely risks before recommending
              anything — gradually building your Preparedness Profile.
            </p>
          </div>
          <div className="sf-strip">
            <h3>Build &middot; Maintain</h3>
            <p>
              Assemble the right preparedness system for your family, then keep it current over the
              long term — not a shopping basket, a system.
            </p>
          </div>
        </section>

        {home.stats.length > 0 && (
          <section className="sf-proof">
            {home.stats.map((s) => (
              <div key={s.label} className="sf-proofitem">
                <strong>{s.value.toLocaleString("en-GB")}</strong>
                <span className="sf-prooflabel">{s.label}</span>
                <span className="sf-proofnote">{s.note}</span>
              </div>
            ))}
          </section>
        )}

        <section className="sf-guides">
          <div className="sf-guideshead">
            <h2>Start with the knowledge</h2>
            <Link href="/admin/site/guides" className="sf-guidesall">
              All guides →
            </Link>
          </div>
          {home.guides.length ? (
            <div className="sf-guidegrid">
              {home.guides.map((g) => (
                <Link key={g.slug} href={`/admin/site/guides/${g.slug}`} className="sf-guidecard">
                  <span className="sf-guidepillar">{g.pillar || g.category}</span>
                  <strong>{g.title}</strong>
                  <p>{g.summary}</p>
                  <span className="sf-guidemin">{g.read_min} min read</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="sf-guideempty">
              <strong>No guides are signed off for publication yet.</strong>
              <p>
                {home.guidesTotal > 0
                  ? `${home.guidesTotal} guides are drafted and in safety review. They appear here once signed — nothing reaches this page before it has been reviewed.`
                  : "Guides appear here once they have been written and signed off."}{" "}
                <Link href="/admin/site/guides">See the Knowledge Hub →</Link>
              </p>
            </div>
          )}
        </section>

        <div className="sf-footnote">
          STOREFRONT PREVIEW — copy and design pending SC 09 brand pass. Hazard data is supplied by
          EFFIS/Copernicus, EMSC, GDACS, ENTSO-E and national transport authorities; StealthCrafter
          is not an emergency service. In an emergency, contact 112.
        </div>
      </div>
    </main>
  );
}
