import Link from "next/link";
import { PILLARS as PAL_PILLARS, SEVERITY } from "@/lib/palette";
import { getEuroMapData } from "@/lib/euro-map";
import { getHazardSnapshot, summarise } from "@/lib/hazards";
import { getHomeDashboard } from "@/lib/home-dashboard";
import HazardMap from "./hazard-map";
import JimmyPanel from "./jimmy-panel";

export const dynamic = "force-dynamic";

const PILLAR_TONE: Record<string, string> = PAL_PILLARS;

function eur(n: number | null): string {
  if (n === null) return "";
  return `€${n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function when(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// CUSTOMER HOME — one page, app-like. Live European conditions at the centre,
// Jimmy in the sidebar, knowledge and tested equipment beneath.
export default async function HomePage() {
  const map = getEuroMapData();
  const [snapshot, dash] = await Promise.all([getHazardSnapshot(), getHomeDashboard()]);
  const { byCountry, severe } = summarise(snapshot.events);

  const liveSources = snapshot.sources.filter((s) => s.state === "live");

  const stats = [
    { label: "Products assessed", value: dash.stats.products.toLocaleString("en-GB") },
    { label: "European markets", value: String(dash.stats.markets) },
    { label: "Suppliers traced", value: String(dash.stats.suppliers) },
    { label: "Test checkpoints run", value: dash.stats.checkpoints.toLocaleString("en-GB") },
  ];

  return (
    <main className="sf-dash">
      {/* ---------- status strip ---------- */}
      <div className="sf-dashbar">
        <span className="sf-dashlive">
          <i />
          Live across Europe
        </span>
        <span>
          <strong>{snapshot.events.length}</strong> conditions tracked
        </span>
        {severe > 0 && (
          <span className="sev">
            <strong>{severe}</strong> requiring action
          </span>
        )}
        <span className="sf-dashsrc">
          {liveSources.map((s) => (
            <i key={s.source} className="sf-hz-layerdot" data-src={s.source} title={s.label} />
          ))}
          {liveSources.length} sources
        </span>
        <Link href="/admin/site/catalogue" className="sf-dashcta">
          Browse equipment →
        </Link>
      </div>

      <div className="sf-dashgrid">
        <JimmyPanel stats={stats} />

        <div className="sf-dashmain">
          {/* ---------- live map ---------- */}
          <section className="sf-dashpanel wide">
            <div className="sf-dashpanelhead">
              <h2>Europe, right now</h2>
              <p>Wildfire, seismic, major-disaster, grid and transport conditions, read live.</p>
            </div>
            <HazardMap
              compact
              width={map.width}
              height={map.height}
              countries={map.countries}
              events={snapshot.events}
              sources={snapshot.sources}
              generatedAt={snapshot.generatedAt}
              byCountry={byCountry}
            />
          </section>

          {/* ---------- knowledge ---------- */}
          <section className="sf-dashpanel">
            <div className="sf-dashpanelhead">
              <h2>Knowledge first</h2>
              <Link href="/admin/site/guides">All guides →</Link>
            </div>
            <div className="sf-dashguides">
              {dash.guides.map((g) => (
                <Link key={g.slug} href={`/admin/site/guides/${g.slug}`} className="sf-dashguide">
                  <span
                    className="sf-dashpill"
                    style={{ color: PILLAR_TONE[g.pillar ?? ""] ?? "#c6a15b" }}
                  >
                    {g.pillar || g.category}
                  </span>
                  <strong>{g.title}</strong>
                  <p>{g.summary}</p>
                  <span className="sf-dashmin">{g.readMin} min read</span>
                </Link>
              ))}
            </div>
          </section>

          {/* ---------- tested ---------- */}
          <section className="sf-dashpanel">
            <div className="sf-dashpanelhead">
              <h2>Tested by us</h2>
              <Link href="/admin/site/tested">All reports →</Link>
            </div>
            <div className="sf-dashtested">
              {dash.tested.map((t) => (
                <Link key={t.code} href={`/admin/site/tested/${t.code}`} className="sf-dashtest">
                  <div className="sf-dashtestimg">
                    {t.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.image} alt="" width={200} height={150} decoding="async" />
                    ) : null}
                  </div>
                  <div className="sf-dashtestbody">
                    {t.brand && <span className="sf-cardbrand">{t.brand}</span>}
                    <strong>{t.product}</strong>
                    <div className="sf-dashtestscore">
                      <span className="ok">
                        {t.passed}/{t.total}
                      </span>
                      checkpoints met · {when(t.when)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>

          {/* ---------- equipment ---------- */}
          <section className="sf-dashpanel">
            <div className="sf-dashpanelhead">
              <h2>Equipment we stand behind</h2>
              <Link href="/admin/site/catalogue">Full catalogue →</Link>
            </div>
            <div className="sf-dashheroes">
              {dash.heroes.map((p) => (
                <Link key={p.slug} href={`/admin/site/catalogue/${p.slug}`} className="sf-dashhero">
                  <div className="sf-dashheroimg">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.image!} alt="" width={240} height={180} decoding="async" />
                  </div>
                  <strong>{p.name}</strong>
                  <span className="sf-dashherometa">
                    {p.category}
                    {p.price !== null ? ` · ${eur(p.price)}` : ""}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
