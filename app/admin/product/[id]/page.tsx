import Link from "next/link";
import { getProduct, getCategoryList } from "@/lib/data";
import { CcIcon } from "../../cc-chrome";
import ProductEditor from "../editor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ---------- helpers ---------- */

function firstImage(image_urls: any): string | null {
  if (!image_urls) return null;
  const m = String(image_urls).match(/https?:\/\/[^\s,"'\]]+/);
  return m ? m[0] : null;
}
function num(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function eur(v: number | null, currency?: string): string {
  if (v === null) return "—";
  const cur = currency || "EUR";
  return `${cur === "EUR" ? "€" : cur + " "}${v.toFixed(2)}`;
}
function scId(p: any): string {
  return p.sku || `SC-${String(p.id || "").slice(0, 8).toUpperCase()}`;
}
function displayName(p: any): string {
  return p.sc_product_name || p.product_name || p.example_product || "Unnamed product";
}

const STOCK_LABEL: Record<string, { label: string; tone: string }> = {
  in_stock: { label: "IN STOCK", tone: "green" },
  low_stock: { label: "LOW STOCK", tone: "amber" },
  out_of_stock: { label: "OUT OF STOCK", tone: "red" },
  discontinued: { label: "DISCONTINUED", tone: "red" },
  sourcing: { label: "SOURCING", tone: "muted" },
};

function statusChip(p: any): { label: string; tone: string } {
  if (p.product_status === "approved" || p.product_status === "listed") return { label: "ACTIVE", tone: "green" };
  if (p.product_status === "rejected" || p.product_status === "discontinued") return { label: "RETIRED", tone: "red" };
  if (p.product_status === "testing") return { label: "TESTING", tone: "amber" };
  const stage: Record<string, string> = {
    pending: "PENDING",
    product_identified: "IDENTIFIED",
    supplier_route_approved: "ROUTE OK",
  };
  return { label: stage[p.research_stage] || "DRAFT", tone: "muted" };
}
function complianceChip(p: any): { label: string; tone: string } {
  if (p.dangerous_goods) return { label: "COMPLIANCE HOLD", tone: "red" };
  if (p.needs_review) return { label: "IN REVIEW", tone: "amber" };
  if (p.product_status === "approved" || p.product_status === "listed") return { label: "COMPLIANCE CLEARED", tone: "green" };
  return { label: "COMPLIANCE PENDING", tone: "muted" };
}

/* ---------- page ---------- */

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [result, categories] = await Promise.all([getProduct(id), getCategoryList()]);

  if (!result) {
    return (
      <main className="cc-container">
        <div className="cc-notice">Data source not configured.</div>
      </main>
    );
  }
  const { product, routes, sources } = result;
  if (!product) {
    return (
      <main className="cc-container">
        <Link className="cc-back" href="/admin">← All Products</Link>
        <div className="cc-notice" style={{ marginTop: 16 }}>Product not found.</div>
      </main>
    );
  }

  const img = firstImage(product.image_urls);
  const st = statusChip(product);
  const comp = complianceChip(product);
  const supplierReady = (routes || []).length > 0;
  const primary =
    (routes || []).find((r: any) => r.role === "primary") ||
    (routes || [])[0] ||
    null;

  const wholesale = num(product.wholesale_price) ?? (primary ? num(primary.wholesale_price) : null);
  const landed = num(product.landed_cost);
  const sell = num(product.selling_price) ?? num(product.retail_price_rrp);
  const margin = sell !== null && landed !== null && sell > 0 ? ((sell - landed) / sell) * 100 : null;

  const stage = product.research_stage;
  const status = product.product_status;
  const researchDone = stage === "product_identified" || stage === "supplier_route_approved";
  const routeDone = stage === "supplier_route_approved";
  const approvedDone = status === "approved" || status === "listed";
  const liveDone = status === "listed";
  const steps: { label: string; state: "done" | "current" | "pending" }[] = [
    { label: "Research Complete", state: researchDone ? "done" : "current" },
    { label: "Route Approved", state: routeDone ? "done" : researchDone ? "current" : "pending" },
    { label: "Tested", state: "pending" },
    { label: "Approved", state: approvedDone ? "done" : "pending" },
    { label: "Live", state: liveDone ? "done" : approvedDone ? "current" : "pending" },
  ];

  const updated = product.updated_at
    ? new Date(product.updated_at).toLocaleString("en-GB", {
        year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : "—";

  return (
    <main className="cc-container">
      <Link className="cc-back" href="/admin">← All Products</Link>

      <div className="cc-detailgrid">
        {/* ---------- Hero ---------- */}
        <section className="cc-panel cc-span12">
          <div className="cc-hero">
            {img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="cc-heroimg" src={img} alt="" />
            ) : (
              <div className="cc-heroimg ph">NO IMAGE ON FILE</div>
            )}
            <div>
              <h1 className="cc-heroname">{displayName(product)}</h1>
              <div className="cc-herosub">
                STEALTHCRAFTER TESTED — <span className="id">{scId(product)}</span>
              </div>
              <div className="cc-chiprow">
                <span className={`cc-chip ${st.tone}`}>{st.label}</span>
                <span className="cc-chip muted plain">NO STOCK DATA</span>
                {supplierReady ? (
                  <span className="cc-chip cyan plain">SUPPLIER READY</span>
                ) : (
                  <span className="cc-chip muted plain">NO SUPPLIER ROUTE</span>
                )}
                <span className={`cc-chip ${comp.tone} plain`}>{comp.label}</span>
                {product.hero_product ? <span className="cc-chip cyan plain">HERO PRODUCT</span> : null}
              </div>
              <div className="cc-kv">
                <span className="k">StealthCrafter ID</span>
                <span className="v mono">{scId(product)}</span>
                <span className="k">SKU</span>
                <span className="v mono">{product.sku || "—"}</span>
                <span className="k">Category</span>
                <span className="v">{product.category || "—"}</span>
                <span className="k">Pillar</span>
                <span className="v">{product.pillar || "—"}</span>
                <span className="k">Type</span>
                <span className="v">{product.subcategory || product.product_type || "—"}</span>
                <span className="k">Brand</span>
                <span className="v">{product.brand || "—"}</span>
                <span className="k">Model</span>
                <span className="v">{product.model || "—"}</span>
              </div>
            </div>
            <div className="cc-suppliercard">
              <div className="sh">Current Supplier</div>
              <div className="sn">{primary?.supplier?.name || "No route on file"}</div>
              <div className="sm">
                {primary ? (
                  <>
                    {primary.role ? `${String(primary.role).toUpperCase()} ROUTE` : null}
                    {primary.ships_from_country ? ` · ships from ${primary.ships_from_country}` : null}
                    {primary.wholesale_price != null ? ` · ${eur(num(primary.wholesale_price), primary.currency)}` : null}
                    {primary.stock_status ? ` · ${STOCK_LABEL[primary.stock_status]?.label || primary.stock_status}` : null}
                  </>
                ) : (
                  "Assign a supplier route to make this item orderable."
                )}
              </div>
              <div className="sm">Last updated · {updated}</div>
            </div>
          </div>
        </section>

        {/* ---------- Stock overview ---------- */}
        <section className="cc-panel cc-span4">
          <div className="cc-panel-h"><CcIcon name="products" /> Stock Overview</div>
          <div className="cc-tiles">
            <div className="cc-tile"><div className="n dim">—</div><div className="l">On Hand</div></div>
            <div className="cc-tile"><div className="n dim">—</div><div className="l">Reserved</div></div>
            <div className="cc-tile"><div className="n dim">—</div><div className="l">Available</div></div>
            <div className="cc-tile"><div className="n dim">—</div><div className="l">Incoming</div></div>
          </div>
          <div className="cc-chiprow" style={{ marginBottom: 0 }}>
            <span className="cc-chip muted plain">NO STOCK DATA</span>
            {primary?.stock_status ? (
              <span className={`cc-chip ${STOCK_LABEL[primary.stock_status]?.tone || "muted"}`}>
                SUPPLIER: {STOCK_LABEL[primary.stock_status]?.label || primary.stock_status}
              </span>
            ) : null}
          </div>
          <div className="cc-notestrip">Inventory tracking comes online with the stock module.</div>
        </section>

        {/* ---------- Cost / pricing / margin ---------- */}
        <section className="cc-panel cc-span4">
          <div className="cc-panel-h"><CcIcon name="overview" /> Cost / Pricing / Margin</div>
          <div className="cc-moneyrows">
            <div className="cc-moneyrow"><span className="k">Supplier Cost ex VAT</span><span className="v">{eur(wholesale, product.currency)}</span></div>
            <div className="cc-moneyrow"><span className="k">Landed Cost</span><span className="v">{eur(landed, product.currency)}</span></div>
            <div className="cc-moneyrow"><span className="k">Sell Price</span><span className="v big">{eur(sell, product.currency)}</span></div>
            <div className="cc-moneyrow">
              <span className="k">Gross Margin</span>
              <span className={`v big ${margin !== null && margin >= 30 ? "green" : ""}`}>
                {margin === null ? "—" : `${margin.toFixed(1)}%`}
              </span>
            </div>
          </div>
          <div className="cc-marginbar">
            <div className="mlab"><span>Margin Visual</span><span>{margin === null ? "—" : `${margin.toFixed(1)}%`}</span></div>
            <div className="mt"><div className="mf" style={{ width: `${Math.min(100, Math.max(0, margin ?? 0))}%` }} /></div>
          </div>
        </section>

        {/* ---------- Testing / compliance ---------- */}
        <section className="cc-panel cc-span4">
          <div className="cc-panel-h"><CcIcon name="compliance" /> Testing / Compliance</div>
          <div className="cc-moneyrows">
            <div className="cc-moneyrow"><span className="k">Tested Report</span><span className="cc-chip muted plain">NOT TESTED</span></div>
            <div className="cc-moneyrow">
              <span className="k">CE Certified</span>
              {product.ce_certified ? <span className="cc-chip green plain">YES</span> : <span className="cc-chip muted plain">NO</span>}
            </div>
            <div className="cc-moneyrow">
              <span className="k">Dangerous Goods</span>
              {product.dangerous_goods ? <span className="cc-chip red plain">YES — HOLD</span> : <span className="cc-chip green plain">NO</span>}
            </div>
            <div className="cc-moneyrow">
              <span className="k">Safety Critical</span>
              {product.safety_critical ? <span className="cc-chip amber plain">YES</span> : <span className="cc-chip muted plain">NO</span>}
            </div>
          </div>
          {product.safety_notes ? (
            <div style={{ marginTop: 10 }}>
              <div className="cc-notelabel">Safety Notes</div>
              <div className="cc-noteblock">{product.safety_notes}</div>
            </div>
          ) : null}
          {product.certifications_notes ? (
            <div style={{ marginTop: 10 }}>
              <div className="cc-notelabel">Certifications</div>
              <div className="cc-noteblock">{product.certifications_notes}</div>
            </div>
          ) : null}
        </section>

        {/* ---------- Workflow pipeline ---------- */}
        <section className="cc-panel cc-span12">
          <div className="cc-panel-h"><CcIcon name="testing" /> Item Status / Workflow</div>
          <div className="cc-pipe">
            {steps.map((s) => (
              <div key={s.label} className={`cc-step ${s.state === "done" ? "done" : s.state === "current" ? "current" : ""}`}>
                <span className="dot">{s.state === "done" ? "✓" : s.state === "current" ? "●" : "○"}</span>
                <span className="sl">{s.label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ---------- Supplier routes ---------- */}
        <section className="cc-panel cc-span6">
          <div className="cc-panel-h">
            <CcIcon name="suppliers" /> Supplier
            <span className="right">{(routes || []).length} ROUTE{(routes || []).length === 1 ? "" : "S"}</span>
          </div>
          {(routes || []).length === 0 ? (
            <span className="cc-empty">No supplier route recorded for this item.</span>
          ) : (
            <div className="cc-routes">
              {(routes || []).map((r: any) => (
                <div className="cc-route" key={r.id || `${r.supplier_id}-${r.role}`}>
                  <span className="rn">{r.supplier?.name || "Unknown supplier"}</span>
                  <span className="cc-chip cyan plain">{String(r.role || "route").toUpperCase()}</span>
                  <span className="rm">
                    {r.ships_from_country ? `ships from ${r.ships_from_country}` : null}
                    {r.fulfilment_region ? ` · ${r.fulfilment_region}` : null}
                    {r.lead_time ? ` · ${r.lead_time}` : null}
                    {r.moq ? ` · MOQ ${r.moq}` : null}
                  </span>
                  {r.stock_status ? (
                    <span className={`cc-chip ${STOCK_LABEL[r.stock_status]?.tone || "muted"}`}>
                      {STOCK_LABEL[r.stock_status]?.label || r.stock_status}
                    </span>
                  ) : null}
                  <span className="rp">{r.wholesale_price != null ? eur(num(r.wholesale_price), r.currency) : "—"}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ---------- Notes ---------- */}
        <section className="cc-panel cc-span6">
          <div className="cc-panel-h"><CcIcon name="jimmy" /> Notes</div>
          <div>
            <div className="cc-notelabel">Internal Notes</div>
            <div className="cc-noteblock">{product.internal_notes || <span className="cc-empty">None.</span>}</div>
          </div>
          <div style={{ marginTop: 14 }}>
            <div className="cc-notelabel">Customer Notes</div>
            <div className="cc-noteblock">{product.customer_notes || <span className="cc-empty">None.</span>}</div>
          </div>
        </section>
      </div>

      {/* ---------- Full edit capability (existing editor, restyled via cc-embed) ---------- */}
      <details className="cc-editwrap">
        <summary>Edit Product Record</summary>
        <div className="cc-embed">
          <ProductEditor product={product} categories={categories} routes={routes} sources={sources} mode="edit" />
        </div>
      </details>
    </main>
  );
}
