"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { CcIcon } from "../cc-chrome";
import { flagEmoji } from "@/lib/flags";
import type { EuMapData } from "@/lib/eu-map";
import type { CountryMarket, SupplyStats } from "@/lib/map-data";

/* ---------- status presentation ---------- */

const STATUS_META: Record<string, { label: string; color: string; chip: string }> = {
  active: { label: "ACTIVE MARKET", color: "var(--cc-cyan)", chip: "cyan" },
  supplier_ready: { label: "SUPPLIER READY", color: "var(--cc-green)", chip: "green" },
  researching: { label: "RESEARCHING", color: "var(--cc-amber)", chip: "amber" },
  compliance_hold: { label: "COMPLIANCE HOLD", color: "var(--cc-red)", chip: "red" },
};

const STATUS_FILL: Record<string, string> = {
  active: "rgba(53, 207, 255, 0.55)",
  supplier_ready: "rgba(52, 217, 123, 0.42)",
  researching: "rgba(255, 179, 64, 0.30)",
  compliance_hold: "rgba(255, 77, 94, 0.42)",
};
const DIM_FILL = "rgba(30, 52, 78, 0.55)"; // researching + zero suppliers

function supplierFill(n: number): string {
  if (n <= 0) return DIM_FILL;
  if (n === 1) return "rgba(53, 207, 255, 0.22)";
  if (n <= 3) return "rgba(53, 207, 255, 0.45)";
  return "rgba(53, 207, 255, 0.72)";
}

/* ---------- small local icons ---------- */

function MIcon({ name }: { name: string }) {
  const common = {
    width: 13,
    height: 13,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "readiness":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3.5 2" />
        </svg>
      );
    case "ship":
      return (
        <svg {...common}>
          <path d="M3 16h13l5-5h-8" />
          <path d="M5 16V8h6v3" />
          <circle cx="8" cy="19" r="1.6" />
          <circle cx="16" cy="19" r="1.6" />
        </svg>
      );
    case "lang":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.6 2.5 3.9 5.6 3.9 9S14.6 18.5 12 21c-2.6-2.5-3.9-5.6-3.9-9S9.4 5.5 12 3z" />
        </svg>
      );
    case "cur":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M15 8.5c-.8-.9-1.9-1.4-3-1.4-2.4 0-4.3 2.2-4.3 4.9s1.9 4.9 4.3 4.9c1.1 0 2.2-.5 3-1.4M6 10.6h5M6 13.4h5" />
        </svg>
      );
    case "star":
      return (
        <svg {...common}>
          <path d="M12 3l2.7 5.7 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3 1.2-6.2L3 9.5l6.3-.8L12 3z" />
        </svg>
      );
    case "layers":
      return (
        <svg {...common}>
          <path d="M12 3l9 5-9 5-9-5 9-5z" />
          <path d="M3 13l9 5 9-5" />
        </svg>
      );
    case "globe":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a13 13 0 010 18M12 3a13 13 0 000 18" />
        </svg>
      );
    case "rocket":
      return (
        <svg {...common}>
          <path d="M12 15c4-3 6-7 6-11-4 0-8 2-11 6l-4 1 3 3-1 4 4-1 3 3 1-4-1-1z" />
          <path d="M5 19c.5-1.5 1.5-2.5 3-3" />
        </svg>
      );
    default:
      return null;
  }
}

/* ---------- star button ---------- */

function Star({ on, onClick }: { on: boolean; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      type="button"
      className={`cc-map-star${on ? " on" : ""}`}
      onClick={onClick}
      aria-label={on ? "Remove favourite" : "Add favourite"}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
        <path d="M12 3l2.7 5.7 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3 1.2-6.2L3 9.5l6.3-.8L12 3z" />
      </svg>
    </button>
  );
}

/* ---------- component ---------- */

type Props = { map: EuMapData; markets: CountryMarket[]; stats: SupplyStats };

