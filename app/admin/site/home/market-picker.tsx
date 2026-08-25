"use client";

/* =====================================================================
   COUNTRY CHOOSER

   Two jobs, and they want different shapes.

   On a first visit it is a question worth asking, because everything on
   the page gets better once it is answered — so it appears over the map
   as a glass panel and the map keeps moving behind it. It is NOT a wall:
   "show me all of Europe" is a real answer, sitting in the same place as
   the flags, not hidden in a corner as a dismissal.

   Afterwards it is a control, not a question: a flag button in the
   status strip that reopens the same panel.

   What we deliberately do NOT do is geolocate and reshape the shop
   around a guess. An IP tells you where a connection terminates, not
   where someone lives, and a household that opens this in an airport
   should not be shown Frankfurt's flood warnings as "yours". Asking
   costs one click and is right every time.
   ===================================================================== */

import { useEffect, useMemo, useRef, useState } from "react";
import { MARKET_COOKIE, MARKET_GROUPS, flagSrc } from "@/lib/market";
import { countryName } from "@/lib/iso-ids";

type Props = {
  /** From the cookie, read on the server so there is no default-then-rearrange. */
  initial: string | null;
  /** Countries with at least one condition right now — worth surfacing. */
  active: Record<string, number>;
  onPick: (iso2: string | null) => void;
};

export default function MarketPicker({ initial, active, onPick }: Props) {
  // Open on a first visit, closed once a choice exists. `initial` comes from the
  // server, so this is right on the first paint rather than after a flash.
  const [open, setOpen] = useState(initial === null);
  const [q, setQ] = useState("");
  const [current, setCurrent] = useState<string | null>(initial);
  const boxRef = useRef<HTMLDivElement | null>(null);

  function choose(iso2: string | null) {
    setCurrent(iso2);
    setOpen(false);
    setQ("");
    // A year: this is a preference, not a session. SameSite=Lax so it survives
    // a link from an email or a search result, which is how most people will
    // arrive at a market page once SC 02's prefixes exist.
    const base = `path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    document.cookie = iso2
      ? `${MARKET_COOKIE}=${iso2}; ${base}`
      : `${MARKET_COOKIE}=; path=/; max-age=0; samesite=lax`;
    onPick(iso2);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const needle = q.trim().toLowerCase();
  const groups = useMemo(
    () =>
      MARKET_GROUPS.map((g) => ({
        ...g,
        codes: needle
          ? g.codes.filter(
              (c) =>
                (countryName(c) || c).toLowerCase().includes(needle) ||
                c.toLowerCase().startsWith(needle)
            )
          : g.codes,
      })).filter((g) => g.codes.length),
    [needle]
  );

  const hits = groups.reduce((n, g) => n + g.codes.length, 0);

  return (
    <>
      <button
        type="button"
        className={`sf-mkbtn${current ? " on" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Choose your country"
      >
        {current ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={flagSrc(current)} alt="" width={20} height={15} />
            {countryName(current)}
          </>
        ) : (
          <>
            <span className="sf-mkglobe" aria-hidden="true">◍</span>
            All of Europe
          </>
        )}
      </button>

      {open && (
        <div className="sf-mkwrap" role="dialog" aria-label="Choose your country">
          <div className="sf-mkscrim" onClick={() => setOpen(false)} />
          <div className="sf-mkbox" ref={boxRef}>
            <div className="sf-mkhead">
              <div>
                <h2>{initial === null ? "Where do you live?" : "Change country"}</h2>
                <p>
                  We will centre the map on your country, lead with the warnings that apply to you,
                  and tell you what your national alert system actually is. You can change it any
                  time.
                </p>
              </div>
              <button type="button" className="sf-mkclose" onClick={() => setOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>

            <input
              className="sf-mksearch"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search…"
              aria-label="Search countries"
              autoFocus
            />

            <div className="sf-mkscroll">
              {groups.map((g) => (
                <div key={g.label} className="sf-mkgroup">
                  <div className="sf-mkgrouphead">
                    <strong>{g.label}</strong>
                    <span>{g.note}</span>
                  </div>
                  <div className="sf-mkgrid">
                    {g.codes.map((c) => {
                      const n = active[c] || 0;
                      return (
                        <button
                          key={c}
                          type="button"
                          className={`sf-mkflag${current === c ? " on" : ""}`}
                          onClick={() => choose(c)}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={flagSrc(c)} alt="" width={28} height={21} />
                          <span>{countryName(c) || c}</span>
                          {/* A live count is the honest reason to look at a
                              country, and it is real: it comes from the same
                              query the map draws from. */}
                          {n > 0 && <i title={`${n} conditions active`}>{n}</i>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {!hits && <div className="sf-mkempty">No country matches “{q}”.</div>}
            </div>

            <div className="sf-mkfoot">
              <button type="button" className="sf-mkall" onClick={() => choose(null)}>
                Show me all of Europe
              </button>
              <span>
                We do not guess your location. Nothing here is sent anywhere — the choice is stored
                on your own device.
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
