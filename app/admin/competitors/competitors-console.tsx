"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CcIcon } from "../cc-chrome";
import { flagEmoji } from "@/lib/flags";
import type { EuMapData } from "@/lib/eu-map";
import type { CountryMarket } from "@/lib/map-data";
import type { CompetitorWithMetrics, MatchStrength, ThreatLevel } from "@/lib/competitors-data";

type Row = CompetitorWithMetrics;

/* ---------- match presentation ---------- */

const MATCH_META: Record<MatchStrength, { label: string; chip: string; color: string; fill: string }> = {
  direct: { label: "DIRECT", chip: "red", color: "#ff4d5e", fill: "rgba(255, 77, 94, 0.38)" },
  partial: { label: "PARTIAL", chip: "amber", color: "#ffb340", fill: "rgba(255, 179, 64, 0.34)" },
  proxy: { label: "PROXY", chip: "muted", color: "#7189a6", fill: "rgba(113, 137, 166, 0.22)" },
};

function MatchChip({ m }: { m: MatchStrength | null }) {
  if (!m) return <span className="cc-chip muted plain">—</span>;
  const meta = MATCH_META[m];
  return <span className={`cc-chip ${meta.chip} plain`}>{meta.label}</span>;
}

/* ---------- effective threat (founder override > auto score) ---------- */

type ThreatBand = "low" | "medium" | "high" | "critical";

const BAND_META: Record<ThreatBand, { label: string; chip: string; color: string; fill: string }> = {
  low: { label: "LOW", chip: "green", color: "#34d97b", fill: "rgba(52, 217, 123, 0.34)" },
  medium: { label: "MEDIUM", chip: "amber", color: "#ffb340", fill: "rgba(255, 179, 64, 0.34)" },
  high: { label: "HIGH", chip: "orange", color: "#ff8a3d", fill: "rgba(255, 138, 61, 0.38)" },
  critical: { label: "CRITICAL", chip: "red fill", color: "#ff4d5e", fill: "rgba(255, 77, 94, 0.44)" },
};

function bandForScore(score: number): ThreatBand {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 40) return "medium";
  return "low";
}

type EffectiveThreat =
  | { kind: "founder"; level: ThreatLevel; band: ThreatBand; sortKey: number }
  | { kind: "auto"; score: number; band: ThreatBand; sortKey: number }
  | null;

// Founder levels sort against auto scores at representative band midpoints,
// nudged up so an override outranks an equal-band auto score.
const LEVEL_SORT: Record<ThreatLevel, number> = { low: 20, medium: 50, high: 70, critical: 90 };

function effectiveThreat(r: Row): EffectiveThreat {
  if (r.threat_level) {
    return { kind: "founder", level: r.threat_level, band: r.threat_level, sortKey: LEVEL_SORT[r.threat_level] + 0.5 };
  }
  if (r.threat_score != null) {
    return { kind: "auto", score: r.threat_score, band: bandForScore(r.threat_score), sortKey: r.threat_score };
  }
  return null;
}

function threatLabel(t: EffectiveThreat): string {
  if (!t) return "—";
  return t.kind === "founder" ? BAND_META[t.band].label : `AUTO ${Math.round(t.score)}/100`;
}

function EffectiveThreatChip({ t }: { t: EffectiveThreat }) {
  if (!t) return <span className="cc-chip muted plain">NOT SCORED</span>;
  const meta = BAND_META[t.band];
  if (t.kind === "founder") {
    return (
      <span className="cc-war-threatcell">
        <span className={`cc-chip ${meta.chip}`}>{meta.label}</span>
        <span className="cc-chip muted plain sm">FOUNDER</span>
      </span>
    );
  }
  return <span className={`cc-chip ${meta.chip}`}>AUTO {Math.round(t.score)}/100</span>;
}

/* ---------- formatting helpers ---------- */

function fmtCompact(n: number | null | undefined): string {
  if (n == null) return "—";
  const trim = (v: number, suffix: string) => {
    const r = Math.round(v * 10) / 10;
    return `${(r % 1 === 0 ? r.toFixed(0) : r.toFixed(1))}${suffix}`;
  };
  if (n >= 1e6) return trim(n / 1e6, "M");
  if (n >= 1000) return trim(n / 1000, "k");
  return String(Math.round(n));
}

function fmtDr(dr: number | null | undefined): string {
  if (dr == null) return "—";
  const r = Math.round(dr * 10) / 10;
  return r % 1 === 0 ? r.toFixed(0) : r.toFixed(1);
}

