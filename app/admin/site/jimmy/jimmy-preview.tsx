"use client";

// Jimmy CUSTOMER EXPERIENCE PREVIEW (Page B).
//
// VOICE v1 — GUARDRAILS-PRESERVING ARCHITECTURE (load-bearing):
// No realtime speech-to-speech. Speech-to-speech would let audio bypass the
// deterministic safety pipeline. Instead the loop is:
//   1. speech-in  — browser SpeechRecognition (feature-detected; mic hidden
//                   where unsupported) transcribes to TEXT;
//   2. the text goes through THE SAME /api/admin/jimmy/chat pipeline
//      (surface "preview" → SIGNED-only retrieval, kill switch, triggers,
//      rate limit, cost cap — every layer, every time);
//   3. speech-out — the final approved reply TEXT is spoken via the authed
//      /api/admin/jimmy/tts endpoint (which never logs the audio).
// If TTS is unavailable the experience silently falls back to text-only.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { JimmyProfile } from "@/lib/jimmy/data";
import {
  CRITICAL_CAP,
  JimmyAssessment,
  JimmyPreviewData,
  PILLARS,
  PillarName,
  isCritical,
  rollupHousehold,
} from "@/lib/jimmy/preview-data";

/* ------------------------------------------------------------------ */
/* Scripted content (Intake Script v1.1)                               */
/* ------------------------------------------------------------------ */

// Stage-0 disclosure — rendered CLIENT-SIDE as the first message of every
// new conversation, verbatim from the Intake Script. Never model-generated.
const GREETING =
  "Hi, I'm Jimmy — StealthCrafter's preparedness guide. I'm an AI, and I'll only ever give you " +
  "advice we've actually tested and stand behind. If something's outside what I can safely help " +
  "with, I'll say so and get a person involved. Nothing here is medical or emergency advice — if " +
  "something's happening right now, call 112.";

const QUICK_STARTS: { label: string; text: string }[] = [
  {
    label: "Start Assessment",
    text: "I'd like to see how prepared my household really is. Where should we start?",
  },
  {
    label: "I already own equipment",
    text: "I already have some equipment at home — can you take what we own into account before recommending anything?",
  },
  {
    label: "Power outage",
    text: "What worries me most is a longer power cut. How would my household cope, and what should we do first?",
  },
  {
    label: "Water disruption",
    text: "What worries me most is the tap water being cut off or unsafe. How much water should we keep at home, and how do we store it?",
  },
  {
    label: "Family travel",
    text: "We travel as a family quite a bit. How do we stay prepared when we're away from home?",
  },
];

// Per-pillar intake openers — used by the "Start" buttons on unassessed pillars.
const PILLAR_OPENERS: Record<PillarName, string> = {
  Water:
    "Can we look at my household's water preparedness? I'd like to know how much we should keep at home and where to start.",
  Fire:
    "Can we look at heat and fire safety for my home? I'd like to know how we'd stay warm — and safe — if the heating failed.",
  Shelter:
    "Can we look at how my home would hold up as shelter in a disruption? I'd like to know where we stand.",
  Medical:
    "Can we look at my household's medical preparedness? Nothing is wrong right now — I just want us to be ready.",
  Food:
    "Can we look at my household's food preparedness? I'd like to know how much we should keep and what actually makes sense.",
};

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

type CxMsg = {
  key: string;
  role: "user" | "jimmy" | "system";
  text: string;
  sources?: { id: string | number; pack: string; section: string | null }[];
  /** product rows this answer was built from — separate from knowledge sources */
  catalogue?: { name: string }[];
  safetyTriggered?: boolean;
  pending?: boolean;
  scripted?: boolean;
};

/* WHERE THE ANSWER ACTUALLY CAME FROM.
   The old badge read "Answered from approved knowledge · 6 sources" on an
   answer built entirely from the catalogue — it counted knowledge chunks that
   were retrieved alongside and contributed nothing. Attribution that names the
   wrong source is worse than none: it is the one line on screen telling the
   reader how much to trust the answer. */
