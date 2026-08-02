import Link from "next/link";
import { CcIcon } from "../cc-chrome";
import { getOverview, OverviewData } from "@/lib/overview-data";

export const dynamic = "force-dynamic";

/* ---------- tiny presentational helpers (server-rendered) ---------- */

const fmt = (n: number) => n.toLocaleString("en-GB");

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d
    .toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    .toUpperCase();
}

function Fig({
  v,
  l,
  tone,
}: {
  v: string;
  l: string;
  tone?: "green" | "amber" | "red" | "cyan";
}) {
  return (
    <div className={`cc-ov-fig${tone ? ` ${tone}` : ""}`}>
      <span className="v">{v}</span>
      <span className="k">{l}</span>
    </div>
  );
}

function OvPanel({
  icon,
  title,
  href,
  status,
  sf,
  children,
}: {
  icon: string;
  title: string;
  href: string;
  status: string;
  sf?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`cc-panel cc-ov-panel${sf ? " sf" : ""}`}>
      <h2 className="cc-panel-h">
        <CcIcon name={icon} />
        {title}
      </h2>
      <div className="cc-ov-figs">{children}</div>
      <p className="cc-ov-statusline">{status}</p>
      <Link href={href} className="cc-ov-open">
        OPEN <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}

/* ---------- priority actions (computed, never invented) ---------- */

type Action = { href: string; label: string; tone: "red" | "amber" };

function buildActions(d: OverviewData): Action[] {
  const actions: Action[] = [];
  for (const g of d.compliance.gateItems) {
    actions.push({
      href: "/admin/compliance",
      label: `Compliance gate open — ${g.title}`,
      tone: "red",
    });
  }
  if (d.suppliers.uncoveredHeroes > 0) {
    actions.push({
      href: "/admin/suppliers",
      label: `${d.suppliers.uncoveredHeroes} hero product${d.suppliers.uncoveredHeroes === 1 ? "" : "s"} without a supplier route`,
      tone: "amber",
    });
  }
  if (d.jimmy && d.jimmy.knowledgeTotal > 0 && d.jimmy.knowledgeSigned < d.jimmy.knowledgeTotal) {
    actions.push({
      href: "/admin/jimmy",
      label: `Jimmy sign-off pending — ${d.jimmy.knowledgeSigned}/${d.jimmy.knowledgeTotal} signed`,
      tone: "amber",
    });
  }
  if (d.products.needsReview > 0) {
    actions.push({
      href: "/admin",
      label: `${d.products.needsReview} product${d.products.needsReview === 1 ? " needs" : "s need"} review`,
      tone: "amber",
    });
  }
  return actions.slice(0, 6);
}

/* ---------- page ---------- */

