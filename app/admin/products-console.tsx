"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CcIcon } from "./cc-chrome";

/* ---------- helpers ---------- */

function firstImage(image_urls: any): string | null {
  if (!image_urls) return null;
  const m = String(image_urls).match(/https?:\/\/[^\s,"'\]]+/);
  return m ? m[0] : null;
}
function displayName(p: any): string {
  return p.sc_product_name || p.product_name || p.example_product || "Unnamed product";
}
function num(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function sellPrice(p: any): number | null {
  return num(p.selling_price) ?? num(p.retail_price_rrp);
}
function costPrice(p: any): number | null {
  return num(p.landed_cost) ?? num(p.wholesale_price);
}
// Margin per spec: (price - landed_cost) / price * 100 when both exist.
function marginPct(p: any): number | null {
  const price = sellPrice(p);
  const cost = num(p.landed_cost);
  if (price === null || cost === null || price <= 0) return null;
  return ((price - cost) / price) * 100;
}
function eur(v: number | null, currency?: string): string {
  if (v === null) return "—";
  const cur = currency || "EUR";
  return `${cur === "EUR" ? "€" : cur + " "}${v.toFixed(2)}`;
}
function scId(p: any): string {
  return p.sku || `SC-${String(p.id || "").slice(0, 8).toUpperCase()}`;
}

const STAGE_LABEL: Record<string, string> = {
  pending: "PENDING",
  product_identified: "IDENTIFIED",
  supplier_route_approved: "ROUTE OK",
};
const STOCK_LABEL: Record<string, { label: string; tone: string }> = {
  in_stock: { label: "IN STOCK", tone: "green" },
  low_stock: { label: "LOW STOCK", tone: "amber" },
  out_of_stock: { label: "OUT OF STOCK", tone: "red" },
  discontinued: { label: "DISCONTINUED", tone: "red" },
  sourcing: { label: "SOURCING", tone: "muted" },
};

function complianceOf(p: any): { label: string; tone: string } {
  if (p.dangerous_goods) return { label: "HOLD", tone: "red" };
  if (p.needs_review) return { label: "IN REVIEW", tone: "amber" };
  if (p.product_status === "approved" || p.product_status === "listed")
    return { label: "CLEARED", tone: "green" };
  return { label: "PENDING", tone: "muted" };
}
function statusOf(p: any): { label: string; tone: string } {
  if (p.product_status === "approved" || p.product_status === "listed")
    return { label: "ACTIVE", tone: "green" };
  if (p.product_status === "rejected" || p.product_status === "discontinued")
    return { label: "RETIRED", tone: "red" };
  if (p.product_status === "testing") return { label: "TESTING", tone: "amber" };
  return { label: STAGE_LABEL[p.research_stage] || "PENDING", tone: "muted" };
}

function uniqSorted(vals: (string | null | undefined)[]): string[] {
  return Array.from(new Set(vals.filter((v): v is string => !!v))).sort((a, b) => a.localeCompare(b));
}

function csvCell(v: any): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/* ---------- component ---------- */

export default function ProductsConsole({ products }: { products: any[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [pillar, setPillar] = useState("");
  const [category, setCategory] = useState("");
  const [stage, setStage] = useState("");
  const [euSrc, setEuSrc] = useState("");
  const [status, setStatus] = useState("");
  const [conf, setConf] = useState("");
  const [sort, setSort] = useState("name");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const pillars = useMemo(() => uniqSorted(products.map((p) => p.pillar)), [products]);
  const categories = useMemo(() => uniqSorted(products.map((p) => p.category)), [products]);
  const statuses = useMemo(() => uniqSorted(products.map((p) => p.product_status)), [products]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = products.filter((p) => {
      if (pillar && p.pillar !== pillar) return false;
      if (category && p.category !== category) return false;
      if (stage && p.research_stage !== stage) return false;
      if (euSrc && (p.eu_sourcing || "unsourced") !== euSrc) return false;
      if (status && p.product_status !== status) return false;
      if (conf && p.research_confidence !== conf) return false;
      if (needle) {
        const hay = `${displayName(p)} ${p.brand || ""} ${p.example_product || ""} ${p.subcategory || ""} ${p.product_type || ""} ${p.sku || ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sort === "price") return (sellPrice(b) ?? -1) - (sellPrice(a) ?? -1);
      if (sort === "margin") return (marginPct(b) ?? -999) - (marginPct(a) ?? -999);
      if (sort === "newest")
        return String(b.created_at || "").localeCompare(String(a.created_at || ""));
      return displayName(a).localeCompare(displayName(b));
    });
    return list;
  }, [products, q, pillar, category, stage, euSrc, status, conf, sort]);

  const stats = useMemo(() => {
    const s = { total: filtered.length, finalised: 0, review: 0, hold: 0, supplier: 0, heroes: 0 };
    for (const p of filtered) {
      const approved = p.product_status === "approved" || p.product_status === "listed";
      if (approved && p.images_complete) s.finalised++;
      if (p.needs_review) s.review++;
      if (p.dangerous_goods) s.hold++;
      if ((p.supplier_count || 0) > 0) s.supplier++;
      if (p.hero_product) s.heroes++;
    }
    return s;
  }, [filtered]);

  // Snapshot: by pillar normally; by category when a single pillar is selected.
  const snapshot = useMemo(() => {
    const key = pillar ? "category" : "pillar";
    const counts: Record<string, number> = {};
    for (const p of filtered) {
      const k = p[key] || "Unassigned";
      counts[k] = (counts[k] || 0) + 1;
    }
    const total = filtered.length || 1;
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([label, n]) => ({ label, n, pct: (n / total) * 100 }));
  }, [filtered, pillar]);

  const quick = useMemo(() => {
    let mSum = 0;
    let mN = 0;
    let withSupplier = 0;
    let compliant = 0;
    for (const p of filtered) {
      const m = marginPct(p);
      if (m !== null) {
        mSum += m;
        mN++;
      }
      if ((p.supplier_count || 0) > 0) withSupplier++;
      if (complianceOf(p).label === "CLEARED") compliant++;
    }
    const total = filtered.length || 1;
    return {
      avgMargin: mN ? mSum / mN : null,
      supplierPct: (withSupplier / total) * 100,
      compliancePct: (compliant / total) * 100,
    };
  }, [filtered]);

  const priority = useMemo(() => {
    let review = 0;
    let hold = 0;
    let noImage = 0;
    let noRoute = 0;
    for (const p of filtered) {
      if (p.needs_review) review++;
      if (p.dangerous_goods) hold++;
      if (!firstImage(p.image_urls)) noImage++;
      if ((p.supplier_count || 0) === 0) noRoute++;
    }
    return { review, hold, noImage, noRoute };
  }, [filtered]);

  const selected = useMemo(
    () => (selectedId ? products.find((p) => p.id === selectedId) || null : null),
    [products, selectedId]
  );

  function exportCsv() {
    const header = [
      "sc_id", "name", "brand", "pillar", "category", "type", "research_stage", "eu_sourcing", "product_status",
      "confidence", "needs_review", "dangerous_goods", "hero", "supplier_count", "primary_supplier",
      "stock_status", "cost", "sell_price", "margin_pct",
    ];
    const rows = filtered.map((p) => [
      scId(p), displayName(p), p.brand, p.pillar, p.category, p.subcategory || p.product_type,
      p.research_stage, p.eu_sourcing || "unsourced", p.product_status, p.research_confidence,
      p.needs_review ? "yes" : "no", p.dangerous_goods ? "yes" : "no", p.hero_product ? "yes" : "no",
      p.supplier_count || 0, p.primary_route?.supplier_name || "",
      p.primary_route?.stock_status || "", costPrice(p) ?? "", sellPrice(p) ?? "",
      marginPct(p) !== null ? marginPct(p)!.toFixed(1) : "",
    ]);
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stealthcrafter-products-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const title = pillar ? `${pillar} Products` : "All Products";
  const subtitle = pillar
    ? `Category overview — ${categories.filter((c) => filtered.some((p) => p.category === c)).slice(0, 4).join(", ").toLowerCase() || "no matching items"}`
    : "Full catalogue across all pillars — live from Supabase";

  return (
    <div className="cc-products">
      {/* ---------- main column ---------- */}
      <div>
        <div className="cc-modhead">
          <span className="cc-modicon">
            <CcIcon name="products" size={22} />
          </span>
          <div>
            <h1>{title}</h1>
            <div className="sub">{subtitle}</div>
          </div>
        </div>

        <div className="cc-stats">
          <div className="cc-stat"><div className="n">{stats.total}</div><div className="l">Total Products</div></div>
          <div className="cc-stat green"><div className="n">{stats.finalised}</div><div className="l">Finalised</div></div>
          <div className="cc-stat amber"><div className="n">{stats.review}</div><div className="l">Under Review</div></div>
          <div className="cc-stat red"><div className="n">{stats.hold}</div><div className="l">Compliance Hold</div></div>
          <div className="cc-stat cyan"><div className="n">{stats.supplier}</div><div className="l">Supplier Ready</div></div>
          <div className="cc-stat cyan"><div className="n">{stats.heroes}</div><div className="l">Heroes</div></div>
        </div>

        <div className="cc-controls">
          <input
            type="search"
            placeholder="Search products, brands, SKUs…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select value={pillar} onChange={(e) => { setPillar(e.target.value); setCategory(""); }}>
            <option value="">All pillars</option>
            {pillars.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">Any stage</option>
            <option value="pending">Pending</option>
            <option value="product_identified">Identified</option>
            <option value="supplier_route_approved">Route approved</option>
          </select>
          <select value={euSrc} onChange={(e) => setEuSrc(e.target.value)} title="EU sourcing — supply axis (SC 11), separate from research stage">
            <option value="">Any EU sourcing</option>
            <option value="unsourced">Unsourced</option>
            <option value="wholesaler_available">Wholesaler-available</option>
            <option value="trade_confirmed">Trade-confirmed</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={conf} onChange={(e) => setConf(e.target.value)}>
            <option value="">Any confidence</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="name">Sort: name</option>
            <option value="newest">Sort: newest</option>
            <option value="price">Sort: price</option>
            <option value="margin">Sort: margin</option>
          </select>
          <button className="cc-btn" onClick={exportCsv}>Export</button>
          <Link className="cc-btn primary" href="/admin/product/new">+ Add Product</Link>
        </div>

        <p className="cc-prodsub" style={{ margin: "0 0 10px" }}>
          SHOWING <span className="cc-num">{filtered.length}</span> OF{" "}
          <span className="cc-num">{products.length}</span> RECORDS · DATA SYNC LIVE
        </p>

        <div className="cc-tablewrap">
          <table className="cc-table">
            <thead>
              <tr>
                <th style={{ width: 30 }}></th>
                <th style={{ width: 46 }}></th>
                <th>Product</th>
                <th>SC ID</th>
                <th>Type</th>
                <th>Tested</th>
                <th>Stock Status</th>
                <th>Supplier Ready</th>
                <th>Compliance</th>
                <th>Cost</th>
                <th>Sell Price</th>
                <th>Margin %</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const img = firstImage(p.image_urls);
                const comp = complianceOf(p);
                const st = statusOf(p);
                const m = marginPct(p);
                const stock = p.primary_route?.stock_status
                  ? STOCK_LABEL[p.primary_route.stock_status] || { label: String(p.primary_route.stock_status).toUpperCase(), tone: "muted" }
                  : null;
                return (
                  <tr
                    key={p.id}
                    className={selectedId === p.id ? "sel" : ""}
                    onClick={() => router.push(`/admin/product/${p.id}`)}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedId === p.id}
                        onChange={() => setSelectedId(selectedId === p.id ? null : p.id)}
                        aria-label="Select for preview"
                      />
                    </td>
                    <td>
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="cc-thumb" src={img} alt="" />
                      ) : (
                        <span className="cc-thumb ph">—</span>
                      )}
                    </td>
                    <td style={{ whiteSpace: "normal", minWidth: 200 }}>
                      <div className="cc-prodname">
                        {displayName(p)}
                        {p.hero_product ? <span className="cc-chip cyan plain" style={{ marginLeft: 8 }}>HERO</span> : null}
                        {p.eu_sourcing === "wholesaler_available" ? <span className="cc-chip amber plain" style={{ marginLeft: 8 }} title="EU wholesaler carries it — no trade account yet">EU-SOURCED</span> : null}
                        {p.eu_sourcing === "trade_confirmed" ? <span className="cc-chip green plain" style={{ marginLeft: 8 }} title="Trade account open / real landed cost">TRADE</span> : null}
                      </div>
                      {p.brand ? <div className="cc-prodsub">{p.brand}</div> : null}
                    </td>
                    <td className="cc-id">{scId(p)}</td>
                    <td className="cc-prodsub">{p.subcategory || p.product_type || "—"}</td>
                    <td><span className="cc-chip muted plain">NOT TESTED</span></td>
                    <td>{stock ? <span className={`cc-chip ${stock.tone}`}>{stock.label}</span> : <span className="cc-empty">—</span>}</td>
                    <td>
                      {(p.supplier_count || 0) > 0 ? (
                        <span className="cc-chip green plain">SUPPLIER READY</span>
                      ) : (
                        <span className="cc-chip muted plain">NO ROUTE</span>
                      )}
                    </td>
                    <td><span className={`cc-chip ${comp.tone} plain`}>{comp.label}</span></td>
                    <td className="cc-num">{eur(costPrice(p), p.currency)}</td>
                    <td className="cc-num">{eur(sellPrice(p), p.currency)}</td>
                    <td className={`cc-num ${m === null ? "" : m >= 40 ? "green" : m >= 20 ? "amber" : "red"}`}>
                      {m === null ? "—" : `${m.toFixed(1)}%`}
                    </td>
                    <td><span className={`cc-chip ${st.tone}`}>{st.label}</span></td>
                  </tr>
                );
              })}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={13} className="cc-empty" style={{ padding: 24, cursor: "default" }}>
                    No products match these filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---------- right sidebar ---------- */}
      <aside className="cc-side">
        <div className="cc-panel">
          <div className="cc-panel-h">
            <CcIcon name="products" />
            {pillar ? `${pillar} Snapshot` : "Category Snapshot"}
            <span className="right">{pillar ? "BY CATEGORY" : "BY PILLAR"}</span>
          </div>
          <div className="cc-bars">
            {snapshot.map((r) => (
              <div className="cc-barrow" key={r.label}>
                <span className="bl">{r.label}</span>
                <span className="bt"><span className="bf" style={{ width: `${r.pct}%` }} /></span>
                <span className="bn">{r.n}</span>
                <span className="bp">{r.pct.toFixed(1)}%</span>
              </div>
            ))}
            {snapshot.length === 0 ? <span className="cc-empty">No data.</span> : null}
          </div>
          <div className="cc-meter">
            <span>
              AVG MARGIN
              <span className="mt"><span className="mf" style={{ width: `${Math.min(100, Math.max(0, quick.avgMargin ?? 0))}%` }} /></span>
            </span>
            <span className="mv">{quick.avgMargin === null ? "—" : `${quick.avgMargin.toFixed(1)}%`}</span>
          </div>
          <div className="cc-meter">
            <span>
              SUPPLIER COVERAGE
              <span className="mt"><span className="mf" style={{ width: `${quick.supplierPct}%` }} /></span>
            </span>
            <span className="mv">{quick.supplierPct.toFixed(0)}%</span>
          </div>
          <div className="cc-meter">
            <span>
              COMPLIANCE COMPLETE
              <span className="mt"><span className="mf" style={{ width: `${quick.compliancePct}%` }} /></span>
            </span>
            <span className="mv">{quick.compliancePct.toFixed(0)}%</span>
          </div>
        </div>

        <div className="cc-panel">
          <div className="cc-panel-h">
            <CcIcon name="compliance" />
            Priority Actions
          </div>
          <div className="cc-actions">
            <div className="cc-actionrow amber"><span className="cnt">{priority.review}</span> Items under review</div>
            <div className="cc-actionrow red"><span className="cnt">{priority.hold}</span> Compliance holds (dangerous goods)</div>
            <div className="cc-actionrow cyan"><span className="cnt">{priority.noImage}</span> Products without images</div>
            <div className="cc-actionrow cyan"><span className="cnt">{priority.noRoute}</span> Products without a supplier route</div>
          </div>
        </div>

        <div className="cc-panel">
          <div className="cc-panel-h">
            <CcIcon name="overview" />
            Selected Product Preview
          </div>
          {selected ? (
            <>
              <div className="cc-preview">
                {firstImage(selected.image_urls) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={firstImage(selected.image_urls)!} alt="" />
                ) : (
                  <span className="ph">NO IMAGE</span>
                )}
                <div style={{ minWidth: 0 }}>
                  <div className="pv-name">{displayName(selected)}</div>
                  <div className="pv-id">{scId(selected)}</div>
                  <span className={`cc-chip ${statusOf(selected).tone}`}>{statusOf(selected).label}</span>
                </div>
              </div>
              <div className="cc-kvmini" style={{ marginTop: 12 }}>
                <span className="k">Margin</span>
                <span className="v">{marginPct(selected) === null ? "—" : `${marginPct(selected)!.toFixed(1)}%`}</span>
                <span className="k">Supplier</span>
                <span className="v">{selected.primary_route?.supplier_name || "—"}</span>
                <span className="k">Stock</span>
                <span className="v">{selected.primary_route?.stock_status ? (STOCK_LABEL[selected.primary_route.stock_status]?.label || selected.primary_route.stock_status) : "NO STOCK DATA"}</span>
                <span className="k">Compliance</span>
                <span className="v">{complianceOf(selected).label}</span>
              </div>
              <div className="cc-prevbtns">
                <Link className="cc-btn" href={`/admin/product/${selected.id}`}>View Item</Link>
                <Link className="cc-btn ghost" href={`/admin/product/${selected.id}`}>View Dossier</Link>
              </div>
            </>
          ) : (
            <span className="cc-empty">Tick a row to preview a product here.</span>
          )}
        </div>
      </aside>
    </div>
  );
}
