"use client";

/* =====================================================================
   LIVE EUROPE — the customer home screen.

   The map is no longer a picture on the page. The map IS the page: a
   satellite basemap filling the viewport, with every panel floating over
   it as translucent glass. That inversion is the whole point — a drawing
   inside a bordered box surrounded by more bordered boxes is what made
   the old version read as a decade-old website, and no palette fixes it.

   Three rules hold the composition together:

     1. The imagery is knocked back in the style itself (desaturated, black
        point lifted, a vignette at the edges) so the panels sit on contrast
        WE control rather than on whatever the tiles happen to show. That is
        also the accessibility fix: overlay text never competes with snow.
     2. Colour is never the only signal. Severity carries a word, a glyph
        and a size as well as an Okabe-Ito hue.
     3. Nothing is invented. Every marker is an upstream record with its own
        identifier; a feed that cannot be reached says so.

   The basemap is a raster source, so swapping imagery provider at launch
   is one URL — see TILES below.
   ===================================================================== */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MlMap, MapMouseEvent } from "maplibre-gl";
import type { HazardEvent, HazardSource, SourceStatus } from "@/lib/hazards/types";
import type { HomeDashboard } from "@/lib/home-dashboard";
import { SEVERITY } from "@/lib/palette";
import { countryName } from "@/lib/iso-ids";

/* ------------------------------------------------------------------ */
/* Basemap                                                             */
/* ------------------------------------------------------------------ */

/* Esri World Imagery: no API key, so the gated demo runs today with no
   credential to provision. At public launch this one entry becomes a
   licensed provider (MapTiler / Mapbox / an Esri Location Platform key)
   and nothing else in this file changes. */
const TILES = "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const TILE_ATTRIBUTION =
  '<a href="https://www.esri.com/" target="_blank" rel="noreferrer">Esri</a>, Maxar, Earthstar Geographics';

/** Whole-continent framing. */
const EUROPE: [[number, number], [number, number]] = [
  [-11.5, 34.5],
  [33.5, 66.5],
];

const SEV_KEYS = ["info", "watch", "elevated", "severe"] as const;
const SEV_LABEL: Record<string, string> = {
  info: "Informational",
  watch: "Worth knowing",
  elevated: "Potentially disruptive",
  severe: "Act on this",
};
const SEV_SHORT: Record<string, string> = {
  info: "Info",
  watch: "Watch",
  elevated: "Disruptive",
  severe: "Act now",
};
const SOURCE_ORDER: HazardSource[] = ["EFFIS", "EMSC", "GDACS", "ENTSOE", "TRANSPORT"];
const KIND_WORD: Record<string, string> = {
  wildfire: "Wildfire",
  earthquake: "Earthquake",
  flood: "Flood",
  storm: "Storm",
  disaster: "Major event",
  grid: "Power grid",
  transport: "Transport",
};

type Props = {
  geo: GeoJSON.FeatureCollection;
  bounds: Record<string, [number, number, number, number]>;
  events: HazardEvent[];
  sources: SourceStatus[];
  generatedAt: string;
  dash: HomeDashboard;
};

/* ------------------------------------------------------------------ */
/* Marker sprites, drawn on a canvas at load                           */
/* ------------------------------------------------------------------ */

/* Symbol layers need images, not SVG. Rather than ship a sprite sheet we
   draw the 28 (kind × severity) markers once into a canvas at 2× — a few
   milliseconds, no extra network request, and the glyph set stays in code
   next to the kinds it describes. */
