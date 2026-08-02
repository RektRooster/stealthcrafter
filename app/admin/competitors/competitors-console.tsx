"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CcIcon } from "../cc-chrome";
import { flagEmoji } from "@/lib/flags";
import type { EuMapData } from "@/lib/eu-map";
import type { CountryMarket } from "@/lib/map-data";
import type { Competitor, MatchStrength, ThreatLevel } from "@/lib/competitors-data";

/* ---------- match / threat presentation ---------- */

const MATCH_META: Record<MatchStrength, { label: string; chip: string; color: string; fill: string }> = {
  direct: { label: "DIRECT", chip: "red", color: "#ff4d5e", fill: "rgba(255, 77, 94, 0.38)" },
  partial: { label: "PARTIAL", chip: "amber", color: "#ffb340", fill: "rgba(255, 179, 64, 0.34)" },
  proxy: { label: "PROXY", chip: "muted", color: "#7189a6", fill: "rgba(113, 137, 166, 0.22)" },
};

const THREAT_META: Record<ThreatLevel, { label: string; chip: string }> = {
  low: { label: "LOW", chip: "green" },
  medium: { label: "MEDIUM", chip: "amber" },
  high: { label: "HIGH", chip: "red" },
  critical: { label: "CRITICAL", chip: "red fill" },
};

function MatchChip({ m }: { m: MatchStrength | null }) {
  if (!m) return <span className="cc-chip muted plain">—</span>;
  const meta = MATCH_META[m];
  return <span className={`cc-chip ${meta.chip} plain`}>{meta.label}</span>;
}

