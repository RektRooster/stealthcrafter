"use client";

// High-tech readouts for the portal. Pure SVG, no dependencies, animated with
// CSS. The brief: this should read like instrumentation, not a settings page.

import { useId } from "react";

const safeId = (s: string) => s.replace(/[^a-zA-Z0-9]/g, "");

export const PILLAR_COLOR: Record<string, string> = {
  Water: "#5fa8d3",
  Food: "#8fbf6a",
  Fire: "#f5913c",
  Shelter: "#c9a9d3",
  Medical: "#e0655f",
};

/* ------------------------------------------------------------------ */
/* Radar — five pillars, current against target                        */
/* ------------------------------------------------------------------ */

export type RadarPoint = { pillar: string; score: number | null; target: number | null; critical: boolean };

export function PillarRadar({ points, size = 340 }: { points: RadarPoint[]; size?: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const cx = size / 2;
  const cy = size / 2 + 6;
  const r = size * 0.33;
  const n = points.length;

  const at = (i: number, frac: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [cx + Math.cos(a) * r * frac, cy + Math.sin(a) * r * frac] as const;
  };

  const poly = (get: (p: RadarPoint) => number | null) =>
    points
      .map((p, i) => {
        const v = get(p);
        const [x, y] = at(i, v === null ? 0.04 : Math.max(0.04, v / 100));
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  const ringLevels = [0.25, 0.5, 0.75, 1];

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="sf-radar" role="img" aria-label="Preparedness across five pillars">
      <defs>
        <radialGradient id={`rg-${uid}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#e3cf9f" stopOpacity="0.42" />
          <stop offset="100%" stopColor="#c6a15b" stopOpacity="0.08" />
        </radialGradient>
        <filter id={`gl-${uid}`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* graticule */}
      {ringLevels.map((lv) => (
        <polygon
          key={lv}
          points={points.map((_, i) => at(i, lv).map((v) => v.toFixed(1)).join(",")).join(" ")}
          className="sf-radarring"
        />
      ))}
      {points.map((_, i) => {
        const [x, y] = at(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} className="sf-radarspoke" />;
      })}
      {ringLevels.map((lv) => (
        <text key={`t${lv}`} x={cx + 4} y={cy - r * lv - 3} className="sf-radarscale">
          {lv * 100}
        </text>
      ))}

      {/* target ring */}
      <polygon points={poly((p) => p.target)} className="sf-radartarget" />

      {/* current */}
      <polygon
        points={poly((p) => p.score)}
        fill={`url(#rg-${uid})`}
        className="sf-radarfill"
        filter={`url(#gl-${uid})`}
      />

      {/* vertices + labels */}
      {points.map((p, i) => {
        const [vx, vy] = at(i, p.score === null ? 0.04 : Math.max(0.04, p.score / 100));
        const [lx, ly] = at(i, 1.3);
        const colour = PILLAR_COLOR[p.pillar] ?? "#c6a15b";
        return (
          <g key={p.pillar}>
            <circle
              cx={vx}
              cy={vy}
              r={p.critical ? 6 : 4.5}
              fill={colour}
              className={`sf-radardot${p.critical ? " crit" : ""}`}
            />
            <text x={lx} y={ly - 4} className="sf-radarlabel" style={{ fill: colour }} textAnchor="middle">
              {p.pillar.toUpperCase()}
            </text>
            <text x={lx} y={ly + 12} className="sf-radarval" textAnchor="middle">
              {p.score === null ? "—" : p.score}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Readiness dial — hours survived against the scenario                */
/* ------------------------------------------------------------------ */

export function ReadinessDial({
  hours,
  scenarioHours,
  label,
  size = 260,
}: {
  hours: number;
  scenarioHours: number;
  label: string;
  size?: number;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.38;
  const START = -220;
  const SWEEP = 260;
  const max = scenarioHours * 1.5;
  const frac = Math.max(0, Math.min(1, (Number.isFinite(hours) ? hours : max) / max));
  const scenarioFrac = Math.min(1, scenarioHours / max);

  const pt = (deg: number, rad: number) => {
    const a = (deg * Math.PI) / 180;
    return [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad] as const;
  };
  const arc = (from: number, to: number, rad: number) => {
    const [x1, y1] = pt(from, rad);
    const [x2, y2] = pt(to, rad);
    const large = Math.abs(to - from) > 180 ? 1 : 0;
    return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${rad} ${rad} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  };

  const tone = frac >= scenarioFrac ? "#6ee7a0" : frac >= scenarioFrac * 0.5 ? "#f2c744" : "#f4553c";
  const ticks = Math.max(4, Math.min(12, Math.round(scenarioHours / 12)));

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="sf-dial" role="img" aria-label={label}>
      <defs>
        <filter id={`dg-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <path d={arc(START, START + SWEEP, r)} className="sf-dialtrack" />

      {Array.from({ length: ticks + 1 }, (_, i) => {
        const deg = START + (SWEEP * i) / ticks;
        const major = i % 2 === 0;
        const [x1, y1] = pt(deg, r - (major ? 15 : 9));
        const [x2, y2] = pt(deg, r - 3);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className={`sf-dialtick${major ? " maj" : ""}`} />;
      })}

      {/* where the scenario ends */}
      <path
        d={arc(START + SWEEP * scenarioFrac - 0.6, START + SWEEP * scenarioFrac + 0.6, r + 11)}
        className="sf-dialmark"
      />
      <text
        {...(() => {
          const [x, y] = pt(START + SWEEP * scenarioFrac, r + 26);
          return { x, y };
        })()}
        className="sf-dialmarklabel"
        textAnchor="middle"
      >
        {scenarioHours}h
      </text>

      {/* the value */}
      <path
        d={arc(START, START + SWEEP * frac, r)}
        className="sf-dialvalue"
        style={{ stroke: tone }}
        filter={`url(#dg-${uid})`}
      />

      <text x={cx} y={cy + 4} className="sf-dialnum" style={{ fill: tone }} textAnchor="middle">
        {Number.isFinite(hours) ? Math.round(hours) : "∞"}
      </text>
      <text x={cx} y={cy + 26} className="sf-diallabel" textAnchor="middle">
        HOURS
      </text>
      <text x={cx} y={cy + 46} className="sf-dialsub" textAnchor="middle">
        of {scenarioHours} needed
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Depletion timeline — when each pillar runs out                      */
/* ------------------------------------------------------------------ */

export type DepletionRow = { pillar: string; hours: number; label: string; survival: boolean };

export function DepletionTimeline({
  rows,
  scenarioHours,
  width = 640,
}: {
  rows: DepletionRow[];
  scenarioHours: number;
  width?: number;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const rowH = 34;
  const padL = 86;
  const padR = 54;
  const padT = 26;
  const height = padT + rows.length * rowH + 16;
  const max = scenarioHours * 1.5;
  const x = (h: number) => padL + (Math.min(h, max) / max) * (width - padL - padR);
  const gridHours = Array.from({ length: 5 }, (_, i) => (max * i) / 4);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="sf-depl" role="img" aria-label="How long each pillar lasts">
      <defs>
        {rows.map((r) => (
          /* userSpaceOnUse, because a <line> has a zero-height bounding box and
             the default objectBoundingBox units are degenerate for one — which
             is why every line rendered grey. Each fades out at its own end. */
          <linearGradient
            key={r.pillar}
            id={`dl-${uid}-${safeId(r.pillar)}`}
            gradientUnits="userSpaceOnUse"
            x1={padL}
            y1={0}
            x2={Math.max(padL + 12, x(r.hours))}
            y2={0}
          >
            <stop offset="0%" stopColor={PILLAR_COLOR[r.pillar] ?? "#c6a15b"} stopOpacity="1" />
            <stop offset="78%" stopColor={PILLAR_COLOR[r.pillar] ?? "#c6a15b"} stopOpacity="0.75" />
            <stop offset="100%" stopColor={PILLAR_COLOR[r.pillar] ?? "#c6a15b"} stopOpacity="0.15" />
          </linearGradient>
        ))}
      </defs>

      {/* time grid */}
      {gridHours.map((h, i) => (
        <g key={i}>
          <line x1={x(h)} y1={padT - 8} x2={x(h)} y2={height - 12} className="sf-deplgrid" />
          <text x={x(h)} y={padT - 14} className="sf-depltime" textAnchor="middle">
            {Math.round(h)}h
          </text>
        </g>
      ))}

      {/* the deadline */}
      <line x1={x(scenarioHours)} y1={padT - 18} x2={x(scenarioHours)} y2={height - 8} className="sf-depldeadline" />
      <text x={x(scenarioHours)} y={height - 1} className="sf-depldeadlabel" textAnchor="middle">
        HELP ARRIVES
      </text>

      {rows.map((r, i) => {
        const y = padT + i * rowH + rowH / 2;
        const end = x(r.hours);
        const short = r.hours < scenarioHours;
        const colour = PILLAR_COLOR[r.pillar] ?? "#c6a15b";
        return (
          <g key={r.pillar} className="sf-deplrow">
            <text x={padL - 12} y={y + 4} className="sf-depllabel" textAnchor="end" style={{ fill: colour }}>
              {r.pillar.toUpperCase()}
            </text>
            <line x1={padL} y1={y} x2={width - padR} y2={y} className="sf-depltrack" />
            <line
              x1={padL}
              y1={y}
              x2={end}
              y2={y}
              stroke={`url(#dl-${uid}-${safeId(r.pillar)})`}
              className="sf-deplline"
            />
            {short ? (
              <g transform={`translate(${end},${y})`} className="sf-deplfail">
                <circle r="7" />
                <path d="M-3.2,-3.2 L3.2,3.2 M3.2,-3.2 L-3.2,3.2" />
              </g>
            ) : (
              <polygon points={`${end - 7},${y - 5} ${end},${y} ${end - 7},${y + 5}`} fill={colour} opacity=".9" />
            )}
            <text
              x={width - padR + 8}
              y={y + 4}
              className={`sf-deplval${short ? " short" : ""}`}
            >
              {Number.isFinite(r.hours) ? `${Math.round(r.hours)}h` : "∞"}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Decay curve — the kit ageing                                        */
/* ------------------------------------------------------------------ */

export function DecayCurve({
  points,
  scenarioHours,
  width = 320,
  height = 130,
}: {
  points: { month: number; failureHour: number }[];
  scenarioHours: number;
  width?: number;
  height?: number;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  if (!points.length) return null;
  const padB = 20;
  const padT = 8;
  const maxM = Math.max(...points.map((p) => p.month), 1);
  const maxH = Math.max(scenarioHours * 1.5, ...points.map((p) => p.failureHour), 1);
  const x = (m: number) => (m / maxM) * width;
  const y = (h: number) => padT + (1 - Math.min(h, maxH) / maxH) * (height - padT - padB);

  const line = points.map((p, i) => `${i ? "L" : "M"} ${x(p.month).toFixed(1)} ${y(p.failureHour).toFixed(1)}`).join(" ");
  const area = `${line} L ${x(maxM).toFixed(1)} ${height - padB} L 0 ${height - padB} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="sf-curve" role="img" aria-label="Readiness over the next three years">
      <defs>
        <linearGradient id={`cv-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6ee7a0" stopOpacity="0.34" />
          <stop offset="100%" stopColor="#6ee7a0" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* the line you must not fall below */}
      <line x1="0" y1={y(scenarioHours)} x2={width} y2={y(scenarioHours)} className="sf-curvethreshold" />
      <text x={width} y={y(scenarioHours) - 5} className="sf-curvethlabel" textAnchor="end">
        {scenarioHours}h needed
      </text>
      <path d={area} fill={`url(#cv-${uid})`} />
      <path d={line} className="sf-curveline" />
      {points.map((p) =>
        p.month % 12 === 0 ? (
          <g key={p.month}>
            <line x1={x(p.month)} y1={padT} x2={x(p.month)} y2={height - padB} className="sf-curvegrid" />
            <text x={x(p.month)} y={height - 6} className="sf-curvex" textAnchor="middle">
              {p.month === 0 ? "now" : `${p.month / 12}y`}
            </text>
          </g>
        ) : null
      )}
      <circle cx={x(0)} cy={y(points[0].failureHour)} r="3.5" className="sf-curvenow" />
    </svg>
  );
}