function drawGlyph(ctx: CanvasRenderingContext2D, kind: string, s: number) {
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = s * 0.17;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  switch (kind) {
    case "wildfire": // flame
      ctx.moveTo(0, -s);
      ctx.bezierCurveTo(s * 0.78, -s * 0.2, s * 0.5, s * 0.62, 0, s);
      ctx.bezierCurveTo(-s * 0.5, s * 0.62, -s * 0.78, -s * 0.2, 0, -s);
      ctx.fill();
      return;
    case "earthquake": // seismogram
      ctx.moveTo(-s, 0);
      ctx.lineTo(-s * 0.45, -s * 0.82);
      ctx.lineTo(-s * 0.08, s * 0.72);
      ctx.lineTo(s * 0.34, -s * 0.7);
      ctx.lineTo(s * 0.68, s * 0.3);
      ctx.lineTo(s, 0);
      ctx.stroke();
      return;
    case "grid": // bolt
      ctx.moveTo(s * 0.3, -s);
      ctx.lineTo(-s * 0.6, s * 0.1);
      ctx.lineTo(-s * 0.06, s * 0.1);
      ctx.lineTo(-s * 0.32, s);
      ctx.lineTo(s * 0.6, -s * 0.16);
      ctx.lineTo(s * 0.06, -s * 0.16);
      ctx.closePath();
      ctx.fill();
      return;
    case "transport": // road chevrons
      ctx.moveTo(-s * 0.72, -s * 0.62);
      ctx.lineTo(0, -s * 0.06);
      ctx.lineTo(-s * 0.72, s * 0.5);
      ctx.moveTo(s * 0.12, -s * 0.62);
      ctx.lineTo(s * 0.84, -s * 0.06);
      ctx.lineTo(s * 0.12, s * 0.5);
      ctx.stroke();
      return;
    case "flood": // waves
      for (let i = -1; i <= 1; i++) {
        const y = i * s * 0.46;
        ctx.moveTo(-s * 0.85, y);
        ctx.quadraticCurveTo(-s * 0.42, y - s * 0.36, 0, y);
        ctx.quadraticCurveTo(s * 0.42, y + s * 0.36, s * 0.85, y);
      }
      ctx.stroke();
      return;
    case "storm": // swirl
      ctx.moveTo(-s * 0.8, -s * 0.45);
      ctx.quadraticCurveTo(s * 0.5, -s * 0.9, s * 0.55, -s * 0.1);
      ctx.quadraticCurveTo(s * 0.6, s * 0.62, -s * 0.3, s * 0.42);
      ctx.stroke();
      return;
    default: // major event — exclamation
      ctx.moveTo(0, -s * 0.78);
      ctx.lineTo(0, s * 0.14);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, s * 0.62, s * 0.17, 0, Math.PI * 2);
      ctx.fill();
      return;
  }
}

function markerImage(kind: string, colour: string, severe: boolean): ImageData | null {
  const px = 48;
  const dpr = 2;
  const c = document.createElement("canvas");
  c.width = px * dpr;
  c.height = px * dpr;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.scale(dpr, dpr);
  ctx.translate(px / 2, px / 2);

  const r = severe ? 12.5 : 11;

  // Soft outer glow — the marker has to survive both dark sea and bright cloud.
  const g = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r * 1.95);
  g.addColorStop(0, hexA(colour, 0.55));
  g.addColorStop(1, hexA(colour, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.95, 0, Math.PI * 2);
  ctx.fill();

  // Disc
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.lineWidth = 1.7;
  ctx.strokeStyle = "rgba(255,255,255,0.92)";
  ctx.stroke();

  drawGlyph(ctx, kind, r * 0.5);
  return ctx.getImageData(0, 0, c.width, c.height);
}

/* ------------------------------------------------------------------ */

