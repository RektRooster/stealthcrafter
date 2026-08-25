import Link from "next/link";
import { notFound } from "next/navigation";
import { getCountryConditions } from "@/lib/country-conditions";
import { SEVERITY } from "@/lib/palette";
import { NUTS_ATTRIBUTION } from "@/lib/geo/regions";

export const dynamic = "force-dynamic";

const SEV_LABEL: Record<string, string> = {
  info: "Informational",
  watch: "Worth knowing",
  elevated: "Potentially disruptive",
  severe: "Act on this",
};

export async function generateMetadata({ params }: { params: Promise<{ iso2: string }> }) {
  const { iso2 } = await params;
  const c = await getCountryConditions(iso2);
  if (!c) return { title: "Conditions" };
  return {
    title: `${c.name} — live conditions and warning coverage`,
    description: `Active weather, flood, seismic and civil-protection warnings for ${c.name}, read from the official sources, with an honest account of what we can and cannot see.`,
  };
}

export default async function CountryConditions({ params }: { params: Promise<{ iso2: string }> }) {
  const { iso2 } = await params;
  const c = await getCountryConditions(iso2);
  if (!c) notFound();

  return (
    <main className="sf-src">
      <header className="sf-srchead">
        <span className="sf-srckicker">
          <Link href="/admin/site/conditions">All countries</Link> · {c.iso2}
        </span>
        <h1>{c.name} right now</h1>
        <p>
          {c.events.length === 0 ? (
            <>
              No warnings are active in {c.name} from the sources we carry. Quiet is the normal case —
              the point of preparing is that it is not the only case.
            </>
          ) : (
            <>
              <strong>{c.events.length}</strong>{" "}
              {c.events.length === 1 ? "warning is" : "warnings are"} active, the most significant
              rated <strong>{SEV_LABEL[c.worst || "info"]}</strong> by our reading of the published
              figures.
            </>
          )}
        </p>
        {c.lastRead && (
          <p className="sf-srcmeta">
            Sources last read {new Date(c.lastRead).toLocaleString("en-GB")}.
          </p>
        )}
      </header>

      {c.events.length > 0 && (
        <section className="sf-srcsec">
          <h2>Active now</h2>
          <div className="sf-ccalerts">
            {c.events.slice(0, 30).map((e) => (
              <article
                key={e.id}
                className="sf-ccalert"
                style={{ ["--sev" as any]: SEVERITY[e.severity] }}
              >
                <div className="sf-ccatop">
                  <span className="sf-ccasev">{SEV_LABEL[e.severity]}</span>
                  {e.upstreamSeverity && (
                    <span className="sf-ccaup">authority: {e.upstreamSeverity}</span>
                  )}
                </div>
                <strong>{e.title}</strong>
                {e.areaDesc && <span className="sf-ccarea">{e.areaDesc}</span>}
                {e.instruction && (
                  <div className="sf-ccainstr">
                    <span>What {e.source} says to do</span>
                    <p>{e.instruction}</p>
                  </div>
                )}
                <span className="sf-ccameta">
                  {e.source}
                  {e.count > 1 ? ` · ${e.count} areas` : ""}
                  {e.attribution ? ` · ${e.attribution}` : ""}
                </span>
              </article>
            ))}
          </div>
        </section>
      )}

      {c.nationalSystem && (
        <section className="sf-srcsec">
          <h2>How {c.name} warns its people</h2>
          <div className={`sf-ccsystem${c.nationalSystem.machineReadable ? " ok" : ""}`}>
            <strong>{c.nationalSystem.authority}</strong>
            <p>
              {c.nationalSystem.machineReadable ? (
                <>
                  This country publishes its official warnings in a machine-readable form, so we
                  carry them here alongside the weather and hazard feeds.
                </>
              ) : (
                <>
                  Official civil-protection alerts here are delivered straight to handsets by cell
                  broadcast. There is nothing for us — or anyone else — to subscribe to, so we cannot
                  mirror them. That makes one setting on your phone more important than anything on
                  this page: <strong>check that emergency alerts are switched on</strong>, because
                  that is the channel your government will actually use. What we watch on your behalf
                  is set out below.
                </>
              )}
            </p>
            {c.nationalSystem.note && <p className="sf-ccnote">{c.nationalSystem.note}</p>}
          </div>
        </section>
      )}

      <section className="sf-srcsec">
        <h2>What we watch, and what we cannot</h2>
        <div className="sf-ccgrid">
          {c.coverage.map((row) => (
            <article
              key={row.kind}
              className={`sf-cccov${
                row.carried.length
                  ? " has"
                  : row.notFound
                  ? " none"
                  : row.available.length
                  ? " avail"
                  : " nofeed"
              }`}
            >
              <div className="sf-ccovtop">
                <strong>{row.label}</strong>
                <span>
                  {row.carried.length
                    ? `${row.carried.filter((x) => x.live).length}/${row.carried.length} reporting`
                    : row.noFeed.length
                    ? "no public feed"
                    : row.available.length
                    ? "found, not yet carried"
                    : "none found"}
                </span>
              </div>
              {row.carried.map((s) => (
                <p key={s.authority} className="sf-ccsrc">
                  {s.authority}
                  {s.licenceState === "pending" && (
                    <em> · licence confirmation in progress</em>
                  )}
                </p>
              ))}
              {row.available.map((s) => (
                <p key={s.authority} className="sf-ccsrc muted">
                  {s.authority} — {s.why}.
                </p>
              ))}
              {row.noFeed.map((s) => (
                <p key={s.authority} className="sf-ccsrc muted">
                  {s.authority} — publishes warnings, but not in a form anyone can read
                  automatically.
                </p>
              ))}
              {row.notFound && !row.carried.length && (
                <p className="sf-ccsrc muted">
                  We looked and could not find a public source. If you know of one, tell us.
                </p>
              )}
            </article>
          ))}
        </div>
        <p className="sf-srcmeta">
          {c.feedsCarried} of {c.feedsRegistered} sources researched for {c.name} are carried today.
          The rest are registered and built, waiting on a key, a licence answer, or a source that
          does not exist yet.
        </p>
      </section>

      <footer className="sf-srcfoot">
        {c.credits.length > 0 && (
          <p>
            <strong>Sources:</strong> {c.credits.join(" · ")}. {NUTS_ATTRIBUTION}.
          </p>
        )}
        <p>
          Severity levels are StealthCrafter&apos;s reading of the published figures, not an official
          alert. Where an authority states its own level or advice we show that too, in its own words.
        </p>
        <Link href="/admin/site/home">← Live map</Link>
      </footer>
    </main>
  );
}