export default function MapConsole({ map, markets, stats }: Props) {
  const [q, setQ] = useState("");
  const [favOnly, setFavOnly] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [coverageFilter, setCoverageFilter] = useState("");
  const [complianceFilter, setComplianceFilter] = useState("");
  const [euOnly, setEuOnly] = useState(true);
  const [layer, setLayer] = useState<"status" | "coverage">("status");
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<string>(markets.some((m) => m.iso2 === "ES") ? "ES" : markets[0]?.iso2 || "");
  const [hovered, setHovered] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const [favs, setFavs] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(markets.map((m) => [m.iso2, Boolean(m.favourite)]))
  );
  const mapBox = useRef<HTMLDivElement>(null);

  const byIso = useMemo(() => Object.fromEntries(markets.map((m) => [m.iso2, m])), [markets]);
  const supply = stats.byIso2;

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return markets
      .filter((m) => {
        if (favOnly && !favs[m.iso2]) return false;
        if (statusFilter && m.market_status !== statusFilter) return false;
        const n = supply[m.iso2]?.suppliers || 0;
        if (coverageFilter === "with" && n === 0) return false;
        if (coverageFilter === "none" && n > 0) return false;
        const reviewed = Boolean(m.compliance_notes);
        if (complianceFilter === "reviewed" && !reviewed) return false;
        if (complianceFilter === "not_reviewed" && reviewed) return false;
        if (complianceFilter === "hold" && m.market_status !== "compliance_hold") return false;
        if (needle && !m.name.toLowerCase().includes(needle) && !m.iso2.toLowerCase().includes(needle)) return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [markets, q, favOnly, statusFilter, coverageFilter, complianceFilter, favs, supply]);

  const sel = selected ? byIso[selected] : null;
  const selSupply = selected ? supply[selected] || { suppliers: 0, routes: 0, products: 0 } : null;

  const tiles = useMemo(() => {
    const active = markets.filter((m) => m.market_status === "active").length;
    const withSuppliers = markets.filter((m) => (supply[m.iso2]?.suppliers || 0) > 0).length;
    const hold = markets.filter((m) => m.market_status === "compliance_hold").length;
    const priority = markets.filter((m) => m.priority).length;
    return { active, withSuppliers, hold, priority };
  }, [markets, supply]);

  async function toggleFav(iso2: string) {
    const next = !favs[iso2];
    setFavs((f) => ({ ...f, [iso2]: next }));
    try {
      const res = await fetch("/api/admin/country/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ iso2, patch: { favourite: next } }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setFavs((f) => ({ ...f, [iso2]: !next })); // roll back
    }
  }

  function fillFor(iso2: string): string {
    const m = byIso[iso2];
    const n = supply[iso2]?.suppliers || 0;
    if (layer === "coverage") return supplierFill(n);
    if (!m) return DIM_FILL;
    if (m.market_status === "researching" && n === 0) return DIM_FILL;
    return STATUS_FILL[m.market_status] || DIM_FILL;
  }

  function onMove(e: React.MouseEvent) {
    const box = mapBox.current?.getBoundingClientRect();
    if (!box) return;
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top });
  }

  const cx = map.width / 2;
  const cy = map.height / 2;
  const hoveredMarket = hovered ? byIso[hovered] : null;

  const complianceLabel = (m: CountryMarket) =>
    m.market_status === "compliance_hold" ? "HOLD" : m.compliance_notes ? "Reviewed" : "Not reviewed";

  return (
    <main className="cc-container">
      <div className="cc-map-grid">
        {/* ---------- left: country selector ---------- */}
        <aside className="cc-panel cc-map-left">
          <div className="cc-panel-h">
            <MIcon name="globe" />
            EU Country Selector
          </div>
          <input
            type="search"
            className="cc-input cc-map-search"
            placeholder="Search country…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="cc-map-listmode">
            <button type="button" className={`mode${!favOnly ? " on" : ""}`} onClick={() => setFavOnly(false)}>
              ALL
            </button>
            <button type="button" className={`mode${favOnly ? " on" : ""}`} onClick={() => setFavOnly(true)}>
              <MIcon name="star" /> FAVOURITES
            </button>
            <span className="cnt">
              {list.length} / {markets.length} COUNTRIES
            </span>
          </div>
          <div className="cc-map-list">
            {list.map((m) => (
              <div
                key={m.iso2}
                className={`cc-map-country${selected === m.iso2 ? " sel" : ""}`}
                onClick={() => setSelected(m.iso2)}
              >
                <span className="fl">{flagEmoji(m.iso2)}</span>
                <span className="nm">{m.name}</span>
                <Star
                  on={Boolean(favs[m.iso2])}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFav(m.iso2);
                  }}
                />
              </div>
            ))}
            {list.length === 0 ? <span className="cc-empty" style={{ padding: 8 }}>No countries match.</span> : null}
          </div>
          <div className="cc-map-filters">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">Market status · all</option>
              <option value="active">Active</option>
              <option value="supplier_ready">Supplier ready</option>
              <option value="researching">Researching</option>
              <option value="compliance_hold">Compliance hold</option>
            </select>
            <select value={coverageFilter} onChange={(e) => setCoverageFilter(e.target.value)}>
              <option value="">Supplier coverage · all</option>
              <option value="with">With suppliers</option>
              <option value="none">No suppliers</option>
            </select>
            <select value={complianceFilter} onChange={(e) => setComplianceFilter(e.target.value)}>
              <option value="">Compliance · all</option>
              <option value="reviewed">Reviewed</option>
              <option value="not_reviewed">Not reviewed</option>
              <option value="hold">On hold</option>
            </select>
          </div>
          <div className="cc-map-toggles">
            <label className="cc-map-toggle">
              <span>SHOW EU ONLY</span>
              <button
                type="button"
                className={`sw${euOnly ? " on" : ""}`}
                onClick={() => setEuOnly(true)}
                aria-pressed={euOnly}
              >
                <span className="knob" />
              </button>
            </label>
            <label className="cc-map-toggle off" title="Region data comes online later">
              <span>DRILL INTO REGIONS</span>
              <button type="button" className="sw" disabled>
                <span className="knob" />
              </button>
            </label>
          </div>
        </aside>

        {/* ---------- centre: map ---------- */}
        <section className="cc-panel cc-map-centre">
          <div className="cc-panel-h">
            <CcIcon name="map" />
            Europe Map
            <span className="right">EUROPEAN UNION COUNTRIES ONLY</span>
          </div>
          <div className="cc-map-stage" ref={mapBox} onMouseMove={onMove} onMouseLeave={() => { setHovered(null); setTip(null); }}>
            <svg viewBox={`0 0 ${map.width} ${map.height}`} className="cc-map-svg" role="img" aria-label="EU-27 map">
              <g transform={`translate(${cx} ${cy}) scale(${zoom}) translate(${-cx} ${-cy})`}>
                {map.countries.map((c) => (
                  <path
                    key={c.iso2}
                    d={c.d}
                    className={`cc-map-shape${selected === c.iso2 ? " sel" : ""}${hovered === c.iso2 ? " hov" : ""}`}
                    fill={fillFor(c.iso2)}
                    onMouseEnter={() => setHovered(c.iso2)}
                    onClick={() => setSelected(c.iso2)}
                  />
                ))}
                {map.countries
                  .filter((c) => c.area > 1300 / zoom)
                  .map((c) => (
                    <text key={`l-${c.iso2}`} x={c.labelX} y={c.labelY} className="cc-map-label" fontSize={11 / Math.sqrt(zoom)}>
                      {(byIso[c.iso2]?.name || c.name).toUpperCase()}
                    </text>
                  ))}
              </g>
            </svg>
            {hoveredMarket && tip ? (
              <div className="cc-map-tip" style={{ left: tip.x + 14, top: tip.y + 10 }}>
                <div className="tn">
                  {flagEmoji(hoveredMarket.iso2)} {hoveredMarket.name}
                </div>
                <div className="tr">
                  <span className={`cc-chip ${STATUS_META[hoveredMarket.market_status]?.chip || "muted"} plain`}>
                    {STATUS_META[hoveredMarket.market_status]?.label || hoveredMarket.market_status}
                  </span>
                </div>
                <div className="tm">SUPPLIERS {supply[hoveredMarket.iso2]?.suppliers || 0}</div>
              </div>
            ) : null}
            <div className="cc-map-zoom">
              <button type="button" onClick={() => setZoom((z) => Math.min(4, +(z * 1.4).toFixed(2)))} aria-label="Zoom in">+</button>
              <button type="button" onClick={() => setZoom((z) => Math.max(1, +(z / 1.4).toFixed(2)))} aria-label="Zoom out">−</button>
              <button type="button" onClick={() => setZoom(1)} aria-label="Reset zoom">⤢</button>
            </div>
            <div className="cc-map-layers">
              <div className="lh">
                <MIcon name="layers" /> LAYERS
              </div>
              <button type="button" className={`ly${layer === "status" ? " on" : ""}`} onClick={() => setLayer("status")}>
                <span className="dot" /> Market Status
              </button>
              <button type="button" className={`ly${layer === "coverage" ? " on" : ""}`} onClick={() => setLayer("coverage")}>
                <span className="dot" /> Supplier Coverage
              </button>
              <button type="button" className="ly off" disabled title="Coming online">
                <span className="dot" /> Compliance
              </button>
              <button type="button" className="ly off" disabled title="Coming online">
                <span className="dot" /> Fulfilment Routes
              </button>
            </div>
            <div className="cc-map-hint">Click a country to view its market panel</div>
          </div>
        </section>

        {/* ---------- right: selected country ---------- */}
        <aside className="cc-map-right">
          {sel ? (
            <div className="cc-panel">
              <div className="cc-map-selhead">
                <span className="fl">{flagEmoji(sel.iso2)}</span>
                <h2>{sel.name}</h2>
                <button
                  type="button"
                  className={`cc-btn ghost cc-map-favbtn${favs[sel.iso2] ? " on" : ""}`}
                  onClick={() => toggleFav(sel.iso2)}
                >
                  <MIcon name="star" /> {favs[sel.iso2] ? "FAVOURITED" : "FAVOURITE"}
                </button>
              </div>
              <div className="cc-map-subh">MARKET OVERVIEW</div>
              <div className="cc-map-rows">
                <div className="row">
                  <span className="k"><MIcon name="readiness" /> MARKET READINESS</span>
                  {sel.market_readiness === null ? (
                    <span className="v muted">NOT ASSESSED</span>
                  ) : (
                    <span className="v withbar">
                      <span className="bar"><span style={{ width: `${Math.min(100, Math.max(0, sel.market_readiness))}%` }} /></span>
                      {sel.market_readiness}%
                    </span>
                  )}
                </div>
                <div className="row">
                  <span className="k"><CcIcon name="suppliers" size={13} /> SUPPLIER COVERAGE</span>
                  <span className="v">
                    {selSupply!.suppliers} supplier{selSupply!.suppliers === 1 ? "" : "s"} · {selSupply!.routes} route{selSupply!.routes === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="row">
                  <span className="k"><CcIcon name="compliance" size={13} /> COMPLIANCE STATUS</span>
                  <span className={`v${sel.market_status === "compliance_hold" ? " red" : sel.compliance_notes ? " green" : " muted"}`}>
                    {complianceLabel(sel)}
                  </span>
                </div>
                <div className="row">
                  <span className="k"><MIcon name="ship" /> SHIPPING ROUTE</span>
                  <span className={`v${sel.shipping_notes ? "" : " muted"}`}>{sel.shipping_notes || "—"}</span>
                </div>
                <div className="row">
                  <span className="k"><MIcon name="lang" /> LANGUAGE SUPPORT</span>
                  <span className="v">{sel.languages || "—"}</span>
                </div>
                <div className="row">
                  <span className="k"><MIcon name="cur" /> CURRENCY</span>
                  <span className="v">{sel.currency || "—"}</span>
                </div>
                <div className="row">
                  <span className="k"><CcIcon name="products" size={13} /> PRIORITY PRODUCTS</span>
                  <span className="v">{selSupply!.products}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="cc-panel">
              <span className="cc-empty">Select a country on the map.</span>
            </div>
          )}

          <div className="cc-panel">
            <div className="cc-panel-h">
              <CcIcon name="map" />
              Region View
            </div>
            <div className="cc-notestrip">REGION DATA COMES ONLINE LATER</div>
          </div>

          {sel ? (
            <div className="cc-panel">
              <div className="cc-panel-h">
                <CcIcon name="overview" />
                Actions
              </div>
              <div className="cc-map-actions">
                <Link className="cc-btn primary" href={`/admin/map/${sel.iso2.toLowerCase()}`}>
                  View Country Profile
                </Link>
                <Link className="cc-btn" href="/admin/suppliers">
                  Open Supplier Network
                </Link>
                <Link className="cc-btn ghost" href={`/admin/map/${sel.iso2.toLowerCase()}#compliance`}>
                  See Compliance Notes
                </Link>
              </div>
            </div>
          ) : null}
        </aside>
      </div>

      {/* ---------- bottom: stat tiles + legend ---------- */}
      <div className="cc-map-bottom">
        <div className="cc-stat cyan">
          <div className="n">{tiles.active} / {markets.length}</div>
          <div className="l">EU Countries Active</div>
        </div>
        <div className="cc-stat green">
          <div className="n">{tiles.withSuppliers} / {markets.length}</div>
          <div className="l">Countries With Suppliers</div>
        </div>
        <div className={`cc-stat${tiles.hold > 0 ? " red" : ""}`}>
          <div className="n">{tiles.hold}</div>
          <div className="l">Compliance Review</div>
        </div>
        <div className="cc-stat amber">
          <div className="n">{tiles.priority}</div>
          <div className="l">Priority Expansion Markets</div>
        </div>
        <div className="cc-panel cc-map-legend">
          <div className="cc-panel-h" style={{ marginBottom: 8 }}>Map Legend</div>
          <div className="lg"><span className="sw" style={{ background: STATUS_FILL.active }} /> Active Market</div>
          <div className="lg"><span className="sw" style={{ background: STATUS_FILL.researching }} /> Researching</div>
          <div className="lg"><span className="sw" style={{ background: STATUS_FILL.compliance_hold }} /> Compliance Hold</div>
          <div className="lg"><span className="sw" style={{ background: STATUS_FILL.supplier_ready }} /> Supplier Ready</div>
          <div className="lg"><span className="sw" style={{ background: DIM_FILL }} /> No supplier presence yet</div>
        </div>
      </div>
    </main>
  );
}