function attribution(m: CxMsg): string {
  const products = (m.catalogue || []).length;
  const chunks = (m.sources || []).length;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (products && chunks)
    return `From our catalogue (${plural(products, "product", "products")}) and our knowledge base (${plural(chunks, "source", "sources")})`;
  if (products) return `From our catalogue · ${plural(products, "product", "products")}`;
  if (chunks) return `From our knowledge base · ${plural(chunks, "source", "sources")}`;
  return "From general knowledge — not from our own written guidance";
}

function greetingMsg(n: number): CxMsg {
  return { key: `greet-${n}`, role: "jimmy", text: GREETING, scripted: true };
}

function fmtVal(v: any): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(fmtVal).filter(Boolean).join(" · ");
  if (typeof v === "object")
    return Object.entries(v)
      .map(([k, x]) => `${k}: ${fmtVal(x)}`)
      .join(" · ");
  return String(v);
}

function equipmentItems(eq: any): string[] {
  if (!eq) return [];
  if (Array.isArray(eq)) {
    return eq
      .map((x: any) =>
        typeof x === "string"
          ? x
          : x && typeof x === "object" && x.name
            ? `${x.name}${x.qty ? ` × ${x.qty}` : ""}`
            : fmtVal(x)
      )
      .filter(Boolean);
  }
  if (typeof eq === "object") {
    if (Array.isArray(eq.items)) return equipmentItems(eq.items);
    return Object.entries(eq)
      .map(([k, v]) => (typeof v === "number" ? `${k} × ${v}` : `${k}${v ? ` — ${fmtVal(v)}` : ""}`))
      .filter(Boolean);
  }
  return [];
}

/** Stylised Jimmy — built from the SC hexagon mark language, pure SVG/CSS.
 *  Deliberately NOT a real-person likeness (likeness pending SC 09 / legal). */