export default async function OverviewPage() {
  let data: OverviewData | null = null;
  let loadError: string | null = null;
  try {
    data = await getOverview();
  } catch (e: any) {
    loadError = e?.message || String(e);
  }

  if (!data) {
    return (
      <main className="cc-container">
        <div className="cc-notice">
          <strong>Overview is offline.</strong>{" "}
          {loadError
            ? `Data load failed: ${loadError}`
            : "Supabase is not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."}
        </div>
      </main>
    );
  }

  const { products, testing, suppliers, markets, warRoom, jimmy, compliance } = data;
  const actions = buildActions(data);
  const today = new Date()
    .toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    .toUpperCase();
  const gates = compliance.openGateItems;

  return (
    <main className="cc-container cc-ov">
      {/* ---------- hero strip ---------- */}
      <section className="cc-panel cc-ov-hero">
        <div className="cc-ov-herotitle">
          <h1>
            COMMAND CENTER — <span className="cy">OVERVIEW</span>
          </h1>
          <div className="date">{today}</div>
        </div>
        <div className="cc-ov-headlines">
          <div className="cc-ov-tile">
            <div className="n cyan">{fmt(products.total)}</div>
            <div className="l">CATALOGUE</div>
            <div className="s">{fmt(products.approved)} approved</div>
          </div>
          <div className="cc-ov-tile">
            <div className="n cyan">{fmt(testing.completed)}</div>
            <div className="l">TEST SESSIONS</div>
            <div className="s">{fmt(testing.active)} in progress</div>
          </div>
          <div className="cc-ov-tile">
            <div className="n cyan">{fmt(suppliers.total)}</div>
            <div className="l">SUPPLIER NETWORK</div>
            <div className="s">{fmt(suppliers.covered)} products covered</div>
          </div>
          <div className={`cc-ov-tile${gates > 0 ? " red" : " green"}`}>
            <div className="n">{fmt(gates)}</div>
            <div className="l">OPEN COMPLIANCE GATES</div>
            <div className="s">{gates > 0 ? "action required" : "register clear"}</div>
          </div>
        </div>
      </section>

      {/* ---------- module panels ---------- */}
      <div className="cc-ov-grid">
        <OvPanel
          icon="products"
          title="PRODUCTS"
          href="/admin"
          status={`${fmt(products.approved)} of ${fmt(products.total)} approved · ${fmt(products.needsReview)} flagged for review.`}
        >
          <Fig v={fmt(products.total)} l="TOTAL" />
          <Fig v={fmt(products.approved)} l="APPROVED" tone="green" />
          <Fig v={fmt(products.needsReview)} l="NEEDS REVIEW" tone={products.needsReview > 0 ? "amber" : undefined} />
          <Fig v={fmt(products.heroes)} l="HEROES" tone="cyan" />
          <Fig v={fmt(products.imagesComplete)} l="IMAGES COMPLETE" />
        </OvPanel>

        <OvPanel
          icon="testing"
          title="TEST LAB"
          href="/admin/testing"
          status={
            testing.completed > 0
              ? `${fmt(testing.completed)} sessions completed · ${fmt(testing.untested)} products still untested.`
              : `No sessions completed yet — ${fmt(testing.untested)} products in the queue.`
          }
        >
          <Fig v={fmt(testing.untested)} l="UNTESTED" tone={testing.untested > 0 ? "amber" : undefined} />
          <Fig v={fmt(testing.active)} l="ACTIVE SESSIONS" tone="cyan" />
          <Fig v={fmt(testing.completed)} l="COMPLETED" />
          <Fig v={fmt(testing.pass)} l="PASS" tone="green" />
          <Fig v={fmt(testing.review)} l="REVIEW" tone={testing.review > 0 ? "amber" : undefined} />
          <Fig v={fmt(testing.fail)} l="FAIL" tone={testing.fail > 0 ? "red" : undefined} />
        </OvPanel>

        <OvPanel
          icon="suppliers"
          title="SUPPLIERS"
          href="/admin/suppliers"
          status={`${fmt(suppliers.covered)} of ${fmt(suppliers.productsTotal)} products have a supplier route · ${fmt(suppliers.uncoveredHeroes)} heroes uncovered.`}
        >
          <Fig v={fmt(suppliers.total)} l="SUPPLIERS" />
          <Fig v={fmt(suppliers.tradeOpen)} l="TRADE OPEN" tone="green" />
          <Fig v={`${fmt(suppliers.toOpen)} / ${fmt(suppliers.applied)}`} l="TO OPEN / APPLIED" />
          <Fig v={`${fmt(suppliers.covered)}/${fmt(suppliers.productsTotal)}`} l="PRODUCTS COVERED" tone="cyan" />
          <Fig v={fmt(suppliers.uncoveredHeroes)} l="HEROES UNCOVERED" tone={suppliers.uncoveredHeroes > 0 ? "amber" : "green"} />
        </OvPanel>

        {markets ? (
          <OvPanel
            icon="map"
            title="MARKETS"
            href="/admin/map"
            status={`${fmt(markets.active)} of 27 EU states active · ${fmt(markets.priority)} priority markets.`}
          >
            <Fig v={`${fmt(markets.active)}/27`} l="STATES ACTIVE" tone="green" />
            <Fig v={`${fmt(markets.withSuppliers)}/27`} l="WITH SUPPLIERS" tone="cyan" />
            <Fig v={fmt(markets.priority)} l="PRIORITY MARKETS" />
            <Fig v={fmt(markets.assessed)} l="READINESS ASSESSED" />
          </OvPanel>
        ) : (
          <OvPanel
            icon="map"
            title="MARKETS"
            href="/admin/map"
            status="Market table unreachable — figures render once country_markets is live."
          >
            <Fig v="—" l="STATES ACTIVE" />
            <Fig v="—" l="WITH SUPPLIERS" />
          </OvPanel>
        )}

        {warRoom ? (
          <OvPanel
            icon="competitors"
            title="WAR ROOM"
            href="/admin/competitors"
            status={
              warRoom.topName
                ? `Top threat: ${warRoom.topName} (${warRoom.topLabel}).`
                : "No rivals scored yet — run the Ahrefs pull."
            }
          >
            <Fig v={fmt(warRoom.tracked)} l="RIVALS TRACKED" />
            <Fig
              v={warRoom.topName ? `${warRoom.topName} · ${warRoom.topLabel ?? "—"}` : "—"}
              l="TOP THREAT"
              tone={warRoom.topName ? "red" : undefined}
            />
            <Fig v={fmt(warRoom.advertising)} l="ADVERTISING" tone={warRoom.advertising > 0 ? "amber" : undefined} />
            <Fig v={warRoom.totalTraffic > 0 ? `${fmt(warRoom.totalTraffic)}/mo` : "—"} l="RIVAL TRAFFIC" />
            <Fig v={fmtDate(warRoom.lastPulled)} l="LAST AHREFS PULL · REFRESHES WEEKLY" tone="cyan" />
          </OvPanel>
        ) : (
          <OvPanel
            icon="competitors"
            title="WAR ROOM"
            href="/admin/competitors"
            status="Competitor tables unreachable — figures render once the rival set is live."
          >
            <Fig v="—" l="RIVALS TRACKED" />
            <Fig v="—" l="TOP THREAT" />
          </OvPanel>
        )}

        {jimmy ? (
          <OvPanel
            icon="jimmy"
            title="JIMMY"
            href="/admin/jimmy"
            status={
              jimmy.online
                ? `Online via ${jimmy.provider} · deterministic safety layer armed.`
                : "Paused — kill switch is on; messages store but no model is called."
            }
          >
            <Fig v={jimmy.online ? "ONLINE" : "PAUSED"} l="STATUS" tone={jimmy.online ? "green" : "red"} />
            <Fig v={`${jimmy.provider} · ${jimmy.model}`} l="PROVIDER / MODEL" tone="cyan" />
            <Fig v={`${fmt(jimmy.knowledgeSigned)}/${fmt(jimmy.knowledgeTotal)}`} l="KNOWLEDGE SIGNED" tone={jimmy.knowledgeSigned < jimmy.knowledgeTotal ? "amber" : "green"} />
            <Fig
              v={jimmy.evalPassRate === null ? `${fmt(jimmy.evalGraded)} graded` : `${fmt(jimmy.evalGraded)} · ${jimmy.evalPassRate}%`}
              l="CHALLENGE TESTS · PASS RATE"
            />
            <Fig v={jimmy.conversations === null ? "—" : fmt(jimmy.conversations)} l="CONVERSATIONS" />
            <Fig v={jimmy.safetyFires === null ? "—" : fmt(jimmy.safetyFires)} l="SAFETY FIRES" tone={(jimmy.safetyFires ?? 0) > 0 ? "amber" : undefined} />
          </OvPanel>
        ) : (
          <OvPanel
            icon="jimmy"
            title="JIMMY"
            href="/admin/jimmy"
            status="Jimmy tables unreachable — figures render once the console schema is live."
          >
            <Fig v="—" l="STATUS" />
            <Fig v="—" l="KNOWLEDGE SIGNED" />
          </OvPanel>
        )}

        <OvPanel
          icon="compliance"
          title="COMPLIANCE"
          href="/admin/compliance"
          status={
            gates > 0
              ? `${fmt(gates)} open gate ${gates === 1 ? "item blocks" : "items block"} launch — resolve in the register.`
              : "No open gate items in the register."
          }
        >
          <Fig v={fmt(compliance.holds)} l="HOLDS" tone={compliance.holds > 0 ? "red" : "green"} />
          <Fig v={fmt(compliance.dangerousGoods)} l="DANGEROUS GOODS" tone={compliance.dangerousGoods > 0 ? "amber" : undefined} />
          <Fig v={fmt(compliance.openItems)} l="OPEN REGISTER ITEMS" tone={gates > 0 ? "red" : compliance.openItems > 0 ? "amber" : "green"} />
          <Fig v={`${fmt(compliance.ceCertified)}/${fmt(compliance.productsTotal)}`} l="CE COVERAGE" />
        </OvPanel>

        {/* ---------- storefront preview (brass tier) ---------- */}
        <section className="cc-panel cc-ov-panel sf">
          <h2 className="cc-panel-h">
            <CcIcon name="logo" />
            STOREFRONT PREVIEW
          </h2>
          <div className="cc-ov-sfchips">
            <span className="cc-ov-sfchip live">HOME · LIVE</span>
            <span className="cc-ov-sfchip live">JIMMY (CUSTOMER) · LIVE</span>
            <span className="cc-ov-sfchip">GUIDES</span>
            <span className="cc-ov-sfchip">CATALOGUE</span>
            <span className="cc-ov-sfchip">KIT BUILDER</span>
            <span className="cc-ov-sfchip">TESTED REPORTS</span>
            <span className="cc-ov-sfchip">DASHBOARD</span>
          </div>
          <p className="cc-ov-statusline">
            2 pages live behind the gate, 5 coming online — graduates to the public site at launch.
          </p>
          <Link href="/admin/site/home" className="cc-ov-open sf">
            OPEN <span aria-hidden="true">→</span>
          </Link>
        </section>
      </div>

      {/* ---------- priority actions ---------- */}
      <section className="cc-panel cc-ov-actions">
        <h2 className="cc-panel-h">
          <CcIcon name="compliance" />
          PRIORITY ACTIONS
          <span className="right">COMPUTED LIVE · ORDERED BY SEVERITY</span>
        </h2>
        {actions.length === 0 ? (
          <p className="cc-ov-noactions">No open priority actions — all computed gates are clear.</p>
        ) : (
          <div className="cc-ov-actionlist">
            {actions.map((a, i) => (
              <Link key={i} href={a.href} className={`cc-ov-action ${a.tone}`}>
                <span className="dot" aria-hidden="true">
                  ●
                </span>
                <span className="tx">{a.label}</span>
                <span className="go" aria-hidden="true">
                  →
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <p className="cc-ov-foot">
        Data live from Supabase · deploys via GitHub → Vercel · SC 05 Platform
      </p>
    </main>
  );
}
