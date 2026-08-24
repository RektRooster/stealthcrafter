"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import {
  PILLAR_LABEL,
  findSpofs,
  projectDecay,
  recommend,
  simulate,
} from "@/lib/kit/sim";
import type { Household, KitItem, Pillar, Scenario, SimResult } from "@/lib/kit/sim";
import { OFFICIAL_LISTS, SCENARIOS } from "@/lib/kit/scenarios";

type CatItem = KitItem & { image: string | null; hero: boolean; pillar: string | null };

type Props = {
  catalogue: CatItem[];
  liveHints: string[]; // hazard sources currently live, used to suggest scenarios
};

const PILLAR_COLOR: Record<Pillar, string> = {
  water: "#5fa8d3",
  food: "#8fbf6a",
  heat: "#f5913c",
  power: "#f2c744",
  light: "#e0d5b0",
  medical: "#e0655f",
};

const CARRY_LIMIT_PER_ADULT = 12;
const CARRY_LIMIT_PER_CHILD = 4;

function hrs(h: number): string {
  if (!Number.isFinite(h)) return "∞";
  if (h < 1) return "<1 h";
  if (h < 48) return `${Math.round(h)} h`;
  const d = h / 24;
  return d < 14 ? `${d.toFixed(1)} d` : `${Math.round(d)} d`;
}

