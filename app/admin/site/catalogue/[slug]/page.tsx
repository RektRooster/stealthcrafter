import Link from "next/link";
import { notFound } from "next/navigation";
import { EVIDENCE_META, fmtEur, getProductBySlug, toEur } from "@/lib/catalogue-data";
import type { ProductDetail } from "@/lib/catalogue-data";

export const dynamic = "force-dynamic";

/* A row in the evidence ledger: verified, not yet checked, or a flag raised. */
type Verdict = "yes" | "no" | "unknown" | "flag";

function Row({ label, verdict, detail }: { label: string; verdict: Verdict; detail: string }) {
  const mark = verdict === "yes" ? "✓" : verdict === "flag" ? "!" : verdict === "no" ? "×" : "–";
  return (
    <div className={`sf-led v-${verdict}`}>
      <span className="sf-ledmark" aria-hidden="true">{mark}</span>
      <span className="sf-ledlabel">{label}</span>
      <span className="sf-leddetail">{detail}</span>
    </div>
  );
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p: ProductDetail | null = await getProductBySlug(slug);
  if (!p) notFound();

  const meta = EVIDENCE_META[p.state];
  const price = toEur(p.price, p.currency);
  const askJimmy = `/admin/site/jimmy?q=${encodeURIComponent(
    `I am looking at ${p.name}${p.brand ? ` by ${p.brand}` : ""}. Is it right for my household, and what should I know before buying it?`
  )}`;

  return (
    <main className="sf-page">
      <div className="sf-catwrap">
        <Link href="/admin/site/catalogue" className="sf-back">
          ← Catalogue
        </Link>

        <div className="sf-pdp">
          <div className="sf-pdpmedia">
            {p.imagesAll.length ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.imagesAll[0]} alt="" className="sf-pdpimg" />
            ) : (
              <div className="sf-pdpnoimg">No image yet</div>
            )}
            {p.imagesAll.length > 1 && (
              <div className="sf-pdpthumbs">
                {p.imagesAll.slice(1, 6).map((u) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={u} src={u} alt="" decoding="async" />
                ))}
              </div>
            )}
          </div>

          <div className="sf-pdpinfo">
            <span className={`sf-state t-${meta.tone} big`}>{meta.label}</span>
            {p.brand && <div className="sf-pdpbrand">{p.brand}</div>}
            <h1>{p.name}</h1>
            <div className="sf-pdpcat">
              {p.category}
              {p.subcategory ? ` · ${p.subcategory}` : ""}
              {p.pillar ? ` · ${p.pillar}` : ""}
            </div>

            <p className="sf-pdpstate">{meta.blurb}</p>

            {p.summary && <p className="sf-pdpsummary">{p.summary}</p>}

            <div className="sf-buybox">
              <div className="sf-buyprice">
                <strong>{fmtEur(price)}</strong>
                <span>
                  {p.priceBasis === "rrp"
                    ? "Based on manufacturer RRP"
                    : p.priceBasis === "landed_x2_2" || p.priceBasis === "wholesale_x2_6"
                    ? "Derived from our supplier cost"
                    : "Indicative — no supplier cost on file yet"}
                </span>
              </div>
              <div className="sf-buyactions">
                {/* A product that has earned its place shows a live-looking
                    basket button. It does nothing yet — the basket is SC 06 and
                    SC 08's ground, not ours — but this is a gated demo whose job
                    is to show the shop as it will ship, and a permanently greyed
                    primary action misrepresents that as much as a fake price
                    would. A product that has NOT earned its place still says so
                    plainly, and that button really is disabled. */}
                <button
                  type="button"
                  className={`sf-cta sm${p.state === "listed" ? "" : " off"}`}
                  disabled={p.state !== "listed"}
                >
                  {p.state === "listed" ? "Add to basket" : "Not yet available"}
                </button>
                <Link href={askJimmy} className="sf-buyask">
                  Ask Jimmy if this suits my household →
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* ---------------- the evidence ledger ---------------- */}
        <section className="sf-ledger">
          <h2>What we know, and what we haven&apos;t checked</h2>
          <p className="sf-ledgerlede">
            Every line here is read from our own records. Where we have not verified something, it
            says so rather than staying quiet.
          </p>

          <Row
            label="Tested by StealthCrafter"
            verdict={p.tested ? "yes" : "unknown"}
            detail={
              p.tested
                ? "We have run this through a test session."
                : "Not yet tested. No StealthCrafter test session has been completed for this product."
            }
          />
          <Row
            label="Product review"
            verdict={
              p.productStatus === "approved" || p.productStatus === "listed"
                ? "yes"
                : p.productStatus === "rejected"
                ? "no"
                : "unknown"
            }
            detail={
              p.productStatus === "approved" || p.productStatus === "listed"
                ? "Cleared our internal product review."
                : p.productStatus === "rejected"
                ? "Assessed and rejected. We are not carrying it."
                : "In review."
            }
          />
          <Row
            label="Supply route"
            verdict={p.routes > 0 ? "yes" : "unknown"}
            detail={
              p.routes > 0
                ? `${p.routes} supplier ${p.routes === 1 ? "route" : "routes"} traced.`
                : "Supply route under negotiation."
            }
          />
          <Row
            label="EU sourcing"
            verdict={
              p.euSourcing === "trade_confirmed"
                ? "yes"
                : p.euSourcing === "wholesaler_available"
                ? "yes"
                : "unknown"
            }
            detail={
              p.euSourcing === "trade_confirmed"
                ? "Trade account confirmed with an EU supplier."
                : p.euSourcing === "wholesaler_available"
                ? "An EU wholesaler is available; trade account not yet opened."
                : "No EU supply route confirmed."
            }
          />
          <Row
            label="CE certification"
            verdict={p.ce ? "yes" : "unknown"}
            detail={
              p.ce
                ? `CE certified.${p.certificationsNotes ? ` ${p.certificationsNotes}` : ""}`
                : "No CE marking on file for this item."
            }
          />
          {p.safetyCritical && (
            <Row
              label="Safety critical"
              verdict="flag"
              detail={
                p.safetyNotes ||
                "Flagged safety critical: failure of this item could put someone at risk. It requires a completed test session before we will sell it."
              }
            />
          )}
          {p.dangerousGoods && (
            <Row
              label="Dangerous goods"
              verdict="flag"
              detail={
                p.shippingRestrictions ||
                "Classified as dangerous goods. Carriage is restricted and compliance sign-off is required before listing."
              }
            />
          )}
          {p.ageRestricted && (
            <Row label="Age restricted" verdict="flag" detail="Sale of this item is age restricted." />
          )}
        </section>

        <div className="sf-pdpcols">
          {p.specs.length > 0 && (
            <section className="sf-panel">
              <h3>Specification</h3>
              <dl className="sf-spec">
                {p.specs.map((s) => (
                  <div key={s.label}>
                    <dt>{s.label}</dt>
                    <dd>{s.value}</dd>
                  </div>
                ))}
                {p.manufacturer && (
                  <div>
                    <dt>Manufacturer</dt>
                    <dd>{p.manufacturer}</dd>
                  </div>
                )}
                {p.countryOfManufacture && (
                  <div>
                    <dt>Made in</dt>
                    <dd>{p.countryOfManufacture}</dd>
                  </div>
                )}
                {p.warranty && (
                  <div>
                    <dt>Warranty</dt>
                    <dd>{p.warranty}</dd>
                  </div>
                )}
                {p.sku && (
                  <div>
                    <dt>SKU</dt>
                    <dd>{p.sku}</dd>
                  </div>
                )}
              </dl>
            </section>
          )}

          <section className="sf-panel">
            <h3>Supply</h3>
            {p.routeList.length ? (
              <ul className="sf-routes">
                {p.routeList.map((r, i) => (
                  <li key={`${r.supplier}-${i}`}>
                    <strong>{r.supplier}</strong>
                    <span>
                      {[r.role?.replace(/_/g, " "), r.shipsFrom, r.region, r.stock?.replace(/_/g, " ")]
                        .filter(Boolean)
                        .join(" · ") || "No detail recorded"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sf-panelempty">
                No supplier route on file. Until there is one, we could not actually get this to you.
              </p>
            )}
          </section>

          {(p.description || p.includedContents) && (
            <section className="sf-panel">
              <h3>Detail</h3>
              {p.description && <p className="sf-panelbody">{p.description}</p>}
              {p.includedContents && (
                <>
                  <h4>In the box</h4>
                  <p className="sf-panelbody">{p.includedContents}</p>
                </>
              )}
            </section>
          )}
        </div>

      </div>
    </main>
  );
}