function JimmyAvatar({ talking }: { talking: boolean }) {
  return (
    <div className={`cc-jcx-avatar${talking ? " talking" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 120 120" width="116" height="116">
        <circle cx="60" cy="60" r="56" className="halo" />
        <g className="breathe">
          <path d="M60 16 L97.5 37.5 V82.5 L60 104 L22.5 82.5 V37.5 Z" className="hex" />
          <path d="M60 32 L83.5 45.5 V72.5 L60 86 L36.5 72.5 V45.5 Z" className="hexin" />
          <circle cx="49.5" cy="56" r="3.6" className="eye" />
          <circle cx="70.5" cy="56" r="3.6" className="eye" />
          <path d="M47 68 Q60 78 73 68" className="mouth" />
        </g>
      </svg>
    </div>
  );
}

function Waveform({ active }: { active: boolean }) {
  return (
    <div className={`cc-jcx-wave${active ? " on" : ""}`} aria-hidden="true">
      {Array.from({ length: 28 }).map((_, i) => (
        <span key={i} style={{ animationDelay: `${(i % 7) * 0.11}s` }} />
      ))}
    </div>
  );
}

function ScoreRing({
  score,
  band,
  size = 74,
}: {
  score: number | null;
  band: string | null;
  size?: number;
}) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const frac = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={`cc-jcx-ring ${band || "none"}`}>
      <circle cx="32" cy="32" r={r} className="track" />
      <circle
        cx="32"
        cy="32"
        r={r}
        className="val"
        strokeDasharray={`${c * frac} ${c}`}
        transform="rotate(-90 32 32)"
      />
      <text x="32" y="37" textAnchor="middle" className="num">
        {score == null ? "—" : score}
      </text>
    </svg>
  );
}

function MicIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0014 0M12 18v3M9 21h6" />
    </svg>
  );
}

function SpeakerIcon({ muted, size = 16 }: { muted: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      {muted ? <path d="M16 9l5 6M21 9l-5 6" /> : <path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12" />}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function JimmyPreview({
  data,
  customerProfileId = null,
}: {
  data: JimmyPreviewData;
  /** the signed-in customer's own household, when there is one */
  customerProfileId?: string | null;
}) {
  const router = useRouter();
  const [profileId, setProfileId] = useState<string>(() => {
    // Their own household wins over any test profile — that is the whole
    // reason an account exists.
    if (customerProfileId && data.profiles.some((p) => String(p.id) === String(customerProfileId)))
      return String(customerProfileId);
    const t = data.profiles.find((p) => p.is_test) || data.profiles[0];
    return t ? String(t.id) : "";
  });
  const profile: JimmyProfile | null =
    data.profiles.find((p) => String(p.id) === profileId) || null;

  const [thread, setThread] = useState<CxMsg[]>([greetingMsg(0)]);
  const [conversationId, setConversationId] = useState<string | number | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [micSupported, setMicSupported] = useState(false);
  const ttsOkRef = useRef<boolean>(data.ttsAvailable);
  const mutedRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recRef = useRef<any>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const autoSentRef = useRef(false);
  const greetCounter = useRef(0);

  useEffect(() => {
    // Feature-detect speech-in; the mic button is hidden where unsupported.
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setMicSupported(Boolean(SR));
    return () => {
      stopAudio();
      try {
        recRef.current?.abort?.();
      } catch {
        /* noop */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [thread]);

  // Hand-off from the homepage: ?q= carries the visitor's first question into
  // the conversation so the journey is never restarted. Fires once, and goes
  // through the identical guarded pipeline as anything typed here.
  useEffect(() => {
    if (autoSentRef.current) return;
    let q: string | null = null;
    try {
      q = new URLSearchParams(window.location.search).get("q");
    } catch {
      q = null;
    }
    if (q && q.trim()) {
      autoSentRef.current = true;
      void send(q.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopAudio() {
    if (audioRef.current) {
      try {
        audioRef.current.pause();
      } catch {
        /* noop */
      }
      audioRef.current = null;
    }
    setSpeaking(false);
  }

  function resetConversation(nextProfile?: string) {
    stopAudio();
    greetCounter.current += 1;
    setThread([greetingMsg(greetCounter.current)]);
    setConversationId(null);
    if (nextProfile !== undefined) setProfileId(nextProfile);
  }

  // Speech-out: reply TEXT → authed TTS endpoint → audio. Any failure falls
  // back to text-only, silently — the customer never sees a voice error.
  async function speak(text: string) {
    if (mutedRef.current || !ttsOkRef.current || !text.trim()) return;
    try {
      const res = await fetch("/api/admin/jimmy/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.slice(0, 4000) }),
      });
      if (!res.ok) {
        if (res.status === 503) ttsOkRef.current = false; // no key — stay text-only
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      stopAudio();
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        setSpeaking(false);
        URL.revokeObjectURL(url);
      };
      audio.onerror = () => {
        setSpeaking(false);
        URL.revokeObjectURL(url);
      };
      setSpeaking(true);
      await audio.play().catch(() => setSpeaking(false));
    } catch {
      /* silent text-only fallback */
    }
  }

  async function send(raw?: string) {
    const msg = (raw ?? input).trim();
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
      // Same pipeline as everything else — surface "preview" hard-locks
      // retrieval to SIGNED knowledge only.
      const res = await fetch("/api/admin/jimmy/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          profileId: profileId || null,
          message: msg,
          idempotencyKey: userKey,
          surface: "preview",
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
                role: a.role === "system" ? ("system" as const) : ("jimmy" as const),
                text: a.text || "",
                sources: a.sources || [],
                catalogue: a.catalogue || [],
                safetyTriggered: Boolean(a.safetyTriggered),
              }
            : m
        )
      );
      // A basket write in this turn means the header pip is now stale.
      if (a.basketChanged) router.refresh();
      if (a.role !== "system" && a.text) void speak(a.text);
    } catch (e: any) {
      setThread((t) =>
        t.map((m) =>
          m.key === `p-${userKey}`
            ? {
                key: m.key,
                role: "system",
                /* Not "something went wrong on our side": that reads as a
                   broken shop, and most of the time this is the network or an
                   unbuilt capability rather than a fault. Say what is true and
                   what they can do. */
                text:
                  "I could not reach my end just now — your message is saved, nothing is lost. " +
                  "Give it a moment and ask me again.",
              }
            : m
        )
      );
    }
    setBusy(false);
  }

  // Speech-in: transcribe locally in the browser, then send the TEXT through
  // the normal pipeline — never straight to a model.
  function startMic() {
    if (listening || busy) return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    try {
      const rec = new SR();
      rec.lang = "en-GB";
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = (e: any) => {
        const t = e?.results?.[0]?.[0]?.transcript;
        if (t && String(t).trim()) void send(String(t).trim());
      };
      rec.onend = () => setListening(false);
      rec.onerror = () => setListening(false);
      recRef.current = rec;
      setListening(true);
      rec.start();
    } catch {
      setListening(false);
    }
  }

  function seed(text: string) {
    setInput(text);
    inputRef.current?.focus();
    inputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /* ------------- derived: profile, assessments, roll-up ------------- */

  const household = profile?.household && typeof profile.household === "object" ? profile.household : {};
  const HH_FIELDS: { key: string; label: string }[] = [
    { key: "members", label: "Household" },
    { key: "location", label: "Location" },
    { key: "home", label: "Home" },
    { key: "pets", label: "Pets" },
    { key: "vehicles", label: "Vehicles" },
    { key: "experience", label: "Experience" },
    { key: "budget", label: "Budget" },
  ];
  const presentFields = HH_FIELDS.filter((f) => {
    const v = (household as any)[f.key];
    return v != null && fmtVal(v).trim() !== "";
  });
  const strength = Math.round((presentFields.length / HH_FIELDS.length) * 100);
  const equipment = equipmentItems(profile?.equipment);

  const latest: JimmyAssessment[] = profileId ? data.assessmentsByProfile[profileId] || [] : [];
  const byPillar = new Map<PillarName, JimmyAssessment>();
  for (const a of latest) {
    const p = PILLARS.find((x) => x.key.toLowerCase() === String(a.pillar || "").toLowerCase());
    if (p && !byPillar.has(p.key)) byPillar.set(p.key, a);
  }
  const rollup = rollupHousehold(latest);
  const unassessed = PILLARS.filter((p) => !byPillar.has(p.key));

  const actions = latest
    .filter((a) => (a.next_action || "").trim())
    .sort((a, b) => {
      const ca = isCritical(a) ? 0 : 1;
      const cb = isCritical(b) ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return (a.score ?? 101) - (b.score ?? 101);
    });

  const voiceActive = speaking || listening;

  return (
    <main className="cc-container cc-jcx">
      {/* slim preview banner — the one piece a customer would never see */}
      <div className="cc-jcx-banner">
        <span className="tag">CUSTOMER EXPERIENCE PREVIEW</span>
        <span className="det">
          gated · fictional test profiles only · serves SIGNED knowledge only
          {data.signedCount === 0
            ? " (currently 0 signed — Jimmy declines until content is signed)"
            : ""}
        </span>
        <Link href="/admin/jimmy" className="back">
          ← JIMMY CONSOLE
        </Link>
      </div>

      {/* 1 · Talking Jimmy hero + 8 · customer chat thread */}
      <section className="cc-panel cc-jcx-hero">
        <div className="cc-jcx-heroleft">
          <JimmyAvatar talking={voiceActive} />
          <Waveform active={voiceActive} />
          <div className="cc-jcx-vstate">
            {listening
              ? "Listening…"
              : speaking
                ? "Jimmy is speaking"
                : busy
                  ? "Jimmy is thinking…"
                  : "Jimmy is here"}
          </div>
          <button
            type="button"
            className={`cc-jcx-mute${muted ? " off" : ""}`}
            onClick={() => {
              const next = !muted;
              setMuted(next);
              mutedRef.current = next;
              if (next) stopAudio();
            }}
            title={muted ? "Unmute Jimmy's voice" : "Mute Jimmy's voice"}
          >
            <SpeakerIcon muted={muted} />
            {muted ? "Voice off" : "Voice on"}
          </button>
        </div>

        <div className="cc-jcx-heroright">
          <div className="cc-jcx-herotop">
            <div>
              <h2 className="cc-jcx-greet">Hi{profile ? `, ${profile.name.split(" ")[0]}` : ""} — I&apos;m Jimmy.</h2>
              <p className="cc-jcx-greetsub">
                Your preparedness guide. Calm, step by step, and only advice we stand behind.
              </p>
            </div>
            <div className="cc-jcx-profsel">
              <select
                className="cc-input"
                value={profileId}
                onChange={(e) => resetConversation(e.target.value)}
                aria-label="Test profile"
              >
                <option value="">NO PROFILE</option>
                {data.profiles.map((p) => (
                  <option key={String(p.id)} value={String(p.id)}>
                    {p.name.toUpperCase()}
                  </option>
                ))}
              </select>
              <span className="cc-chip amber plain sm">FICTIONAL</span>
            </div>
          </div>

          <div className="cc-jcx-thread" ref={threadRef}>
            {thread.map((m) => (
              <div key={m.key} className={`cc-jcx-bubble ${m.role}`}>
                <span className="who">{m.role === "user" ? "You" : m.role === "jimmy" ? "Jimmy" : "Note"}</span>
                <div className="txt">{m.pending ? "Jimmy is thinking…" : m.text}</div>
                {m.role === "jimmy" && !m.pending && !m.scripted ? (
                  <div className="src">{attribution(m)}</div>
                ) : null}
              </div>
            ))}
          </div>

          <div className="cc-jcx-inputrow">
            {micSupported ? (
              <button
                type="button"
                className={`cc-jcx-mic${listening ? " live" : ""}`}
                onClick={startMic}
                disabled={busy || listening}
                title="Speak to Jimmy"
                aria-label="Speak to Jimmy"
              >
                <MicIcon />
              </button>
            ) : null}
            <textarea
              ref={inputRef}
              className="cc-input"
              rows={1}
              placeholder="Ask Jimmy…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button
              type="button"
              className="cc-btn primary"
              onClick={() => void send()}
              disabled={busy || !input.trim()}
            >
              {busy ? "…" : "Send"}
            </button>
            <button type="button" className="cc-btn ghost" onClick={() => resetConversation()}>
              New chat
            </button>
          </div>

          <div className="cc-jcx-disclose">
            Jimmy is an AI — he can make mistakes. Verify critical information.
          </div>
        </div>
      </section>

      {/* 7 · quick-start actions */}
      <div className="cc-jcx-quick">
        {QUICK_STARTS.map((q) => (
          <button key={q.label} type="button" onClick={() => seed(q.text)}>
            {q.label}
          </button>
        ))}
      </div>

      {/* 3 · household profile + existing equipment */}
      <div className="cc-jcx-grid2">
        <section className="cc-panel">
          <div className="cc-panel-h">
            Your Household Profile
            <span className="right">{profile ? "WHAT JIMMY KNOWS" : "NO PROFILE SELECTED"}</span>
          </div>
          {!profile ? (
            <div className="cc-jcx-empty">
              Choose a test profile above — Jimmy tailors everything to the household in front of him.
            </div>
          ) : (
            <>
              <div className="cc-jcx-strength">
                <div className="bar">
                  <span style={{ width: `${strength}%` }} />
                </div>
                <span className="lab">
                  PROFILE STRENGTH {strength}% — {presentFields.length} of {HH_FIELDS.length} areas shared
                </span>
              </div>
              {presentFields.length === 0 ? (
                <div className="cc-jcx-empty">
                  Nothing shared yet — the more Jimmy knows about your household, the better his advice fits.
                </div>
              ) : (
                <dl className="cc-jcx-hh">
                  {presentFields.map((f) => (
                    <div key={f.key}>
                      <dt>{f.label}</dt>
                      <dd>{fmtVal((household as any)[f.key])}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </>
          )}
        </section>

        <section className="cc-panel">
          <div className="cc-panel-h">
            Your Existing Equipment
            <span className="right">CREDITED, NEVER RESOLD</span>
          </div>
          {equipment.length === 0 ? (
            <div className="cc-jcx-empty">Nothing recorded yet.</div>
          ) : (
            <ul className="cc-jcx-equip">
              {equipment.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          )}
          <div className="cc-jcx-note">
            CREDITED — Jimmy never resells what you own. Anything you already have counts towards your
            preparedness first.
          </div>
        </section>
      </div>

      {/* 4 · Preparedness Map */}
      <section className="cc-panel">
        <div className="cc-panel-h">
          Your Preparedness Map
          <span className="right">{rollup.coverageLabel.toUpperCase()}</span>
        </div>

        {rollup.assessedCount === 0 ? (
          <div className="cc-jcx-rollup none">
            <div className="msg">
              <strong>Not yet assessed.</strong> Your Preparedness Map fills in as you look at each area
              with Jimmy — there&apos;s no score until there&apos;s something honest to score. Start
              wherever feels most important to you.
            </div>
          </div>
        ) : (
          <div className={`cc-jcx-rollup ${rollup.band || "none"}`}>
            <ScoreRing score={rollup.overall} band={rollup.band} size={92} />
            <div className="msg">
              <div className="line1">
                Household preparedness — <strong>{rollup.overall}</strong> ·{" "}
                <span className={`bandword ${rollup.band}`}>{(rollup.band || "").toUpperCase()}</span>{" "}
                <span className="cov">({rollup.coverageLabel})</span>
              </div>
              {rollup.criticalPillars.length > 0 ? (
                <div className="line2">
                  A critical gap in{" "}
                  <strong>
                    {rollup.criticalPillars
                      .map((k) => PILLARS.find((p) => p.key === k)?.label || k)
                      .join(", ")}
                  </strong>{" "}
                  sets this score{rollup.floorApplied ? ` — capped at ${CRITICAL_CAP}` : ""}. A danger is
                  never averaged away: close that gap and your score follows.
                </div>
              ) : (
                <div className="line2">No critical gaps in the areas you&apos;ve assessed so far.</div>
              )}
              {unassessed.length > 0 ? (
                <div className="line3">
                  {unassessed.map((p) => p.label).join(", ")} not assessed yet — not included in this
                  number, and not assumed to be fine.
                </div>
              ) : null}
            </div>
          </div>
        )}

        <div className="cc-jcx-pillars">
          {PILLARS.map((p) => {
            const a = byPillar.get(p.key) || null;
            const critical = a ? isCritical(a) : false;
            return (
              <div key={p.key} className={`cc-jcx-pillar${a ? ` ${a.band ? String(a.band).toLowerCase() : ""}` : " unassessed"}${critical ? " critical" : ""}`}>
                <div className="pname">{p.label}</div>
                {a ? (
                  <>
                    <ScoreRing
                      score={typeof a.score === "number" ? a.score : null}
                      band={a.band ? String(a.band).toLowerCase() : null}
                    />
                    <div className="pband">{String(a.band || "").toUpperCase()}</div>
                    {critical ? <div className="pcrit">CRITICAL GAP</div> : null}
                    {typeof a.recommended_score === "number" ? (
                      <div className="prec">recommended {a.recommended_score}</div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <div className="pnone">NOT YET ASSESSED</div>
                    <button type="button" className="cc-btn" onClick={() => seed(PILLAR_OPENERS[p.key])}>
                      Start
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 5 · Next Best Actions + 6 · how recommendations work */}
      <div className="cc-jcx-grid2">
        <section className="cc-panel">
          <div className="cc-panel-h">
            Next Best Actions
            <span className="right">WORST FIRST</span>
          </div>
          {actions.length === 0 ? (
            <div className="cc-jcx-empty">Your action plan appears after your first assessment.</div>
          ) : (
            <ol className="cc-jcx-actions">
              {actions.map((a) => {
                const p = PILLARS.find((x) => x.key.toLowerCase() === String(a.pillar || "").toLowerCase());
                return (
                  <li key={String(a.id)} className={isCritical(a) ? "critical" : ""}>
                    <span className="pl">{p?.label || a.pillar}</span>
                    {isCritical(a) ? <span className="crit">CLOSE THIS FIRST</span> : null}
                    <span className="act">{a.next_action}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="cc-panel">
          <div className="cc-panel-h">
            How Jimmy Recommends
            <span className="right">PERSON → PROBLEM → SOLUTION → PRODUCT</span>
          </div>
          <ol className="cc-jcx-how">
            <li>
              <strong>Person.</strong> Your household first — who you are, where you live, what you
              already own.
            </li>
            <li>
              <strong>Problem.</strong> The real risks for a household like yours, honestly weighed —
              never fear.
            </li>
            <li>
              <strong>Solution.</strong> What actually closes the gap — often free, and your own gear
              always counts first.
            </li>
            <li>
              <strong>Product.</strong> Only when something is genuinely needed and nothing you own
              covers it.
            </li>
          </ol>
          <div className="cc-jcx-empty">
            Recommendations appear once an assessment is complete — prices come from the published shop,
            Jimmy never sets them.
          </div>
        </section>
      </div>
    </main>
  );
}