function eur(n: number): string {
  return `€${n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function KitBuilder({ catalogue, liveHints }: Props) {
  const [household, setHousehold] = useState<Household>({
    adults: 2,
    children: 1,
    infants: 0,
    pets: 0,
    medicalPower: false,
    countryIso2: "DE",
  });
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [kit, setKit] = useState<KitItem[]>([]);
  const [browse, setBrowse] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [listId, setListId] = useState(OFFICIAL_LISTS[0].id);

  const scenario: Scenario = useMemo(
    () => SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0],
    [scenarioId]
  );

  const sim: SimResult = useMemo(
    () => simulate(household, scenario, kit),
    [household, scenario, kit]
  );

  const recs = useMemo(
    () => recommend(household, scenario, kit, catalogue, 6),
    [household, scenario, kit, catalogue]
  );

  const spofs = useMemo(() => findSpofs(kit), [kit]);
  const decay = useMemo(
    () => (kit.length ? projectDecay(household, scenario, kit, 36) : []),
    [household, scenario, kit]
  );

  const carryLimit =
    household.adults * CARRY_LIMIT_PER_ADULT + household.children * CARRY_LIMIT_PER_CHILD;

  /* ------------------------------ kit ops ------------------------------ */

  const add = useCallback((item: KitItem) => {
    setKit((prev) => {
      const found = prev.find((i) => i.id === item.id);
      if (found) return prev.map((i) => (i.id === item.id ? { ...i, qty: i.qty + 1 } : i));
      return [...prev, { ...item, qty: 1 }];
    });
  }, []);

  const bump = useCallback((id: string, delta: number) => {
    setKit((prev) =>
      prev
        .map((i) => (i.id === id ? { ...i, qty: i.qty + delta } : i))
        .filter((i) => i.qty > 0)
    );
  }, []);

  /** Greedy build: repeatedly buy the best hours-per-euro until the budget is gone. */
  const autoBuild = useCallback(
    (budget: number) => {
      let current: KitItem[] = [];
      let spent = 0;
      for (let step = 0; step < 60; step++) {
        const options = recommend(household, scenario, current, catalogue, 14);
        if (!options.length) break;
        const pick = options.find((o) => spent + (o.item.price ?? 0) <= budget);
        if (!pick) break;
        current = [...current, { ...pick.item, qty: 1 }];
        spent += pick.item.price ?? 0;
        const s = simulate(household, scenario, current);
        // Comfortably clear on every pillar — stop before it starts gold-plating.
        if (s.failureHour >= scenario.hours * 1.5) break;
      }
      setKit(current);
    },
    [household, scenario, catalogue]
  );

  /* --------------------------- official list --------------------------- */

  const list = OFFICIAL_LISTS.find((l) => l.id === listId) ?? OFFICIAL_LISTS[0];
  const listResult = list.items.map((li) => ({
    label: li.label,
    met: kit.some((k) => li.match.test(`${k.name} ${k.category}`)),
  }));
  const listMet = listResult.filter((r) => r.met).length;

  /* ----------------------------- rendering ----------------------------- */

  const filtered = useMemo(() => {
    const q = browse.trim().toLowerCase();
    const base = q
      ? catalogue.filter((c) => `${c.name} ${c.brand ?? ""} ${c.category}`.toLowerCase().includes(q))
      : catalogue;
    return base.slice(0, 60);
  }, [browse, catalogue]);

  const suggested = SCENARIOS.filter((s) => s.hazardHint && liveHints.includes(s.hazardHint));

  const askJimmy = `/admin/site/jimmy?q=${encodeURIComponent(
    `I ran the kit builder for a household of ${household.adults} adults, ${household.children} children and ${household.infants} infants against "${scenario.label}". My kit fails at hour ${Math.round(sim.failureHour)} of ${scenario.hours}, and my weakest pillar is ${PILLAR_LABEL[sim.weakest]}. What should I do about it?`
  )}`;

  return (
    <main className="sf-page">
      <div className="sf-kbwrap">
        <header className="sf-kbhead">
          <div className="sf-hz-kicker">Kit Builder</div>
          <h1>Your kit has a failure clock. Here is the hour it breaks.</h1>
          <p>
            Not a checklist. A simulation. Tell it who lives in your home and what goes wrong, and it
            runs the resources down hour by hour until something gives — then works out the cheapest
            way to buy those hours back.
          </p>
        </header>

        {/* ---------------- household + scenario ---------------- */}
        <section className="sf-kbsetup">
          <div className="sf-kbpanel">
            <div className="sf-kbpaneltitle">Household</div>
            <div className="sf-kbcounts">
              {(
                [
                  ["adults", "Adults"],
                  ["children", "Children 4–17"],
                  ["infants", "Under 4"],
                  ["pets", "Pets"],
                ] as [keyof Household, string][]
              ).map(([key, label]) => (
                <div key={key} className="sf-kbcount">
                  <span>{label}</span>
                  <div className="sf-kbstep">
                    <button
                      type="button"
                      onClick={() =>
                        setHousehold((h) => ({ ...h, [key]: Math.max(0, (h[key] as number) - 1) }))
                      }
                      aria-label={`Fewer ${label}`}
                    >
                      −
                    </button>
                    <strong>{household[key] as number}</strong>
                    <button
                      type="button"
                      onClick={() =>
                        setHousehold((h) => ({ ...h, [key]: Math.min(12, (h[key] as number) + 1) }))
                      }
                      aria-label={`More ${label}`}
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <label className="sf-check">
              <input
                type="checkbox"
                checked={household.medicalPower}
                onChange={() => setHousehold((h) => ({ ...h, medicalPower: !h.medicalPower }))}
              />
              Someone depends on powered medical equipment
            </label>
          </div>

          <div className="sf-kbpanel">
            <div className="sf-kbpaneltitle">
              Scenario
              {suggested.length > 0 && (
                <span className="sf-kblive">
                  ● {suggested.length} flagged by live conditions
                </span>
              )}
            </div>
            <div className="sf-kbscen">
              {SCENARIOS.map((s) => {
                const live = suggested.some((x) => x.id === s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`sf-kbscenopt${s.id === scenarioId ? " on" : ""}${live ? " live" : ""}`}
                    onClick={() => setScenarioId(s.id)}
                  >
                    <strong>{s.label}</strong>
                    <span>
                      {s.hours} h · {s.tempC}°C{s.gridDown ? " · grid down" : ""}
                      {s.mainsWaterDown ? " · no mains water" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="sf-kbscensum">{scenario.summary}</p>
          </div>
        </section>

        {/* ---------------- the failure clock ---------------- */}
        <section className={`sf-clock${sim.survived ? " ok" : ""}`}>
          <div className="sf-clockmain">
            <div className="sf-clocklabel">
              {kit.length === 0
                ? "Nothing in the kit yet"
                : sim.survived
                ? "Your kit outlasts this scenario"
                : "Your kit fails at"}
            </div>
            <div className="sf-clockbig">
              {kit.length === 0 ? "hour 0" : sim.survived ? hrs(sim.failureHour) : `hour ${Math.round(sim.failureHour)}`}
              <span>of {scenario.hours}</span>
            </div>
            <div className="sf-clocksub">
              {kit.length === 0 ? (
                <>Add items, or let the builder assemble one for you.</>
              ) : (
                <>
                  Weakest pillar: <strong style={{ color: PILLAR_COLOR[sim.weakest] }}>{PILLAR_LABEL[sim.weakest]}</strong>
                  {" — "}the household is only as ready as this one.
                </>
              )}
            </div>
          </div>
          <div className="sf-clockside">
            <div>
              <dt>Kit value</dt>
              <dd>{eur(sim.totalCost)}</dd>
            </div>
            <div>
              <dt>Weight</dt>
              <dd className={scenario.evacuation && sim.totalWeightKg > carryLimit ? "over" : ""}>
                {sim.totalWeightKg.toFixed(1)} kg
                {scenario.evacuation && <span> / {carryLimit} kg carry limit</span>}
              </dd>
            </div>
            <div>
              <dt>Items</dt>
              <dd>{kit.reduce((t, i) => t + i.qty, 0)}</dd>
            </div>
          </div>
        </section>

        {/* ---------------- pillar timeline ---------------- */}
        <section className="sf-panelbox">
          <h2>How long each pillar lasts</h2>
          <div className="sf-timeline">
            {sim.pillars.map((p) => {
              const max = scenario.hours * 1.5;
              const w = Math.min(100, (Math.min(p.runwayHours, max) / max) * 100);
              const fails = p.runwayHours < scenario.hours;
              return (
                <div key={p.pillar} className="sf-tlrow">
                  <span className="sf-tllabel">{PILLAR_LABEL[p.pillar]}</span>
                  <div className="sf-tltrack">
                    <div
                      className={`sf-tlbar${fails ? " fails" : ""}`}
                      style={{ width: `${w}%`, background: PILLAR_COLOR[p.pillar] }}
                    />
                    <div
                      className="sf-tlmark"
                      style={{ left: `${(scenario.hours / max) * 100}%` }}
                      title={`Scenario ends at ${scenario.hours} h`}
                    />
                  </div>
                  <span className={`sf-tlval${fails ? " fails" : ""}`}>{hrs(p.runwayHours)}</span>
                </div>
              );
            })}
          </div>
          <div className="sf-tlkey">
            <span className="sf-tlkeymark" /> scenario ends at {scenario.hours} h · a bar short of
            the line is a pillar that runs out before help arrives
          </div>
          <div className="sf-tldetail">
            {sim.pillars.map((p) => (
              <div key={p.pillar}>
                <dt style={{ color: PILLAR_COLOR[p.pillar] }}>{PILLAR_LABEL[p.pillar]}</dt>
                <dd>
                  {p.supplyLabel}
                  <br />
                  <span>{p.demandLabel}</span>
                </dd>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------- recommendations ---------------- */}
        <section className="sf-panelbox accent">
          <div className="sf-kbrowhead">
            <h2>The best next euro</h2>
            <div className="sf-kbauto">
              <span>Or build one for me:</span>
              {[150, 300, 600].map((b) => (
                <button key={b} type="button" onClick={() => autoBuild(b)}>
                  €{b}
                </button>
              ))}
              {kit.length > 0 && (
                <button type="button" className="clear" onClick={() => setKit([])}>
                  Clear
                </button>
              )}
            </div>
          </div>
          <p className="sf-kblede">
            Ranked by hours of survival gained per euro, always against your weakest pillar. It is
            optimising your resilience, not our basket total.
          </p>
          {recs.length ? (
            <div className="sf-recs">
              {recs.map((r) => (
                <div key={r.item.id} className="sf-rec">
                  <div className="sf-recgain">
                    +{hrs(r.hoursGained)}
                    <span>for {eur(r.item.price ?? 0)}</span>
                  </div>
                  <div className="sf-recbody">
                    <strong>{r.item.name}</strong>
                    <span className="sf-recreason">{r.reason}</span>
                    <span className="sf-recmeta">
                      {r.item.category}
                      {r.item.weightKg ? ` · ${r.item.weightKg.toFixed(2)} kg` : ""}
                      {r.item.attrs.basis === "typical" ? " · capacity estimated" : ""}
                    </span>
                  </div>
                  <button type="button" className="sf-recadd" onClick={() => add(r.item)}>
                    Add
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="sf-panelempty">
              {kit.length === 0
                ? "Pick a budget above and the builder will assemble the strongest kit it can."
                : "Nothing in the catalogue would meaningfully extend this kit under this scenario. Try a harder scenario."}
            </p>
          )}
        </section>

        {/* ---------------- the kit ---------------- */}
        <section className="sf-panelbox">
          <div className="sf-kbrowhead">
            <h2>Your kit — {kit.reduce((t, i) => t + i.qty, 0)} items</h2>
            <button type="button" className="sf-kbaddbtn" onClick={() => setShowAdd((v) => !v)}>
              {showAdd ? "Done" : "Add from catalogue"}
            </button>
          </div>

          {showAdd && (
            <div className="sf-kbbrowse">
              <input
                className="sf-catsearch"
                value={browse}
                onChange={(e) => setBrowse(e.target.value)}
                placeholder="Search products the simulator understands…"
              />
              <div className="sf-kbbrowselist">
                {filtered.map((c) => (
                  <button key={c.id} type="button" className="sf-kbbrowseitem" onClick={() => add(c)}>
                    <strong>{c.name}</strong>
                    <span>
                      {c.category} · {c.price !== null ? eur(c.price) : "—"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {kit.length ? (
            <ul className="sf-kitlist">
              {kit.map((i) => (
                <li key={i.id}>
                  <div className="sf-kitqty">
                    <button type="button" onClick={() => bump(i.id, -1)} aria-label="Remove one">−</button>
                    <strong>{i.qty}</strong>
                    <button type="button" onClick={() => bump(i.id, 1)} aria-label="Add one">+</button>
                  </div>
                  <div className="sf-kitinfo">
                    <Link href={`/admin/site/catalogue/${i.slug}`}>{i.name}</Link>
                    <span>
                      {i.category}
                      {i.weightKg ? ` · ${(i.weightKg * i.qty).toFixed(2)} kg` : ""}
                      {i.shelfMonths ? ` · ${i.shelfMonths} mo shelf life` : ""}
                      {i.attrs.basis === "typical" ? " · capacity estimated" : ""}
                    </span>
                  </div>
                  <span className="sf-kitprice">{eur((i.price ?? 0) * i.qty)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="sf-panelempty">Empty. Use a budget button above, or add from the catalogue.</p>
          )}
        </section>

        {/* ---------------- analysis ---------------- */}
        <div className="sf-kbcols">
          <section className="sf-panelbox">
            <h2>Single points of failure</h2>
            {spofs.length ? (
              <ul className="sf-spofs">
                {spofs.map((s) => (
                  <li key={`${s.pillar}-${s.fuel}`}>
                    <strong>{Math.round(s.share * 100)}%</strong> of your {s.pillar} depends on{" "}
                    {s.fuel}. If that one supply fails, {s.count} items fail together.
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sf-panelempty">
                {kit.length < 2
                  ? "Add a few items and this will check whether they all share one dependency."
                  : "No single supply carries the majority of your heat or power. That is what you want."}
              </p>
            )}
          </section>

          <section className="sf-panelbox">
            <h2>How it ages</h2>
            {decay.length ? (
              <>
                <div className="sf-decay">
                  {decay.map((d) => {
                    const h = Math.min(100, (d.failureHour / (scenario.hours * 1.5)) * 100);
                    const fails = d.failureHour < scenario.hours;
                    return (
                      <div key={d.month} className="sf-decaycol" title={`Month ${d.month}: ${hrs(d.failureHour)}`}>
                        <div
                          className={`sf-decaybar${fails ? " fails" : ""}`}
                          style={{ height: `${Math.max(3, h)}%` }}
                        />
                        <span>{d.month}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="sf-kblede">
                  Months from today. Kits do not stay ready — consumables expire and the clock moves
                  backwards on its own. This is the maintenance calendar, drawn from shelf life.
                </p>
              </>
            ) : (
              <p className="sf-panelempty">Build a kit and this projects it forward three years.</p>
            )}
          </section>
        </div>

        {/* ---------------- official guidance ---------------- */}
        <section className="sf-panelbox">
          <div className="sf-kbrowhead">
            <h2>Against official guidance</h2>
            <select value={listId} onChange={(e) => setListId(e.target.value)} className="sf-kbsel">
              {OFFICIAL_LISTS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.authority}
                </option>
              ))}
            </select>
          </div>
          <p className="sf-kblede">
            Your kit meets <strong>{listMet} of {listResult.length}</strong> items on the{" "}
            {list.authority} list.
          </p>
          <div className="sf-official">
            {listResult.map((r) => (
              <div key={r.label} className={`sf-offitem${r.met ? " met" : ""}`}>
                <span aria-hidden="true">{r.met ? "✓" : "–"}</span>
                {r.label}
              </div>
            ))}
          </div>
        </section>

        <div className="sf-kbfoot">
          <Link href={askJimmy} className="sf-cta sm">
            Ask Jimmy about these results
          </Link>
          <p>
            Capacities are derived from product names, categories and weights — litres, kcal, watt
            hours, burn times. Items marked <em>capacity estimated</em> use a typical figure for
            their type rather than a published one. This is a demo of the engine; the figures firm up
            as the catalogue is measured.
          </p>
        </div>
      </div>
    </main>
  );
}
