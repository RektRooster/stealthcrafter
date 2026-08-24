"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { TestedIndex, ReportSummary } from "@/lib/tested-data";
import { ScoreRing } from "./report-visuals";

const VERDICT: Record<string, { label: string; tone: string }> = {
  pass: { label: "PASS", tone: "go" },
  review: { label: "REVIEW", tone: "warm" },
  fail: { label: "FAIL", tone: "stop" },
};

function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function TestedIndexView({ data }: { data: TestedIndex }) {
  const [cat, setCat] = useState<string | null>(null);

  const shown = useMemo(
    () => data.reports.filter((r) => !cat || r.category === cat),
    [data.reports, cat]
  );
  const comps = cat ? data.comparisons.filter((c) => c.category === cat) : data.comparisons;

  if (!data.reports.length) {
    return (
      <main className="sf-page">
        <div className="sf-catwrap">
          <div className="sf-guideempty">
            <strong>No test reports are published yet.</strong>
            <p>
              Reports appear here as sessions complete in the Test Lab. Nothing reaches this page
              before the full protocol has been run and the verdict recorded.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="sf-page">
      <div className="sf-catwrap">
        <header className="sf-cathead wide">
          <div className="sf-hz-kicker">Tested Reports</div>
          <h1>Nothing reaches this shop without earning it.</h1>
          <p>
            Every product runs the same protocol — the same checkpoints, in the same order, under
            recorded conditions. We write down what we expect{" "}
            <strong>before we open the box</strong>, then publish every result: the method, the
            expectation, and what actually happened. No stars and no sponsored verdicts. What did
            not make it never appears here at all.
          </p>
        </header>

        <div className="sf-tstats">
          <div>
            <strong>{data.stats.tested}</strong>
            <span>products tested</span>
          </div>
          <div>
            <strong>{data.stats.checkpoints.toLocaleString("en-GB")}</strong>
            <span>checkpoints run and published</span>
          </div>
          <div>
            <strong>{data.categories.length}</strong>
            <span>categories with a published protocol</span>
          </div>
          <Link href="/admin/site/tested/protocol" className="sf-tprotolink">
            Read the full protocol →
          </Link>
        </div>

        <div className="sf-hz-controls">
          <button
            type="button"
            className={`sf-hz-layer alt${cat === null ? " on" : ""}`}
            onClick={() => setCat(null)}
          >
            All reports
          </button>
          {data.categories.map((c) => (
            <button
              key={c}
              type="button"
              className={`sf-hz-layer${cat === c ? " on" : ""}`}
              onClick={() => setCat(cat === c ? null : c)}
            >
              {c}
            </button>
          ))}
        </div>

        {/* ---------- head-to-head ---------- */}
        {comps.length > 0 && (
          <section className="sf-panelbox accent">
            <h2>Head to head, on the same measurement</h2>
            <p className="sf-kblede">
              Every product here ran the identical checkpoint under identical conditions. That is the
              only way a comparison means anything — and it is only possible because the protocol
              never changes.
            </p>
            {comps.map((c) => {
              const th = c.expected.match(/(?:>=|<=|>|<)\s*([\d.,]+)/);
              const thVal = th ? Number(th[1].replace(/,/g, "")) : null;
              const best = Math.max(...c.rows.map((r) => Math.abs(r.value)), thVal ?? 0, 1) * 1.12;
              return (
                <div key={`${c.category}-${c.metric}`} className="sf-h2h">
                  <div className="sf-h2hhead">
                    <strong>{c.metric}</strong>
                    <span>
                      {c.category} · marker shows the threshold we set before testing:{" "}
                      {c.expected}
                    </span>
                  </div>
                  {c.rows.map((r) => (
                    <div key={r.code} className="sf-h2hrow">
                      <Link href={`/admin/site/tested/${r.code}`} className="sf-h2hname">
                        {r.product}
                      </Link>
                      <div className="sf-h2htrack">
                        <div
                          className={`sf-h2hbar v-${r.verdict ?? "pass"}`}
                          style={{ width: `${Math.max(2, (Math.abs(r.value) / best) * 100)}%` }}
                        />
                        {thVal !== null && (
                          <div
                            className="sf-h2hth"
                            style={{ left: `${Math.min(99, (thVal / best) * 100)}%` }}
                            title={`Expected ${c.expected}`}
                          />
                        )}
                      </div>
                      <span className="sf-h2hval">
                        {r.value.toLocaleString("en-GB")} {c.unit}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </section>
        )}

        {/* ---------- report cards ---------- */}
        <div className="sf-treports">
          {shown.map((r) => (
            <ReportCard key={r.code} r={r} />
          ))}
        </div>
      </div>
    </main>
  );
}

function ReportCard({ r }: { r: ReportSummary }) {
  const v = VERDICT[r.verdict ?? "review"];
  return (
    <Link href={`/admin/site/tested/${r.code}`} className={`sf-tcard v-${r.verdict}`}>
      <div className="sf-tcardimg">
        {r.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={r.image} alt="" width={360} height={270} decoding="async" />
        ) : (
          <span className="sf-noimg">No image yet</span>
        )}
        <span className={`sf-state t-${v.tone}`}>{v.label}</span>
        <div className="sf-tcardring">
          <ScoreRing passed={r.passed} failed={r.failed} na={r.na} verdict={r.verdict} size={62} />
        </div>
      </div>
      <div className="sf-tcardbody">
        {r.brand && <span className="sf-cardbrand">{r.brand}</span>}
        <strong>{r.productName}</strong>
        {r.summary && <p>{r.summary}</p>}
        <div className="sf-tcardmeta">
          <span>{r.code}</span>
          <span>{when(r.completedAt)}</span>
          {r.temperature !== null && <span>{r.temperature}°C</span>}
        </div>
      </div>
    </Link>
  );
}
