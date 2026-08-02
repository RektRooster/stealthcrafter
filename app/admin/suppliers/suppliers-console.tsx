"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CcIcon } from "../cc-chrome";
import { flagEmoji } from "@/lib/flags";
import type { EuMapData } from "@/lib/eu-map";
import type {
  Reliability,
  SupplierRoute,
  SupplierRow,
  SuppliersConsoleData,
  TradeStatus,
} from "@/lib/suppliers-data";

type Row = SupplierRow;

/* ---------- presentation meta ---------- */

const TRADE_META: Record<TradeStatus, { label: string; cls: string }> = {
  open: { label: "OPEN", cls: "cc-chip green" },
  applied: { label: "APPLIED", cls: "cc-chip amber" },
  to_open: { label: "TO OPEN", cls: "cc-chip amber plain" },
  none: { label: "—", cls: "cc-chip muted plain" },
};

function TradeChip({ s }: { s: TradeStatus | null }) {
  const meta = TRADE_META[s || "none"] || TRADE_META.none;
  return <span className={meta.cls}>{meta.label}</span>;
}

const REL_META: Record<Reliability, { label: string; cls: string; ord: number }> = {
  high: { label: "HIGH", cls: "cc-chip green", ord: 3 },
  medium: { label: "MEDIUM", cls: "cc-chip cyan", ord: 2 },
  low: { label: "LOW", cls: "cc-chip amber", ord: 1 },
  unknown: { label: "UNKNOWN", cls: "cc-chip muted plain", ord: 0 },
};

function RelChip({ r }: { r: Reliability | null }) {
  if (!r) return <span className="cc-chip muted plain">—</span>;
  const meta = REL_META[r] || REL_META.unknown;
  return <span className={meta.cls}>{meta.label}</span>;
}

function StockChip({ s }: { s: string | null }) {
  if (!s) return <span className="cc-chip muted plain sm">STOCK ?</span>;
  const v = s.toLowerCase();
  const label = s.replace(/_/g, " ").toUpperCase();
  let cls = "cc-chip muted plain sm";
  if (v.includes("out")) cls = "cc-chip red plain sm";
  else if (v.includes("low") || v.includes("limited") || v.includes("preorder")) cls = "cc-chip amber plain sm";
  else if (v.includes("in_stock") || v.includes("available")) cls = "cc-chip green plain sm";
  return <span className={cls}>{label}</span>;
}

/* ---------- formatting ---------- */

function countryName(iso2: string): string {
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    return dn.of(iso2.toUpperCase()) || iso2.toUpperCase();
  } catch {
    return iso2.toUpperCase();
  }
}

function countryLabel(r: Row): string {
  if (r.iso2) return countryName(r.iso2);
  return (r.country || "").trim() || "—";
}

function fmtEur(v: number | null | undefined): string {
  if (v == null) return "—";
  return `€${v.toFixed(2)}`;
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return d.slice(0, 10);
}

/* ---------- per-supplier route aggregates ---------- */

type Agg = {
  routes: SupplierRoute[];
  routeCount: number;
  productCount: number;
  avgBuy: number | null;
  mixedVat: boolean; // priced routes disagree on VAT basis (or basis unknown on some)
};

const EMPTY_AGG: Agg = { routes: [], routeCount: 0, productCount: 0, avgBuy: null, mixedVat: false };

function buildAggs(routes: SupplierRoute[]): Record<string, Agg> {
  const bySup: Record<string, SupplierRoute[]> = {};
  for (const r of routes) (bySup[r.supplier_id] ||= []).push(r);
  const out: Record<string, Agg> = {};
  for (const [sid, rs] of Object.entries(bySup)) {
    const priced = rs.filter((r) => r.wholesale_price != null);
    const avg = priced.length
      ? priced.reduce((acc, r) => acc + (r.wholesale_price as number), 0) / priced.length
      : null;
    const bases = new Set(priced.map((r) => (r.vat_included === null ? "unknown" : String(r.vat_included))));
    out[sid] = {
      routes: rs,
      routeCount: rs.length,
      productCount: new Set(rs.map((r) => r.product_id)).size,
      avgBuy: avg,
      mixedVat: bases.size > 1,
    };
  }
  return out;
}

