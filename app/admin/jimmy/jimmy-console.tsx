"use client";

import { Fragment, useMemo, useRef, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CcIcon } from "../cc-chrome";
import type {
  JimmyConsoleData,
  JimmyKnowledgeChunk,
  JimmyMessageRow,
  JimmyScenario,
} from "@/lib/jimmy/data";

/* ---------- small helpers ---------- */

const PACKS = ["Water", "Fire", "Shelter", "Medical", "Food", "General"];
const TIERS = ["GREEN", "AMBER", "RED"] as const;

function TierChip({ tier }: { tier: string | null | undefined }) {
  if (!tier) return null;
  const cls = tier === "GREEN" ? "green" : tier === "RED" ? "red" : "amber";
  return <span className={`cc-chip ${cls}`}>{tier}</span>;
}

function StatusChip({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  return (
    <span className={`cc-chip ${status === "SIGNED" ? "green" : "amber"} plain`}>{status}</span>
  );
}

function LockIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 018 0v4" />
    </svg>
  );
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
}

function fmtCents(c: number): string {
  return `€${(c / 100).toFixed(2)}`;
}

/* ---------- thread message model ---------- */

type ThreadMsg = {
  key: string;
  role: "user" | "jimmy" | "system";
  text: string;
  tier?: string | null;
  sources?: { id: string | number; pack: string; section: string | null; tier: string | null }[];
  provider?: string | null;
  model?: string | null;
  tokensIn?: number;
  tokensOut?: number;
  safetyTriggered?: boolean;
  pending?: boolean;
};

type ScenarioResult = {
  scenarioName: string;
  answer: any;
  expected: string | null;
  evalRunId: string | number;
  graded: null | boolean;
};

type Tab = "console" | "knowledge" | "training" | "conversations" | "analytics" | "settings";

const TAB_LABELS: { id: Tab; label: string }[] = [
  { id: "console", label: "Test Console" },
  { id: "knowledge", label: "Knowledge Base" },
  { id: "training", label: "Training Center" },
  { id: "conversations", label: "Conversations" },
  { id: "analytics", label: "Analytics" },
  { id: "settings", label: "Settings" },
];

