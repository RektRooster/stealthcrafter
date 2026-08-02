"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CcIcon } from "../../../cc-chrome";
import type { CheckpointRow, SessionRow } from "@/lib/testing-data";
import {
  RESULT_META,
  RESOLVED_RESULTS,
  displayName,
  firstImage,
  fmtDateTime,
  fmtDuration,
  highPriority,
  scId,
  verdictMeta,
} from "../../lab-utils";

/* ---------- static copy ---------- */

const SECTION_DESC: Record<number, string> = {
  1: "Record the out-of-box experience, completeness and first impressions.",
  2: "Inspect build quality, materials, finish and markings.",
  3: "Test the core functionality and performance of the product.",
  4: "Stress the product against knocks, drops and environment.",
  5: "Run the product through a realistic end-to-end scenario.",
  6: "Wrap up: confirm findings, set the verdict and generate the report.",
};

const STEP_SHORT: Record<number, string> = {
  1: "UNBOX",
  2: "VISUAL INSPECTION",
  3: "FUNCTIONAL TESTING",
  4: "DURABILITY TESTS",
  5: "REAL WORLD TEST",
  6: "VERDICT & REPORT",
};

const RESULT_ORDER = ["waiting", "in_progress", "pass", "fail", "na"] as const;

function eur(v: any, currency?: string): string {
  const n = Number(v);
  if (v === null || v === undefined || v === "" || !Number.isFinite(n)) return "—";
  return `${!currency || currency === "EUR" ? "€" : currency + " "}${n.toFixed(2)}`;
}

/* ---------- Jimmy mini avatar (SC hexagon mark — deliberately not a photo) ---------- */

function JimmyMiniAvatar() {
  return (
    <span className="cc-lab-jimmyav" aria-hidden="true">
      <svg viewBox="0 0 120 120" width="44" height="44">
        <path d="M60 16 L97.5 37.5 V82.5 L60 104 L22.5 82.5 V37.5 Z" className="hex" />
        <path d="M60 32 L83.5 45.5 V72.5 L60 86 L36.5 72.5 V45.5 Z" className="hexin" />
        <circle cx="49.5" cy="56" r="3.6" className="eye" />
        <circle cx="70.5" cy="56" r="3.6" className="eye" />
        <path d="M47 68 Q60 78 73 68" className="mouth" />
      </svg>
    </span>
  );
}

/* ---------- component ---------- */

type ChatMsg = { key: string; role: "user" | "jimmy" | "system"; text: string; pending?: boolean };

