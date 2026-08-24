"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { HazardEvent, HazardSource, SourceStatus } from "@/lib/hazards/types";
import type { MapCountry } from "@/lib/euro-map";

type Props = {
  width: number;
  height: number;
  countries: MapCountry[];
  events: HazardEvent[];
  sources: SourceStatus[];
  generatedAt: string;
  byCountry: Record<string, { count: number; worst: number }>;
};

const SEV_COLOR: Record<string, string> = {
  info: "#6f7f8c",
  watch: "#c9a227",
  elevated: "#d4762a",
  severe: "#c8442e",
};

const SEV_LABEL: Record<string, string> = {
  info: "Informational",
  watch: "Worth knowing",
  elevated: "Potentially disruptive",
  severe: "Act on this",
};

const SOURCE_ORDER: HazardSource[] = ["EFFIS", "EMSC", "GDACS", "ENTSOE", "TRANSPORT"];

const STATE_LABEL: Record<string, string> = {
  live: "LIVE",
  empty: "LIVE · QUIET",
  error: "UNREACHABLE",
  "needs-key": "NEEDS KEY",
  "not-built": "NOT BUILT",
};

function KindGlyph({ kind, size = 9 }: { kind: string; size?: number }) {
  const s = size;
  switch (kind) {
    case "wildfire":
      return <path d={`M0,${-s} C ${s * .7},${-s * .2} ${s * .5},${s * .5} 0,${s} C ${-s * .5},${s * .5} ${-s * .7},${-s * .2} 0,${-s} Z`} />;
    case "earthquake":
      return <path d={`M${-s},0 L${-s * .45},${-s * .8} L${-s * .1},${s * .7} L${s * .35},${-s * .7} L${s * .7},${s * .3} L${s},0`} fill="none" strokeWidth="2" stroke="currentColor" />;
    case "grid":
      return <path d={`M${s * .25},${-s} L${-s * .55},${s * .1} L${-s * .05},${s * .1} L${-s * .3},${s} L${s * .55},${-s * .15} L${s * .05},${-s * .15} Z`} />;
    case "transport":
      return <path d={`M${-s * .85},${-s * .45} h${s * 1.7} v${s * .9} h${-s * 1.7} Z`} />;
    case "flood":
      return <path d={`M${-s},${s * .2} q ${s * .5},${-s * .6} ${s},0 q ${s * .5},${s * .6} ${s},0`} fill="none" strokeWidth="2" stroke="currentColor" />;
    default:
      return <circle r={s * .7} />;
  }
}