function ThreatChip({ t }: { t: ThreatLevel | null }) {
  if (!t) return <span className="cc-chip muted plain">NOT ASSESSED</span>;
  const meta = THREAT_META[t];
  return <span className={`cc-chip ${meta.chip}`}>{meta.label}</span>;
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

// Match strength → vertical band (fraction of plot height, from the bottom).
const MATCH_BAND: Record<MatchStrength, number> = { proxy: 0.16, partial: 0.5, direct: 0.82 };

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

type Props = { map: EuMapData; competitors: Competitor[]; markets: CountryMarket[] };

export default function CompetitorsConsole({ map, competitors, markets }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState<Competitor[]>(competitors);
  const [selected, setSelected] = useState<string>(() => {
    const twin = competitors.find((c) => c.country_iso2 === "EE");
    return twin?.id || competitors[0]?.id || "";
  });
  const [hovered, setHovered] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const [sortBy, setSortBy] = useState<"state" | "match" | "name">("state");
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
    const assessed = rows.filter((r) => r.threat_level !== null).length;
    return {
      direct,
      partial,
      proxy: proxies.length,
      proxyStates: proxies.map((r) => stateName(r.country_iso2)).join(", "),
      watch,
      assessed,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, marketByIso]);

  /* ---- table sort ---- */
  const sorted = useMemo(() => {
    const arr = [...rows];
    const MATCH_ORD: Record<string, number> = { direct: 0, partial: 1, proxy: 2 };
    if (sortBy === "name") arr.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === "match")
      arr.sort(
        (a, b) =>
          (MATCH_ORD[a.match_strength || ""] ?? 3) - (MATCH_ORD[b.match_strength || ""] ?? 3) ||
          stateName(a.country_iso2).localeCompare(stateName(b.country_iso2))
      );
    else arr.sort((a, b) => stateName(a.country_iso2).localeCompare(stateName(b.country_iso2)));
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortBy, marketByIso]);

  /* ---- positioning map geometry ---- */
  const PLOT = { x0: 56, x1: 644, y0: 22, y1: 372, w: 660, h: 428 };
  const xFor = (depth: number) => PLOT.x0 + ((depth - 0.5) / 6.4) * (PLOT.x1 - PLOT.x0);
  const yFor = (f: number) => PLOT.y1 - f * (PLOT.y1 - PLOT.y0);

  const dots = useMemo(() => {
    // Group dots that share a cell, then spread them on a deterministic spiral
    // so nothing overlaps — layout jitter only, the underlying scale is ordinal.
    const groups: Record<string, Competitor[]> = {};
    for (const r of rows) {
      const key = `${styleDepth(r.style)}:${r.match_strength || "proxy"}`;
      (groups[key] ||= []).push(r);
    }
    const out: { r: Competitor; x: number; y: number; depth: number }[] = [];
    for (const [key, members] of Object.entries(groups)) {
      const [dStr, match] = key.split(":");
      const depth = Number(dStr);
      const baseX = xFor(depth);
      const baseY = yFor(MATCH_BAND[(match as MatchStrength) || "proxy"] ?? 0.16);
      members.sort((a, b) => (a.country_iso2 || "").localeCompare(b.country_iso2 || ""));
      members.forEach((m, i) => {
        const rad = i === 0 ? 0 : 9 + 8.5 * Math.sqrt(i);
        const ang = i * 2.39996; // golden angle
        out.push({ r: m, x: baseX + Math.cos(ang) * rad, y: baseY + Math.sin(ang) * rad * 0.85, depth });
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const scTarget = { x: xFor(6.18), y: yFor(0.94) };

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

  async function toggleWatch(row: Competitor) {
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
      setRows((rs) => rs.map((r) => (r.id === sel.id ? { ...r, ...patch } : r)) as Competitor[]);
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
            {stats.assessed} / {rows.length}
          </div>
          <div className="l">Threat Assessed</div>
        </div>
      </div>

      <div className="cc-detailgrid" style={{ marginTop: 4 }}>
        {/* ---------- positioning map ---------- */}
        <div className="cc-panel cc-span7">
          <div className="cc-panel-h">
            <WIcon name="scatter" />
            Competitor Positioning Map
            <span className="right">CLICK A DOT TO SELECT</span>
          </div>
          <div className="cc-war-stage" ref={stageRef} onMouseMove={onStageMove} onMouseLeave={() => { setHovered(null); setTip(null); }}>
            <svg viewBox={`0 0 ${PLOT.w} ${PLOT.h}`} className="cc-war-svg" role="img" aria-label="Competitor positioning map">
              {/* grid */}
              {[1, 2, 3, 4, 5, 6].map((d) => (
                <line key={`gx-${d}`} x1={xFor(d)} y1={PLOT.y0} x2={xFor(d)} y2={PLOT.y1} className="cc-war-grid" />
              ))}
              {(["proxy", "partial", "direct"] as MatchStrength[]).map((m) => (
                <line key={`gy-${m}`} x1={PLOT.x0} y1={yFor(MATCH_BAND[m])} x2={PLOT.x1} y2={yFor(MATCH_BAND[m])} className="cc-war-grid" />
              ))}
              {/* axes frame */}
              <line x1={PLOT.x0} y1={PLOT.y0} x2={PLOT.x0} y2={PLOT.y1} className="cc-war-frame" />
              <line x1={PLOT.x0} y1={PLOT.y1} x2={PLOT.x1} y2={PLOT.y1} className="cc-war-frame" />
              {/* Y band labels */}
              <text x={8} y={yFor(MATCH_BAND.direct) + 3} className="cc-war-band">DIRECT</text>
              <text x={8} y={yFor(MATCH_BAND.partial) + 3} className="cc-war-band">PARTIAL</text>
              <text x={8} y={yFor(MATCH_BAND.proxy) + 3} className="cc-war-band">PROXY</text>
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
              {/* dots */}
              {dots.map(({ r, x, y }) => {
                const meta = MATCH_META[r.match_strength || "proxy"];
                const isSel = r.id === selected;
                const isHov = r.id === hovered;
                return (
                  <g
                    key={r.id}
                    className={`cc-war-dot${isSel ? " sel" : ""}${isHov ? " hov" : ""}`}
                    onMouseEnter={() => setHovered(r.id)}
                    onClick={() => setSelected(r.id)}
                  >
                    <circle cx={x} cy={y} r={10} fill="rgba(6, 13, 23, 0.85)" stroke={meta.color} strokeWidth={isSel ? 2 : 1.2} />
                    <text x={x} y={y + 3.5} fontSize={10} textAnchor="middle">
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
                  <MatchChip m={hov.match_strength} />
                </div>
                <div className="tm">{(hov.style || "").toUpperCase() || "—"}</div>
              </div>
            ) : null}
          </div>
          <div className="cc-war-legend">
            <span><span className="dot" style={{ background: MATCH_META.direct.color }} /> Direct</span>
            <span><span className="dot" style={{ background: MATCH_META.partial.color }} /> Partial</span>
            <span><span className="dot" style={{ background: MATCH_META.proxy.color }} /> Proxy</span>
          </div>
          <div className="cc-war-note">
            X axis is an ordinal proxy derived from each rival&apos;s style classification — not a measured metric.
            Y axis: match strength. Dot spread within a cell is layout jitter only.
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
                <ThreatChip t={sel.threat_level} />
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
                <span className="right">FOUNDER SETS THREAT</span>
              </div>
              <div className="cc-map-edit">
                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <label>
                    <span>Threat level</span>
                    <select className="cc-input" value={threatDraft} onChange={(e) => setThreatDraft(e.target.value)}>
                      <option value="">Not assessed</option>
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
                onChange={(e) => setSortBy(e.target.value as any)}
                aria-label="Sort threat matrix"
              >
                <option value="state">STATE</option>
                <option value="match">MATCH</option>
                <option value="name">NAME</option>
              </select>
            </span>
          </div>
          <div className="cc-tablewrap">
            <table className="cc-table cc-war-table">
              <thead>
                <tr>
                  <th>Competitor</th>
                  <th>State</th>
                  <th>Match</th>
                  <th>Style</th>
                  <th>Threat</th>
                  <th>Watch</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const url = r.website_url || (r.domain ? `https://${r.domain}` : null);
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
                      <td><MatchChip m={r.match_strength} /></td>
                      <td className="cc-war-style">{r.style || "—"}</td>
                      <td><ThreatChip t={r.threat_level} /></td>
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
        </div>

        {/* ---------- mini EU map ---------- */}
        <div className="cc-panel cc-span5">
          <div className="cc-panel-h">
            <CcIcon name="map" />
            Rival Map
            <span className="right">COLOURED BY MATCH STRENGTH</span>
          </div>
          <div className="cc-war-minimap">
            <svg viewBox={`0 0 ${map.width} ${map.height}`} role="img" aria-label="EU-27 rivals by match strength">
              {(map.contextPaths || []).map((c) => (
                <path key={`ctx-${c.iso2}`} d={c.d} className="cc-map-context" fill="rgba(16, 28, 44, 0.55)" />
              ))}
              {map.countries.map((c) => {
                const comp = byIso[c.iso2];
                const fill = comp?.match_strength ? MATCH_META[comp.match_strength].fill : "rgba(30, 52, 78, 0.4)";
                const isSel = comp && comp.id === selected;
                return (
                  <path
                    key={c.iso2}
                    d={c.d}
                    fill={fill}
                    className={`mm${isSel ? " sel" : ""}`}
                    onClick={() => comp && setSelected(comp.id)}
                  >
                    <title>{comp ? `${stateName(c.iso2)} — ${comp.name}` : c.name}</title>
                  </path>
                );
              })}
            </svg>
          </div>
          <div className="cc-war-legend">
            <span><span className="dot" style={{ background: MATCH_META.direct.fill }} /> Direct rival</span>
            <span><span className="dot" style={{ background: MATCH_META.partial.fill }} /> Partial</span>
            <span><span className="dot" style={{ background: MATCH_META.proxy.fill }} /> Proxy / white space</span>
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
          <div className="cc-notestrip">INTEL FEED COMES ONLINE WITH THE AHREFS / KEYWORD SYNC</div>
        </div>
      </div>
    </main>
  );
}