// paid_cost arrives in USD CENTS
function fmtUsdCents(cents: number | null | undefined): string {
  if (cents == null) return "—";
  const usd = cents / 100;
  if (usd >= 1000) return `$${fmtCompact(usd)}`;
  return `$${usd % 1 === 0 ? usd.toFixed(0) : usd.toFixed(2)}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 10);
}

function countryName(iso2: string): string {
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    return dn.of(iso2.toUpperCase()) || iso2.toUpperCase();
  } catch {
    return iso2.toUpperCase();
  }
}

/* ---------- product-space proximity proxy (X axis) ----------
   Ordinal derived purely from the style CLASSIFICATION — not a measured metric.
   1 Outdoor (general) · 2 Army-surplus / tactical · 3 Survival / tactical
   4 Prepper (broad) + Kit specialist (narrow) · 5 Kit specialist (household)
   6 Curated household (SC's own model) */
function styleDepth(style: string | null): number {
  const s = (style || "").toLowerCase();
  if (!s) return 3;
  if (s.includes("curated")) return 6;
  if (s.includes("narrow")) return 4;
  if (s.includes("kit specialist") || s.includes("kit /")) return 5;
  if (s.includes("prepper")) return 4;
  if (s.includes("survival")) return 3;
  if (s.includes("army") || s.includes("tactical") || s.includes("military") || s.includes("surplus")) return 2;
  if (s.includes("outdoor")) return 1;
  return 3;
}

const DEPTH_TICKS = ["OUTDOOR", "TACTICAL", "SURVIVAL", "PREPPER / 72H", "KIT (HOUSEHOLD)", "CURATED"];

/* ---------- small icons ---------- */

function WIcon({ name, size = 13 }: { name: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "eye":
      return (
        <svg {...common}>
          <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
          <circle cx="12" cy="12" r="2.8" />
        </svg>
      );
    case "scatter":
      return (
        <svg {...common}>
          <path d="M3 3v18h18" />
          <circle cx="9" cy="14" r="1.6" />
          <circle cx="13" cy="9" r="1.6" />
          <circle cx="18" cy="6" r="1.6" />
        </svg>
      );
    case "matrix":
      return (
        <svg {...common}>
          <path d="M3 5h18M3 12h18M3 19h18" />
          <path d="M8 3v18M16 3v18" />
        </svg>
      );
    case "insight":
      return (
        <svg {...common}>
          <path d="M12 3a6.5 6.5 0 014 11.6c-.9.7-1.3 1.5-1.4 2.4h-5.2c-.1-.9-.5-1.7-1.4-2.4A6.5 6.5 0 0112 3z" />
          <path d="M9.6 20h4.8" />
        </svg>
      );
    case "feed":
      return (
        <svg {...common}>
          <path d="M4 11a9 9 0 019 9M4 4a16 16 0 0116 16" />
          <circle cx="5.5" cy="18.5" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case "pulse":
      return (
        <svg {...common}>
          <path d="M3 12h4l2.5-6 4 12L16 12h5" />
        </svg>
      );
    case "link":
      return (
        <svg {...common}>
          <path d="M10 14L21 3M15 3h6v6" />
          <path d="M19 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h6" />
        </svg>
      );
    default:
      return null;
  }
}

function Eye({ on, onClick }: { on: boolean; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      type="button"
      className={`cc-war-eye${on ? " on" : ""}`}
      onClick={onClick}
      aria-label={on ? "Remove from watch list" : "Add to watch list"}
      title={on ? "On watch — click to remove" : "Add to watch list"}
    >
      <WIcon name="eye" size={15} />
    </button>
  );
}

/* ---------- component ---------- */

type SortKey = "threat" | "dr" | "traffic" | "state" | "match" | "name";

type Props = { map: EuMapData; competitors: Row[]; markets: CountryMarket[] };

export default function CompetitorsConsole({ map, competitors, markets }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(competitors);
  const [selected, setSelected] = useState<string>(() => {
    const twin = competitors.find((c) => c.country_iso2 === "EE");
    return twin?.id || competitors[0]?.id || "";
  });
  const [hovered, setHovered] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("threat");
  const stageRef = useRef<HTMLDivElement>(null);

  const marketByIso = useMemo(() => Object.fromEntries(markets.map((m) => [m.iso2, m])), [markets]);
  const stateName = (iso2: string | null) => (iso2 && marketByIso[iso2]?.name) || iso2 || "—";
  const byId = useMemo(() => Object.fromEntries(rows.map((r) => [r.id, r])), [rows]);
  const byIso = useMemo(
    () => Object.fromEntries(rows.filter((r) => r.country_iso2).map((r) => [r.country_iso2 as string, r])),
    [rows]
  );

  const sel = byId[selected] || null;

  /* ---- edit-assessment form drafts (reset when selection changes) ---- */
  const [threatDraft, setThreatDraft] = useState<string>("");
  const [watchDraft, setWatchDraft] = useState<boolean>(false);
  const [notesDraft, setNotesDraft] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    const r = byId[selected];
    setThreatDraft(r?.threat_level || "");
    setWatchDraft(Boolean(r?.watch));
    setNotesDraft(r?.notes || "");
    setMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  /* ---- stats ---- */
  const stats = useMemo(() => {
    const direct = rows.filter((r) => r.match_strength === "direct").length;
    const partial = rows.filter((r) => r.match_strength === "partial").length;
    const proxies = rows.filter((r) => r.match_strength === "proxy");
    const watch = rows.filter((r) => r.watch).length;
    const scored = rows.filter((r) => r.threat_score != null).length;
    const advertising = rows.filter((r) => (r.metrics?.paid_keywords ?? 0) > 0).length;
    const totalTraffic = rows.reduce((acc, r) => acc + (r.metrics?.org_traffic ?? 0), 0);
    let top: Row | null = null;
    let topKey = -1;
    for (const r of rows) {
      const t = effectiveThreat(r);
      if (t && t.sortKey > topKey) {
        topKey = t.sortKey;
        top = r;
      }
    }
    let lastPulled: string | null = null;
    for (const r of rows) {
      const p = r.metrics?.pulled_at || null;
      if (p && (!lastPulled || p > lastPulled)) lastPulled = p;
    }
    return {
      direct,
      partial,
      proxy: proxies.length,
      proxyStates: proxies.map((r) => stateName(r.country_iso2)).join(", "),
      watch,
      scored,
      advertising,
      totalTraffic,
      top,
      lastPulled,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, marketByIso]);

  const topThreat = stats.top ? effectiveThreat(stats.top) : null;

  /* ---- table sort ---- */
  const sorted = useMemo(() => {
    const arr = [...rows];
    const MATCH_ORD: Record<string, number> = { direct: 0, partial: 1, proxy: 2 };
    const threatKey = (r: Row) => effectiveThreat(r)?.sortKey ?? -1;
    const drKey = (r: Row) => r.metrics?.domain_rating ?? -1;
    const trafficKey = (r: Row) => r.metrics?.org_traffic ?? -1;
    if (sortBy === "name") arr.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === "match")
      arr.sort(
        (a, b) =>
          (MATCH_ORD[a.match_strength || ""] ?? 3) - (MATCH_ORD[b.match_strength || ""] ?? 3) ||
          stateName(a.country_iso2).localeCompare(stateName(b.country_iso2))
      );
    else if (sortBy === "state") arr.sort((a, b) => stateName(a.country_iso2).localeCompare(stateName(b.country_iso2)));
    else if (sortBy === "dr") arr.sort((a, b) => drKey(b) - drKey(a) || trafficKey(b) - trafficKey(a));
    else if (sortBy === "traffic") arr.sort((a, b) => trafficKey(b) - trafficKey(a) || drKey(b) - drKey(a));
    else arr.sort((a, b) => threatKey(b) - threatKey(a) || drKey(b) - drKey(a) || a.name.localeCompare(b.name));
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortBy, marketByIso]);

  /* ---- positioning map geometry ----
     X: style-derived product-space proximity (ordinal, unchanged).
     Y: Ahrefs domain rating, linear 0-40 (current rival range is DR 0-35).
     Bubble AREA ∝ organic traffic/mo, with a floor so 0-traffic rivals stay visible. */
  const PLOT = { x0: 56, x1: 644, y0: 22, y1: 372, w: 660, h: 428 };
  const DR_MAX = 40;
  const xFor = (depth: number) => PLOT.x0 + ((depth - 0.5) / 6.4) * (PLOT.x1 - PLOT.x0);
  const yForDr = (dr: number) => PLOT.y1 - (Math.min(Math.max(dr, 0), DR_MAX) / DR_MAX) * (PLOT.y1 - PLOT.y0);

  const MIN_R = 5.5;
  const MAX_R = 23;

  const dots = useMemo(() => {
    const maxTraffic = Math.max(1, ...rows.map((r) => r.metrics?.org_traffic ?? 0));
    const radiusFor = (r: Row) => {
      const t = r.metrics?.org_traffic ?? 0;
      return MIN_R + (MAX_R - MIN_R) * Math.sqrt(t / maxTraffic); // area ∝ traffic
    };
    // Rivals with no pull yet sit on the DR-0 baseline at minimum size.
    // Group dots that share a cell (same depth + rounded DR), then spread on a
    // deterministic spiral so the low-DR cluster stays readable — layout jitter only.
    const groups: Record<string, Row[]> = {};
    for (const r of rows) {
      const dr = r.metrics?.domain_rating ?? 0;
      const key = `${styleDepth(r.style)}:${Math.round(dr)}`;
      (groups[key] ||= []).push(r);
    }
    const out: { r: Row; x: number; y: number; rad: number }[] = [];
    for (const [key, members] of Object.entries(groups)) {
      const [dStr, drStr] = key.split(":");
      const baseX = xFor(Number(dStr));
      const baseY = yForDr(Number(drStr));
      members.sort((a, b) => (a.country_iso2 || "").localeCompare(b.country_iso2 || ""));
      members.forEach((m, i) => {
        const spread = i === 0 ? 0 : 11 + 9 * Math.sqrt(i);
        const ang = i * 2.39996; // golden angle
        out.push({
          r: m,
          x: baseX + Math.cos(ang) * spread,
          y: baseY + Math.sin(ang) * spread * 0.8,
          rad: radiusFor(m),
        });
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const scTarget = { x: xFor(6.18), y: yForDr(30) };

  /* ---- persistence ---- */
  async function persist(id: string, patch: Record<string, any>): Promise<boolean> {
    try {
      const res = await fetch("/api/admin/competitor/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, patch }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function toggleWatch(row: Row) {
    const next = !row.watch;
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, watch: next } : r)));
    if (row.id === selected) setWatchDraft(next);
    const ok = await persist(row.id, { watch: next });
    if (!ok) {
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, watch: !next } : r)));
      if (row.id === selected) setWatchDraft(!next);
    }
  }

  async function saveAssessment() {
    if (!sel) return;
    setSaving(true);
    setMsg(null);
    const patch = {
      threat_level: threatDraft || null,
      watch: watchDraft,
      notes: notesDraft.trim() || null,
    };
    const ok = await persist(sel.id, patch);
    if (ok) {
      setRows((rs) => rs.map((r) => (r.id === sel.id ? { ...r, ...patch } : r)) as Row[]);
      setMsg({ ok: true, text: "Assessment saved." });
      router.refresh();
    } else {
      setMsg({ ok: false, text: "Save failed." });
    }
    setSaving(false);
  }

  function onStageMove(e: React.MouseEvent) {
    const box = stageRef.current?.getBoundingClientRect();
    if (!box) return;
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top });
  }

  const hov = hovered ? byId[hovered] : null;
  const selUrl = sel ? sel.website_url || (sel.domain ? `https://${sel.domain}` : null) : null;
  const selMetrics = sel?.metrics || null;
  const selThreat = sel ? effectiveThreat(sel) : null;
  const selWeights =
    sel?.threat_score_inputs && typeof sel.threat_score_inputs.weights === "string"
      ? sel.threat_score_inputs.weights
      : null;
  const selAhrefsUrl = sel?.domain
    ? `https://app.ahrefs.com/site-explorer/overview/v2/subdomains/live?target=${encodeURIComponent(sel.domain)}`
    : null;

  return (
    <main className="cc-container">
      {/* ---------- header ---------- */}
      <div className="cc-modhead">
        <span className="cc-modicon">
          <CcIcon name="competitors" size={22} />
        </span>
        <div>
          <h1>COMPETITOR WAR ROOM</h1>
          <div className="sub">Know them. Outperform them. · One closest rival per EU-27 state — founder research v1.0</div>
        </div>
      </div>

      {/* ---------- data feed strip ---------- */}
      <div className="cc-war-datastrip">
        <span className="live" />
        <span className="k">AHREFS FEED</span>
        <span className="sep">·</span>
        <span>LAST PULLED {fmtDate(stats.lastPulled)}</span>
        <span className="sep">·</span>
        <span>REFRESH CADENCE: WEEKLY (SCHEDULED)</span>
        <span className="sep">·</span>
        <span>REFRESHED BY SC 05 SESSION</span>
      </div>

      {/* ---------- stat tiles ---------- */}
      <div className="cc-stats">
        <div className="cc-stat cyan">
          <div className="n">{rows.length}</div>
          <div className="l">Competitors Tracked</div>
        </div>
        <div className="cc-stat red">
          <div className="n">{stats.direct}</div>
          <div className="l">Direct Rivals</div>
        </div>
        <div className="cc-stat amber">
          <div className="n">{stats.partial}</div>
          <div className="l">Partial Match</div>
        </div>
        <div className="cc-stat">
          <div className="n">{stats.proxy}</div>
          <div className="l">Proxy / White Space</div>
          {stats.proxyStates ? <div className="l" style={{ opacity: 0.7, marginTop: 2 }}>{stats.proxyStates}</div> : null}
        </div>
        <div className="cc-stat cyan">
          <div className="n">{stats.watch}</div>
          <div className="l">On Watch</div>
        </div>
        <div className="cc-stat green">
          <div className="n">
            {stats.scored} / {rows.length}
          </div>
          <div className="l">Auto-Scored</div>
        </div>
        <div className="cc-stat red">
          <div className="n">{topThreat ? (topThreat.kind === "auto" ? `${Math.round(topThreat.score)}` : BAND_META[topThreat.band].label) : "—"}</div>
          <div className="l">Top Threat</div>
          {stats.top ? <div className="l" style={{ opacity: 0.7, marginTop: 2 }}>{stats.top.name}</div> : null}
        </div>
        <div className="cc-stat cyan">
          <div className="n">{fmtCompact(stats.totalTraffic)}</div>
          <div className="l">Total Rival Traffic/Mo</div>
        </div>
        <div className="cc-stat amber">
          <div className="n">{stats.advertising}</div>
          <div className="l">Advertising (PPC Active)</div>
        </div>
      </div>

      {/* ---------- SEO read (SC 02) ---------- */}
      <div className="cc-war-seostrip">
        <span className="cc-chip cyan plain tag">SEO READ</span>
        <span>
          Only fluchtrucksack.de and military1st.ie are meaningful SEO forces; the strongest curated player is
          allprepare.com (NL). Every curated-household rival in our launch markets is weak (prepersi.eu DR 2.1) — the
          curated space is open.
        </span>
        <span className="src">SC 02</span>
      </div>

      <div className="cc-detailgrid" style={{ marginTop: 4 }}>
        {/* ---------- positioning map ---------- */}
        <div className="cc-panel cc-span7">
          <div className="cc-panel-h">
            <WIcon name="scatter" />
            Competitor Positioning Map
            <span className="right">CLICK A BUBBLE TO SELECT</span>
          </div>
          <div className="cc-war-stage" ref={stageRef} onMouseMove={onStageMove} onMouseLeave={() => { setHovered(null); setTip(null); }}>
            <svg viewBox={`0 0 ${PLOT.w} ${PLOT.h}`} className="cc-war-svg" role="img" aria-label="Competitor positioning map">
              {/* grid */}
              {[1, 2, 3, 4, 5, 6].map((d) => (
                <line key={`gx-${d}`} x1={xFor(d)} y1={PLOT.y0} x2={xFor(d)} y2={PLOT.y1} className="cc-war-grid" />
              ))}
              {[0, 10, 20, 30, 40].map((dr) => (
                <g key={`gy-${dr}`}>
                  <line x1={PLOT.x0} y1={yForDr(dr)} x2={PLOT.x1} y2={yForDr(dr)} className="cc-war-grid" />
                  <text x={PLOT.x0 - 8} y={yForDr(dr) + 3} className="cc-war-band" textAnchor="end">
                    {dr}
                  </text>
                </g>
              ))}
              {/* axes frame */}
              <line x1={PLOT.x0} y1={PLOT.y0} x2={PLOT.x0} y2={PLOT.y1} className="cc-war-frame" />
              <line x1={PLOT.x0} y1={PLOT.y1} x2={PLOT.x1} y2={PLOT.y1} className="cc-war-frame" />
              {/* Y axis label */}
              <text
                className="cc-war-axis"
                transform={`rotate(-90 14 ${(PLOT.y0 + PLOT.y1) / 2})`}
                x={14}
                y={(PLOT.y0 + PLOT.y1) / 2}
              >
                DOMAIN RATING (AHREFS)
              </text>
              {/* X ticks */}
              {DEPTH_TICKS.map((t, i) => (
                <text key={t} x={xFor(i + 1)} y={PLOT.y1 + 16} className="cc-war-tick">
                  {t}
                </text>
              ))}
              <text x={(PLOT.x0 + PLOT.x1) / 2} y={PLOT.h - 8} className="cc-war-axis">
                PRODUCT-SPACE PROXIMITY TO SC →
              </text>
              {/* SC target position */}
              <g className="cc-war-target">
                <circle cx={scTarget.x} cy={scTarget.y} r={28} />
                <circle cx={scTarget.x} cy={scTarget.y} r={3.5} fill="currentColor" stroke="none" />
                <text x={scTarget.x} y={scTarget.y + 42} fontSize={8.5}>STEALTHCRAFTER</text>
                <text x={scTarget.x} y={scTarget.y + 53} fontSize={7.5} opacity={0.75}>(TARGET POSITION)</text>
              </g>
              {/* bubbles — colour: effective threat band, area ∝ organic traffic */}
              {dots.map(({ r, x, y, rad }) => {
                const t = effectiveThreat(r);
                const color = t ? BAND_META[t.band].color : "#7189a6";
                const fill = t ? BAND_META[t.band].fill : "rgba(113, 137, 166, 0.18)";
                const isSel = r.id === selected;
                const isHov = r.id === hovered;
                return (
                  <g
                    key={r.id}
                    className={`cc-war-dot${isSel ? " sel" : ""}${isHov ? " hov" : ""}`}
                    onMouseEnter={() => setHovered(r.id)}
                    onClick={() => setSelected(r.id)}
                  >
                    <circle cx={x} cy={y} r={rad} fill={fill} stroke={color} strokeWidth={isSel ? 2 : 1.2} />
                    <text x={x} y={y + 3.2} fontSize={rad >= 8 ? 10 : 8} textAnchor="middle">
                      {flagEmoji(r.country_iso2 || "")}
                    </text>
                  </g>
                );
              })}
            </svg>
            {hov && tip ? (
              <div className="cc-map-tip" style={{ left: tip.x + 14, top: tip.y + 10 }}>
                <div className="tn">
                  {flagEmoji(hov.country_iso2 || "")} {hov.name}
                </div>
                <div className="tr">
                  <EffectiveThreatChip t={effectiveThreat(hov)} />
                </div>
                <div className="tm">
                  DR {fmtDr(hov.metrics?.domain_rating)} · TRAFFIC {fmtCompact(hov.metrics?.org_traffic)}/MO
                </div>
              </div>
            ) : null}
          </div>
          <div className="cc-war-legend">
            <span><span className="dot" style={{ background: BAND_META.low.color }} /> Low</span>
            <span><span className="dot" style={{ background: BAND_META.medium.color }} /> Medium</span>
            <span><span className="dot" style={{ background: BAND_META.high.color }} /> High</span>
            <span><span className="dot" style={{ background: BAND_META.critical.color }} /> Critical</span>
            <span><span className="dot" style={{ background: "#7189a6" }} /> Not scored</span>
          </div>
          <div className="cc-war-note">
            X axis is an ordinal proxy derived from each rival&apos;s style classification — not a measured metric.
            Y axis: Ahrefs domain rating (live pull). Bubble size = organic traffic/mo; colour = effective threat band.
            Spread within a cell is layout jitter only.
          </div>
        </div>

        {/* ---------- selected competitor ---------- */}
        <div className="cc-panel cc-span5">
          {sel ? (
            <>
              <div className="cc-map-selhead">
                <span className="fl">{flagEmoji(sel.country_iso2 || "")}</span>
                <h2>{sel.name}</h2>
              </div>
              {selUrl ? (
                <a className="cc-war-domain" href={selUrl} target="_blank" rel="noopener noreferrer">
                  <WIcon name="link" size={11} /> {sel.domain || selUrl}
                </a>
              ) : null}
              <div className="cc-chiprow" style={{ marginTop: 10 }}>
                <MatchChip m={sel.match_strength} />
                <EffectiveThreatChip t={selThreat} />
                {sel.watch ? <span className="cc-chip cyan plain">ON WATCH</span> : null}
              </div>
              <div className="cc-map-rows">
                <div className="row">
                  <span className="k">STATE</span>
                  <span className="v">
                    <Link href={`/admin/map/${(sel.country_iso2 || "").toLowerCase()}`} className="cc-war-statelink">
                      {stateName(sel.country_iso2)}
                    </Link>
                  </span>
                </div>
                <div className="row">
                  <span className="k">STYLE</span>
                  <span className="v">{sel.style || "—"}</span>
                </div>
                <div className="row">
                  <span className="k">APPROX SCALE</span>
                  <span className={`v${sel.approx_scale ? "" : " muted"}`}>{sel.approx_scale || "—"}</span>
                </div>
                <div className="row">
                  <span className="k">SOURCE</span>
                  <span className={`v${sel.source_url ? "" : " muted"}`}>
                    {sel.source_url ? (
                      <a href={sel.source_url} target="_blank" rel="noopener noreferrer" className="cc-war-statelink">
                        OPEN SOURCE ↗
                      </a>
                    ) : (
                      "—"
                    )}
                  </span>
                </div>
              </div>

              {/* ---- live signals (Ahrefs) ---- */}
              <div className="cc-panel-h" style={{ marginTop: 16 }}>
                <WIcon name="pulse" />
                Live Signals
                <span className="right">
                  {selMetrics ? `AHREFS · PULLED ${fmtDate(selMetrics.pulled_at)}` : "NO PULL YET"}
                </span>
              </div>
              {selMetrics ? (
                <>
                  <div className="cc-war-signals">
                    <div className="sig">
                      <span className="k">DOMAIN RATING</span>
                      <span className="v">{fmtDr(selMetrics.domain_rating)}</span>
                    </div>
                    <div className="sig">
                      <span className="k">ORGANIC TRAFFIC / MO</span>
                      <span className="v">{fmtCompact(selMetrics.org_traffic)}</span>
                    </div>
                    <div className="sig">
                      <span className="k">ORGANIC KEYWORDS</span>
                      <span className="v">{fmtCompact(selMetrics.org_keywords)}</span>
                    </div>
                    <div className="sig">
                      <span className="k">TOP MARKET</span>
                      <span className="v">
                        {selMetrics.top_country
                          ? `${flagEmoji(selMetrics.top_country)} ${countryName(selMetrics.top_country)}`
                          : "—"}
                      </span>
                    </div>
                    <div className="sig">
                      <span className="k">PAID KEYWORDS · SPEND</span>
                      <span className="v">
                        {(selMetrics.paid_keywords ?? 0) > 0
                          ? `${selMetrics.paid_keywords} · ${fmtUsdCents(selMetrics.paid_cost)}/mo`
                          : "—"}
                      </span>
                    </div>
                    <div className="sig">
                      <span className="k">REFERRING DOMAINS</span>
                      <span className="v">{fmtCompact(selMetrics.refdomains)}</span>
                    </div>
                  </div>
                  <div className="cc-war-trendhint">TREND — needs ≥2 pulls · second weekly snapshot unlocks deltas</div>
                </>
              ) : (
                <div className="cc-notestrip">NO AHREFS PULL FOR THIS RIVAL YET</div>
              )}

              {/* ---- auto threat score ---- */}
              <div className="cc-war-autoscore">
                <span className="k">AUTO THREAT SCORE</span>
                {sel.threat_score != null ? (
                  <span className={`cc-chip ${BAND_META[bandForScore(sel.threat_score)].chip}`}>
                    AUTO {Math.round(sel.threat_score)}/100
                  </span>
                ) : (
                  <span className="cc-chip muted plain">NOT SCORED</span>
                )}
                {sel.threat_level ? (
                  <span className="cc-chip muted plain sm">OVERRIDDEN BY FOUNDER</span>
                ) : null}
              </div>
              {selWeights ? <div className="cc-war-formula">FORMULA · {selWeights}</div> : null}

              {/* ---- deep links ---- */}
              <div className="cc-war-links">
                {selUrl ? (
                  <a className="cc-btn" href={selUrl} target="_blank" rel="noopener noreferrer">
                    OPEN SITE ↗
                  </a>
                ) : null}
                {selAhrefsUrl ? (
                  <a className="cc-btn" href={selAhrefsUrl} target="_blank" rel="noopener noreferrer">
                    AHREFS ↗
                  </a>
                ) : null}
              </div>

              {sel.positioning ? (
                <>
                  <div className="cc-notelabel" style={{ marginTop: 12 }}>POSITIONING</div>
                  <div className="cc-noteblock">{sel.positioning}</div>
                </>
              ) : null}
              {sel.notes ? (
                <>
                  <div className="cc-notelabel" style={{ marginTop: 12 }}>WHY CLOSEST RIVAL</div>
                  <div className="cc-noteblock">{sel.notes}</div>
                </>
              ) : null}

              {/* ---- edit assessment ---- */}
              <div className="cc-panel-h" style={{ marginTop: 18 }}>
                <CcIcon name="settings" />
                Edit Assessment
                <span className="right">OVERRIDE BEATS AUTO</span>
              </div>
              <div className="cc-map-edit">
                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <label>
                    <span>Founder override (takes precedence)</span>
                    <select className="cc-input" value={threatDraft} onChange={(e) => setThreatDraft(e.target.value)}>
                      <option value="">No override — use auto score</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </label>
                  <label className="check">
                    <input type="checkbox" checked={watchDraft} onChange={(e) => setWatchDraft(e.target.checked)} />
                    <span>On watch list</span>
                  </label>
                </div>
                <label className="block">
                  <span>Notes — why closest rival</span>
                  <textarea
                    className="cc-input"
                    rows={3}
                    placeholder="What makes this the closest rival, what to watch…"
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                  />
                </label>
                <div className="foot">
                  <button type="button" className="cc-btn primary" onClick={saveAssessment} disabled={saving}>
                    {saving ? "Saving…" : "Save Assessment"}
                  </button>
                  {msg ? <span className={`savemsg ${msg.ok ? "ok" : "err"}`}>{msg.text}</span> : null}
                </div>
              </div>
            </>
          ) : (
            <span className="cc-empty">Select a competitor.</span>
          )}
        </div>

        {/* ---------- threat matrix ---------- */}
        <div className="cc-panel cc-span7">
          <div className="cc-panel-h">
            <WIcon name="matrix" />
            Competitor Threat Matrix
            <span className="right">
              SORT&nbsp;
              <select
                className="cc-war-sort"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortKey)}
                aria-label="Sort threat matrix"
              >
                <option value="threat">THREAT</option>
                <option value="dr">DR</option>
                <option value="traffic">TRAFFIC</option>
                <option value="state">STATE</option>
                <option value="match">MATCH</option>
                <option value="name">NAME</option>
              </select>
            </span>
          </div>
          <div className="cc-tablewrap">
            <table className="cc-table cc-war-table wide">
              <thead>
                <tr>
                  <th>Competitor</th>
                  <th>State</th>
                  <th>DR</th>
                  <th>Traffic/Mo</th>
                  <th>Keywords</th>
                  <th>Top Market</th>
                  <th>PPC</th>
                  <th>Match</th>
                  <th>Style</th>
                  <th>Threat</th>
                  <th>Watch</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const url = r.website_url || (r.domain ? `https://${r.domain}` : null);
                  const m = r.metrics;
                  return (
                    <tr key={r.id} className={r.id === selected ? "sel" : ""} onClick={() => setSelected(r.id)}>
                      <td>
                        <div className="cc-war-name">
                          <span className="nm">
                            {flagEmoji(r.country_iso2 || "")} {r.name}
                          </span>
                          {url ? (
                            <a
                              className="dm"
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {r.domain || url}
                            </a>
                          ) : null}
                        </div>
                      </td>
                      <td>{stateName(r.country_iso2)}</td>
                      <td className="cc-war-num">{fmtDr(m?.domain_rating)}</td>
                      <td className="cc-war-num">{fmtCompact(m?.org_traffic)}</td>
                      <td className="cc-war-num">{fmtCompact(m?.org_keywords)}</td>
                      <td className="cc-war-num">
                        {m?.top_country ? `${flagEmoji(m.top_country)} ${m.top_country}` : "—"}
                      </td>
                      <td className="cc-war-num">{(m?.paid_keywords ?? 0) > 0 ? m?.paid_keywords : "—"}</td>
                      <td><MatchChip m={r.match_strength} /></td>
                      <td className="cc-war-style">{r.style || "—"}</td>
                      <td><EffectiveThreatChip t={effectiveThreat(r)} /></td>
                      <td>
                        <Eye
                          on={r.watch}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleWatch(r);
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="cc-war-note">
            THREAT = founder override where set, otherwise auto score from the Ahrefs pull. TREND — needs ≥2 pulls.
          </div>
        </div>

        {/* ---------- mini EU map ---------- */}
        <div className="cc-panel cc-span5">
          <div className="cc-panel-h">
            <CcIcon name="map" />
            Rival Map
            <span className="right">COLOURED BY EFFECTIVE THREAT</span>
          </div>
          <div className="cc-war-minimap">
            <svg viewBox={`0 0 ${map.width} ${map.height}`} role="img" aria-label="EU-27 rivals by effective threat">
              {(map.contextPaths || []).map((c) => (
                <path key={`ctx-${c.iso2}`} d={c.d} className="cc-map-context" fill="rgba(16, 28, 44, 0.55)" />
              ))}
              {map.countries.map((c) => {
                const comp = byIso[c.iso2];
                const t = comp ? effectiveThreat(comp) : null;
                const fill = t ? BAND_META[t.band].fill : "rgba(30, 52, 78, 0.4)";
                const isSel = comp && comp.id === selected;
                return (
                  <path
                    key={c.iso2}
                    d={c.d}
                    fill={fill}
                    className={`mm${isSel ? " sel" : ""}`}
                    onClick={() => comp && setSelected(comp.id)}
                  >
                    <title>
                      {comp
                        ? `${stateName(c.iso2)} — ${comp.name} · ${threatLabel(t)}`
                        : c.name}
                    </title>
                  </path>
                );
              })}
            </svg>
          </div>
          <div className="cc-war-legend">
            <span><span className="dot" style={{ background: BAND_META.low.fill }} /> Low</span>
            <span><span className="dot" style={{ background: BAND_META.medium.fill }} /> Medium</span>
            <span><span className="dot" style={{ background: BAND_META.high.fill }} /> High</span>
            <span><span className="dot" style={{ background: BAND_META.critical.fill }} /> Critical</span>
            <span><span className="dot" style={{ background: "rgba(30, 52, 78, 0.4)" }} /> Not scored</span>
            <span><span className="dot" style={{ background: "rgba(16, 28, 44, 0.9)", border: "1px solid var(--cc-line2)" }} /> Non-EU (context)</span>
          </div>
        </div>

        {/* ---------- headline reads ---------- */}
        <div className="cc-panel cc-span7">
          <div className="cc-panel-h">
            <WIcon name="insight" />
            Headline Reads
            <span className="right">FOUNDER RESEARCH · v1.0</span>
          </div>
          <div className="cc-war-insights">
            <div className="row">
              <span className="cc-chip cyan plain tag">TWINS</span>
              <span>
                Closest twins to SC&apos;s model: Estonia (GoPrep), Sweden (Preppbox), Austria (Zivilschutz Shop),
                France (Abriteo), Portugal (Kit72).
              </span>
            </div>
            <div className="row">
              <span className="cc-chip red plain tag">SCALE</span>
              <span>
                Biggest / broadest rivals: Germany (Fluchtrucksack), Italy (Italian Prepper),
                Poland (Sklep Polskiego Prepersa).
              </span>
            </div>
            <div className="row">
              <span className="cc-chip amber plain tag">WHITE SPACE</span>
              <span>
                Luxembourg has no dedicated player; Latvia &amp; Lithuania are covered by 72h-kit specialists only.
              </span>
            </div>
            <div className="row">
              <span className="cc-chip green plain tag">SC WEDGE</span>
              <span>
                Recurring gap across all 27: none pairs a full curated range with an ongoing
                membership / education layer — that is SC&apos;s wedge.
              </span>
            </div>
          </div>
        </div>

        {/* ---------- live intel feed ---------- */}
        <div className="cc-panel cc-span5">
          <div className="cc-panel-h">
            <WIcon name="feed" />
            Live Intel Feed
            <span className="right">STANDBY</span>
          </div>
          <div className="cc-notestrip">PRICE &amp; CHANGE MONITORING COMES ONLINE WITH THE FIRECRAWL PHASE</div>
        </div>
      </div>
    </main>
  );
}