export default function TestConsole({
  session,
  checkpoints: initialCps,
  product,
  routes,
}: {
  session: SessionRow;
  checkpoints: CheckpointRow[];
  product: any | null;
  routes: any[];
}) {
  const router = useRouter();

  const [status, setStatus] = useState(session.status);
  const [verdict, setVerdict] = useState<string | null>(session.verdict);
  const [completedAt, setCompletedAt] = useState<string | null>(session.completed_at);
  const readOnly = status !== "in_progress";

  const [cps, setCps] = useState<CheckpointRow[]>(initialCps);
  const [notes, setNotes] = useState(session.notes || "");
  const [location, setLocation] = useState(session.location || "");
  const [editingLoc, setEditingLoc] = useState(false);
  const [temperature, setTemperature] = useState(session.temperature == null ? "" : String(session.temperature));
  const [humidity, setHumidity] = useState(session.humidity == null ? "" : String(session.humidity));
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);

  const notesRef = useRef<HTMLTextAreaElement>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  /* ---- derived section model ---- */
  const sections = useMemo(() => {
    const map = new Map<number, { section: number; name: string; items: CheckpointRow[] }>();
    for (const c of cps) {
      const e = map.get(c.section) || { section: c.section, name: c.section_name, items: [] };
      e.items.push(c);
      map.set(c.section, e);
    }
    return [...map.values()].sort((a, b) => a.section - b.section);
  }, [cps]);

  const sectionDone = (items: CheckpointRow[]) =>
    items.length > 0 && items.every((c) => RESOLVED_RESULTS.has(c.result));

  const [currentSection, setCurrentSection] = useState<number>(() => {
    for (const s of sections) if (!sectionDone(s.items)) return s.section;
    return sections.length ? sections[sections.length - 1].section : 1;
  });
  const current = sections.find((s) => s.section === currentSection) || sections[0];

  const total = cps.length;
  const resolved = cps.filter((c) => RESOLVED_RESULTS.has(c.result)).length;
  const fails = cps.filter((c) => c.result === "fail").length;
  const overallPct = total ? Math.round((resolved / total) * 100) : 0;
  const sections1to5Done = sections.filter((s) => s.section <= 5).every((s) => sectionDone(s.items));

  /* ---- elapsed ticker ---- */
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    if (readOnly) return;
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [readOnly]);
  const startMs = new Date(session.started_at).getTime();
  const elapsedLabel = readOnly
    ? completedAt
      ? fmtDuration(new Date(completedAt).getTime() - startMs)
      : "—"
    : nowMs
      ? fmtDuration(nowMs - startMs)
      : "--:--";

  /* ---- persistence ---- */
  async function apiSessionPatch(patch: Record<string, any>) {
    try {
      const res = await fetch(`/api/admin/testing/session/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      setSaveErr(null);
    } catch (e: any) {
      setSaveErr(`Save failed: ${e?.message || e}`);
    }
  }

  function debounced(key: string, fn: () => void, ms = 700) {
    if (timers.current[key]) clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(fn, ms);
  }

  async function saveCheckpoint(id: string, patch: { result?: string; notes_evidence?: string }) {
    try {
      const res = await fetch("/api/admin/testing/checkpoint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      setSaveErr(null);
    } catch (e: any) {
      setSaveErr(`Save failed: ${e?.message || e}`);
    }
  }

  function setResult(cp: CheckpointRow, result: string) {
    if (readOnly) return;
    const at = new Date().toISOString();
    setCps((list) => list.map((c) => (c.id === cp.id ? { ...c, result: result as any, updated_at: at } : c)));
    saveCheckpoint(cp.id, { result });
  }

  function setCpNotes(cp: CheckpointRow, text: string) {
    if (readOnly) return;
    setCps((list) => list.map((c) => (c.id === cp.id ? { ...c, notes_evidence: text } : c)));
    debounced(`cp-${cp.id}`, () => saveCheckpoint(cp.id, { notes_evidence: text }));
  }

  function nextIncompleteSection() {
    const after = sections.filter((s) => s.section > currentSection && !sectionDone(s.items));
    if (after.length) return after[0].section;
    const any = sections.filter((s) => !sectionDone(s.items));
    if (any.length) return any[0].section;
    return 6;
  }

  async function endSession() {
    if (readOnly || ending) return;
    if (
      !confirm(
        "End this test session? It will be marked ABANDONED — complete section 6 with a verdict instead if the test is finished."
      )
    )
      return;
    setEnding(true);
    try {
      const res = await fetch(`/api/admin/testing/session/${session.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "abandon" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      router.push("/admin/testing");
    } catch (e: any) {
      setSaveErr(e?.message || String(e));
      setEnding(false);
    }
  }

  const [completing, setCompleting] = useState<string | null>(null);
  async function completeSession(v: "pass" | "review" | "fail") {
    if (readOnly || completing) return;
    if (!confirm(`Complete this test session with verdict ${v.toUpperCase()}?`)) return;
    setCompleting(v);
    try {
      const res = await fetch(`/api/admin/testing/session/${session.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete", verdict: v }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setStatus("completed");
      setVerdict(v);
      setCompletedAt(new Date().toISOString());
      router.refresh();
    } catch (e: any) {
      setSaveErr(e?.message || String(e));
    }
    setCompleting(null);
  }

  /* ---- Jimmy chat ---- */
  const productName = displayName(product);
  const [thread, setThread] = useState<ChatMsg[]>([
    {
      key: "seed",
      role: "system",
      text: `Jimmy linked to this session — context: ${productName}${
        product?.pillar ? ` (${product.pillar} pillar)` : ""
      }, test ${session.test_code || session.id.slice(0, 8)}.`,
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | number | null>(null);
  const firstSend = useRef(true);
  const threadRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [thread]);

  async function sendChat() {
    const msg = chatInput.trim();
    if (!msg || chatBusy) return;
    setChatBusy(true);
    setChatInput("");
    const key = crypto.randomUUID();
    setThread((t) => [
      ...t,
      { key: `u-${key}`, role: "user", text: msg },
      { key: `p-${key}`, role: "jimmy", text: "…", pending: true },
    ]);
    const contextPrefix = firstSend.current
      ? `[Test Lab console — I am testing "${productName}"${
          product?.pillar ? ` (${product.pillar} pillar)` : ""
        }, session ${session.test_code || session.id}, current section: ${
          current ? `${current.section}. ${current.name}` : "—"
        }.] `
      : "";
    firstSend.current = false;
    try {
      const res = await fetch("/api/admin/jimmy/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          profileId: null,
          message: contextPrefix + msg,
          idempotencyKey: key,
          includeDraft: true,
          surface: "console",
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      if (body.conversationId) setConversationId(body.conversationId);
      const a = body.answer || {};
      setThread((t) =>
        t.map((m) =>
          m.key === `p-${key}`
            ? { key: m.key, role: a.role === "system" ? "system" : "jimmy", text: a.text || "" }
            : m
        )
      );
    } catch (e: any) {
      setThread((t) =>
        t.map((m) =>
          m.key === `p-${key}` ? { key: m.key, role: "system", text: `Request failed: ${e?.message || e}` } : m
        )
      );
    }
    setChatBusy(false);
  }

  /* ---- derived panels ---- */
  const timemarks = useMemo(
    () =>
      cps
        .filter((c) => RESOLVED_RESULTS.has(c.result))
        .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime())
        .map((c) => ({
          id: c.id,
          at: fmtDuration(Math.max(0, new Date(c.updated_at).getTime() - startMs)),
          name: `${c.section}.${c.seq} ${c.name}`,
          result: c.result,
        })),
    [cps, startMs]
  );

  const metrics = useMemo(
    () =>
      cps
        .filter((c) => c.result === "pass" && c.notes_evidence && /\d/.test(c.notes_evidence))
        .slice(0, 4)
        .map((c) => ({ id: c.id, value: c.notes_evidence as string, label: c.name })),
    [cps]
  );

  const prelim = useMemo(() => {
    if (fails > 2) return { label: "FAIL", tone: "red", pos: 8 };
    if (fails >= 1) return { label: "REVIEW", tone: "amber", pos: 50 };
    if (total && resolved / total > 0.5) return { label: "LIKELY PASS", tone: "green", pos: 92 };
    return { label: "TOO EARLY", tone: "muted", pos: 50 };
  }, [fails, resolved, total]);

  const primaryRoute = routes.find((r) => r.role === "primary") || routes[0] || null;
  const supplierName = primaryRoute?.supplier?.name || null;
  const img = firstImage(product?.image_urls);
  const finalVerdict = verdictMeta(verdict);

  const specRows: [string, any][] = [];
  if (product) {
    const base: [string, any][] = [
      ["Brand", product.brand],
      ["Model", product.model],
      ["Weight", product.weight],
      ["Dimensions", product.dimensions],
    ];
    const extra: [string, any][] = [
      ["Materials", product.materials],
      ["Power Source", product.power_source],
      ["Waterproof Rating", product.waterproof_rating],
      ["Operating Temp", product.operating_temperature],
      ["Shelf Life", product.shelf_life],
      ["Warranty", product.warranty],
      ["Country of Origin", product.country_of_manufacture],
      ["Colour Options", product.colour_options],
    ];
    specRows.push(...base);
    specRows.push(...extra.filter(([, v]) => v).slice(0, 4));
  }

  /* ================================================================ */

  return (
    <main className="cc-container cc-lab">
      {/* ---------- header row ---------- */}
      <div className="cc-lab-tophead">
        <Link className="cc-back" href="/admin/testing">← TEST LAB</Link>
        <h1>
          TEST LAB <span className="sep">/</span> PRODUCT TESTING CONSOLE
        </h1>
        <div className="chips">
          {readOnly ? (
            <>
              <span className={`cc-chip ${status === "completed" ? "green" : "red"}`}>
                {status === "completed" ? "SESSION COMPLETED" : "SESSION ABANDONED"}
              </span>
              {verdict ? <span className={`cc-chip ${finalVerdict.tone}`}>VERDICT {finalVerdict.label}</span> : null}
            </>
          ) : (
            <span className="cc-chip green cc-lab-pulse">TEST MODE ACTIVE</span>
          )}
          {/* environment chip — editable location */}
          {editingLoc && !readOnly ? (
            <input
              className="cc-input cc-lab-locinput"
              autoFocus
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              onBlur={() => {
                setEditingLoc(false);
                apiSessionPatch({ location });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              aria-label="Test location"
            />
          ) : (
            <button
              type="button"
              className="cc-chip cyan plain cc-lab-envchip"
              title={readOnly ? undefined : "Click to edit test location"}
              onClick={() => !readOnly && setEditingLoc(true)}
            >
              ENVIRONMENT · {location || "—"}
            </button>
          )}
          <span className="cc-chip muted plain off" title="Hardware integration comes online later">
            CAMERA — NOT CONNECTED
          </span>
          <span className="cc-chip muted plain off" title="Hardware integration comes online later">
            MIC — NOT CONNECTED
          </span>
        </div>
        {!readOnly ? (
          <button type="button" className="cc-btn cc-lab-endbtn" onClick={endSession} disabled={ending}>
            {ending ? "ENDING…" : "END TEST SESSION"}
          </button>
        ) : (
          <Link href={`/admin/testing/session/${session.id}/report`} className="cc-btn primary">
            VIEW TEST REPORT
          </Link>
        )}
      </div>

      {saveErr ? <div className="savemsg err" style={{ margin: "6px 0" }}>{saveErr}</div> : null}
      {readOnly ? (
        <div className="cc-notestrip" style={{ marginTop: 8 }}>
          READ-ONLY VIEW — this session has ended. Checkpoints and notes are frozen as recorded.
        </div>
      ) : null}

      {/* ---------- 3-column grid ---------- */}
      <div className="cc-lab-grid">
        {/* ===== LEFT ===== */}
        <div className="cc-lab-col">
          <div className="cc-panel">
            {img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="cc-lab-prodimg" src={img} alt={productName} />
            ) : (
              <div className="cc-lab-prodimg ph">NO IMAGE</div>
            )}
            <div className="cc-lab-prodname">{productName}</div>
            <div className="cc-lab-prodid">{scId(product)}</div>
            <div className="cc-chiprow" style={{ margin: "10px 0" }}>
              {product?.product_status ? (
                <span
                  className={`cc-chip ${
                    product.product_status === "approved" || product.product_status === "listed"
                      ? "green"
                      : product.product_status === "rejected"
                        ? "red"
                        : "amber"
                  } plain`}
                >
                  {String(product.product_status).replace(/_/g, " ").toUpperCase()}
                </span>
              ) : null}
              {product?.hero_product ? <span className="cc-chip cyan plain">HERO</span> : null}
              {product?.safety_critical ? <span className="cc-chip red plain">SAFETY CRITICAL</span> : null}
            </div>
            <div className="cc-kvmini">
              <span className="k">Category</span>
              <span className="v">{product?.category || "—"}</span>
              <span className="k">Supplier</span>
              <span className="v">{supplierName || "—"}</span>
              <span className="k">Unit Cost (ex VAT)</span>
              <span className="v">{eur(product?.wholesale_price ?? product?.landed_cost, product?.currency)}</span>
              <span className="k">RRP</span>
              <span className="v">{eur(product?.retail_price_rrp, product?.currency)}</span>
              <span className="k">Test Priority</span>
              <span className="v">{highPriority(product) ? "High" : "Standard"}</span>
            </div>
            {product ? (
              <Link href={`/admin/product/${product.id}`} className="cc-btn cc-lab-fullwbtn">
                VIEW FULL PRODUCT PAGE
              </Link>
            ) : null}
          </div>

          <div className="cc-panel">
            <div className="cc-panel-h">
              <CcIcon name="products" />
              Product Overview
            </div>
            {specRows.length === 0 ? (
              <span className="cc-empty">No spec data on file for this product.</span>
            ) : (
              <div className="cc-kvmini">
                {specRows.map(([k, v]) => (
                  <span key={k} style={{ display: "contents" }}>
                    <span className="k">{k}</span>
                    <span className="v">{v || "—"}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="cc-panel">
            <div className="cc-panel-h">
              <CcIcon name="testing" />
              Test Session Info
            </div>
            <div className="cc-kvmini">
              <span className="k">Test ID</span>
              <span className="v">{session.test_code || session.id.slice(0, 8)}</span>
              <span className="k">Started By</span>
              <span className="v">{session.started_by || "—"}</span>
              <span className="k">Start Time</span>
              <span className="v">{fmtDateTime(session.started_at)}</span>
              <span className="k">Status</span>
              <span className="v">{status.replace(/_/g, " ").toUpperCase()}</span>
              <span className="k">Planned Duration</span>
              <span className="v">{session.planned_minutes ? `~ ${session.planned_minutes} min` : "—"}</span>
              <span className="k">Location</span>
              <span className="v">{location || "—"}</span>
            </div>
            <div className="cc-lab-envrow">
              <label>
                <span>Temperature °C</span>
                <input
                  className="cc-input"
                  type="number"
                  step="0.1"
                  value={temperature}
                  disabled={readOnly}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTemperature(v);
                    debounced("temp", () => apiSessionPatch({ temperature: v }));
                  }}
                />
              </label>
              <label>
                <span>Humidity %</span>
                <input
                  className="cc-input"
                  type="number"
                  step="1"
                  value={humidity}
                  disabled={readOnly}
                  onChange={(e) => {
                    const v = e.target.value;
                    setHumidity(v);
                    debounced("hum", () => apiSessionPatch({ humidity: v }));
                  }}
                />
              </label>
            </div>
          </div>
        </div>

        {/* ===== CENTRE ===== */}
        <div className="cc-lab-col">
          <div className="cc-panel">
            <div className="cc-panel-h">
              <CcIcon name="testing" />
              Test Workflow
            </div>
            <div className="cc-pipe">
              {sections.map((s) => {
                const done = sectionDone(s.items);
                const isCurrent = s.section === currentSection;
                return (
                  <button
                    key={s.section}
                    type="button"
                    className={`cc-step cc-lab-step${done ? " done" : ""}${isCurrent ? " current" : ""}`}
                    onClick={() => setCurrentSection(s.section)}
                  >
                    <span className="dot">{done ? "✓" : s.section}</span>
                    <span className="sl">
                      {s.section}. {STEP_SHORT[s.section] || s.name.toUpperCase()}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {current ? (
            <div className="cc-panel">
              <div className="cc-lab-sechead">
                <div>
                  <div className="t">
                    {current.section}. {current.name.toUpperCase()}
                  </div>
                  <div className="d">{SECTION_DESC[current.section] || ""}</div>
                </div>
                <div className="right">
                  <div className="prog">
                    <span className="cc-num green">
                      {current.items.filter((c) => RESOLVED_RESULTS.has(c.result)).length}
                    </span>{" "}
                    / {current.items.length} completed
                    <div className="bar">
                      <span
                        style={{
                          width: `${
                            current.items.length
                              ? Math.round(
                                  (current.items.filter((c) => RESOLVED_RESULTS.has(c.result)).length /
                                    current.items.length) *
                                    100
                                )
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                  <div className="elapsed">
                    <span className="lab">ELAPSED TIME</span>
                    <span className="cc-num val" suppressHydrationWarning>
                      {elapsedLabel}
                    </span>
                  </div>
                </div>
              </div>

              {/* checkpoint table */}
              <div className="cc-lab-cptable">
                <div className="cc-lab-cphead">
                  <span>Test Checkpoint</span>
                  <span>Method</span>
                  <span>Expected Result</span>
                  <span>Result</span>
                  <span>Notes / Evidence</span>
                </div>
                {current.items.map((c) => {
                  const meta = RESULT_META[c.result] || RESULT_META.waiting;
                  return (
                    <div key={c.id} className="cc-lab-cprow">
                      <span className="nm">
                        <span className="seq">
                          {c.section}.{c.seq}
                        </span>
                        {c.name}
                      </span>
                      <span className="mth">{c.method || "—"}</span>
                      <span className="exp">{c.expected || "—"}</span>
                      <span>
                        <select
                          className={`cc-lab-result ${c.result}`}
                          value={c.result}
                          disabled={readOnly}
                          onChange={(e) => setResult(c, e.target.value)}
                          aria-label={`Result for ${c.name}`}
                        >
                          {RESULT_ORDER.map((r) => (
                            <option key={r} value={r}>
                              {RESULT_META[r].label}
                            </option>
                          ))}
                        </select>
                      </span>
                      <span>
                        <input
                          className="cc-input cc-lab-cpnotes"
                          type="text"
                          placeholder={readOnly ? "—" : "Notes / evidence…"}
                          value={c.notes_evidence || ""}
                          disabled={readOnly}
                          onChange={(e) => setCpNotes(c, e.target.value)}
                        />
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* verdict controls in section 6 */}
              {current.section === 6 && !readOnly ? (
                <div className="cc-lab-verdictrow">
                  {sections1to5Done ? (
                    <>
                      <span className="lab">SET FINAL VERDICT</span>
                      <button
                        type="button"
                        className="cc-btn cc-lab-vbtn pass"
                        disabled={completing !== null}
                        onClick={() => completeSession("pass")}
                      >
                        {completing === "pass" ? "SAVING…" : "PASS"}
                      </button>
                      <button
                        type="button"
                        className="cc-btn cc-lab-vbtn review"
                        disabled={completing !== null}
                        onClick={() => completeSession("review")}
                      >
                        {completing === "review" ? "SAVING…" : "REVIEW"}
                      </button>
                      <button
                        type="button"
                        className="cc-btn cc-lab-vbtn fail"
                        disabled={completing !== null}
                        onClick={() => completeSession("fail")}
                      >
                        {completing === "fail" ? "SAVING…" : "FAIL"}
                      </button>
                    </>
                  ) : (
                    <span className="cc-empty">
                      Verdict unlocks when sections 1–5 are fully resolved (
                      {sections
                        .filter((s) => s.section <= 5 && !sectionDone(s.items))
                        .map((s) => s.section)
                        .join(", ") || "—"}{" "}
                      still open).
                    </span>
                  )}
                </div>
              ) : null}
              {current.section === 6 && readOnly && status === "completed" ? (
                <div className="cc-lab-verdictrow">
                  <span className="lab">FINAL VERDICT</span>
                  <span className={`cc-chip ${finalVerdict.tone}`}>{finalVerdict.label}</span>
                  <Link href={`/admin/testing/session/${session.id}/report`} className="cc-btn">
                    OPEN TEST REPORT
                  </Link>
                </div>
              ) : null}

              {/* quick notes */}
              <div className="cc-lab-quicknotes">
                <div className="cc-notelabel">QUICK NOTES</div>
                <textarea
                  ref={notesRef}
                  className="cc-input"
                  rows={2}
                  placeholder={readOnly ? "—" : "Add a note about this test session…"}
                  value={notes}
                  disabled={readOnly}
                  onChange={(e) => {
                    const v = e.target.value;
                    setNotes(v);
                    debounced("notes", () => apiSessionPatch({ notes: v }));
                  }}
                />
                <div className="btns">
                  <button
                    type="button"
                    className="cc-btn ghost"
                    disabled={readOnly}
                    onClick={() => notesRef.current?.focus()}
                  >
                    ADD NOTE
                  </button>
                  <button
                    type="button"
                    className="cc-btn ghost off"
                    disabled
                    title="Comes online with evidence storage"
                  >
                    UPLOAD IMAGE
                  </button>
                  <button
                    type="button"
                    className="cc-btn ghost off"
                    disabled
                    title="Comes online with evidence storage"
                  >
                    ATTACH FILE
                  </button>
                  <button
                    type="button"
                    className="cc-btn ghost off"
                    disabled
                    title="Comes online with evidence storage"
                  >
                    ADD TIME MARK
                  </button>
                  <button
                    type="button"
                    className="cc-btn primary"
                    style={{ marginLeft: "auto" }}
                    onClick={() => setCurrentSection(nextIncompleteSection())}
                  >
                    NEXT SECTION →
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="cc-panel">
              <span className="cc-empty">No checkpoints on this session.</span>
            </div>
          )}
        </div>

        {/* ===== RIGHT ===== */}
        <div className="cc-lab-col">
          {/* Jimmy */}
          <div className="cc-panel cc-lab-jimmy">
            <div className="cc-panel-h">
              <CcIcon name="jimmy" />
              Jimmy AI Assistant
              <span className="right online">
                <span className="dot" /> ONLINE
              </span>
            </div>
            <div className="cc-lab-jimmyhead">
              <JimmyMiniAvatar />
              <div className="tx">
                Grounded preparedness companion — ask about test methods, safety or the {product?.pillar || "product"}{" "}
                pillar.
              </div>
            </div>
            <div className="cc-lab-chat" ref={threadRef}>
              {thread.map((m) => (
                <div key={m.key} className={`cc-jimmy-bubble ${m.role}`}>
                  <span className="who">{m.role === "user" ? "You" : m.role === "jimmy" ? "Jimmy" : "System"}</span>
                  <div className="txt">{m.pending ? "Jimmy is thinking…" : m.text}</div>
                </div>
              ))}
            </div>
            <div className="cc-lab-chatinput">
              <input
                className="cc-input"
                type="text"
                placeholder="Ask Jimmy…"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") sendChat();
                }}
              />
              <button
                type="button"
                className="cc-btn primary"
                onClick={sendChat}
                disabled={chatBusy || !chatInput.trim()}
              >
                {chatBusy ? "…" : "SEND"}
              </button>
            </div>
            <div className="cc-lab-disclose">Jimmy is an AI assistant — verify critical information.</div>
          </div>

          {/* Live recording */}
          <div className="cc-panel">
            <div className="cc-panel-h">
              <CcIcon name="competitors" />
              Live Test Recording
              <span className="right">OFFLINE</span>
            </div>
            <div className="cc-lab-recbox">
              Recording hardware comes online later — no camera or microphone is connected to this console.
            </div>
            <div className="cc-notelabel" style={{ marginTop: 12 }}>
              AUTO TIMEMARKS
            </div>
            {timemarks.length === 0 ? (
              <span className="cc-empty">Timemarks appear as checkpoints are resolved.</span>
            ) : (
              <div className="cc-lab-timemarks">
                {timemarks.map((t) => (
                  <div key={t.id} className="tm">
                    <span className="cc-num at">{t.at}</span>
                    <span className="nm">{t.name}</span>
                    <span className={`cc-chip ${RESULT_META[t.result]?.tone || "muted"} plain sm`}>
                      {RESULT_META[t.result]?.label || t.result}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Export & share */}
          <div className="cc-panel">
            <div className="cc-panel-h">
              <CcIcon name="overview" />
              Export &amp; Share
            </div>
            <div className="cc-lab-exports">
              <Link href={`/admin/testing/session/${session.id}/report`} className="cc-btn">
                GENERATE TEST REPORT
              </Link>
              <button type="button" className="cc-btn ghost off" disabled title="Comes online with publishing integrations">
                CREATE YOUTUBE VIDEO
              </button>
              <button type="button" className="cc-btn ghost off" disabled title="Comes online with supplier messaging">
                SHARE WITH SUPPLIER
              </button>
              <Link href="/admin/testing" className="cc-btn ghost" title="Progress is saved continuously">
                SAVE &amp; CLOSE SESSION
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- bottom strip ---------- */}
      <div className="cc-lab-bottom">
        <div className="cc-panel ring">
          <div className="cc-panel-h">Test Progress</div>
          <ProgressRing pct={overallPct} />
        </div>
        <div className="cc-panel">
          <div className="cc-panel-h">Section Progress</div>
          <div className="cc-lab-secprog">
            {sections.map((s) => {
              const done = s.items.filter((c) => RESOLVED_RESULTS.has(c.result)).length;
              const all = sectionDone(s.items);
              return (
                <div key={s.section} className={`row${all ? " done" : ""}`}>
                  <span className="nm">
                    {s.section}. {s.name}
                  </span>
                  <span className="cc-num n">
                    {done} / {s.items.length}
                  </span>
                  <span className="tick">{all ? "✓" : ""}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="cc-panel">
          <div className="cc-panel-h">Key Metrics (So Far)</div>
          {metrics.length === 0 ? (
            <span className="cc-empty">
              No measured values yet — metrics populate from the evidence notes of passed checkpoints.
            </span>
          ) : (
            <div className="cc-lab-metrics">
              {metrics.map((m) => (
                <div key={m.id} className="cc-tile">
                  <div className="n" style={{ fontSize: 15 }}>{m.value}</div>
                  <div className="l">{m.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="cc-panel">
          <div className="cc-panel-h">Preliminary Verdict</div>
          {status === "completed" && verdict ? (
            <div className={`cc-lab-verdict ${finalVerdict.tone}`}>{finalVerdict.label}</div>
          ) : (
            <div className={`cc-lab-verdict ${prelim.tone}`}>{prelim.label}</div>
          )}
          <div className="cc-lab-gauge">
            <div className="band">
              <span className="seg fail" />
              <span className="seg review" />
              <span className="seg pass" />
            </div>
            <span
              className="marker"
              style={{ left: `${status === "completed" && verdict ? (verdict === "fail" ? 8 : verdict === "review" ? 50 : 92) : prelim.pos}%` }}
            >
              ▼
            </span>
            <div className="labels">
              <span>FAIL</span>
              <span>REVIEW</span>
              <span>PASS</span>
            </div>
          </div>
          <div className="cc-lab-gaugenote">
            {status === "completed"
              ? "Final verdict recorded for this session."
              : "Complete all tests to get final verdict."}
          </div>
        </div>
      </div>
    </main>
  );
}

function ProgressRing({ pct }: { pct: number }) {
  const r = 40;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(100, pct)) / 100;
  return (
    <div className="cc-lab-ring">
      <svg viewBox="0 0 100 100" width="110" height="110">
        <circle cx="50" cy="50" r={r} className="track" />
        <circle
          cx="50"
          cy="50"
          r={r}
          className="val"
          strokeDasharray={`${c * frac} ${c}`}
          transform="rotate(-90 50 50)"
        />
        <text x="50" y="54" textAnchor="middle" className="num">
          {pct}%
        </text>
      </svg>
      <div className="l">OVERALL PROGRESS</div>
    </div>
  );
}
