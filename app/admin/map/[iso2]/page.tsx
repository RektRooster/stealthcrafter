import Link from "next/link";
import { notFound } from "next/navigation";
import { CcIcon } from "../../cc-chrome";
import { flagEmoji } from "@/lib/flags";
import { getCountryMini } from "@/lib/eu-map";
import { getCountryDetail, getCountryMarket } from "@/lib/map-data";
import CountryEditor from "./country-editor";

export const dynamic = "force-dynamic";

const STATUS_CHIP: Record<string, { label: string; tone: string }> = {
  active: { label: "ACTIVE MARKET", tone: "cyan" },
  supplier_ready: { label: "SUPPLIER READY", tone: "green" },
  researching: { label: "RESEARCHING", tone: "amber" },
  compliance_hold: { label: "COMPLIANCE HOLD", tone: "red" },
};

const PRODUCT_CHIP_LIMIT = 36;

export default async function CountryProfilePage({
  params,
}: {
  params: Promise<{ iso2: string }>;
}) {
  const { iso2: raw } = await params;
  const iso2 = String(raw || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(iso2)) notFound();

  let market = null;
  let detail = null;
  let loadError: string | null = null;
  try {
    [market, detail] = await Promise.all([getCountryMarket(iso2), getCountryDetail(iso2)]);
  } catch (e: any) {
    loadError = e?.message || String(e);
  }

  if (loadError || detail === null) {
    return (
      <main className="cc-container">
        <div className="cc-notice">
          <strong>Country profile is offline.</strong>{" "}
          {loadError || "Supabase is not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."}
        </div>
      </main>
    );
  }
  if (!market) notFound();

  const mini = getCountryMini(iso2);
  const chip = STATUS_CHIP[market.market_status] || { label: market.market_status.toUpperCase(), tone: "muted" };
  const approved = detail.suppliers.filter((s) => s.trade_account);
  const pending = detail.suppliers.length - approved.length;
  const heroes = detail.products.filter((p) => p.hero);
  const shownProducts = detail.products.slice(0, PRODUCT_CHIP_LIMIT);
  const compliance =
    market.market_status === "compliance_hold" ? "HOLD" : market.compliance_notes ? "REVIEWED" : "NOT REVIEWED";

  return (
    <main className="cc-container">
      <Link className="cc-back" href="/admin/map">
        ← EU MAP <span style={{ opacity: 0.6 }}>/</span> {market.name.toUpperCase()}
      </Link>

      <div className="cc-detailgrid">
        {/* ---------- header ---------- */}
        <div className="cc-panel cc-span12">
          <div className="cc-map-profilehead">
            {mini ? (
              <div className="cc-map-mini">
                <svg viewBox={`0 0 ${mini.width} ${mini.height}`} role="img" aria-label={`${market.name} map`}>
                  <path d={mini.d} />
                </svg>
              </div>
            ) : null}
            <div style={{ minWidth: 0, flex: 1 }}>
              <h1 className="cc-heroname">
                <span style={{ marginRight: 10 }}>{flagEmoji(iso2)}</span>
                {market.name}
              </h1>
              <div className="cc-herosub">
                EU MEMBER STATE · <span className="id">{iso2}</span>
              </div>
              <div className="cc-chiprow">
                <span className={`cc-chip ${chip.tone}`}>{chip.label}</span>
                {market.priority ? <span className="cc-chip amber plain">PRIORITY MARKET</span> : null}
                {market.favourite ? <span className="cc-chip cyan plain">★ FAVOURITE</span> : null}
                {detail.suppliers.length > 0 ? (
                  <span className="cc-chip green plain">SUPPLIER PRESENCE</span>
                ) : (
                  <span className="cc-chip muted plain">NO SUPPLIERS YET</span>
                )}
              </div>
              <div className="cc-tiles" style={{ marginTop: 14 }}>
                <div className="cc-tile">
                  <div className={`n${market.market_readiness === null ? " dim" : ""}`}>
                    {market.market_readiness === null ? "—" : `${market.market_readiness}%`}
                  </div>
                  <div className="l">{market.market_readiness === null ? "Not Assessed" : "Market Readiness"}</div>
                </div>
                <div className="cc-tile">
                  <div className="n">{detail.suppliers.length}</div>
                  <div className="l">Suppliers · {detail.routeCount} routes</div>
                </div>
                <div className="cc-tile">
                  <div className={`n${compliance === "NOT REVIEWED" ? " dim" : ""}`} style={{ fontSize: 15, paddingTop: 4 }}>
                    {compliance}
                  </div>
                  <div className="l">Compliance</div>
                </div>
                <div className="cc-tile">
                  <div className={`n${market.shipping_notes ? "" : " dim"}`} style={{ fontSize: 12.5, paddingTop: 6, lineHeight: 1.4 }}>
                    {market.shipping_notes || "—"}
                  </div>
                  <div className="l">Shipping Route</div>
                </div>
                <div className="cc-tile">
                  <div className="n" style={{ fontSize: 14, paddingTop: 4 }}>{market.languages || "—"}</div>
                  <div className="l">Languages</div>
                </div>
                <div className="cc-tile">
                  <div className="n" style={{ fontSize: 16, paddingTop: 3 }}>{market.currency || "—"}</div>
                  <div className="l">Currency</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ---------- products ---------- */}
        <div className="cc-panel cc-span8">
          <div className="cc-panel-h">
            <CcIcon name="products" />
            Products Covered From {market.name}
            <span className="right">
              {detail.productCount} PRODUCTS · {heroes.length} HEROES
            </span>
          </div>
          {detail.productCount === 0 ? (
            <span className="cc-empty">No supplier routes ship from {market.name} yet.</span>
          ) : (
            <>
              <div className="cc-chiprow" style={{ margin: 0 }}>
                {shownProducts.map((p) => (
                  <Link key={p.id} href={`/admin/product/${p.id}`} style={{ textDecoration: "none" }}>
                    <span className={`cc-chip ${p.hero ? "cyan" : "muted"} plain`}>
                      {p.hero ? "★ " : ""}
                      {p.name}
                    </span>
                  </Link>
                ))}
              </div>
              {detail.productCount > shownProducts.length ? (
                <div className="cc-prodsub" style={{ marginTop: 10 }}>
                  + {detail.productCount - shownProducts.length} more — open the Products module for the full list.
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* ---------- suppliers ---------- */}
        <div className="cc-panel cc-span4">
          <div className="cc-panel-h">
            <CcIcon name="suppliers" />
            Suppliers
            <span className="right">
              {approved.length} APPROVED · {pending} PENDING
            </span>
          </div>
          {detail.suppliers.length === 0 ? (
            <span className="cc-empty">No suppliers registered in {market.name} yet.</span>
          ) : (
            <div className="cc-chiprow" style={{ margin: 0 }}>
              {detail.suppliers.map((s) => (
                <span key={s.id} className={`cc-chip ${s.trade_account ? "green" : "muted"}`}>
                  {s.name}
                  {s.trade_account ? " · TRADE" : ""}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* ---------- compliance ---------- */}
        <div className="cc-panel cc-span6" id="compliance">
          <div className="cc-panel-h">
            <CcIcon name="compliance" />
            Compliance
            <span className="right">{compliance}</span>
          </div>
          {market.compliance_notes ? (
            <div className="cc-noteblock">{market.compliance_notes}</div>
          ) : (
            <span className="cc-empty">No compliance review recorded yet.</span>
          )}
        </div>

        {/* ---------- market insights ---------- */}
        <div className="cc-panel cc-span6">
          <div className="cc-panel-h">
            <CcIcon name="overview" />
            Market Insights
          </div>
          {market.notes ? (
            <div className="cc-noteblock">{market.notes}</div>
          ) : (
            <span className="cc-empty">No market notes recorded yet.</span>
          )}
        </div>

        {/* ---------- region coverage ---------- */}
        <div className="cc-panel cc-span6">
          <div className="cc-panel-h">
            <CcIcon name="map" />
            Region Coverage
          </div>
          <div className="cc-notestrip">REGION DATA COMES ONLINE LATER</div>
        </div>

        {/* ---------- recent activity ---------- */}
        <div className="cc-panel cc-span6">
          <div className="cc-panel-h">
            <CcIcon name="testing" />
            Recent Activity
          </div>
          <div className="cc-notestrip">ACTIVITY FEED COMES ONLINE WITH THE AUDIT LOG</div>
          {market.updated_at ? (
            <div className="cc-prodsub" style={{ marginTop: 10 }}>
              Market record last updated {new Date(market.updated_at).toLocaleString("en-GB")}
            </div>
          ) : null}
        </div>

        {/* ---------- edit ---------- */}
        <div className="cc-panel cc-span12">
          <div className="cc-panel-h">
            <CcIcon name="settings" />
            Edit Market
            <span className="right">FOUNDER ACCESS</span>
          </div>
          <CountryEditor market={market} />
        </div>
      </div>
    </main>
  );
}
