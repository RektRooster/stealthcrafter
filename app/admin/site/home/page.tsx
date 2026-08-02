import Link from "next/link";

// STOREFRONT PREVIEW — homepage skeleton.
// Built per Website & Platform Architecture v2.0: Jimmy-led, one clear next
// step, one uninterrupted journey (Welcome → Understand → Educate → Assess →
// Build → Recommend). Behind the /admin gate until launch.
export default function StorefrontHomePage() {
  return (
    <main className="sf-page">
      <div className="sf-inner">
        <section className="sf-hero">
          <h1>Protect the people you love.</h1>
          <p className="sf-sub">
            Every family is different. Let&apos;s build the preparedness system
            that&apos;s right for yours.
          </p>
          <Link href="/admin/site/jimmy" className="sf-cta">
            Launch Jimmy
          </Link>
          <div className="sf-cta-note">Takes around 5 minutes.</div>
          <div className="sf-rule" />
        </section>

        <section className="sf-strips">
          <div className="sf-strip">
            <h3>Learn</h3>
            <p>
              Understand the risks and the concepts — explained as they become
              relevant, inside the conversation, never as a hurdle before you
              can act.
            </p>
          </div>
          <div className="sf-strip">
            <h3>Assess</h3>
            <p>
              Jimmy understands your household, environment and likely risks
              before recommending anything — gradually building your
              Preparedness Profile.
            </p>
          </div>
          <div className="sf-strip">
            <h3>Build &middot; Maintain</h3>
            <p>
              Assemble the right preparedness system for your family, then keep
              it current over the long term — not a shopping basket, a system.
            </p>
          </div>
        </section>

        <div className="sf-footnote">
          STOREFRONT PREVIEW — copy and design pending SC 09 brand pass
        </div>
      </div>
    </main>
  );
}