/* ---------- component ---------- */

type SortKey = "name" | "country" | "reliability" | "routes" | "trade";

const TRADE_ORD: Record<string, number> = { open: 3, applied: 2, to_open: 1, none: 0 };

type Props = { map: EuMapData; data: SuppliersConsoleData };

export default function SuppliersConsole({ map, data }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(data.suppliers);
  const [selected, setSelected] = useState<string>(data.suppliers[0]?.id || "");

  /* filters */
  const [q, setQ] = useState("");
  const [country, setCountry] = useState("");
  const [trade, setTrade] = useState("");
  const [rel, setRel] = useState("");
  const [hasRoutes, setHasRoutes] = useState(false);
  const [authDist, setAuthDist] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  const aggs = useMemo(() => buildAggs(data.routes), [data.routes]);
  const aggFor = (id: string): Agg => aggs[id] || EMPTY_AGG;
  const byId = useMemo(() => Object.fromEntries(rows.map((r) => [r.id, r])), [rows]);
  const sel = byId[selected] || null;
  const selAgg = sel ? aggFor(sel.id) : EMPTY_AGG;

  /* ---- edit-workflow drafts (reset when selection changes) ---- */
  const [tradeDraft, setTradeDraft] = useState("");
  const [relDraft, setRelDraft] = useState("");
  const [lastContactDraft, setLastContactDraft] = useState("");
  const [nextActionDraft, setNextActionDraft] = useState("");
  const [nextDateDraft, setNextDateDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    const r = byId[selected];
    setTradeDraft(r?.trade_status || "none");
    setRelDraft(r?.reliability || "");
    setLastContactDraft(r?.last_contact || "");
    setNextActionDraft(r?.next_action || "");
    setNextDateDraft(r?.next_action_date || "");
    setNotesDraft(r?.notes || "");
    setMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  /* ---- stats (whole network, not the filtered view) ---- */
  const stats = useMemo(() => {
    const tradeOpen = rows.filter((r) => r.trade_status === "open").length;
    const toOpen = rows.filter((r) => r.trade_status === "to_open").length;
    const applied = rows.filter((r) => r.trade_status === "applied").length;
    const highRel = rows.filter((r) => r.reliability === "high").length;
    const euIsos = new Set(rows.map((r) => r.iso2).filter(Boolean) as string[]);
    const nonEu = new Set(
      rows.filter((r) => !r.iso2 && (r.country || "").trim()).map((r) => (r.country as string).trim().toLowerCase())
    );
    return { tradeOpen, toOpen, applied, highRel, euStates: euIsos.size, nonEu: nonEu.size };
  }, [rows]);

  /* ---- filter options ---- */
  const countryOptions = useMemo(() => {
    const set = new Map<string, { label: string; iso2: string | null }>();
    for (const r of rows) {
      const label = countryLabel(r);
      if (label === "—") continue;
      if (!set.has(label)) set.set(label, { label, iso2: r.iso2 });
    }
    return [...set.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  /* ---- filtered + sorted table rows ---- */
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const arr = rows.filter((r) => {
      if (country && countryLabel(r) !== country) return false;
      if (trade && (r.trade_status || "none") !== trade) return false;
      if (rel && (r.reliability || "unknown") !== rel) return false;
      if (hasRoutes && aggFor(r.id).routeCount === 0) return false;
      if (authDist && !r.authorised_distributor) return false;
      if (!needle) return true;
      return [r.name, r.type, r.country, countryLabel(r)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
    const dir = sortDir;
    if (sortBy === "name") arr.sort((a, b) => dir * a.name.localeCompare(b.name));
    else if (sortBy === "country")
      arr.sort((a, b) => dir * countryLabel(a).localeCompare(countryLabel(b)) || a.name.localeCompare(b.name));
    else if (sortBy === "reliability")
      arr.sort(
        (a, b) =>
          dir * ((REL_META[b.reliability || "unknown"]?.ord ?? 0) - (REL_META[a.reliability || "unknown"]?.ord ?? 0)) ||
          a.name.localeCompare(b.name)
      );
    else if (sortBy === "routes")
      arr.sort((a, b) => dir * (aggFor(b.id).routeCount - aggFor(a.id).routeCount) || a.name.localeCompare(b.name));
    else if (sortBy === "trade")
      arr.sort(
        (a, b) =>
          dir * ((TRADE_ORD[b.trade_status || "none"] ?? 0) - (TRADE_ORD[a.trade_status || "none"] ?? 0)) ||
          a.name.localeCompare(b.name)
      );
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, country, trade, rel, hasRoutes, authDist, sortBy, sortDir, aggs]);

  function toggleSort(k: SortKey) {
    if (sortBy === k) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortBy(k);
      setSortDir(1);
    }
  }

  function SortTh({ k, children }: { k: SortKey; children: React.ReactNode }) {
    const active = sortBy === k;
    return (
      <th className="cc-sup-sorth" onClick={() => toggleSort(k)} role="button" aria-sort={active ? (sortDir === 1 ? "ascending" : "descending") : undefined}>
        {children}
        <span className={`arr${active ? " on" : ""}`}>{active && sortDir === -1 ? "▼" : "▲"}</span>
      </th>
    );
  }

  /* ---- supplier map (choropleth by supplier count) ---- */
  const mapCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) if (r.iso2) counts[r.iso2] = (counts[r.iso2] || 0) + 1;
    return counts;
  }, [rows]);
  const mapMax = Math.max(1, ...Object.values(mapCounts));

  /* ---- open negotiations / next steps ---- */
  const negotiations = useMemo(() => {
    return rows
      .filter((r) => (r.next_action || "").trim())
      .sort((a, b) => {
        if (a.next_action_date && b.next_action_date) return a.next_action_date.localeCompare(b.next_action_date);
        if (a.next_action_date) return -1;
        if (b.next_action_date) return 1;
        return a.name.localeCompare(b.name);
      });
  }, [rows]);

  /* ---- persistence ---- */
  async function saveWorkflow() {
    if (!sel) return;
    setSaving(true);
    setMsg(null);
    const patch = {
      trade_status: tradeDraft || "none",
      reliability: relDraft || null,
      last_contact: lastContactDraft || null,
      next_action: nextActionDraft.trim() || null,
      next_action_date: nextDateDraft || null,
      notes: notesDraft.trim() || null,
    };
    try {
      const res = await fetch("/api/admin/supplier/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sel.id, patch }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      setRows((rs) => rs.map((r) => (r.id === sel.id ? { ...r, ...patch } : r)) as Row[]);
      setMsg({ ok: true, text: "Workflow saved." });
      router.refresh();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || "Save failed." });
    }
    setSaving(false);
  }

  const selUrl = sel?.website
    ? sel.website.startsWith("http")
      ? sel.website
      : `https://${sel.website}`
    : null;

  return (
    <main className="cc-container">
      {/* ---------- header ---------- */}
      <div className="cc-modhead">
        <span className="cc-modicon">
          <CcIcon name="suppliers" size={22} />
        </span>
        <div>
          <h1>SUPPLIER INTELLIGENCE</h1>
          <div className="sub">
            Supplier Network — approved, pending and strategic supplier coverage · trade accounts, reliability and
            open negotiations
          </div>
        </div>
      </div>

      {/* ---------- stat tiles ---------- */}
      <div className="cc-stats">
        <div className="cc-stat cyan">
          <div className="n">{rows.length}</div>
          <div className="l">Total Suppliers</div>
        </div>
        <div className="cc-stat green">
          <div className="n">{stats.tradeOpen}</div>
          <div className="l">Trade Open</div>
        </div>
        <div className="cc-stat amber">
          <div className="n">
            {stats.toOpen} / {stats.applied}
          </div>
          <div className="l">To Open / Applied</div>
        </div>
        <div className="cc-stat green">
          <div className="n">{stats.highRel}</div>
          <div className="l">High Reliability</div>
        </div>
        <div className="cc-stat cyan">
          <div className="n">{stats.euStates}</div>
          <div className="l">EU States Covered</div>
          {stats.nonEu ? (
            <div className="l" style={{ opacity: 0.7, marginTop: 2 }}>
              + {stats.nonEu} non-EU
            </div>
          ) : null}
        </div>
        <div className="cc-stat green">
          <div className="n">
            {data.coveredProducts} <span style={{ fontSize: 13, color: "var(--cc-muted)" }}>of {data.productsTotal}</span>
          </div>
          <div className="l">Products Covered</div>
        </div>
      </div>

      {/* ---------- rail / table / selected ---------- */}
      <div className="cc-sup-grid">
        {/* ---- left filter rail ---- */}
        <div className="cc-panel cc-sup-rail">
          <div className="cc-panel-h">
            <CcIcon name="settings" />
            Filters &amp; Controls
          </div>
          <input
            type="search"
            className="cc-input cc-sup-search"
            placeholder="SEARCH NAME, TYPE, COUNTRY…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search suppliers"
          />
          <div className="cc-map-filters">
            <select value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Filter country">
              <option value="">ALL COUNTRIES</option>
              {countryOptions.map((c) => (
                <option key={c.label} value={c.label}>
                  {c.iso2 ? `${flagEmoji(c.iso2)} ` : ""}
                  {c.label.toUpperCase()}
                </option>
              ))}
            </select>
            <select value={trade} onChange={(e) => setTrade(e.target.value)} aria-label="Filter trade status">
              <option value="">ALL TRADE STATUSES</option>
              <option value="open">TRADE OPEN</option>
              <option value="applied">APPLIED</option>
              <option value="to_open">TO OPEN</option>
              <option value="none">NO TRADE ACCOUNT</option>
            </select>
            <select value={rel} onChange={(e) => setRel(e.target.value)} aria-label="Filter reliability">
              <option value="">ALL RELIABILITY</option>
              <option value="high">HIGH</option>
              <option value="medium">MEDIUM</option>
              <option value="low">LOW</option>
              <option value="unknown">UNKNOWN</option>
            </select>
          </div>
          <div className="cc-map-toggles">
            <label className="cc-map-toggle">
              <span>HAS PRODUCT ROUTES</span>
              <button
                type="button"
                className={`sw${hasRoutes ? " on" : ""}`}
                onClick={() => setHasRoutes((v) => !v)}
                aria-pressed={hasRoutes}
                aria-label="Only suppliers with product routes"
              >
                <span className="knob" />
              </button>
            </label>
            <label className="cc-map-toggle">
              <span>AUTHORISED DISTRIBUTOR</span>
              <button
                type="button"
                className={`sw${authDist ? " on" : ""}`}
                onClick={() => setAuthDist((v) => !v)}
                aria-pressed={authDist}
                aria-label="Only authorised distributors"
              >
                <span className="knob" />
              </button>
            </label>
          </div>
          <div className="cc-sup-railnote">
            SHOWING {filtered.length} OF {rows.length}
          </div>
          <div className="cc-sup-railnote dim">SAVED VIEWS — PLANNED · NOT IN THIS BUILD</div>
        </div>

        {/* ---- main table ---- */}
        <div className="cc-panel cc-sup-main">
          <div className="cc-panel-h">
            <CcIcon name="suppliers" />
            Supplier Network
            <span className="right">CLICK A ROW TO SELECT · CLICK A HEADER TO SORT</span>
          </div>
          <div className="cc-tablewrap">
            <table className="cc-table cc-sup-table">
              <thead>
                <tr>
                  <SortTh k="name">Supplier</SortTh>
                  <SortTh k="country">Country</SortTh>
                  <SortTh k="trade">Trade</SortTh>
                  <SortTh k="routes">Routes</SortTh>
                  <th>Products</th>
                  <SortTh k="reliability">Reliability</SortTh>
                  <th>Avg Buy</th>
                  <th>Last Contact</th>
                  <th>Next Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const a = aggFor(r.id);
                  return (
                    <tr key={r.id} className={r.id === selected ? "sel" : ""} onClick={() => setSelected(r.id)}>
                      <td>
                        <div className="cc-sup-name">
                          <span className="nm">
                            {r.name}
                            {r.authorised_distributor ? (
                              <span className="cc-chip cyan plain sm" title="Authorised distributor">
                                AD
                              </span>
                            ) : null}
                          </span>
                          {r.type ? <span className="tp">{r.type}</span> : null}
                        </div>
                      </td>
                      <td className="cc-sup-country">
                        {r.iso2 ? `${flagEmoji(r.iso2)} ${countryName(r.iso2)}` : countryLabel(r)}
                      </td>
                      <td>
                        <TradeChip s={r.trade_status} />
                      </td>
                      <td className="cc-war-num">{a.routeCount || "—"}</td>
                      <td className="cc-war-num">{a.productCount || "—"}</td>
                      <td>
                        <RelChip r={r.reliability} />
                      </td>
                      <td className="cc-war-num">
                        {fmtEur(a.avgBuy)}
                        {a.avgBuy != null && a.mixedVat ? (
                          <span className="cc-sup-caveat" title="Mixed basis — this supplier's route prices mix ex-VAT and inc-VAT values.">
                            †
                          </span>
                        ) : null}
                      </td>
                      <td className="cc-war-num">{fmtDate(r.last_contact)}</td>
                      <td className="cc-sup-next" title={r.next_action || undefined}>
                        {r.next_action || "—"}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      <span className="cc-empty">No suppliers match the current filters.</span>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="cc-war-note">
            AVG BUY = mean wholesale price across this supplier&apos;s routes. † marks suppliers whose route prices mix
            ex-VAT and inc-VAT bases — treat the average as indicative only.
          </div>
        </div>

        {/* ---- right: selected supplier ---- */}
        <div className="cc-panel cc-sup-side">
          {sel ? (
            <>
              <div className="cc-map-selhead">
                {sel.iso2 ? <span className="fl">{flagEmoji(sel.iso2)}</span> : null}
                <h2>{sel.name}</h2>
              </div>
              <div className="cc-chiprow" style={{ marginTop: 4 }}>
                <TradeChip s={sel.trade_status} />
                <RelChip r={sel.reliability} />
                {sel.authorised_distributor ? <span className="cc-chip cyan plain">AUTHORISED DISTRIBUTOR</span> : null}
              </div>
              {selUrl ? (
                <a className="cc-war-domain" href={selUrl} target="_blank" rel="noopener noreferrer">
                  {sel.website} ↗
                </a>
              ) : null}
              <div className="cc-map-rows" style={{ marginTop: 6 }}>
                <div className="row">
                  <span className="k">COUNTRY</span>
                  <span className={`v${countryLabel(sel) === "—" ? " muted" : ""}`}>{countryLabel(sel)}</span>
                </div>
                <div className="row">
                  <span className="k">TYPE</span>
                  <span className={`v${sel.type ? "" : " muted"}`}>{sel.type || "—"}</span>
                </div>
                <div className="row">
                  <span className="k">CONTACT</span>
                  <span className={`v${sel.contact ? "" : " muted"}`}>{sel.contact || "—"}</span>
                </div>
                <div className="row">
                  <span className="k">NEXT ACTION</span>
                  <span className={`v${sel.next_action ? "" : " muted"}`}>
                    {sel.next_action ? `${sel.next_action}${sel.next_action_date ? ` · ${sel.next_action_date}` : ""}` : "—"}
                  </span>
                </div>
              </div>

              {/* ---- edit workflow ---- */}
              <div className="cc-panel-h" style={{ marginTop: 14 }}>
                <CcIcon name="settings" />
                Edit Workflow
              </div>
              <div className="cc-map-edit">
                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <label>
                    <span>Trade status</span>
                    <select className="cc-input" value={tradeDraft} onChange={(e) => setTradeDraft(e.target.value)}>
                      <option value="none">None</option>
                      <option value="to_open">To open</option>
                      <option value="applied">Applied</option>
                      <option value="open">Open</option>
                    </select>
                  </label>
                  <label>
                    <span>Reliability</span>
                    <select className="cc-input" value={relDraft} onChange={(e) => setRelDraft(e.target.value)}>
                      <option value="">Not rated</option>
                      <option value="unknown">Unknown</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </label>
                  <label>
                    <span>Last contact</span>
                    <input
                      type="date"
                      className="cc-input"
                      value={lastContactDraft}
                      onChange={(e) => setLastContactDraft(e.target.value)}
                    />
                  </label>
                  <label>
                    <span>Next action date</span>
                    <input
                      type="date"
                      className="cc-input"
                      value={nextDateDraft}
                      onChange={(e) => setNextDateDraft(e.target.value)}
                    />
                  </label>
                </div>
                <label className="block">
                  <span>Next action</span>
                  <input
                    type="text"
                    className="cc-input"
                    placeholder="Open trade account, request price list, confirm MOQ…"
                    value={nextActionDraft}
                    onChange={(e) => setNextActionDraft(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span>Notes</span>
                  <textarea
                    className="cc-input"
                    rows={3}
                    placeholder="Terms, contacts, account numbers, caveats…"
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                  />
                </label>
                <div className="foot">
                  <button type="button" className="cc-btn primary" onClick={saveWorkflow} disabled={saving}>
                    {saving ? "Saving…" : "Save Workflow"}
                  </button>
                  {msg ? <span className={`savemsg ${msg.ok ? "ok" : "err"}`}>{msg.text}</span> : null}
                </div>
              </div>

              {/* ---- product coverage ---- */}
              <div className="cc-panel-h" style={{ marginTop: 16 }}>
                <CcIcon name="products" />
                Product Coverage
                <span className="right">
                  {selAgg.routeCount} ROUTE{selAgg.routeCount === 1 ? "" : "S"}
                </span>
              </div>
              {selAgg.routeCount === 0 ? (
                <span className="cc-empty">No product routes recorded for this supplier yet.</span>
              ) : (
                <div className="cc-sup-coverage">
                  {selAgg.routes.map((rt) => {
                    const facts: string[] = [];
                    if (rt.ships_from_country) facts.push(`SHIPS FROM ${rt.ships_from_country.toUpperCase()}`);
                    if (rt.fulfilment_region) facts.push(`FULFILMENT ${rt.fulfilment_region}`);
                    if (rt.lead_time) facts.push(`LEAD ${rt.lead_time.toUpperCase()}`);
                    if (rt.moq != null) facts.push(`MOQ ${rt.moq}`);
                    if (rt.import_duty_risk && rt.import_duty_risk !== "none")
                      facts.push(`DUTY RISK ${rt.import_duty_risk.toUpperCase()}`);
                    return (
                      <div key={rt.id} className="cc-sup-route">
                        <div className="top">
                          <Link href={`/admin/product/${rt.product_id}`} className="pn">
                            {rt.product_name}
                          </Link>
                          {rt.role ? <span className="cc-chip muted plain sm">{rt.role.replace(/_/g, " ").toUpperCase()}</span> : null}
                          <StockChip s={rt.stock_status} />
                        </div>
                        <div className="mid">
                          <span className="pr">
                            {rt.wholesale_price != null
                              ? `${fmtEur(rt.wholesale_price)}${rt.vat_included === true ? " inc VAT" : rt.vat_included === false ? " ex VAT" : ""}`
                              : "no price"}
                          </span>
                          {rt.source_url ? (
                            <a href={rt.source_url} target="_blank" rel="noopener noreferrer" className="src">
                              SOURCE ↗
                            </a>
                          ) : null}
                        </div>
                        {facts.length ? <div className="facts">{facts.join(" · ")}</div> : null}
                      </div>
                    );
                  })}
                </div>
              )}

              {sel.notes ? (
                <>
                  <div className="cc-notelabel" style={{ marginTop: 14 }}>
                    NOTES
                  </div>
                  <div className="cc-noteblock">{sel.notes}</div>
                </>
              ) : null}
            </>
          ) : (
            <span className="cc-empty">Select a supplier.</span>
          )}
        </div>
      </div>

      {/* ---------- bottom row ---------- */}
      <div className="cc-detailgrid">
        {/* ---- supplier map ---- */}
        <div className="cc-panel cc-span4">
          <div className="cc-panel-h">
            <CcIcon name="map" />
            Supplier Map
            <span className="right">SHADED BY SUPPLIER COUNT</span>
          </div>
          <div className="cc-war-minimap">
            <svg viewBox={`0 0 ${map.width} ${map.height}`} role="img" aria-label="EU-27 supplier count per state">
              {(map.contextPaths || []).map((c) => (
                <path key={`ctx-${c.iso2}`} d={c.d} className="cc-map-context" fill="rgba(16, 28, 44, 0.55)" />
              ))}
              {map.countries.map((c) => {
                const n = mapCounts[c.iso2] || 0;
                const fill = n
                  ? `rgba(52, 217, 123, ${(0.12 + 0.55 * (n / mapMax)).toFixed(3)})`
                  : "rgba(30, 52, 78, 0.4)";
                return (
                  <path
                    key={c.iso2}
                    d={c.d}
                    fill={fill}
                    className="mm"
                    onClick={() => setCountry(n ? countryName(c.iso2) : "")}
                  >
                    <title>{`${countryName(c.iso2)} — ${n} supplier${n === 1 ? "" : "s"}`}</title>
                  </path>
                );
              })}
            </svg>
          </div>
          <div className="cc-war-legend">
            <span>
              <span className="dot" style={{ background: "rgba(52, 217, 123, 0.67)" }} /> Most suppliers ({mapMax})
            </span>
            <span>
              <span className="dot" style={{ background: "rgba(52, 217, 123, 0.18)" }} /> Few
            </span>
            <span>
              <span className="dot" style={{ background: "rgba(30, 52, 78, 0.6)" }} /> None
            </span>
          </div>
          <div className="cc-war-note">
            EU-27 only — non-EU suppliers ({stats.nonEu} countries) are not pinned. Click a state to filter the table.
          </div>
        </div>

        {/* ---- open negotiations / next steps ---- */}
        <div className="cc-panel cc-span4">
          <div className="cc-panel-h">
            <CcIcon name="testing" />
            Open Negotiations / Next Steps
            <span className="right">{negotiations.length}</span>
          </div>
          {negotiations.length === 0 ? (
            <span className="cc-empty">Set next actions on a supplier to build this list.</span>
          ) : (
            <div className="cc-sup-neglist">
              {negotiations.map((r) => (
                <button key={r.id} type="button" className="neg" onClick={() => setSelected(r.id)}>
                  <span className="nm">
                    {r.iso2 ? `${flagEmoji(r.iso2)} ` : ""}
                    {r.name}
                  </span>
                  <span className="ac">{r.next_action}</span>
                  <span className={`dt${r.next_action_date ? "" : " muted"}`}>{r.next_action_date || "no date"}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ---- price change & alerts ---- */}
        <div className="cc-panel cc-span4">
          <div className="cc-panel-h">
            <CcIcon name="competitors" />
            Price Change &amp; Alerts
            <span className="right">STANDBY</span>
          </div>
          <div className="cc-notestrip">PRICE-CHANGE MONITORING COMES ONLINE WITH THE FIRECRAWL PHASE</div>
          <div className="cc-sup-factrow">
            <span className="n">{data.reverifyRouteCount}</span>
            <span className="t">
              routes point at products flagged &ldquo;reverify at purchase&rdquo; in their internal notes — re-check
              price and spec before ordering.
            </span>
          </div>
        </div>

        {/* ---- uncovered products ---- */}
        <div className="cc-panel cc-span7">
          <div className="cc-panel-h">
            <CcIcon name="products" />
            Uncovered Products
            <span className="right">
              {data.uncoveredCount} OF {data.productsTotal} WITHOUT A ROUTE
            </span>
          </div>
          {data.uncoveredHeroes.length === 0 ? (
            <span className="cc-empty">Every hero product has at least one supplier route.</span>
          ) : (
            <>
              <div className="cc-notelabel">HERO PRODUCTS WITHOUT ANY SUPPLIER ROUTE</div>
              <div className="cc-sup-uncovered">
                {data.uncoveredHeroes.map((p) => (
                  <Link key={p.id} href={`/admin/product/${p.id}`} className="unc">
                    <span className="nm">{p.name}</span>
                    {p.pillar ? <span className="cc-chip amber plain sm">{p.pillar.toUpperCase()}</span> : null}
                  </Link>
                ))}
              </div>
              {data.uncoveredHeroCount > data.uncoveredHeroes.length ? (
                <div className="cc-war-note">
                  {data.uncoveredHeroCount - data.uncoveredHeroes.length} more hero products without a route.
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* ---- recent activity ---- */}
        <div className="cc-panel cc-span5">
          <div className="cc-panel-h">
            <CcIcon name="overview" />
            Recent Activity
            <span className="right">STANDBY</span>
          </div>
          <div className="cc-notestrip">ACTIVITY FEED COMES ONLINE WITH THE AUDIT LOG</div>
        </div>
      </div>
    </main>
  );
}
