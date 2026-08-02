"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

function firstImage(image_urls: any): string | null {
  if (!image_urls) return null;
  const m = String(image_urls).match(/https?:\/\/[^\s,"'\]]+/);
  return m ? m[0] : null;
}

function displayName(p: any): string {
  return p.sc_product_name || p.product_name || p.example_product || "Unnamed product";
}

function money(p: any): string {
  const v = p.landed_cost ?? p.wholesale_price;
  if (v === null || v === undefined || v === "") return "—";
  const cur = p.currency || "EUR";
  return `${cur === "EUR" ? "€" : cur + " "}${Number(v).toFixed(2)}`;
}

const STAGE_LABEL: Record<string, string> = {
  pending: "unresearched",
  product_identified: "identified",
  supplier_route_approved: "route approved",
};

function uniqSorted(vals: (string | null | undefined)[]): string[] {
  return Array.from(new Set(vals.filter((v): v is string => !!v))).sort((a, b) => a.localeCompare(b));
}

export default function CatalogueBrowser({ products }: { products: any[] }) {
  const [q, setQ] = useState("");
  const [pillar, setPillar] = useState("");
  const [category, setCategory] = useState("");
  const [stage, setStage] = useState("");
  const [status, setStatus] = useState("");
  const [review, setReview] = useState(false);
  const [sort, setSort] = useState("category");

  const pillars = useMemo(() => uniqSorted(products.map((p) => p.pillar)), [products]);
  const categories = useMemo(() => uniqSorted(products.map((p) => p.category)), [products]);
  const statuses = useMemo(() => uniqSorted(products.map((p) => p.product_status)), [products]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = products.filter((p) => {
      if (pillar && p.pillar !== pillar) return false;
      if (category && p.category !== category) return false;
      if (stage && p.research_stage !== stage) return false;
      if (status && p.product_status !== status) return false;
      if (review && !p.needs_review) return false;
      if (needle) {
        const hay = `${displayName(p)} ${p.brand || ""} ${p.example_product || ""} ${p.subcategory || ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sort === "name") return displayName(a).localeCompare(displayName(b));
      if (sort === "price") return (Number(b.landed_cost ?? b.wholesale_price ?? 0)) - (Number(a.landed_cost ?? a.wholesale_price ?? 0));
      // default: category then name
      return (a.category || "").localeCompare(b.category || "") || displayName(a).localeCompare(displayName(b));
    });
    return list;
  }, [products, q, pillar, category, stage, status, review, sort]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      total: products.length,
      approved: 0,
      route: 0,
      identified: 0,
      pending: 0,
      review: 0,
    };
    for (const p of products) {
      if (p.product_status === "approved") c.approved++;
      if (p.research_stage === "supplier_route_approved") c.route++;
      if (p.research_stage === "product_identified") c.identified++;
      if (p.research_stage === "pending") c.pending++;
      if (p.needs_review) c.review++;
    }
    return c;
  }, [products]);

  const activeFilters = Boolean(q || pillar || category || stage || status || review);

  function reset() {
    setQ("");
    setPillar("");
    setCategory("");
    setStage("");
    setStatus("");
    setReview(false);
  }

  return (
    <>
      <div className="statgrid">
        <div className="stat"><div className="n">{counts.total}</div><div className="l">Total products</div></div>
        <div className="stat"><div className="n">{counts.pending}</div><div className="l">Unresearched</div></div>
        <div className="stat"><div className="n">{counts.identified + counts.route}</div><div className="l">Researched</div></div>
        <div className="stat"><div className="n">{counts.approved}</div><div className="l">Approved</div></div>
        <div className="stat"><div className="n">{counts.review}</div><div className="l">Needs review</div></div>
      </div>

      <div className="filters">
        <input
          className="f-search"
          type="search"
          placeholder="Search name, brand, subcategory…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={pillar} onChange={(e) => setPillar(e.target.value)}>
          <option value="">All pillars</option>
          {pillars.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={stage} onChange={(e) => setStage(e.target.value)}>
          <option value="">Any stage</option>
          <option value="pending">Unresearched</option>
          <option value="product_identified">Identified</option>
          <option value="supplier_route_approved">Route approved</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="category">Sort: category</option>
          <option value="name">Sort: name</option>
          <option value="price">Sort: buy price</option>
        </select>
        <label className="f-check">
          <input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} />
          Needs review only
        </label>
        {activeFilters ? <button className="f-reset" onClick={reset}>Clear</button> : null}
        <Link className="f-new" href="/admin/product/new">+ New product</Link>
      </div>

      <p className="subtle showing">
        Showing <strong>{filtered.length}</strong> of {products.length} · live from Supabase
      </p>

      <table className="cat">
        <thead>
          <tr>
            <th style={{ width: 52 }}></th>
            <th>Product</th>
            <th>Pillar</th>
            <th>Category</th>
            <th>Buy price</th>
            <th>Conf.</th>
            <th>Stage</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((p) => {
            const img = firstImage(p.image_urls);
            return (
              <tr key={p.id}>
                <td>
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="thumb" src={img} alt="" />
                  ) : (
                    <span className="thumb ph">—</span>
                  )}
                </td>
                <td>
                  <Link className="name" href={`/admin/product/${p.id}`}>{displayName(p)}</Link>
                  {p.brand ? <span className="subtle"> · {p.brand}</span> : null}
                  {p.hero_product ? <span className="badge approved" style={{ marginLeft: 6 }}>hero</span> : null}
                  {p.dangerous_goods ? <span className="badge flag" style={{ marginLeft: 6 }}>DG</span> : null}
                </td>
                <td className="subtle">{p.pillar || "—"}</td>
                <td className="subtle">{p.category || "—"}</td>
                <td>{money(p)}</td>
                <td>
                  {p.research_confidence ? (
                    <span className={`badge ${p.research_confidence}`}>{p.research_confidence}</span>
                  ) : "—"}
                </td>
                <td>
                  <span className="badge stage">{STAGE_LABEL[p.research_stage] || p.research_stage || "—"}</span>
                  {p.needs_review ? <span className="badge review" style={{ marginLeft: 6 }}>review</span> : null}
                </td>
                <td><span className={`badge st-${p.product_status}`}>{p.product_status || "—"}</span></td>
              </tr>
            );
          })}
          {filtered.length === 0 ? (
            <tr><td colSpan={8} className="subtle" style={{ padding: 24 }}>No products match these filters.</td></tr>
          ) : null}
        </tbody>
      </table>
    </>
  );
}