export default function HazardMap({
  width,
  height,
  countries,
  events,
  sources,
  generatedAt,
  byCountry,
}: Props) {
  const available = useMemo(
    () => new Set(events.map((e) => e.source)),
    [events]
  );
  const [off, setOff] = useState<Set<HazardSource>>(new Set());
  const [severeOnly, setSevereOnly] = useState(false);
  const [country, setCountry] = useState<string | null>(null);
  const [hover, setHover] = useState<{ iso2: string; name: string; x: number; y: number } | null>(null);
  const [active, setActive] = useState<string | null>(null);

  const shown = useMemo(() => {
    return events.filter((e) => {
      if (off.has(e.source)) return false;
      if (severeOnly && e.severity !== "severe" && e.severity !== "elevated") return false;
      if (country && e.countryIso2 !== country) return false;
      return true;
    });
  }, [events, off, severeOnly, country]);

  const plotted = useMemo(() => shown.filter((e) => e.xy), [shown]);

  const countryName = country ? countries.find((c) => c.iso2 === country)?.name ?? country : null;

  function toggle(src: HazardSource) {
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(src)) next.delete(src);
      else next.add(src);
      return next;
    });
  }

  const worstNow = shown[0];

  return (
    <div className="sf-hz">
      <div className="sf-hz-head">
        <div>
          <div className="sf-hz-kicker">Live · Europe</div>
          <h2 className="sf-hz-title">What Europe looks like right now</h2>
          <p className="sf-hz-lede">
            Wildfire, seismic, major-disaster, power and transport conditions, read directly from the
            public European sources. Preparedness starts with knowing what is actually happening —
            not with a shopping list.
          </p>
        </div>
        <div className="sf-hz-stamp">
          <span className="sf-hz-dot" />
          <div>
            <strong>{shown.length}</strong> events shown
            <br />
            <span>updated {timeAgo(generatedAt)}</span>
          </div>
        </div>
      </div>

      <div className="sf-hz-controls">
        {SOURCE_ORDER.map((src) => {
          const st = sources.find((s) => s.source === src);
          if (!st) return null;
          const isOff = off.has(src);
          const dead = st.state !== "live";
          return (
            <button
              key={src}
              type="button"
              className={`sf-hz-layer${isOff ? " off" : ""}${dead ? " dead" : ""}`}
              onClick={() => toggle(src)}
              disabled={dead && !available.has(src)}
              title={dead ? st.detail : st.what}
            >
              <span className="sf-hz-layerdot" data-src={src} />
              {st.label}
              <span className="sf-hz-layercount">{dead ? STATE_LABEL[st.state] : st.count}</span>
            </button>
          );
        })}
        <button
          type="button"
          className={`sf-hz-layer alt${severeOnly ? " on" : ""}`}
          onClick={() => setSevereOnly((v) => !v)}
        >
          Disruptive only
        </button>
        {country && (
          <button type="button" className="sf-hz-layer alt on" onClick={() => setCountry(null)}>
            {countryName} ✕
          </button>
        )}
      </div>

      <div className="sf-hz-body">
        <div className="sf-hz-mapwrap">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="sf-hz-svg"
            role="img"
            aria-label="Live hazard map of Europe"
            onMouseLeave={() => setHover(null)}
          >
            <defs>
              <radialGradient id="hz-sea" cx="50%" cy="42%" r="72%">
                <stop offset="0%" stopColor="#0d1620" />
                <stop offset="100%" stopColor="#080d13" />
              </radialGradient>
            </defs>
            <rect width={width} height={height} fill="url(#hz-sea)" />

            {countries.map((c) => {
              const agg = byCountry[c.iso2];
              const worst = agg ? agg.worst : -1;
              const sevKey = ["info", "watch", "elevated", "severe"][worst];
              const selected = country === c.iso2;
              return (
                <path
                  key={c.iso2}
                  d={c.d}
                  className={`sf-hz-country${c.eu ? " eu" : " ctx"}${selected ? " sel" : ""}`}
                  style={
                    worst >= 1
                      ? { fill: hexA(SEV_COLOR[sevKey], c.eu ? 0.17 : 0.12) }
                      : undefined
                  }
                  onMouseEnter={() =>
                    setHover({ iso2: c.iso2, name: c.name, x: c.labelX, y: c.labelY })
                  }
                  onClick={() => setCountry((prev) => (prev === c.iso2 ? null : c.iso2))}
                />
              );
            })}

            {/* Country labels for the larger EU markets only — the map has to stay readable. */}
            {countries
              .filter((c) => c.eu && c.area > 2600 && c.labelX > -900)
              .map((c) => (
                <text key={`l-${c.iso2}`} x={c.labelX} y={c.labelY} className="sf-hz-clabel">
                  {c.iso2}
                </text>
              ))}

            {plotted.map((e) => {
              const isActive = active === e.id;
              return (
                <g
                  key={e.id}
                  transform={`translate(${e.xy!.x},${e.xy!.y})`}
                  className={`sf-hz-marker sev-${e.severity}${isActive ? " active" : ""}`}
                  style={{ color: SEV_COLOR[e.severity] }}
                  onMouseEnter={() => setActive(e.id)}
                  onMouseLeave={() => setActive(null)}
                >
                  {(e.severity === "severe" || e.severity === "elevated") && (
                    <circle r={e.severity === "severe" ? 15 : 11} className="sf-hz-halo" />
                  )}
                  <circle r={e.severity === "severe" ? 8.5 : 7} className="sf-hz-disc" />
                  <g className="sf-hz-glyph">
                    <KindGlyph kind={e.kind} size={e.severity === "severe" ? 5.5 : 4.6} />
                  </g>
                </g>
              );
            })}

            {hover && hover.x > -900 && (
              <g transform={`translate(${clamp(hover.x, 70, width - 70)},${clamp(hover.y - 22, 20, height - 20)})`} className="sf-hz-tip">
                <rect x={-64} y={-15} width={128} height={22} rx={4} />
                <text y={0}>{hover.name}</text>
              </g>
            )}
          </svg>

          <div className="sf-hz-legend">
            {(["severe", "elevated", "watch", "info"] as const).map((s) => (
              <span key={s} className="sf-hz-legitem">
                <i style={{ background: SEV_COLOR[s] }} />
                {SEV_LABEL[s]}
              </span>
            ))}
            <span className="sf-hz-legnote">
              Severity is StealthCrafter&apos;s reading of the published figures, not an official alert.
            </span>
          </div>
        </div>

        <aside className="sf-hz-rail">
          {worstNow && (
            <div className="sf-hz-lead" style={{ borderColor: hexA(SEV_COLOR[worstNow.severity], 0.55) }}>
              <div className="sf-hz-leadtag" style={{ color: SEV_COLOR[worstNow.severity] }}>
                {SEV_LABEL[worstNow.severity]}
              </div>
              <div className="sf-hz-leadtitle">{worstNow.title}</div>
              <p>{worstNow.summary}</p>
              <Link
                className="sf-hz-ask"
                href={`/admin/site/jimmy?q=${encodeURIComponent(
                  `There is a ${worstNow.kind} event — ${worstNow.title}. What should my household do to be ready for something like this?`
                )}`}
              >
                Ask Jimmy what this means for my household →
              </Link>
            </div>
          )}

          <div className="sf-hz-listhead">
            {country ? `${countryName} — ${shown.length} events` : `${shown.length} events across Europe`}
          </div>

          <ul className="sf-hz-list">
            {shown.slice(0, 40).map((e) => (
              <li
                key={e.id}
                className={`sf-hz-item${active === e.id ? " active" : ""}`}
                onMouseEnter={() => setActive(e.id)}
                onMouseLeave={() => setActive(null)}
              >
                <span className="sf-hz-itembar" style={{ background: SEV_COLOR[e.severity] }} />
                <div className="sf-hz-itembody">
                  <div className="sf-hz-itemtop">
                    <strong>{e.title}</strong>
                    {e.countryIso2 && <span className="sf-hz-iso">{e.countryIso2}</span>}
                  </div>
                  <p>{e.summary}</p>
                  <div className="sf-hz-itemmeta">
                    <span>{e.source}</span>
                    <span>{timeAgo(e.at)}</span>
                    {e.pillars.slice(0, 3).map((p) => (
                      <span key={p} className="sf-hz-pillar">
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              </li>
            ))}
            {!shown.length && (
              <li className="sf-hz-empty">
                Nothing matches the current filters. Europe being quiet is the normal case — the point
                of preparing is that it is not the only case.
              </li>
            )}
          </ul>
        </aside>
      </div>

      <div className="sf-hz-sources">
        <div className="sf-hz-sourceshead">Where this comes from</div>
        <div className="sf-hz-sourcegrid">
          {SOURCE_ORDER.map((src) => {
            const st = sources.find((s) => s.source === src);
            if (!st) return null;
            return (
              <div key={src} className={`sf-hz-source st-${st.state}`}>
                <div className="sf-hz-sourcetop">
                  <span className="sf-hz-layerdot" data-src={src} />
                  <strong>{st.label}</strong>
                  <span className="sf-hz-state">{STATE_LABEL[st.state]}</span>
                </div>
                <p className="sf-hz-what">{st.what}</p>
                <p className="sf-hz-detail">{st.detail}</p>
                <a href={st.href} target="_blank" rel="noreferrer noopener">
                  {st.attribution}
                </a>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "recently";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  return `${days} d ago`;
}
