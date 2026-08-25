"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CatalogueData, CatalogueProduct, EvidenceState } from "@/lib/catalogue-data";
import { EVIDENCE_META, EVIDENCE_ORDER, fmtEur, toEur } from "@/lib/catalogue-data";

type Sort = "relevance" | "price-asc" | "price-desc" | "name";

const PAGE = 36;

export default function CatalogueBrowser({ data }: { data: CatalogueData }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<number | null>(null);
  const [states, setStates] = useState<Set<EvidenceState>>(new Set());
  const [euOnly, setEuOnly] = useState(false);
  const [ceOnly, setCeOnly] = useState(false);
  const [sort, setSort] = useState<Sort>("relevance");
  const [limit, setLimit] = useState(PAGE);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = data.products.filter((p) => {
      if (cat !== null && p.categoryId !== cat) return false;
      if (states.size && !states.has(p.state)) return false;
      if (euOnly && p.euSourcing !== "trade_confirmed" && p.euSourcing !== "wholesaler_available")
        return false;
      if (ceOnly && !p.ce) return false;
      if (needle) {
        const hay = `${p.name} ${p.brand ?? ""} ${p.category} ${p.subcategory ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });

    const rank = (p: CatalogueProduct) => EVIDENCE_ORDER.indexOf(p.state);
    out = [...out].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "price-asc" || sort === "price-desc") {
        const pa = toEur(a.price, a.currency) ?? Infinity;
        const pb = toEur(b.price, b.currency) ?? Infinity;
        return sort === "price-asc" ? pa - pb : pb - pa;
      }
      // relevance: evidence first, then heroes, then name
      const d = rank(a) - rank(b);
      if (d) return d;
      const h = Number(b.superHero) - Number(a.superHero) || Number(b.hero) - Number(a.hero);
      if (h) return h;
      return a.name.localeCompare(b.name);
    });
    return out;
  }, [data.products, q, cat, states, euOnly, ceOnly, sort]);

  const shown = filtered.slice(0, limit);

  function toggleState(s: EvidenceState) {
    setLimit(PAGE);
    setStates((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  const activeCat = cat === null ? null : data.categories.find((c) => c.id === cat);

  return (
    <main className="sf-page">
      {/* The band carries the home screen's world into the shop, then hands over
          to light for the browsing itself. The evidence ladder lives inside it
          as a row of figures rather than six boxes: it is the page's argument,
          and it is also the primary filter. */}
      <header className="sf-hero">
        <div className="sf-heroin">
          <div className="sf-herokicker">Catalogue</div>
          <h1 className="wide">Everything we are looking at — and what we have actually checked.</h1>
          <p className="sf-herolede">
            Each product carries its evidence state, openly: what we have verified ourselves, what we
            have only sourced, and what is still on the research list. Nothing here is dressed up as
            more settled than it is.
          </p>

          <div className="sf-herostats" role="group" aria-label="Filter by evidence state">
            {EVIDENCE_ORDER.map((s) => {
              const meta = EVIDENCE_META[s];
              const on = states.has(s);
              return (
                <button
                  key={s}
                  type="button"
                  className={`sf-herostat${on ? " on" : ""}`}
                  onClick={() => toggleState(s)}
                  title={meta.blurb}
                  aria-pressed={on}
                >
                  <b>{data.counts[s].toLocaleString("en-GB")}</b>
                  <span>{meta.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <div className="sf-catwrap">
        <div className="sf-catbody">
          <aside className="sf-catside">
            <input
              className="sf-catsearch"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setLimit(PAGE);
              }}
              placeholder="Search the catalogue…"
              aria-label="Search the catalogue"
            />

            <div className="sf-facet">
              <div className="sf-facethead">Category</div>
              <button
                type="button"
                className={`sf-facetrow${cat === null ? " on" : ""}`}
                onClick={() => {
                  setCat(null);
                  setLimit(PAGE);
                }}
              >
                All categories <span>{data.products.length}</span>
              </button>
              {data.categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`sf-facetrow${cat === c.id ? " on" : ""}`}
                  onClick={() => {
                    setCat(cat === c.id ? null : c.id);
                    setLimit(PAGE);
                  }}
                >
                  {c.name} <span>{c.count}</span>
                </button>
              ))}
            </div>

            <div className="sf-facet">
              <div className="sf-facethead">Sourcing &amp; certification</div>
              <label className="sf-check">
                <input type="checkbox" checked={euOnly} onChange={() => { setEuOnly((v) => !v); setLimit(PAGE); }} />
                EU supply route
              </label>
              <label className="sf-check">
                <input type="checkbox" checked={ceOnly} onChange={() => { setCeOnly((v) => !v); setLimit(PAGE); }} />
                CE certified
              </label>
            </div>

            <div className="sf-facetnote">
              Scenario filters — home, vehicle, bug-out, EDC, family, pet — are wired to the
              database and switch on here as SC 01 tags the catalogue.
            </div>
          </aside>

          <section className="sf-catmain">
            <div className="sf-catbar">
              <span>
                <strong>{filtered.length.toLocaleString("en-GB")}</strong>{" "}
                {activeCat ? `in ${activeCat.name}` : "products"}
                {states.size ? ` · ${[...states].map((s) => EVIDENCE_META[s].label).join(", ")}` : ""}
              </span>
              <label className="sf-sort">
                Sort
                <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                  <option value="relevance">Evidence first</option>
                  <option value="price-asc">Price — low to high</option>
                  <option value="price-desc">Price — high to low</option>
                  <option value="name">Name</option>
                </select>
              </label>
            </div>

            <div className="sf-grid">
              {shown.map((p) => (
                <ProductCard key={p.id} p={p} />
              ))}
            </div>

            {!filtered.length && (
              <div className="sf-catempty">
                Nothing matches those filters. Clear a filter, or search a brand or product name.
              </div>
            )}

            {limit < filtered.length && (
              <button type="button" className="sf-more" onClick={() => setLimit((l) => l + PAGE * 2)}>
                Show more — {(filtered.length - limit).toLocaleString("en-GB")} remaining
              </button>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function ProductCard({ p }: { p: CatalogueProduct }) {
  const meta = EVIDENCE_META[p.state];
  const price = toEur(p.price, p.currency);
  return (
    <Link href={`/admin/site/catalogue/${p.slug}`} className={`sf-card sf-lift st-${p.state}`}>
      <div className="sf-cardimg">
        {p.image ? (
          // No loading="lazy": Chrome never fires the intersection callback for
          // these tiles, so every card sat blank forever while the identical URL
          // loaded instantly as eager. Verified in the browser before changing it.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.image} alt="" width={400} height={300} decoding="async" />
        ) : (
          <span className="sf-noimg">No image yet</span>
        )}
        {/* Evidence used to shout from a chip on every tile. It is the most
            important thing about a product and the least urgent thing on a
            grid, so it is a quiet rule of colour down the card edge plus a
            word — read it when you want it, ignore it while you browse. */}
        <span className={`sf-state t-${meta.tone}`}>{meta.label}</span>
      </div>
      <div className="sf-cardbody">
        {p.brand && <span className="sf-cardbrand">{p.brand}</span>}
        <strong>{p.name}</strong>
        <span className="sf-cardcat">{p.category}</span>
        <div className="sf-cardfoot">
          <span className="sf-price">{fmtEur(price)}</span>
          <span className="sf-cardchips">
            {p.ce && <i title="CE certified">CE</i>}
            {(p.euSourcing === "trade_confirmed" || p.euSourcing === "wholesaler_available") && (
              <i className="eu" title="EU supply route">EU</i>
            )}
            {p.dangerousGoods && <i className="warn" title="Dangerous goods — shipping restricted">DG</i>}
          </span>
        </div>
      </div>
    </Link>
  );
}