export default function JimmyConsole({ data }: { data: JimmyConsoleData }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("console");
  const { settings, analytics } = data;

  const signedCount = data.knowledge.filter((k) => k.status === "SIGNED").length;
  const online = !settings.kill_switch;

  return (
    <main className="cc-container">
      <div className="cc-modhead">
        <span className="cc-modicon">
          <CcIcon name="jimmy" size={22} />
        </span>
        <div>
          <h1>JIMMY RUNTIME</h1>
          <div className="sub">
            Preparedness companion — grounded-only runtime, deterministic safety layers, human sign-off.
            SC 03 authors him; SC 05 hosts him.
          </div>
        </div>
        <Link href="/admin/jimmy/preview" className="cc-jcx-navlink">
          CUSTOMER PREVIEW →
        </Link>
      </div>

      {/* header strip — everything read from live settings, never hardcoded */}
      <div className="cc-jimmy-head">
        <span className={`cc-jimmy-status ${online ? "online" : "paused"}`}>
          <span className="dot" />
          {online ? "JIMMY ONLINE" : "JIMMY PAUSED"}
        </span>
        <span className="sep">·</span>
        <span>
          <span className="k">PROVIDER</span> {settings.provider_primary.toUpperCase()} / {settings.model_primary}
        </span>
        <span className="sep">·</span>
        <span>
          <span className="k">FALLBACK</span> {settings.provider_fallback.toUpperCase()} / {settings.model_fallback}
        </span>
        <span className="sep">·</span>
        <span>
          <span className="k">KNOWLEDGE</span> {data.knowledge.length} chunks · {signedCount} signed
        </span>
        <span className="sep">·</span>
        <span className={`cc-chip ${data.prompt?.status === "SIGNED" ? "green" : "amber"} plain`}>
          {settings.prompt_version} {data.prompt?.status || "DRAFT"}
        </span>
        <span className="sep">·</span>
        <span>
          <span className="k">TRIGGERS</span> {data.triggersActive} active
        </span>
      </div>
      <div className="cc-jimmy-disclaim">
        <strong>Jimmy is an AI assistant</strong> — Jimmy can make mistakes. Verify critical information.
      </div>

      <div className="cc-jimmy-tabs" role="tablist">
        {TAB_LABELS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`cc-jimmy-tab${tab === t.id ? " on" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "console" && <TestConsole data={data} />}
      {tab === "knowledge" && <KnowledgeBase data={data} />}
      {tab === "training" && <TrainingCenter data={data} onChanged={() => router.refresh()} />}
      {tab === "conversations" && <Conversations data={data} />}
      {tab === "analytics" && <Analytics data={data} />}
      {tab === "settings" && <SettingsTab data={data} onChanged={() => router.refresh()} />}
    </main>
  );
}

/* ==================================================================== */
/* TEST CONSOLE                                                          */
/* ==================================================================== */

function TestConsole({ data }: { data: JimmyConsoleData }) {
  const [thread, setThread] = useState<ThreadMsg[]>([]);
  const [conversationId, setConversationId] = useState<string | number | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [includeDraft, setIncludeDraft] = useState(true);
  const [profileId, setProfileId] = useState<string>(() => {
    const t = data.profiles.find((p) => p.is_test) || data.profiles[0];
    return t ? String(t.id) : "";
  });
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [thread]);

  async function send() {
    const msg = input.trim();
    if (!msg || busy) return;
    setBusy(true);
    setInput("");
    const userKey = crypto.randomUUID();
    setThread((t) => [
      ...t,
      { key: `u-${userKey}`, role: "user", text: msg },
      { key: `p-${userKey}`, role: "jimmy", text: "…", pending: true },
    ]);
    try {
      const res = await fetch("/api/admin/jimmy/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          profileId: profileId || null,
          message: msg,
          idempotencyKey: userKey,
          includeDraft,
          surface: "console",
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      if (body.conversationId) setConversationId(body.conversationId);
      const a = body.answer || {};
      setThread((t) =>
        t.map((m) =>
          m.key === `p-${userKey}`
            ? {
                key: m.key,
                role: a.role === "system" ? "system" : "jimmy",
                text: a.text || "",
                tier: a.tier,
                sources: a.sources || [],
                provider: a.provider,
                model: a.model,
                tokensIn: a.tokensIn,
                tokensOut: a.tokensOut,
                safetyTriggered: Boolean(a.safetyTriggered),
              }
            : m
        )
      );
    } catch (e: any) {
      setThread((t) =>
        t.map((m) =>
          m.key === `p-${userKey}`
            ? { key: m.key, role: "system", text: `Request failed: ${e?.message || e}` }
            : m
        )
      );
    }
    setBusy(false);
  }

  return (
    <div className="cc-jimmy-console">
      {/* left: chat */}
      <div className="cc-panel">
        <div className="cc-panel-h">
          <CcIcon name="jimmy" />
          Test Console
          <span className="right">{conversationId ? `CONV ${String(conversationId).slice(0, 8)}` : "NEW CONVERSATION"}</span>
        </div>

        <div className="cc-controls" style={{ marginTop: 0 }}>
          <select
            className="cc-input"
            value={profileId}
            onChange={(e) => {
              setProfileId(e.target.value);
              setConversationId(null);
              setThread([]);
            }}
            aria-label="Test profile"
          >
            <option value="">NO PROFILE</option>
            {data.profiles.map((p) => (
              <option key={String(p.id)} value={String(p.id)}>
                {p.name.toUpperCase()}
                {p.is_test ? " · FICTIONAL" : ""}
              </option>
            ))}
          </select>
          {data.profiles.length === 0 ? (
            <span className="cc-empty">No test profiles yet — seeding in progress.</span>
          ) : (
            <span className="cc-chip amber plain">TEST PROFILES ARE FICTIONAL</span>
          )}
          <button
            type="button"
            className="cc-btn ghost"
            onClick={() => {
              setConversationId(null);
              setThread([]);
            }}
          >
            New conversation
          </button>
        </div>

        <div className="cc-jimmy-thread" ref={threadRef}>
          {thread.length === 0 ? (
            <span className="cc-empty">
              Send a message to test Jimmy. Every message runs the full runtime pipeline — store-before-AI,
              deterministic emergency check, rate limit, cost cap, grounded retrieval, provider router.
            </span>
          ) : (
            thread.map((m) => (
              <div key={m.key} className={`cc-jimmy-bubble ${m.role}`}>
                <span className="who">{m.role === "user" ? "You" : m.role === "jimmy" ? "Jimmy" : "System"}</span>
                {m.safetyTriggered ? (
                  <div className="cc-jimmy-safety">
                    <LockIcon size={13} />
                    DETERMINISTIC RESPONSE — model was not called
                  </div>
                ) : null}
                <div className="txt">{m.pending ? "Jimmy is thinking…" : m.text}</div>
                {m.role === "jimmy" && !m.pending ? (
                  <div className="cc-jimmy-meta">
                    <TierChip tier={m.tier} />
                    {(m.sources || []).map((s) => (
                      <span key={`${m.key}-${String(s.id)}`} className="cc-chip muted plain sm">
                        {s.pack}/{s.section || "general"}
                      </span>
                    ))}
                    {m.provider ? (
                      <span>
                        {m.provider}/{m.model} · {(m.tokensIn || 0) + (m.tokensOut || 0)} tok
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>

        <div className="cc-jimmy-inputrow">
          <textarea
            className="cc-input"
            rows={2}
            placeholder="Ask Jimmy something…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button type="button" className="cc-btn primary" onClick={send} disabled={busy || !input.trim()}>
            {busy ? "…" : "Send"}
          </button>
        </div>

        <div className="cc-jimmy-controls">
          <div className="cc-jimmy-toggle">
            <span className="lab">Use latest knowledge (includes DRAFT)</span>
            <button
              type="button"
              className={`sw${includeDraft ? " on" : ""}`}
              onClick={() => setIncludeDraft((v) => !v)}
              aria-label="Use latest knowledge"
            >
              <span className="knob" />
            </button>
          </div>
          <div className="cc-jimmy-toggle" title="Wired to SC 01 next">
            <span className="lab">Include product data (wired to SC 01 next)</span>
            <button type="button" className="sw" disabled aria-label="Include product data — coming soon">
              <span className="knob" />
            </button>
          </div>
          <div
            className="cc-jimmy-toggle locked"
            title="Locked by grounding rule — customer Jimmy answers only from approved knowledge"
          >
            <span className="lab">
              <span className="cc-jimmy-lockico">
                <LockIcon />
              </span>
              Real-time Web Search — LOCKED OFF
            </span>
            <button
              type="button"
              className="sw"
              disabled
              aria-label="Real-time web search — locked by grounding rule"
            >
              <span className="knob" />
            </button>
          </div>
        </div>
      </div>

      {/* right: scenario runner */}
      <ScenarioRunner scenarios={data.scenarios} profileId={profileId || null} />
    </div>
  );
}

function ScenarioRunner({
  scenarios,
  profileId,
}: {
  scenarios: JimmyScenario[];
  profileId: string | null;
}) {
  const [runningId, setRunningId] = useState<string | null>(null);
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [grading, setGrading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const byCategory = useMemo(() => {
    const groups: Record<string, JimmyScenario[]> = {};
    for (const s of scenarios) (groups[s.category || "General"] ||= []).push(s);
    return groups;
  }, [scenarios]);

  async function run(s: JimmyScenario) {
    if (runningId) return;
    setRunningId(String(s.id));
    setErr(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/jimmy/scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: s.id, profileId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setResult({
        scenarioName: body.scenarioName || s.name,
        answer: body.answer,
        expected: body.expected_behaviour ?? s.expected_behaviour,
        evalRunId: body.evalRunId,
        graded: null,
      });
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
    setRunningId(null);
  }

  async function grade(passed: boolean) {
    if (!result || grading) return;
    setGrading(true);
    try {
      const res = await fetch("/api/admin/jimmy/eval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evalRunId: result.evalRunId, passed }),
      });
      if (res.ok) setResult({ ...result, graded: passed });
      else {
        const body = await res.json().catch(() => null);
        setErr(body?.error || `HTTP ${res.status}`);
      }
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
    setGrading(false);
  }

  const a = result?.answer;

  return (
    <div className="cc-panel">
      <div className="cc-panel-h">
        <CcIcon name="testing" />
        Scenario Runner
        <span className="right">SAME PIPELINE AS CHAT</span>
      </div>
      {scenarios.length === 0 ? (
        <span className="cc-empty">No challenge scenarios yet — seeding in progress.</span>
      ) : (
        <div className="cc-jimmy-scenlist">
          {Object.entries(byCategory).map(([cat, list]) => (
            <div key={cat}>
              <div className="cc-jimmy-scencat">{cat}</div>
              {list.map((s) => (
                <div key={String(s.id)} className="cc-jimmy-scen">
                  <span className="nm" title={s.prompt}>
                    {s.name}
                  </span>
                  <button
                    type="button"
                    className="cc-btn"
                    disabled={runningId !== null}
                    onClick={() => run(s)}
                  >
                    {runningId === String(s.id) ? "Running…" : "Run"}
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {err ? <div className="savemsg err" style={{ marginTop: 10 }}>{err}</div> : null}
      {result ? (
        <div className="cc-jimmy-scenresult">
          <div className="sh">Scenario — {result.scenarioName}</div>
          {a?.safetyTriggered ? (
            <div className="cc-jimmy-safety" style={{ marginBottom: 8 }}>
              <LockIcon size={13} />
              DETERMINISTIC RESPONSE — model was not called
            </div>
          ) : null}
          <div className="body">{a?.text || "(empty answer)"}</div>
          <div className="cc-jimmy-meta" style={{ marginTop: 8 }}>
            <TierChip tier={a?.tier} />
            {a?.provider ? (
              <span>
                {a.provider}/{a.model} · {(a.tokensIn || 0) + (a.tokensOut || 0)} tok
              </span>
            ) : null}
          </div>
          <div className="sh">Expected behaviour</div>
          <div className="body">{result.expected || "—"}</div>
          <div className="cc-jimmy-grade">
            {result.graded === null ? (
              <>
                <button type="button" className="cc-btn pass" disabled={grading} onClick={() => grade(true)}>
                  Pass
                </button>
                <button type="button" className="cc-btn fail" disabled={grading} onClick={() => grade(false)}>
                  Fail
                </button>
                <span className="cc-empty">Human grading writes the eval record.</span>
              </>
            ) : (
              <span className={`cc-chip ${result.graded ? "green" : "red"}`}>
                GRADED {result.graded ? "PASS" : "FAIL"}
              </span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ==================================================================== */
/* KNOWLEDGE BASE                                                        */
/* ==================================================================== */

function ChunkCard({ chunk }: { chunk: JimmyKnowledgeChunk }) {
  const [open, setOpen] = useState(false);
  const content = chunk.content || "";
  const preview = content.length > 220 && !open ? `${content.slice(0, 220)}…` : content;
  return (
    <div className="cc-jimmy-chunk">
      <div className="row1">
        <span className="cc-chip cyan plain">{chunk.pack.toUpperCase()}</span>
        <span className="sec">{chunk.section || "General"}</span>
        <TierChip tier={chunk.tier} />
        <StatusChip status={chunk.status} />
        {chunk.status === "SIGNED" && chunk.signed_by ? (
          <span className="cc-chip muted plain sm">
            SIGNED BY {chunk.signed_by.toUpperCase()} · {fmtDate(chunk.signed_at).slice(0, 10)}
          </span>
        ) : null}
      </div>
      <div className={`preview${open ? " full" : ""}`}>{preview}</div>
      {content.length > 220 ? (
        <button type="button" className="expand" onClick={() => setOpen((v) => !v)}>
          {open ? "Collapse" : "Expand"}
        </button>
      ) : null}
      {chunk.keywords ? <div className="kw">KEYWORDS · {chunk.keywords}</div> : null}
    </div>
  );
}

function KnowledgeBase({ data }: { data: JimmyConsoleData }) {
  const [pack, setPack] = useState("");
  const [status, setStatus] = useState("");
  const filtered = data.knowledge.filter(
    (k) => (!pack || k.pack === pack) && (!status || k.status === status)
  );
  return (
    <div className="cc-jimmy-kbgrid">
      <div className="cc-panel">
        <div className="cc-panel-h">
          <CcIcon name="compliance" />
          Knowledge Base
          <span className="right">
            {data.knowledge.length} CHUNKS · {data.knowledge.filter((k) => k.status === "SIGNED").length} SIGNED
          </span>
        </div>
        <div className="cc-controls" style={{ marginTop: 0 }}>
          <select className="cc-input" value={pack} onChange={(e) => setPack(e.target.value)} aria-label="Filter pack">
            <option value="">ALL PACKS</option>
            {PACKS.map((p) => (
              <option key={p} value={p}>
                {p.toUpperCase()}
              </option>
            ))}
          </select>
          <select
            className="cc-input"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Filter status"
          >
            <option value="">ALL STATUSES</option>
            <option value="DRAFT">DRAFT</option>
            <option value="SIGNED">SIGNED</option>
          </select>
          <span className="cc-empty">
            Customer-facing Jimmy serves SIGNED chunks only.
          </span>
        </div>
        {data.knowledge.length === 0 ? (
          <div className="cc-notestrip">KNOWLEDGE SEEDING IN PROGRESS — chunks will appear here as the packs land.</div>
        ) : filtered.length === 0 ? (
          <div className="cc-notestrip">No chunks match this filter.</div>
        ) : (
          filtered.map((k) => <ChunkCard key={String(k.id)} chunk={k} />)
        )}
      </div>
      <div className="cc-panel">
        <div className="cc-panel-h">
          <CcIcon name="suppliers" />
          Source Register
          <span className="right">{data.sources.length} SOURCES</span>
        </div>
        {data.sources.length === 0 ? (
          <div className="cc-notestrip">SOURCE REGISTER EMPTY — seeding in progress.</div>
        ) : (
          data.sources.map((s) => (
            <div key={String(s.id)} className="cc-jimmy-src">
              <span className="t">{s.title || "Untitled source"}</span>
              <StatusChip status={s.status} />
              {s.publisher ? <span className="p">{s.publisher}</span> : null}
              {s.url ? (
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  OPEN ↗
                </a>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ==================================================================== */
/* TRAINING CENTER                                                       */
/* ==================================================================== */

function TrainingCenter({ data, onChanged }: { data: JimmyConsoleData; onChanged: () => void }) {
  const [pack, setPack] = useState("Water");
  const [section, setSection] = useState("");
  const [tier, setTier] = useState<string>("AMBER");
  const [content, setContent] = useState("");
  const [keywords, setKeywords] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [newSourceTitle, setNewSourceTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [signNames, setSignNames] = useState<Record<string, string>>({});
  const [signingId, setSigningId] = useState<string | null>(null);

  async function addChunk() {
    if (!content.trim() || saving) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/jimmy/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          pack,
          section: section.trim() || null,
          tier,
          content: content.trim(),
          keywords: keywords.trim() || null,
          sourceId: sourceId || null,
          newSource: !sourceId && newSourceTitle.trim() ? { title: newSourceTitle.trim() } : null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setMsg({ ok: true, text: "Chunk added as DRAFT — sign it below to approve." });
      setContent("");
      setKeywords("");
      setSection("");
      setNewSourceTitle("");
      onChanged();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || String(e) });
    }
    setSaving(false);
  }

  async function sign(chunkId: string | number) {
    const name = (signNames[String(chunkId)] || "").trim();
    if (!name || signingId) return;
    setSigningId(String(chunkId));
    try {
      const res = await fetch("/api/admin/jimmy/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sign", id: chunkId, signed_by: name }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      onChanged();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || String(e) });
    }
    setSigningId(null);
  }

  const drafts = data.knowledge.filter((k) => k.status === "DRAFT");

  return (
    <div>
      <div className="cc-jimmy-trainbanner">
        <LockIcon size={14} />
        TRAINING ADDS SIGNED KNOWLEDGE ONLY — JIMMY NEVER SELF-TEACHES. Customer-facing Jimmy serves SIGNED
        chunks only; every addition starts as DRAFT and needs a reviewer&apos;s sign-off.
      </div>
      <div className="cc-detailgrid" style={{ marginTop: 0 }}>
        <div className="cc-panel cc-span6">
          <div className="cc-panel-h">
            <CcIcon name="products" />
            Add Knowledge
            <span className="right">CREATES DRAFT</span>
          </div>
          <div className="cc-jimmy-form">
            <label>
              <span>Pack</span>
              <select className="cc-input" value={pack} onChange={(e) => setPack(e.target.value)}>
                {PACKS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Section</span>
              <input
                className="cc-input"
                type="text"
                value={section}
                onChange={(e) => setSection(e.target.value)}
                placeholder="e.g. Water storage"
              />
            </label>
            <label>
              <span>Tier</span>
              <select className="cc-input" value={tier} onChange={(e) => setTier(e.target.value)}>
                {TIERS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="wide">
              <span>Content</span>
              <textarea
                className="cc-input"
                rows={5}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Approved-candidate knowledge text…"
              />
            </label>
            <label className="wide">
              <span>Keywords (retrieval hints, comma-separated)</span>
              <input
                className="cc-input"
                type="text"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder="water, storage, litres, household"
              />
            </label>
            <label>
              <span>Source</span>
              <select className="cc-input" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                <option value="">— none / new —</option>
                {data.sources.map((s) => (
                  <option key={String(s.id)} value={String(s.id)}>
                    {s.title || String(s.id)}
                  </option>
                ))}
              </select>
            </label>
            {!sourceId ? (
              <label>
                <span>Or new source title</span>
                <input
                  className="cc-input"
                  type="text"
                  value={newSourceTitle}
                  onChange={(e) => setNewSourceTitle(e.target.value)}
                  placeholder="e.g. WHO household water guide"
                />
              </label>
            ) : null}
          </div>
          <div className="cc-jimmy-signrow">
            <button type="button" className="cc-btn primary" onClick={addChunk} disabled={saving || !content.trim()}>
              {saving ? "Saving…" : "Add as DRAFT"}
            </button>
            {msg ? <span className={`savemsg ${msg.ok ? "ok" : "err"}`}>{msg.text}</span> : null}
          </div>
        </div>

        <div className="cc-panel cc-span6">
          <div className="cc-panel-h">
            <CcIcon name="compliance" />
            Sign-off Queue
            <span className="right">{drafts.length} DRAFT</span>
          </div>
          {drafts.length === 0 ? (
            <div className="cc-notestrip">NO DRAFT CHUNKS AWAITING SIGN-OFF.</div>
          ) : (
            drafts.map((k) => (
              <div key={String(k.id)} className="cc-jimmy-chunk">
                <div className="row1">
                  <span className="cc-chip cyan plain">{k.pack.toUpperCase()}</span>
                  <span className="sec">{k.section || "General"}</span>
                  <TierChip tier={k.tier} />
                  <StatusChip status={k.status} />
                </div>
                <div className="preview">{(k.content || "").slice(0, 180)}{(k.content || "").length > 180 ? "…" : ""}</div>
                <div className="cc-jimmy-signrow">
                  <input
                    className="cc-input"
                    type="text"
                    placeholder="Reviewer name (required)"
                    value={signNames[String(k.id)] || ""}
                    onChange={(e) => setSignNames((s) => ({ ...s, [String(k.id)]: e.target.value }))}
                  />
                  <button
                    type="button"
                    className="cc-btn"
                    disabled={!(signNames[String(k.id)] || "").trim() || signingId !== null}
                    onClick={() => sign(k.id)}
                  >
                    {signingId === String(k.id) ? "Signing…" : "Sign"}
                  </button>
                </div>
              </div>
            ))
          )}
          <div className="cc-notestrip">
            Signing is the ONLY path to SIGNED. Any later edit resets a chunk to DRAFT — it must be re-signed.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ==================================================================== */
/* CONVERSATIONS                                                         */
/* ==================================================================== */

function Conversations({ data }: { data: JimmyConsoleData }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const profileName = (id: string | number | null) => {
    if (id == null) return "—";
    const p = data.profiles.find((x) => String(x.id) === String(id));
    return p ? p.name : String(id).slice(0, 8);
  };
  return (
    <div className="cc-panel">
      <div className="cc-panel-h">
        <CcIcon name="overview" />
        Conversations
        <span className="right">LAST {data.conversations.length} · READ-ONLY</span>
      </div>
      {data.conversations.length === 0 ? (
        <div className="cc-notestrip">NO CONVERSATIONS YET — run the test console to create the first one.</div>
      ) : (
        <div className="cc-tablewrap">
          <table className="cc-table" style={{ minWidth: 700 }}>
            <thead>
              <tr>
                <th>Started</th>
                <th>Profile</th>
                <th>Surface</th>
                <th>Messages</th>
                <th>Safety fires</th>
                <th>Meta</th>
              </tr>
            </thead>
            <tbody>
              {data.conversations.map((c) => (
                <Fragment key={String(c.id)}>
                  <tr
                    className={openId === String(c.id) ? "sel" : ""}
                    onClick={() => setOpenId(openId === String(c.id) ? null : String(c.id))}
                  >
                    <td className="cc-num">{fmtDate(c.started_at)}</td>
                    <td>{profileName(c.profile_id)}</td>
                    <td>
                      <span className="cc-chip muted plain sm">{(c.surface || "console").toUpperCase()}</span>
                    </td>
                    <td className="cc-num">{c.messageCount}</td>
                    <td className={`cc-num${c.safetyFires > 0 ? " red" : ""}`}>{c.safetyFires}</td>
                    <td>{c.meta?.scenario ? <span className="cc-chip amber plain sm">SCENARIO</span> : "—"}</td>
                  </tr>
                  {openId === String(c.id) ? (
                    <tr>
                      <td colSpan={6} style={{ whiteSpace: "normal" }}>
                        <div className="cc-jimmy-convthread">
                          {c.messages.length === 0 ? (
                            <span className="cc-empty">No messages stored.</span>
                          ) : (
                            c.messages.map((m: JimmyMessageRow) => (
                              <div key={String(m.id)} className={`cc-jimmy-bubble ${m.role === "user" ? "user" : m.role === "system" ? "system" : "jimmy"}`}>
                                <span className="who">
                                  {m.role} · {fmtDate(m.created_at)}
                                </span>
                                {m.safety_triggered ? (
                                  <div className="cc-jimmy-safety">
                                    <LockIcon size={13} />
                                    DETERMINISTIC RESPONSE — model was not called
                                  </div>
                                ) : null}
                                <div className="txt">{m.content}</div>
                                {m.role === "jimmy" ? (
                                  <div className="cc-jimmy-meta">
                                    <TierChip tier={m.tier} />
                                    {m.provider ? (
                                      <span>
                                        {m.provider}/{m.model} · {(m.tokens_in || 0) + (m.tokens_out || 0)} tok
                                      </span>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            ))
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ==================================================================== */
/* ANALYTICS                                                             */
/* ==================================================================== */

function Analytics({ data }: { data: JimmyConsoleData }) {
  const a = data.analytics;
  const cap = data.settings.daily_cost_cap_cents || 0;
  const enoughEvals = a.evalRunsGraded >= 20;
  return (
    <div>
      <div className="cc-stats">
        <div className="cc-stat cyan">
          <div className="n">{a.conversations == null ? "—" : a.conversations}</div>
          <div className="l">Conversations</div>
        </div>
        <div className="cc-stat cyan">
          <div className="n">{a.messages == null ? "—" : a.messages}</div>
          <div className="l">Messages</div>
        </div>
        <div className="cc-stat red">
          <div className="n">{a.safetyFires == null ? "—" : a.safetyFires}</div>
          <div className="l">Deterministic Safety Fires</div>
        </div>
        <div className="cc-stat green">
          <div className="n">{a.challengePassRate == null ? "—" : `${a.challengePassRate}%`}</div>
          <div className="l">Safety Score — challenge-test pass rate</div>
          {a.challengePassRate == null ? <div className="l" style={{ opacity: 0.7, marginTop: 2 }}>needs data</div> : null}
        </div>
        <div className="cc-stat amber">
          <div className="n">
            {a.evalRunsTotal} / {a.evalRunsGraded}
          </div>
          <div className="l">Challenge Tests Run / Graded</div>
        </div>
        <div className="cc-stat">
          <div className="n">{a.avgResponseChars == null ? "—" : a.avgResponseChars}</div>
          <div className="l">Avg Response Chars</div>
          {a.avgResponseChars == null ? <div className="l" style={{ opacity: 0.7, marginTop: 2 }}>needs data</div> : null}
        </div>
        <div className="cc-stat cyan">
          <div className="n">
            {fmtCents(a.spendTodayCents)} / {fmtCents(cap)}
          </div>
          <div className="l">Est. Spend Today vs Cap</div>
        </div>
      </div>

      <div className="cc-detailgrid" style={{ marginTop: 0 }}>
        <div className="cc-panel cc-span6">
          <div className="cc-panel-h">
            <CcIcon name="competitors" />
            Per-Provider Answers
          </div>
          {Object.keys(a.providerCounts).length === 0 ? (
            <div className="cc-notestrip">NO MODEL ANSWERS YET — needs data.</div>
          ) : (
            <div className="cc-tiles">
              {Object.entries(a.providerCounts).map(([p, n]) => (
                <div key={p} className="cc-tile">
                  <div className="n">{n}</div>
                  <div className="l">{p.toUpperCase()}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="cc-panel cc-span6">
          <div className="cc-panel-h">
            <CcIcon name="testing" />
            Accuracy &amp; Hallucination Proxies
            <span className="right">{enoughEvals ? "PROXY LIVE" : "LOCKED"}</span>
          </div>
          {enoughEvals ? (
            <>
              <div className="cc-tiles">
                <div className="cc-tile">
                  <div className="n">{a.challengePassRate}%</div>
                  <div className="l">Accuracy proxy</div>
                </div>
                <div className="cc-tile">
                  <div className="n">{100 - (a.challengePassRate ?? 0)}%</div>
                  <div className="l">Hallucination-risk proxy</div>
                </div>
              </div>
              <div className="cc-jimmy-method">
                METHODOLOGY — proxies derived solely from the human-graded challenge-test pass rate
                ({a.evalRunsGraded} graded evals). These are pass-rate-based proxies, not measured
                accuracy or hallucination benchmarks.
              </div>
            </>
          ) : (
            <div className="cc-notestrip">
              NEEDS ≥20 GRADED EVALS — currently {a.evalRunsGraded}. No invented numbers: these tiles stay locked
              until enough human-graded challenge tests exist to compute pass-rate-based proxies.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ==================================================================== */
/* SETTINGS                                                              */
/* ==================================================================== */

function SettingsTab({ data, onChanged }: { data: JimmyConsoleData; onChanged: () => void }) {
  const s = data.settings;
  const [providerPrimary, setProviderPrimary] = useState(s.provider_primary);
  const [providerFallback, setProviderFallback] = useState(s.provider_fallback);
  const [modelPrimary, setModelPrimary] = useState(s.model_primary);
  const [modelFallback, setModelFallback] = useState(s.model_fallback);
  const [rateLimit, setRateLimit] = useState(String(s.rate_limit_per_hour));
  const [costCap, setCostCap] = useState(String(s.daily_cost_cap_cents));
  const [temperature, setTemperature] = useState(String(s.temperature ?? 0.3));
  const [killSwitch, setKillSwitch] = useState(Boolean(s.kill_switch));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => setKillSwitch(Boolean(s.kill_switch)), [s.kill_switch]);

  async function patchSettings(patch: Record<string, any>): Promise<boolean> {
    const res = await fetch("/api/admin/jimmy/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patch }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setMsg({ ok: false, text: body?.error || `HTTP ${res.status}` });
      return false;
    }
    return true;
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setMsg(null);
    const ok = await patchSettings({
      provider_primary: providerPrimary,
      provider_fallback: providerFallback,
      model_primary: modelPrimary,
      model_fallback: modelFallback,
      rate_limit_per_hour: Number(rateLimit),
      daily_cost_cap_cents: Number(costCap),
      temperature: Number(temperature),
    });
    if (ok) {
      setMsg({ ok: true, text: "Settings saved." });
      onChanged();
    }
    setSaving(false);
  }

  async function toggleKill() {
    const next = !killSwitch;
    const q = next
      ? "KILL SWITCH: silence ALL Jimmy AI replies immediately? Messages will still be stored."
      : "Turn Jimmy back ON? Model calls will resume.";
    if (!confirm(q)) return;
    setKillSwitch(next);
    const ok = await patchSettings({ kill_switch: next });
    if (ok) {
      setMsg({ ok: true, text: next ? "Kill switch ON — Jimmy paused." : "Kill switch OFF — Jimmy online." });
      onChanged();
    } else {
      setKillSwitch(!next);
    }
  }

  return (
    <div className="cc-detailgrid" style={{ marginTop: 0 }}>
      <div className="cc-panel cc-span12">
        <div className="cc-jimmy-kill">
          <span className="kt">KILL SWITCH</span>
          <span className="kd">
            One flag silences all AI replies instantly. Inbound messages are still stored; Jimmy answers with the
            paused notice and never calls a model.
          </span>
          <button
            type="button"
            className={`sw${killSwitch ? " on" : ""}`}
            onClick={toggleKill}
            aria-label="Kill switch"
          >
            <span className="knob" />
          </button>
          <span className={`cc-chip ${killSwitch ? "red" : "green"}`}>
            {killSwitch ? "PAUSED" : "ONLINE"}
          </span>
        </div>
      </div>

      <div className="cc-panel cc-span6">
        <div className="cc-panel-h">
          <CcIcon name="settings" />
          Provider Routing
          <span className="right">FALLBACK ON ERROR / TIMEOUT</span>
        </div>
        <div className="cc-jimmy-form" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <label>
            <span>Primary provider</span>
            <select className="cc-input" value={providerPrimary} onChange={(e) => setProviderPrimary(e.target.value)}>
              <option value="openai">openai</option>
              <option value="anthropic">anthropic</option>
            </select>
          </label>
          <label>
            <span>Primary model</span>
            <input className="cc-input" type="text" value={modelPrimary} onChange={(e) => setModelPrimary(e.target.value)} />
          </label>
          <label>
            <span>Fallback provider</span>
            <select className="cc-input" value={providerFallback} onChange={(e) => setProviderFallback(e.target.value)}>
              <option value="openai">openai</option>
              <option value="anthropic">anthropic</option>
            </select>
          </label>
          <label>
            <span>Fallback model</span>
            <input className="cc-input" type="text" value={modelFallback} onChange={(e) => setModelFallback(e.target.value)} />
          </label>
        </div>
        <div className="cc-notestrip">
          Provider keys live in Vercel environment variables (<code>OPENAI_API_KEY</code>,{" "}
          <code>ANTHROPIC_API_KEY</code>) — never entered here.
        </div>
        <div className="cc-jimmy-keys">
          <span className={`cc-chip ${data.keys.openai ? "green" : "red"}`}>
            OPENAI KEY {data.keys.openai ? "PRESENT" : "MISSING"}
          </span>
          <span className={`cc-chip ${data.keys.anthropic ? "green" : "red"}`}>
            ANTHROPIC KEY {data.keys.anthropic ? "PRESENT" : "MISSING"}
          </span>
        </div>
      </div>

      <div className="cc-panel cc-span6">
        <div className="cc-panel-h">
          <CcIcon name="compliance" />
          Guardrails
          <span className="right">DETERMINISTIC — RUN BEFORE ANY MODEL</span>
        </div>
        <div className="cc-jimmy-form" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <label>
            <span>Rate limit / hour</span>
            <input className="cc-input" type="number" min={0} value={rateLimit} onChange={(e) => setRateLimit(e.target.value)} />
          </label>
          <label>
            <span>Daily cost cap (cents)</span>
            <input className="cc-input" type="number" min={0} value={costCap} onChange={(e) => setCostCap(e.target.value)} />
          </label>
          <label>
            <span>Temperature</span>
            <input
              className="cc-input"
              type="number"
              step={0.1}
              min={0}
              max={2}
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
            />
          </label>
        </div>
        <div className="cc-jimmy-lockrow" title="Locked by grounding rule — customer Jimmy answers only from approved knowledge">
          <span className="cc-jimmy-lockico">
            <LockIcon size={14} />
          </span>
          <span>
            <strong>Customer real-time web search — LOCKED OFF.</strong> No control exists here: the grounding rule
            hard-codes customer Jimmy to SIGNED knowledge only. Any patch touching it is rejected by the API.
          </span>
        </div>
        <div className="cc-jimmy-signrow" style={{ marginTop: 14 }}>
          <button type="button" className="cc-btn primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </button>
          {msg ? <span className={`savemsg ${msg.ok ? "ok" : "err"}`}>{msg.text}</span> : null}
        </div>
      </div>
    </div>
  );
}
