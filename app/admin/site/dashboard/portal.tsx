"use client";

import Link from "next/link";
import { PILLARS as PAL_PILLARS, SEVERITY } from "@/lib/palette";
import { useRouter } from "next/navigation";
import type { OwnedItem, PortalData } from "@/lib/portal-data";
import { ScoreRing } from "../tested/report-visuals";
import { DecayCurve, DepletionTimeline, PillarRadar, ReadinessDial } from "./viz";
import type { DepletionRow, RadarPoint } from "./viz";

const PILLAR_COLOR: Record<string, string> = PAL_PILLARS;

/* The simulator's pillar names to SC 03's five. "heat" is SC 03's "Fire". */
const SIM_TO_PILLAR: Record<string, string> = {
  water: "Water",
  food: "Food",
  heat: "Fire",
  medical: "Medical",
  power: "Power",
  light: "Light",
};

const KIT_LABEL: Record<string, string> = {
  home: "Home",
  go_bag: "Go-bag",
  vehicle: "Vehicle",
  work: "Work",
};

const SEV_COLOR: Record<string, string> = SEVERITY;

function hrs(h: number): string {
  if (!Number.isFinite(h)) return "indefinitely";
  if (h < 48) return `${Math.round(h)} hours`;
  return `${(h / 24).toFixed(1)} days`;
}

