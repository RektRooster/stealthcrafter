"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type View = { x: number; y: number; w: number; h: number };

// Tuned for a dark map: the previous set was only a shade or two off the land
// underneath it, so nothing read at a glance. These sit well clear of both the
// sea and the two land tones below.
const SEV_COLOR: Record<string, string> = {
  info: "#8fb3d1",
  watch: "#f2c744",
  elevated: "#f5913c",
  severe: "#f4553c",
};

/* Base land colours. Countries are filled with an opaque blend of these and
   the severity colour, so a tinted country keeps its land identity instead of
   compositing straight onto the sea. */
const LAND_EU = "#3f3d31";
const LAND_CTX = "#242e39";

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

/** Deepest magnification, as a multiple of the full-continent view. */
const MAX_ZOOM = 14;
const ZOOM_STEP = 1.6;
const ANIM_MS = 460;

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
  const FULL: View = useMemo(() => ({ x: 0, y: 0, w: width, h: height }), [width, height]);
  const AR = width / height;

  const available = useMemo(() => new Set(events.map((e) => e.source)), [events]);
  const [off, setOff] = useState<Set<HazardSource>>(new Set());
  const [severeOnly, setSevereOnly] = useState(false);
  const [country, setCountry] = useState<string | null>(null);
  const [hover, setHover] = useState<{ iso2: string; name: string; x: number; y: number } | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>(FULL);
  const itemRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const listRef = useRef<HTMLUListElement | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const animRef = useRef<number | null>(null);
  const viewRef = useRef<View>(FULL);
  viewRef.current = view;

  /* ------------------------- viewport maths ------------------------- */

  /** Fit a rect to the map's aspect, clamp the magnification, keep it on-map. */
  const frame = useCallback(
    (bx: number, by: number, bw: number, bh: number, pad = 0.28): View => {
      let w = Math.max(bw, 1) * (1 + pad);
      let h = Math.max(bh, 1) * (1 + pad);
      if (w / h > AR) h = w / AR;
      else w = h * AR;

      const minW = width / MAX_ZOOM;
      if (w < minW) { w = minW; h = minW / AR; }
      if (w > width) { w = width; h = height; }

      const cx = bx + bw / 2;
      const cy = by + bh / 2;
      return {
        x: clamp(cx - w / 2, 0, width - w),
        y: clamp(cy - h / 2, 0, height - h),
        w,
        h,
      };
    },
    [AR, width, height]
  );

  const animateTo = useCallback((target: View) => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    const from = viewRef.current;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ANIM_MS);
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; // easeInOutCubic
      setView({
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
        w: from.w + (target.w - from.w) * e,
        h: from.h + (target.h - from.h) * e,
      });
      if (p < 1) animRef.current = requestAnimationFrame(step);
    };
    animRef.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => () => { if (animRef.current) cancelAnimationFrame(animRef.current); }, []);

  const resetView = useCallback(() => {
    setCountry(null);
    animateTo(FULL);
  }, [animateTo, FULL]);

  /** Zoom about a fixed point in map coordinates — used by the buttons and the wheel. */
  const zoomAbout = useCallback(
    (factor: number, ax: number, ay: number, animate = true) => {
      const v = viewRef.current;
      let w = clamp(v.w / factor, width / MAX_ZOOM, width);
      let h = w / AR;
      // keep (ax,ay) under the same relative position
      const rx = (ax - v.x) / v.w;
      const ry = (ay - v.y) / v.h;
      const next: View = {
        x: clamp(ax - rx * w, 0, width - w),
        y: clamp(ay - ry * h, 0, height - h),
        w,
        h,
      };
      if (animate) animateTo(next);
      else setView(next);
    },
    [AR, width, height, animateTo]
  );

  const zoomToCountry = useCallback(
    (c: MapCountry) => {
      const [bx, by, bw, bh] = c.bbox;
      animateTo(frame(bx, by, bw, bh));
    },
    [animateTo, frame]
  );

  const zoomToEvent = useCallback(
    (e: HazardEvent) => {
      if (!e.xy) return;
      const w = width / 7;
      animateTo(frame(e.xy.x - w / 2, e.xy.y - w / AR / 2, w, w / AR, 0));
    },
    [animateTo, frame, width, AR]
  );

  /* Clicking a marker is the whole point of the map: it opens that event in
     the rail, scrolls it into view and flies to it. */
  const selectEvent = useCallback(
    (e: HazardEvent, fly = true) => {
      setSelected(e.id);
      setActive(e.id);
      if (fly) zoomToEvent(e);
      // Scroll the LIST, never the page. scrollIntoView walks up and scrolls
      // every scrollable ancestor, which threw the reader past the site nav
      // with no obvious way back.
      window.setTimeout(() => {
        const list = listRef.current;
        const item = itemRefs.current[e.id];
        if (!list || !item) return;
        const top = item.offsetTop;
        const bottom = top + item.offsetHeight;
        if (top < list.scrollTop) list.scrollTo({ top, behavior: "smooth" });
        else if (bottom > list.scrollTop + list.clientHeight)
          list.scrollTo({ top: bottom - list.clientHeight, behavior: "smooth" });
      }, 60);
    },
    [zoomToEvent]
  );

  /* client point -> map coordinate */
  const toMap = useCallback((clientX: number, clientY: number): [number, number] => {
    const el = svgRef.current;
    if (!el) return [width / 2, height / 2];
    const r = el.getBoundingClientRect();
    const v = viewRef.current;
    return [v.x + ((clientX - r.left) / r.width) * v.w, v.y + ((clientY - r.top) / r.height) * v.h];
  }, [width, height]);

  /* ------------------------- wheel + drag ------------------------- */

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const [ax, ay] = toMap(ev.clientX, ev.clientY);
      zoomAbout(ev.deltaY < 0 ? 1.18 : 1 / 1.18, ax, ay, false);
    };
    // passive:false so preventDefault actually stops the page scrolling
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [toMap, zoomAbout]);

  /* Panning deliberately does NOT use setPointerCapture: capturing retargets
     the subsequent click to the <svg>, which silently swallowed every
     click-a-country-to-zoom. Window listeners give the same drag-outside
     behaviour without stealing the click. */
  const dragRef = useRef<{ sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const onWinMove = useCallback(
    (ev: PointerEvent) => {
      const d = dragRef.current;
      const el = svgRef.current;
      if (!d || !el) return;
      const dxPx = ev.clientX - d.sx;
      const dyPx = ev.clientY - d.sy;
      if (!d.moved && Math.abs(dxPx) + Math.abs(dyPx) > 4) d.moved = true;
      if (!d.moved) return;
      if (animRef.current) cancelAnimationFrame(animRef.current);
      const r = el.getBoundingClientRect();
      const v = viewRef.current;
      setView({
        x: clamp(d.vx - (dxPx / r.width) * v.w, 0, width - v.w),
        y: clamp(d.vy - (dyPx / r.height) * v.h, 0, height - v.h),
        w: v.w,
        h: v.h,
      });
    },
    [width, height]
  );

  const onWinUp = useCallback(() => {
    const d = dragRef.current;
    dragRef.current = null;
    window.removeEventListener("pointermove", onWinMove);
    if (d?.moved) {
      // The click that follows this pointerup belongs to the pan, not to the
      // country underneath the cursor.
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    }
  }, [onWinMove]);

  useEffect(
    () => () => {
      window.removeEventListener("pointermove", onWinMove);
      window.removeEventListener("pointerup", onWinUp);
    },
    [onWinMove, onWinUp]
  );

  function onPointerDown(ev: React.PointerEvent<SVGSVGElement>) {
    if (ev.button !== 0) return;
    const v = viewRef.current;
    dragRef.current = { sx: ev.clientX, sy: ev.clientY, vx: v.x, vy: v.y, moved: false };
    window.addEventListener("pointermove", onWinMove);
    window.addEventListener("pointerup", onWinUp, { once: true });
  }

  function handleCountry(c: MapCountry) {
    if (suppressClick.current) return;
    if (country === c.iso2) {
      resetView();
      return;
    }
    setCountry(c.iso2);
    zoomToCountry(c);
  }

  /* Esc always gets you back to the whole continent. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") resetView();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [resetView]);

  /* ------------------------- filtering ------------------------- */

  const shown = useMemo(
    () =>
      events.filter((e) => {
        if (off.has(e.source)) return false;
        if (severeOnly && e.severity !== "severe" && e.severity !== "elevated") return false;
        if (country && e.countryIso2 !== country) return false;
        return true;
      }),
    [events, off, severeOnly, country]
  );

  const plotted = useMemo(() => shown.filter((e) => e.xy), [shown]);

  // A layer toggle or a country change can filter the selected event away.
  useEffect(() => {
    if (selected && !shown.some((e) => e.id === selected)) setSelected(null);
  }, [shown, selected]);
  const countryName = country ? countries.find((c) => c.iso2 === country)?.name ?? country : null;
  const worstNow = shown[0];
  const featured = (selected && shown.find((e) => e.id === selected)) || worstNow;

  function toggle(src: HazardSource) {
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(src)) next.delete(src);
      else next.add(src);
      return next;
    });
  }

  /* Screen-constant sizing: geometry drawn in map units shrinks as we zoom in. */
  const k = view.w / width;            // 1 at full extent, smaller when zoomed in
  const zoom = width / view.w;         // magnification, for the readout
  const labelCut = 2600 * k * k;       // reveal smaller countries as you go deeper

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
          <button type="button" className="sf-hz-layer alt on" onClick={resetView}>
            {countryName} ✕
          </button>
        )}
      </div>

      <div className="sf-hz-body">
        <div className="sf-hz-mapwrap">
          <svg
            ref={svgRef}
            viewBox={`${r2(view.x)} ${r2(view.y)} ${r2(view.w)} ${r2(view.h)}`}
            className={`sf-hz-svg${zoom > 1.01 ? " zoomed" : ""}`}
            role="img"
            aria-label="Live hazard map of Europe. Scroll to zoom, drag to pan, click a country to zoom to it."
            onPointerDown={onPointerDown}
            onMouseLeave={() => setHover(null)}
            onDoubleClick={(e) => {
              const [ax, ay] = toMap(e.clientX, e.clientY);
              zoomAbout(ZOOM_STEP, ax, ay);
            }}
          >
            <defs>
              <radialGradient id="hz-sea" cx="50%" cy="42%" r="72%">
                <stop offset="0%" stopColor="#101c27" />
                <stop offset="100%" stopColor="#0a121a" />
              </radialGradient>
            </defs>
            <rect x={0} y={0} width={width} height={height} fill="url(#hz-sea)" />

            {countries.map((c) => {
              const agg = byCountry[c.iso2];
              const worst = agg ? agg.worst : -1;
              const sevKey = ["info", "watch", "elevated", "severe"][worst];
              const selected = country === c.iso2;
              return (
                <path
                  key={c.iso2}
                  d={c.d}
                  vectorEffect="non-scaling-stroke"
                  className={`sf-hz-country${c.eu ? " eu" : " ctx"}${selected ? " sel" : ""}`}
                  style={{
                    fill:
                      worst >= 1
                        ? mix(c.eu ? LAND_EU : LAND_CTX, SEV_COLOR[sevKey], c.eu ? 0.42 : 0.32)
                        : c.eu
                        ? LAND_EU
                        : LAND_CTX,
                  }}
                  onMouseEnter={() => setHover({ iso2: c.iso2, name: c.name, x: c.labelX, y: c.labelY })}
                  onClick={() => handleCountry(c)}
                />
              );
            })}

            {countries
              .filter((c) => c.area > labelCut && c.labelX > -900)
              .map((c) => (
                <text
                  key={`l-${c.iso2}`}
                  x={c.labelX}
                  y={c.labelY}
                  className="sf-hz-clabel"
                  style={{ fontSize: 11 * k }}
                >
                  {c.iso2}
                </text>
              ))}

            {plotted.map((e) => {
              const isActive = active === e.id;
              const isSel = selected === e.id;
              const big = e.severity === "severe";
              return (
                <g
                  key={e.id}
                  transform={`translate(${e.xy!.x},${e.xy!.y}) scale(${k})`}
                  className={`sf-hz-marker sev-${e.severity}${isActive ? " active" : ""}${isSel ? " selected" : ""}`}
                  style={{ color: SEV_COLOR[e.severity] }}
                  onMouseEnter={() => setActive(e.id)}
                  onMouseLeave={() => setActive(null)}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    if (suppressClick.current) return;
                    // No fly-to: you are already looking at this marker.
                    selectEvent(e, false);
                  }}
                >
                  {isSel && <circle r={big ? 21 : 18} className="sf-hz-selring" />}
                  {(big || e.severity === "elevated") && (
                    <circle r={big ? 15 : 11} className="sf-hz-halo" />
                  )}
                  <circle r={big ? 8.5 : 7} className="sf-hz-disc" />
                  <g className="sf-hz-glyph">
                    <KindGlyph kind={e.kind} size={big ? 5.5 : 4.6} />
                  </g>
                </g>
              );
            })}

            {hover && hover.x > -900 && (
              <g
                transform={`translate(${clamp(hover.x, view.x + 70 * k, view.x + view.w - 70 * k)},${clamp(
                  hover.y - 22 * k,
                  view.y + 20 * k,
                  view.y + view.h - 20 * k
                )}) scale(${k})`}
                className="sf-hz-tip"
              >
                <rect x={-64} y={-15} width={128} height={22} rx={4} />
                <text y={0}>{hover.name}</text>
              </g>
            )}
          </svg>

          <div className="sf-hz-zoom" role="group" aria-label="Map zoom">
            <button
              type="button"
              onClick={() => zoomAbout(ZOOM_STEP, view.x + view.w / 2, view.y + view.h / 2)}
              disabled={zoom >= MAX_ZOOM - 0.01}
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => zoomAbout(1 / ZOOM_STEP, view.x + view.w / 2, view.y + view.h / 2)}
              disabled={zoom <= 1.01}
              aria-label="Zoom out"
            >
              −
            </button>
            <button
              type="button"
              className="sf-hz-zoomreset"
              onClick={resetView}
              disabled={zoom <= 1.01 && !country}
              aria-label="Reset to the whole continent"
            >
              ⤢
            </button>
            <span className="sf-hz-zoomlevel">{zoom < 1.05 ? "1×" : `${zoom.toFixed(1)}×`}</span>
          </div>

          <div className="sf-hz-hint">
            Click a country to zoom to it · scroll or double-click to zoom · drag to pan · Esc to reset
          </div>

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
          {featured && (
            <div
              className={`sf-hz-lead${selected ? " selected" : ""}`}
              style={{ borderColor: hexA(SEV_COLOR[featured.severity], 0.7) }}
            >
              <div className="sf-hz-leadhead">
                <span className="sf-hz-leadtag" style={{ color: SEV_COLOR[featured.severity] }}>
                  {SEV_LABEL[featured.severity]}
                </span>
                {selected ? (
                  <button type="button" className="sf-hz-leadclear" onClick={() => setSelected(null)}>
                    Selected from map ✕
                  </button>
                ) : (
                  <span className="sf-hz-leadhint">Most significant right now</span>
                )}
              </div>
              <div className="sf-hz-leadtitle">{featured.title}</div>
              <p>{featured.summary}</p>
              <dl className="sf-hz-facts">
                <div>
                  <dt>Source</dt>
                  <dd>{featured.source}</dd>
                </div>
                {featured.magnitude !== null && (
                  <div>
                    <dt>Measured</dt>
                    <dd>
                      {featured.magnitude.toLocaleString("en-GB")} {featured.unit}
                    </dd>
                  </div>
                )}
                {featured.countryIso2 && (
                  <div>
                    <dt>Country</dt>
                    <dd>{featured.countryIso2}</dd>
                  </div>
                )}
                <div>
                  <dt>Recorded</dt>
                  <dd>{timeAgo(featured.at)}</dd>
                </div>
              </dl>
              <div className="sf-hz-leadpillars">
                {featured.pillars.map((p) => (
                  <span key={p} className="sf-hz-pillar">
                    {p}
                  </span>
                ))}
              </div>
              <div className="sf-hz-leadactions">
                <Link
                  className="sf-hz-ask"
                  href={`/admin/site/jimmy?q=${encodeURIComponent(
                    `There is a ${featured.kind} event — ${featured.title}. What should my household do to be ready for something like this?`
                  )}`}
                >
                  Ask Jimmy what this means for my household →
                </Link>
                {featured.xy && (
                  <button type="button" className="sf-hz-locate" onClick={() => selectEvent(featured)}>
                    Show on map
                  </button>
                )}
                {featured.url && (
                  <a
                    className="sf-hz-locate"
                    href={featured.url}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Source report
                  </a>
                )}
              </div>
            </div>
          )}

          <div className="sf-hz-listhead">
            {country ? `${countryName} — ${shown.length} events` : `${shown.length} events across Europe`}
          </div>

          <ul className="sf-hz-list" ref={listRef}>
            {shown.slice(0, 40).map((e) => (
              <li
                key={e.id}
                ref={(el) => {
                  itemRefs.current[e.id] = el;
                }}
                className={`sf-hz-item${active === e.id ? " active" : ""}${
                  selected === e.id ? " selected" : ""
                }${e.xy ? " clickable" : ""}`}
                onMouseEnter={() => setActive(e.id)}
                onMouseLeave={() => setActive(null)}
                onClick={() => selectEvent(e)}
                title={e.xy ? "Show this event on the map" : undefined}
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

/* Opaque blend of two hex colours — t=0 keeps a, t=1 gives b. */
function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (sh: number) => {
    const va = (pa >> sh) & 255;
    const vb = (pb >> sh) & 255;
    return Math.round(va + (vb - va) * t);
  };
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
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
