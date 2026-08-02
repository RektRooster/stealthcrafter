"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CcIcon } from "../cc-chrome";
import type { TestLabHome as TestLabHomeData } from "@/lib/testing-data";
import {
  displayName,
  firstImage,
  fmtDateTime,
  fmtDuration,
  highPriority,
  scId,
  verdictMeta,
} from "./lab-utils";

const QUEUE_CAP = 150;

function useElapsedLabel(startedAt: string): string {
  // static label is fine on the home screen — no per-second ticker per row
  return fmtDuration(Date.now() - new Date(startedAt).getTime());
}

export default function TestLabHome({ data }: { data: TestLabHomeData }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [pillar, setPillar] = useState("");
  const [startingId, setStartingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const testedSet = useMemo(() => new Set(data.testedIds), [data.testedIds]);
  const pillars = useMemo(
    () => [...new Set(data.queue.map((p) => p.pillar).filter(Boolean))].sort() as string[],
    [data.queue]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.queue.filter((p) => {
      if (pillar && p.pillar !== pillar) return false;
      if (!needle) return true;
      return [displayName(p), p.brand, p.category, p.subcategory, scId(p)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
  }, [data.queue, q, pillar]);

  async function startTest(productId: string) {
    if (startingId) return;
    setStartingId(productId);
    setErr(null);
    try {
      const res = await fetch("/api/admin/testing/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      router.push(`/admin/testing/session/${body.id}`);
    } catch (e: any) {
      setErr(e?.message || String(e));
      setStartingId(null);
    }
  }

  return (
    <main className="cc-container">
      <div className="cc-modhead">
        <span className="cc-modicon">
          <CcIcon name="testing" size={22} />
        </span>
        <div>
          <h1>TEST LAB</h1>
          <div className="sub">
            StealthCrafter Tested programme — structured 6-step product test sessions, checkpoint
            evidence and pass/fail verdicts feeding the catalogue.
          </div>
        </div>
      </div>

      {err ? <div className="savemsg err" style={{ margin: "8px 0" }}>{err}</div> : null}

      {/* ---- ACTIVE SESSIONS ---- */}
      <div className="cc-panel" style={{ marginTop: 12 }}>
        <div className="cc-panel-h">
          <CcIcon name="testing" />
          Active Sessions
          <span className="right">{data.active.length} IN PROGRESS</span>
        </div>
        {data.active.length === 0 ? (
          <span className="cc-empty">No test session running — start one from the Test Queue below.</span>
        ) : (
          <div className="cc-lab-active">
            {data.active.map((s) => (
              <ActiveSessionCard key={s.id} s={s} />
            ))}
          </div>
        )}
      </div>

      <div className="cc-detailgrid">
        {/* ---- TEST QUEUE ---- */}
        <div className="cc-panel cc-span8">
          <div className="cc-panel-h">
            <CcIcon name="products" />
            Test Queue
            <span className="right">{data.queue.length} UNTESTED PRODUCTS</span>
          </div>
          <div className="cc-controls" style={{ marginTop: 0 }}>
            <input
              type="search"
              placeholder="SEARCH PRODUCT, BRAND, SKU…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search test queue"
            />
            <select value={pillar} onChange={(e) => setPillar(e.target.value)} aria-label="Filter pillar">
              <option value="">ALL PILLARS</option>
              {pillars.map((p) => (
                <option key={p} value={p}>
                  {p.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
          {filtered.length === 0 ? (
            <div className="cc-notestrip">
              {data.queue.length === 0
                ? "TEST QUEUE CLEAR — every product has a completed test session."
                : "No untested products match this filter."}
            </div>
          ) : (
            <>
              <div className="cc-tablewrap">
                <table className="cc-table">
                  <thead>
                    <tr>
                      <th></th>
                      <th>Product</th>
                      <th>Pillar</th>
                      <th>Priority</th>
                      <th style={{ textAlign: "right" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, QUEUE_CAP).map((p) => (
                      <tr
                        key={p.id}
                        style={{ cursor: startingId ? "wait" : "pointer" }}
                        title="Start a test session for this product"
                        onClick={() => {
                          if (!startingId) startTest(p.id);
                        }}
                      >
                        <td>
                          {firstImage(p.image_urls) ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img className="cc-thumb" src={firstImage(p.image_urls)!} alt="" />
                          ) : (
                            <span className="cc-thumb ph">NO IMG</span>
                          )}
                        </td>
                        <td>
                          <div className="cc-prodname">{displayName(p)}</div>
                          <div className="cc-prodsub">
                            {p.brand ? `${p.brand} · ` : ""}
                            {scId(p)}
                            {p.category ? ` · ${p.category}` : ""}
                          </div>
                        </td>
                        <td>{p.pillar || "—"}</td>
                        <td>
                          {highPriority(p) ? (
                            <span className="cc-chip red plain">HIGH</span>
                          ) : (
                            <span className="cc-chip muted plain">STD</span>
                          )}
                          {testedSet.has(p.id) ? (
                            <span className="cc-chip green plain" style={{ marginLeft: 6 }}>
                              TESTED
                            </span>
                          ) : null}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <button
                            type="button"
                            className="cc-btn"
                            disabled={startingId !== null}
                            onClick={(e) => {
                              e.stopPropagation();
                              startTest(p.id);
                            }}
                          >
                            {startingId === p.id ? "STARTING…" : "START TEST"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filtered.length > QUEUE_CAP ? (
                <div className="cc-notestrip">
                  Showing first {QUEUE_CAP} of {filtered.length} — refine the search to narrow the queue.
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* ---- TEST HISTORY ---- */}
        <div className="cc-panel cc-span4">
          <div className="cc-panel-h">
            <CcIcon name="compliance" />
            Test History
            <span className="right">{data.history.length} COMPLETED</span>
          </div>
          {data.history.length === 0 ? (
            <span className="cc-empty">No completed sessions yet — verdicts land here.</span>
          ) : (
            <div className="cc-lab-history">
              {data.history.map((s) => {
                const v = verdictMeta(s.verdict);
                const dur =
                  s.completed_at != null
                    ? fmtDuration(new Date(s.completed_at).getTime() - new Date(s.started_at).getTime())
                    : "—";
                return (
                  <Link key={s.id} href={`/admin/testing/session/${s.id}`} className="cc-lab-histrow">
                    <span className="code">{s.test_code || s.id.slice(0, 8)}</span>
                    <span className="nm">{displayName(s.product)}</span>
                    <span className={`cc-chip ${v.tone} plain`}>{v.label}</span>
                    <span className="meta">
                      {fmtDateTime(s.completed_at)} · {dur}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function ActiveSessionCard({
  s,
}: {
  s: TestLabHomeData["active"][number];
}) {
  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
  const elapsed = useElapsedLabel(s.started_at);
  return (
    <div className="cc-lab-activecard">
      {firstImage(s.product?.image_urls) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="cc-thumb" src={firstImage(s.product?.image_urls)!} alt="" />
      ) : (
        <span className="cc-thumb ph">NO IMG</span>
      )}
      <div className="mid">
        <div className="nm">{displayName(s.product)}</div>
        <div className="meta">
          <span className="code">{s.test_code || s.id.slice(0, 8)}</span> · elapsed {elapsed} ·{" "}
          {s.done}/{s.total} checkpoints
        </div>
        <div className="bar">
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="pct cc-num">{pct}%</div>
      <Link href={`/admin/testing/session/${s.id}`} className="cc-btn primary">
        CONTINUE
      </Link>
    </div>
  );
}
