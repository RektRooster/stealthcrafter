import Link from "next/link";
import { countriesWithRegistry } from "@/lib/country-conditions";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function ConditionsIndex() {
  const countries = countriesWithRegistry();
  const sb = supabaseAdmin();
  const counts = new Map<string, number>();
  if (sb) {
    const { data } = await sb
      .from("alerts")
      .select("country_iso2")
      .or(`expires.is.null,expires.gt.${new Date().toISOString()}`)
      .limit(5000);
    for (const r of (data || []) as any[]) {
      if (!r.country_iso2) continue;
      counts.set(r.country_iso2, (counts.get(r.country_iso2) || 0) + 1);
    }
  }

  return (
    <main className="sf-src">
      <header className="sf-srchead">
        <span className="sf-srckicker">By country</span>
        <h1>Conditions across Europe</h1>
        <p>
          What is happening in each country right now, and — the part most sites leave out — what we
          can and cannot see there. Most European states warn their citizens by cell broadcast
          straight to the handset, with nothing for anyone to subscribe to. Where that is the case we
          say so and name the system, because knowing which channel your government will actually use
          is itself preparedness.
        </p>
      </header>

      <div className="sf-ccgrid">
        {countries.map((c) => {
          const active = counts.get(c.iso2) || 0;
          return (
            <Link key={c.iso2} href={`/admin/site/conditions/${c.iso2.toLowerCase()}`} className="sf-cccard">
              <span className="sf-cciso">{c.iso2}</span>
              <strong>{c.name}</strong>
              <span className="sf-ccmeta">
                {active > 0 ? `${active} active` : "Quiet"} · {c.carried} of {c.feeds} feeds carried
              </span>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