export default function LiveEurope({
  geo,
  bounds,
  events,
  sources,
  generatedAt,
  dash,
}: Props) {
  const router = useRouter();
  const holder = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const hoverIso = useRef<string | null>(null);
  const selIso = useRef<string | null>(null);

  const [ready, setReady] = useState(false);
  const [off, setOff] = useState<Set<HazardSource>>(new Set());
  const [severeOnly, setSevereOnly] = useState(false);
  const [country, setCountry] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hoverName, setHoverName] = useState<string | null>(null);
  const [globe, setGlobe] = useState(false);
  const [tab, setTab] = useState<"jimmy" | "guides" | "tested" | "gear">("jimmy");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  const available = useMemo(() => new Set(events.map((e) => e.source)), [events]);
  const liveSources = sources.filter((s) => s.state === "live");
  const severeCount = useMemo(() => events.filter((e) => e.severity === "severe").length, [events]);

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

  const featured = (selected && shown.find((e) => e.id === selected)) || shown[0];

  /* ---------------- map lifecycle ---------------- */

  useEffect(() => {
    let map: MlMap | null = null;
    let cancelled = false;

    (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      if (cancelled || !holder.current) return;

      map = new maplibregl.Map({
        container: holder.current,
        attributionControl: { compact: true },
        maxZoom: 13,
        minZoom: 1.6,
        dragRotate: false,
        pitchWithRotate: false,
        style: {
          version: 8,
          sources: {
            sat: {
              type: "raster",
              tiles: [TILES],
              tileSize: 256,
              maxzoom: 18,
              attribution: TILE_ATTRIBUTION,
            },
          },
          layers: [
            // Painted behind the tiles so the globe's void and any gap while
            // tiles load is deep sea, never white flash.
            { id: "void", type: "background", paint: { "background-color": "#06111b" } },
            {
              id: "sat",
              type: "raster",
              source: "sat",
              paint: {
                // Knocking the imagery back is what lets the glass panels and
                // the markers read. Untouched satellite is far too busy to
                // carry an interface on top of it.
                "raster-saturation": -0.4,
                "raster-contrast": 0.04,
                "raster-brightness-max": 0.8,
              },
            },
          ],
        },
      });
      mapRef.current = map;

      /* "style.load", not "load". The load event waits for the first visually
         complete render, which never arrives if the tile host is slow or
         blocked — and the entire interface would then sit behind a spinner
         because some imagery did not download. The style is all we need in
         order to add our own sources and layers. */
      map.on("style.load", () => {
        if (!map) return;

        for (const kind of Object.keys(KIND_WORD)) {
          for (const sev of SEV_KEYS) {
            const img = markerImage(kind, SEVERITY[sev], sev === "severe");
            if (img && !map.hasImage(`${kind}-${sev}`)) {
              map.addImage(`${kind}-${sev}`, img, { pixelRatio: 2 });
            }
          }
        }

        map.addSource("countries", { type: "geojson", data: geo, promoteId: "iso2" });

        /* Country wash. Subtle by design: a full choropleth over satellite is
           the same mistake as the old flat map, just with photos underneath.
           This reads as weather over the land, and the numbers live in the
           rail where they can be read properly. */
        map.addLayer({
          id: "country-fill",
          type: "fill",
          source: "countries",
          paint: {
            "fill-color": [
              "match",
              ["get", "sev"],
              3, SEVERITY.severe,
              2, SEVERITY.elevated,
              1, SEVERITY.watch,
              0, SEVERITY.info,
              "#ffffff",
            ],
            "fill-opacity": [
              "case",
              ["boolean", ["feature-state", "selected"], false], 0.26,
              ["boolean", ["feature-state", "hover"], false], 0.19,
              ["match", ["get", "sev"], 3, 0.2, 2, 0.15, 1, 0.1, 0, 0.06, 0.012],
            ],
          },
        });

        map.addLayer({
          id: "country-line",
          type: "line",
          source: "countries",
          paint: {
            "line-color": "#ffffff",
            "line-opacity": [
              "case",
              ["boolean", ["feature-state", "selected"], false], 0.9,
              ["boolean", ["feature-state", "hover"], false], 0.6,
              0.18,
            ],
            "line-width": [
              "case",
              ["boolean", ["feature-state", "selected"], false], 2.2,
              ["boolean", ["feature-state", "hover"], false], 1.5,
              0.7,
            ],
          },
        });

        map.addSource("hazards", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });

        map.addLayer({
          id: "hz-halo",
          type: "circle",
          source: "hazards",
          filter: [">=", ["get", "rank"], 2],
          paint: {
            "circle-color": ["get", "colour"],
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 12, 6, 24, 10, 40],
            "circle-blur": 1,
            "circle-opacity": 0.32,
          },
        });

        map.addLayer({
          id: "hz-ring",
          type: "circle",
          source: "hazards",
          filter: ["==", ["get", "sel"], true],
          paint: {
            "circle-color": "rgba(0,0,0,0)",
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 17, 8, 26],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
            "circle-stroke-opacity": 0.95,
          },
        });

        map.addLayer({
          id: "hz-pin",
          type: "symbol",
          source: "hazards",
          layout: {
            "icon-image": ["concat", ["get", "kind"], "-", ["get", "sev"]],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            /* Size is graded by severity as well as zoom. On a continental view
               the 140 routine tremors would otherwise read exactly as loudly as
               the fire someone needs to act on — the ramp has to be visible in
               size, not only in hue. Lower sort keys draw first, so the worst
               events land on top of the pile. */
            "icon-size": [
              "interpolate", ["linear"], ["zoom"],
              2, ["match", ["get", "sev"], "severe", 0.62, "elevated", 0.54, "watch", 0.42, 0.32],
              5, ["match", ["get", "sev"], "severe", 0.82, "elevated", 0.72, "watch", 0.58, 0.46],
              9, ["match", ["get", "sev"], "severe", 1.0, "elevated", 0.92, "watch", 0.8, 0.68],
            ],
            "symbol-sort-key": ["get", "rank"],
          },
          paint: {
            "icon-opacity": [
              "interpolate", ["linear"], ["zoom"],
              2, ["match", ["get", "sev"], "info", 0.5, "watch", 0.8, 1],
              6, 1,
            ],
          },
        });

        /* --------- interaction --------- */

        map.on("click", "hz-pin", (ev: MapMouseEvent & { features?: any[] }) => {
          const f = ev.features?.[0];
          if (!f) return;
          ev.originalEvent.stopPropagation();
          setSelected(String(f.properties.id));
        });

        map.on("click", "country-fill", (ev: MapMouseEvent & { features?: any[] }) => {
          const f = ev.features?.[0];
          if (!f) return;
          setCountry((prev) => (prev === f.properties.iso2 ? null : String(f.properties.iso2)));
        });

        const setHover = (iso2: string | null) => {
          if (hoverIso.current === iso2 || !map) return;
          if (hoverIso.current) {
            map.setFeatureState({ source: "countries", id: hoverIso.current }, { hover: false });
          }
          hoverIso.current = iso2;
          if (iso2) map.setFeatureState({ source: "countries", id: iso2 }, { hover: true });
          setHoverName(iso2 ? countryName(iso2) : null);
        };

        map.on("mousemove", "country-fill", (ev: MapMouseEvent & { features?: any[] }) => {
          const f = ev.features?.[0];
          setHover(f ? String(f.properties.iso2) : null);
          const tip = tipRef.current;
          if (tip) {
            tip.style.transform = `translate(${ev.point.x + 16}px, ${ev.point.y + 16}px)`;
          }
        });
        map.on("mouseleave", "country-fill", () => setHover(null));

        for (const id of ["hz-pin", "country-fill"]) {
          map.on("mouseenter", id, () => {
            if (map) map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", id, () => {
            if (map) map.getCanvas().style.cursor = "";
          });
        }

        map.fitBounds(EUROPE, { padding: framePadding(), duration: 0 });
        setReady(true);
      });
    })();

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
    // Built once. Data changes are pushed through setData below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- push country severity ---------------- */

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src: any = map.getSource("countries");
    if (!src) return;
    const counts: Record<string, { count: number; worst: number }> = {};
    for (const e of shown) {
      if (!e.countryIso2) continue;
      const cur = counts[e.countryIso2] || { count: 0, worst: -1 };
      cur.count++;
      cur.worst = Math.max(cur.worst, SEV_KEYS.indexOf(e.severity as any));
      counts[e.countryIso2] = cur;
    }
    src.setData({
      ...geo,
      features: geo.features.map((f) => {
        const iso2 = (f.properties as any).iso2 as string;
        const agg = counts[iso2];
        return { ...f, properties: { ...f.properties, sev: agg ? agg.worst : -1, n: agg?.count ?? 0 } };
      }),
    });
  }, [geo, shown, ready]);

  /* ---------------- push hazard markers ---------------- */

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src: any = map.getSource("hazards");
    if (!src) return;
    src.setData({
      type: "FeatureCollection",
      features: shown
        .filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lon))
        .map((e) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [e.lon, e.lat] },
          properties: {
            id: e.id,
            kind: KIND_WORD[e.kind] ? e.kind : "disaster",
            sev: e.severity,
            rank: SEV_KEYS.indexOf(e.severity as any),
            colour: SEVERITY[e.severity],
            sel: e.id === selected,
          },
        })),
    });
  }, [shown, selected, ready]);

  /* ---------------- country selection → camera ---------------- */

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (selIso.current) {
      map.setFeatureState({ source: "countries", id: selIso.current }, { selected: false });
    }
    selIso.current = country;
    if (country) {
      map.setFeatureState({ source: "countries", id: country }, { selected: true });
      const b = bounds[country];
      if (b) {
        map.fitBounds([[b[0], b[1]], [b[2], b[3]]], {
          padding: framePadding(),
          duration: 900,
          maxZoom: 8,
        });
      }
    } else {
      map.fitBounds(EUROPE, { padding: framePadding(), duration: 900 });
    }
  }, [country, bounds, ready]);

  /* ---------------- selected event → camera + rail ---------------- */

  useEffect(() => {
    if (!selected) return;
    const e = events.find((x) => x.id === selected);
    const map = mapRef.current;
    if (e && map && ready && Number.isFinite(e.lat)) {
      map.flyTo({
        center: [e.lon, e.lat],
        zoom: Math.max(map.getZoom(), 6),
        duration: 900,
        padding: framePadding(),
      });
    }
    // Scroll the LIST, never the page — scrollIntoView walks up and scrolls
    // every scrollable ancestor, which throws the reader past the site nav.
    const t = window.setTimeout(() => {
      const list = listRef.current;
      const item = itemRefs.current[selected];
      if (!list || !item) return;
      const top = item.offsetTop;
      const bottom = top + item.offsetHeight;
      if (top < list.scrollTop) list.scrollTo({ top: top - 8, behavior: "smooth" });
      else if (bottom > list.scrollTop + list.clientHeight)
        list.scrollTo({ top: bottom - list.clientHeight + 8, behavior: "smooth" });
    }, 60);
    return () => window.clearTimeout(t);
  }, [selected, events, ready]);

  /* ---------------- globe / flat ---------------- */

  useEffect(() => {
    const map = mapRef.current as any;
    if (!map || !ready || typeof map.setProjection !== "function") return;
    try {
      map.setProjection({ type: globe ? "globe" : "mercator" });
    } catch {
      /* projection unsupported in this build — the flat map is the fallback */
    }
  }, [globe, ready]);

  /* ---------------- narrow screens ----------------
     Below the breakpoint the panels are bottom sheets, so two open at once
     would stack on top of each other. One at a time, and neither to start:
     the point of arriving is seeing the map. */
  const narrow = useRef(false);
  useEffect(() => {
    const check = () => {
      const isNarrow = window.innerWidth < 900;
      if (isNarrow === narrow.current) return;
      narrow.current = isNarrow;
      setLeftOpen(!isNarrow);
      setRightOpen(!isNarrow);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const openLeft = useCallback((v: boolean) => {
    setLeftOpen(v);
    if (v && narrow.current) setRightOpen(false);
  }, []);
  const openRight = useCallback((v: boolean) => {
    setRightOpen(v);
    if (v && narrow.current) setLeftOpen(false);
  }, []);

  /* ---------------- keyboard ---------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (selected) setSelected(null);
      else if (country) setCountry(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, country]);

  // A layer toggle or a country change can filter the selected event away.
  useEffect(() => {
    if (selected && !shown.some((e) => e.id === selected)) setSelected(null);
  }, [shown, selected]);

  /* ---------------- handlers ---------------- */

  const zoom = useCallback((dir: 1 | -1) => {
    const map = mapRef.current;
    if (!map) return;
    if (dir === 1) map.zoomIn({ duration: 300 });
    else map.zoomOut({ duration: 300 });
  }, []);

  const resetView = useCallback(() => {
    setCountry(null);
    setSelected(null);
    mapRef.current?.fitBounds(EUROPE, { padding: framePadding(), duration: 800 });
  }, []);

  function toggleSource(src: HazardSource) {
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(src)) next.delete(src);
      else next.add(src);
      return next;
    });
  }

  const askJimmy = useCallback(
    (q: string) => router.push(`/admin/site/jimmy?q=${encodeURIComponent(q)}`),
    [router]
  );

  /* ---------------- render ---------------- */

  return (
    <div className={`sf-live${leftOpen ? " l-open" : ""}${rightOpen ? " r-open" : ""}`}>
      <div ref={holder} className="sf-live-canvas" aria-label="Live satellite map of Europe" />
      <div className="sf-live-vignette" aria-hidden="true" />

      {hoverName && (
        <div ref={tipRef} className="sf-live-tip" aria-hidden="true">
          {hoverName}
        </div>
      )}

      {!ready && (
        <div className="sf-live-boot">
          <span />
          Bringing Europe into view…
        </div>
      )}

      {/* ---------------- top status bar ---------------- */}
      <header className="sf-live-top">
        <span className="sf-live-pulse">
          <i />
          Live
        </span>
        <span className="sf-live-stat">
          <strong>{shown.length}</strong> conditions
        </span>
        {severeCount > 0 && (
          <span className="sf-live-stat urgent">
            <strong>{severeCount}</strong> need action
          </span>
        )}
        <span className="sf-live-srcdots" title={`${liveSources.length} feeds reporting`}>
          {liveSources.map((s) => (
            <i key={s.source} data-src={s.source} />
          ))}
          {liveSources.length} feeds
        </span>
        <span className="sf-live-when">updated {timeAgo(generatedAt)}</span>
        <span className="sf-live-spacer" />
        {country && (
          <button type="button" className="sf-live-chip on" onClick={() => setCountry(null)}>
            {countryName(country)} <b>✕</b>
          </button>
        )}
        <Link href="/admin/site/catalogue" className="sf-live-cta">
          Browse equipment
        </Link>
      </header>

      {/* ---------------- left: conditions ---------------- */}
      <button
        type="button"
        className="sf-live-tab l"
        onClick={() => openLeft(!leftOpen)}
        aria-expanded={leftOpen}
      >
        {leftOpen ? "‹" : "›"}
        <span>Conditions</span>
      </button>

      <aside className="sf-live-left" aria-label="Live conditions">
        <div className="sf-live-filters">
          {SOURCE_ORDER.map((src) => {
            const st = sources.find((s) => s.source === src);
            if (!st) return null;
            const dead = st.state !== "live";
            return (
              <button
                key={src}
                type="button"
                className={`sf-live-chip${off.has(src) ? " off" : ""}${dead ? " dead" : ""}`}
                onClick={() => toggleSource(src)}
                disabled={dead && !available.has(src)}
                title={dead ? st.detail : st.what}
              >
                <i data-src={src} />
                {st.label}
                {!dead && <b>{st.count}</b>}
              </button>
            );
          })}
          <button
            type="button"
            className={`sf-live-chip alt${severeOnly ? " on" : ""}`}
            onClick={() => setSevereOnly((v) => !v)}
          >
            Disruptive only
          </button>
        </div>

        {featured && (
          <article className="sf-live-feature" style={{ ["--sev" as any]: SEVERITY[featured.severity] }}>
            <div className="sf-live-featuretop">
              <span className="sf-live-sev">
                <i />
                {SEV_LABEL[featured.severity]}
              </span>
              {selected ? (
                <button type="button" className="sf-live-x" onClick={() => setSelected(null)}>
                  Clear ✕
                </button>
              ) : (
                <span className="sf-live-hintword">Most significant now</span>
              )}
            </div>
            <h3>{featured.title}</h3>
            <p>{featured.summary}</p>
            <dl className="sf-live-facts">
              <div>
                <dt>Type</dt>
                <dd>{KIND_WORD[featured.kind] || featured.kind}</dd>
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
                  <dt>Where</dt>
                  <dd>{countryName(featured.countryIso2)}</dd>
                </div>
              )}
              <div>
                <dt>Recorded</dt>
                <dd>{timeAgo(featured.at)}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{featured.source}</dd>
              </div>
            </dl>
            <div className="sf-live-pillars">
              {featured.pillars.map((p) => (
                <span key={p}>{p}</span>
              ))}
            </div>
            <div className="sf-live-actions">
              <button
                type="button"
                className="sf-live-ask"
                onClick={() =>
                  askJimmy(
                    `There is a ${featured.kind} event — ${featured.title}. What should my household do to be ready for something like this?`
                  )
                }
              >
                Ask Jimmy what this means for us →
              </button>
              <button type="button" className="sf-live-ghost" onClick={() => setSelected(featured.id)}>
                Show on map
              </button>
              {featured.url && (
                <a
                  className="sf-live-ghost"
                  href={featured.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Source
                </a>
              )}
            </div>
          </article>
        )}

        <div className="sf-live-listhead">
          {country ? `${countryName(country)} — ${shown.length}` : `${shown.length} across Europe`}
          <span>worst first</span>
        </div>

        <ul className="sf-live-list" ref={listRef}>
          {shown.slice(0, 60).map((e) => (
            <li
              key={e.id}
              ref={(el) => {
                itemRefs.current[e.id] = el;
              }}
              className={`sf-live-item${selected === e.id ? " on" : ""}`}
              style={{ ["--sev" as any]: SEVERITY[e.severity] }}
              onClick={() => setSelected(e.id)}
            >
              <span className="sf-live-itemsev" title={SEV_LABEL[e.severity]}>
                {SEV_SHORT[e.severity]}
              </span>
              <div>
                <strong>{e.title}</strong>
                <p>{e.summary}</p>
                <span className="sf-live-itemmeta">
                  {e.countryIso2 ? countryName(e.countryIso2) : "Offshore"} · {e.source} ·{" "}
                  {timeAgo(e.at)}
                </span>
              </div>
            </li>
          ))}
          {!shown.length && (
            <li className="sf-live-empty">
              Nothing matches these filters. Europe being quiet is the normal case — the point of
              preparing is that it is not the only case.
            </li>
          )}
        </ul>
      </aside>

      {/* ---------------- right: Jimmy + the rest of the site ---------------- */}
      <button
        type="button"
        className="sf-live-tab r"
        onClick={() => openRight(!rightOpen)}
        aria-expanded={rightOpen}
      >
        {rightOpen ? "›" : "‹"}
        <span>Your readiness</span>
      </button>

      <aside className="sf-live-right" aria-label="Jimmy and knowledge">
        <nav className="sf-live-tabs">
          {(
            [
              ["jimmy", "Jimmy"],
              ["guides", "Guides"],
              ["tested", "Tested"],
              ["gear", "Gear"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={tab === k ? "on" : ""}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="sf-live-tabbody">
          {tab === "jimmy" && <JimmyTab dash={dash} onAsk={askJimmy} featured={featured} />}

          {tab === "guides" && (
            <div className="sf-live-cards">
              {dash.guides.map((g) => (
                <Link key={g.slug} href={`/admin/site/guides/${g.slug}`} className="sf-live-card">
                  <span className="sf-live-kicker">{g.pillar || g.category}</span>
                  <strong>{g.title}</strong>
                  <p>{g.summary}</p>
                  <span className="sf-live-meta">{g.readMin} min read</span>
                </Link>
              ))}
              <Link href="/admin/site/guides" className="sf-live-more">
                All guides →
              </Link>
            </div>
          )}

          {tab === "tested" && (
            <div className="sf-live-cards">
              {dash.tested.map((t) => (
                <Link key={t.code} href={`/admin/site/tested/${t.code}`} className="sf-live-card row">
                  {t.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t.image} alt="" width={64} height={64} decoding="async" />
                  )}
                  <span>
                    {t.brand && <span className="sf-live-kicker">{t.brand}</span>}
                    <strong>{t.product}</strong>
                    <span className="sf-live-meta">
                      <b>
                        {t.passed}/{t.total}
                      </b>{" "}
                      checkpoints met · {shortDate(t.when)}
                    </span>
                  </span>
                </Link>
              ))}
              <Link href="/admin/site/tested" className="sf-live-more">
                All reports →
              </Link>
            </div>
          )}

          {tab === "gear" && (
            <div className="sf-live-cards">
              {dash.heroes.map((p) => (
                <Link
                  key={p.slug}
                  href={`/admin/site/catalogue/${p.slug}`}
                  className="sf-live-card row"
                >
                  {p.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image} alt="" width={64} height={64} decoding="async" />
                  )}
                  <span>
                    <span className="sf-live-kicker">{p.category}</span>
                    <strong>{p.name}</strong>
                    <span className="sf-live-meta">{p.price !== null ? eur(p.price) : ""}</span>
                  </span>
                </Link>
              ))}
              <Link href="/admin/site/catalogue" className="sf-live-more">
                Full catalogue →
              </Link>
            </div>
          )}
        </div>
      </aside>

      {/* ---------------- map controls ---------------- */}
      <div className="sf-live-controls" role="group" aria-label="Map controls">
        <button type="button" onClick={() => zoom(1)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoom(-1)} aria-label="Zoom out">
          −
        </button>
        <button type="button" onClick={resetView} aria-label="Back to the whole continent">
          ⤢
        </button>
        <button
          type="button"
          className={globe ? "on" : ""}
          onClick={() => setGlobe((v) => !v)}
          aria-pressed={globe}
          title={globe ? "Flat map" : "Globe"}
        >
          ◍
        </button>
      </div>

      <div className="sf-live-legend">
        {SEV_KEYS.slice()
          .reverse()
          .map((s) => (
            <span key={s}>
              <i style={{ background: SEVERITY[s] }} />
              {SEV_LABEL[s]}
            </span>
          ))}
        <em>Our reading of the published figures, not an official alert.</em>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function JimmyTab({
  dash,
  onAsk,
  featured,
}: {
  dash: HomeDashboard;
  onAsk: (q: string) => void;
  featured?: HazardEvent;
}) {
  const [q, setQ] = useState("");
  const prompts = [
    "We lose power a few times each winter",
    "I have two kids under five",
    "How much water should we store?",
    "The tap water is not safe — what now?",
  ];
  return (
    <div className="sf-live-jimmy">
      <div className="sf-live-jmark" aria-hidden="true">
        <svg viewBox="0 0 48 48" width="40" height="40">
          <path d="M24 3 L42 13.5 V34.5 L24 45 L6 34.5 V13.5 Z" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M24 12 L33.5 17.5 V28.5 L24 34 L14.5 28.5 V17.5 Z" fill="currentColor" opacity=".85" />
        </svg>
      </div>
      <h3>Protect the people you love.</h3>
      <p>
        Jimmy learns how your household actually lives, then builds the preparedness system that
        fits it. Around five minutes.
      </p>
      <form
        className="sf-live-jform"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) onAsk(q.trim());
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask Jimmy anything…"
          aria-label="Ask Jimmy"
        />
        <button type="submit">{q.trim() ? "Ask" : "Start"}</button>
      </form>
      <div className="sf-live-jprompts">
        {featured?.countryIso2 && (
          <button
            type="button"
            className="ctx"
            onClick={() =>
              onAsk(
                `Conditions in ${countryName(featured.countryIso2)} right now include: ${featured.title}. What does my household need?`
              )
            }
          >
            About {countryName(featured.countryIso2)} right now
          </button>
        )}
        {prompts.map((p) => (
          <button key={p} type="button" onClick={() => onAsk(p)}>
            {p}
          </button>
        ))}
      </div>
      <div className="sf-live-jstats">
        <div>
          <strong>{dash.stats.products.toLocaleString("en-GB")}</strong>
          <span>Products assessed</span>
        </div>
        <div>
          <strong>{dash.stats.markets}</strong>
          <span>European markets</span>
        </div>
        <div>
          <strong>{dash.stats.suppliers}</strong>
          <span>Suppliers traced</span>
        </div>
        <div>
          <strong>{dash.stats.checkpoints.toLocaleString("en-GB")}</strong>
          <span>Test checkpoints</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** Keep the camera clear of the floating panels: what looks centred has to
    be centred in the *visible* map, not in the container the panels cover. */
function framePadding() {
  if (typeof window === "undefined") return 40;
  const w = window.innerWidth;
  if (w < 900) return { top: 96, bottom: 220, left: 24, right: 24 };
  return { top: 96, bottom: 90, left: 420, right: 400 };
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function eur(n: number): string {
  return `€${n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shortDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "recently";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}
