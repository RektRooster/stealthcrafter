import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase";
import { getHazardSnapshot } from "@/lib/hazards";
import { countryName } from "@/lib/iso-ids";

export const dynamic = "force-dynamic";

// WHERE THIS COMES FROM.
//
// Two jobs, and the first is not optional. Several of the licences we rely on —
// CC BY 4.0, OGL, the Meteoalarm terms — require attribution as a condition of
// use, and for a period this site displayed EMSC, GDACS and EFFIS data with no
// credit visible anywhere. That was a defect, not a style choice.
//
// The second job is that a page naming every authority behind every number is
// the argument for the whole business. Nobody else selling preparedness
// equipment can publish this page.
export default async function SourcesPage() {
  const sb = supabaseAdmin();
  const [{ sources: legacy }, feedRows] = await Promise.all([
    getHazardSnapshot(),
    sb
      ? sb
          .from("feeds")
          .select("id, country_iso2, kind, authority, endpoint, licence, attribution, licence_state, last_success_at, last_status")
          .eq("enabled", true)
          .in("licence_state", ["clear", "pending"])
          .order("country_iso2", { ascending: true })
          .then((r) => r.data || [])
      : Promise.resolve([]),
  ]);

  const feeds = (feedRows as any[]) || [];
  const byCountry = new Map<string, any[]>();
  for (const f of feeds) {
    const k = f.country_iso2 || "EU";
    if (!byCountry.has(k)) byCountry.set(k, []);
    byCountry.get(k)!.push(f);
  }

  return (
    <main className="sf-src">
      <header className="sf-srchead">
        <span className="sf-srckicker">Provenance</span>
        <h1>Where this comes from</h1>
        <p>
          Every condition shown on this site is a record published by a named public authority. We
          classify how much a household should care; we never restate our reading as theirs, and we
          never fill a gap with an estimate. This page lists every feed we carry, who issues it, and
          the licence we carry it under.
        </p>
      </header>

      <section className="sf-srcsec">
        <h2>European layers</h2>
        <div className="sf-srcgrid">
          {legacy.map((s) => (
            <article key={s.source} className={`sf-srccard st-${s.state}`}>
              <div className="sf-srctop">
                <span className="sf-srcdot" data-src={s.source} />
                <strong>{s.label}</strong>
                <span className="sf-srcstate">{s.state === "live" ? "Reporting" : "Not reporting"}</span>
              </div>
              <p className="sf-srcwhat">{s.what}</p>
              <p className="sf-srccredit">{s.attribution}</p>
              <a href={s.href} target="_blank" rel="noreferrer noopener">
                {new URL(s.href).hostname}
              </a>
            </article>
          ))}
        </div>
      </section>

      {[...byCountry.entries()].map(([iso2, rows]) => (
        <section key={iso2} className="sf-srcsec">
          <h2>{iso2 === "EU" ? "Pan-European" : countryName(iso2) || iso2}</h2>
          <div className="sf-srcgrid">
            {rows.map((f) => (
              <article key={f.id} className="sf-srccard">
                <div className="sf-srctop">
                  <strong>{f.authority}</strong>
                  <span className="sf-srcstate">{f.kind.replace(/-/g, " ")}</span>
                </div>
                <p className="sf-srccredit">{f.attribution}</p>
                {f.licence && <p className="sf-srclic">{f.licence.slice(0, 400)}</p>}
                <span className="sf-srcmeta">
                  {f.last_success_at
                    ? `Last read ${new Date(f.last_success_at).toLocaleString("en-GB")}`
                    : "Not yet read"}
                  {f.licence_state === "pending" && " · licence confirmation in progress"}
                </span>
              </article>
            ))}
          </div>
        </section>
      ))}

      <footer className="sf-srcfoot">
        <p>
          Severity levels on this site are StealthCrafter&apos;s reading of the published figures,
          not an official alert. Where an authority states its own level or advice, we show that
          too, in its own words.
        </p>
        <Link href="/admin/site/home">← Back to live conditions</Link>
      </footer>
    </main>
  );
}