function eur(n: number): string {
  return `€${n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function Portal({ data }: { data: PortalData }) {
  const router = useRouter();
  const h = data.household!;
  const sim = data.sim!;
  const people = h.adults + h.children + h.infants;

  // The roll-up rule from SC 03: unassessed pillars sit OUTSIDE the number.
  const ALL = ["Water", "Food", "Fire", "Shelter", "Medical"];
  const assessedMap = new Map(data.assessments.map((a) => [a.pillar, a]));
  const unassessed = ALL.filter((p) => !assessedMap.has(p));
  const critical = data.assessments.filter((a) => a.critical);
  const avg = data.assessments.length
    ? Math.round(data.assessments.reduce((t, a) => t + a.score, 0) / data.assessments.length)
    : null;
  const capped = critical.length > 0 && avg !== null ? Math.min(avg, 40) : avg;

  const radar: RadarPoint[] = ALL.map((p) => {
    const a = assessedMap.get(p);
    return {
      pillar: p,
      score: a ? a.score : null,
      target: a?.recommended ?? 85,
      critical: Boolean(a?.critical),
    };
  });

  const depletion: DepletionRow[] = sim.pillars.map((p) => ({
    pillar: SIM_TO_PILLAR[p.pillar] ?? capitalise(p.pillar),
    hours: Number.isFinite(p.runwayHours) ? p.runwayHours : data.scenario.hours * 1.5,
    label: p.supplyLabel,
    survival: ["water", "food", "heat", "medical"].includes(p.pillar),
  }));

  const byKit = data.equipment.reduce<Record<string, OwnedItem[]>>((acc, e) => {
    (acc[e.kit] ||= []).push(e);
    return acc;
  }, {});

  function go(params: { h?: string; s?: string }) {
    const q = new URLSearchParams();
    q.set("h", params.h ?? h.id);
    q.set("s", params.s ?? data.scenario.id);
    router.push(`/admin/site/dashboard?${q.toString()}`);
  }

  const worstAction =
    critical[0]?.nextAction ??
    data.assessments.slice().sort((a, b) => a.score - b.score)[0]?.nextAction ??
    null;

  return (
    <main className="sf-page banded">
      {/* ---------------- who ---------------- */}
      <header className="sf-band">
        <div className="sf-bandin sf-portalbar">
          <div>
            <div className="sf-bandkicker">Your household</div>
            <h1>{h.name}</h1>
            <p className="sf-bandlede">
              {[
                h.location,
                h.home,
                `${h.adults} adult${h.adults === 1 ? "" : "s"}`,
                h.children ? `${h.children} child${h.children === 1 ? "" : "ren"}` : null,
                h.infants ? `${h.infants} under 4` : null,
                h.pets ? `${h.pets} pet${h.pets === 1 ? "" : "s"}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <label className="sf-sort">
            Viewing
            <select value={h.id} onChange={(e) => go({ h: e.target.value })}>
              {data.households.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <div className="sf-kbwrap">
        {/* ---------------- the readiness console ---------------- */}
        <section className="sf-console">
          <div className="sf-consoledial">
            <ReadinessDial
              hours={sim.failureHour}
              scenarioHours={data.scenario.hours}
              label={`Hours survived in a ${data.scenario.label}`}
            />
            <div className="sf-consolecap">
              <span>Weakest link</span>
              <strong style={{ color: PILLAR_COLOR[SIM_TO_PILLAR[sim.weakest]] ?? "#f2c744" }}>
                {SIM_TO_PILLAR[sim.weakest] ?? capitalise(sim.weakest)}
              </strong>
            </div>
          </div>

          <div className="sf-consolemain">
            <div className="sf-consolehead">
              <div>
                <div className="sf-hz-kicker">On what you own</div>
                <h2>{data.scenario.label}</h2>
              </div>
              <label className="sf-sort">
                Run
                <select value={data.scenario.id} onChange={(e) => go({ s: e.target.value })}>
                  {data.scenarios.map((sc) => (
                    <option key={sc.id} value={sc.id}>
                      {sc.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <DepletionTimeline rows={depletion} scenarioHours={data.scenario.hours} />

            <div className="sf-consolestats">
              <div>
                <dt>Registered</dt>
                <dd>{data.equipment.reduce((t, e) => t + e.qty, 0)}</dd>
              </div>
              <div>
                <dt>Assessed</dt>
                <dd>
                  {data.assessments.length}<em>/5</em>
                </dd>
              </div>
              <div>
                <dt>Attention</dt>
                <dd className={data.attention.length ? "over" : ""}>{data.attention.length}</dd>
              </div>
              <div>
                <dt>Kit value</dt>
                <dd className="sm">{eur(sim.totalCost)}</dd>
              </div>
            </div>
          </div>
        </section>

        <div className="sf-portalcols">
          {/* ---------------- left: pillars + register ---------------- */}
          <div className="sf-portalmain">
            <section className="sf-panelbox">
              <div className="sf-kbrowhead">
                <h2>Your preparedness profile</h2>
                {capped !== null && (
                  <span className="sf-portalscore">
                    {capped}
                    <em>/100</em>
                  </span>
                )}
              </div>
              {critical.length > 0 && (
                <div className="sf-portalcap">
                  A critical gap in <strong>{critical.map((c) => c.pillar).join(", ")}</strong> caps
                  your overall score. We do not average a serious weakness away.
                </div>
              )}
              <div className="sf-radarwrap">
                <PillarRadar points={radar} />
                <ul className="sf-radarlegend">
                  {ALL.map((p) => {
                    const a = assessedMap.get(p);
                    return (
                      <li key={p} className={a ? (a.critical ? "crit" : "") : "unassessed"}>
                        <i style={{ background: PILLAR_COLOR[p] }} />
                        <div>
                          <strong>{p}</strong>
                          <span>{a?.nextAction ?? "Jimmy can cover this in a few minutes."}</span>
                        </div>
                        <em>{a ? a.score : "—"}</em>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {unassessed.length > 0 && (
                <Link
                  href={`/admin/site/jimmy?q=${encodeURIComponent(
                    `I have not been assessed on ${unassessed.join(" or ")} yet. Can we do that now?`
                  )}`}
                  className="sf-hz-ask"
                >
                  Close the {unassessed.length} unassessed area
                  {unassessed.length === 1 ? "" : "s"} with Jimmy →
                </Link>
              )}
            </section>

            <section className="sf-panelbox">
              <div className="sf-kbrowhead">
                <h2>Equipment register</h2>
                <Link href="/admin/site/kit-builder" className="sf-kbaddbtn">
                  Model changes in the Kit Builder
                </Link>
              </div>
              {Object.entries(byKit).map(([kit, items]) => (
                <div key={kit} className="sf-regkit">
                  <div className="sf-regkithead">
                    {KIT_LABEL[kit] ?? kit}
                    <span>{items.reduce((t, i) => t + i.qty, 0)} items</span>
                  </div>
                  <ul className="sf-register">
                    {items.map((e) => (
                      <li key={e.ownedId} className={e.monthsLeft !== null && e.monthsLeft <= 6 ? "warn" : ""}>
                        <div className="sf-regimg">
                          {e.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={e.image} alt="" decoding="async" />
                          ) : (
                            <span />
                          )}
                        </div>
                        <div className="sf-reginfo">
                          {e.slug ? (
                            <Link href={`/admin/site/catalogue/${e.slug}`}>{e.name}</Link>
                          ) : (
                            <strong>{e.name}</strong>
                          )}
                          <span>
                            {e.qty > 1 ? `${e.qty} × ` : ""}
                            {e.category}
                            {e.condition ? ` · ${e.condition.replace(/_/g, " ")}` : ""}
                          </span>
                        </div>
                        <div className="sf-regexpiry">
                          {e.monthsLeft === null ? (
                            <span className="none">no expiry</span>
                          ) : e.monthsLeft <= 0 ? (
                            <span className="bad">lapsed</span>
                          ) : e.monthsLeft <= 6 ? (
                            <span className="warn">{e.monthsLeft} mo left</span>
                          ) : (
                            <span>{e.monthsLeft} mo left</span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {!data.equipment.length && (
                <p className="sf-panelempty">
                  Nothing registered yet. Add what you already own and the simulation starts working
                  for you immediately — we credit everything you have before recommending anything.
                </p>
              )}
            </section>
          </div>

          {/* ---------------- right rail ---------------- */}
          <aside className="sf-portalrail">
            <section className="sf-panelbox">
              <h2>Where you live, today</h2>
              {data.localEvents.length ? (
                <ul className="sf-locallist">
                  {data.localEvents.map((e) => (
                    <li key={e.id}>
                      <span className="sf-localdot" style={{ background: SEV_COLOR[e.severity] }} />
                      <div>
                        <strong>{e.title}</strong>
                        <span>{e.source}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="sf-panelempty">
                  Nothing significant reported {h.location ? `near ${h.location}` : "in your area"}{" "}
                  right now. That is the normal case — and the reason to prepare while it lasts.
                </p>
              )}
              <Link href="/admin/site/home" className="sf-hz-ask">
                See the whole European picture →
              </Link>
            </section>

            {data.nextBuy && (
              <section className="sf-panelbox accent">
                <h2>Your single best next move</h2>
                <div className="sf-nextbuy">
                  <div className="sf-nextgain">
                    +{hrs(data.nextBuy.hoursGained)}
                    <span>for {eur(data.nextBuy.price)}</span>
                  </div>
                  <Link href={`/admin/site/catalogue/${data.nextBuy.slug}`}>
                    {data.nextBuy.name}
                  </Link>
                  <p>{data.nextBuy.reason}</p>
                </div>
                {worstAction && <p className="sf-nextwhy">{worstAction}</p>}
              </section>
            )}

            {data.attention.length > 0 && (
              <section className="sf-panelbox">
                <h2>Needs attention</h2>
                <ul className="sf-attention">
                  {data.attention.map((e) => (
                    <li key={e.ownedId}>
                      <strong>{e.name}</strong>
                      <span>
                        {e.monthsLeft !== null && e.monthsLeft <= 0
                          ? "Lapsed — replace it"
                          : `Expires in ${e.monthsLeft} months`}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="sf-kblede">
                  A kit does not stay ready on its own. This is the only page that tells you when
                  yours has quietly stopped being one.
                </p>
              </section>
            )}

            <section className="sf-panelbox">
              <h2>How it ages</h2>
              <DecayCurve points={data.decay} scenarioHours={data.scenario.hours} />
              <p className="sf-kblede">Months from today, if you change nothing.</p>
            </section>

            <section className="sf-panelbox">
              <h2>Jimmy</h2>
              <div className="sf-jimmyrow">
                <ScoreRing
                  passed={data.assessments.length}
                  failed={0}
                  na={5 - data.assessments.length}
                  verdict={critical.length ? "review" : "pass"}
                  size={78}
                />
                <div>
                  <strong>{data.conversations} conversations</strong>
                  <span>
                    {data.lastActivity
                      ? `Last assessed ${new Date(data.lastActivity).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                        })}`
                      : "Assessment in progress"}
                  </span>
                </div>
              </div>
              <Link
                href={`/admin/site/jimmy?q=${encodeURIComponent(
                  `Give me an update on my household. We are ${people} people in ${h.location ?? "our home"}, my weakest area is ${capitalise(sim.weakest)}, and on my current kit I last ${Math.round(sim.failureHour)} hours in a ${data.scenario.label.toLowerCase()}.`
                )}`}
                className="sf-cta sm"
              >
                Pick up with Jimmy
              </Link>
            </section>
          </aside>
        </div>

      </div>
    </main>
  );
}

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
