// Jimmy runtime core — the ONE pipeline every surface calls.
// Order of the deterministic layers is load-bearing:
//   kill switch → store-before-AI (idempotent) → emergency triggers →
//   rate limit → cost cap → grounded retrieval → provider router → store answer.
// Server only. Never crashes the caller: every failure path returns a stored notice.

import { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../supabase";
import { ChatMsg, NoProviderKeyError, estimateCostCents, routeChat } from "./providers";
import {
  catalogueSize,
  formatCatalogueBlock,
  looksLikeShopQuestion,
  searchCatalogue,
} from "./catalogue-tool";

export type Tier = "GREEN" | "AMBER" | "RED";

/* SIGNED-ONLY: a switch, not a hard-code.
 *
 * The launch position is that Jimmy speaks only from knowledge a human has
 * signed. That position is correct for a public site and wrong for a
 * password-gated demo with zero signed chunks — it made him decline every
 * question he was asked, including "do you sell tents".
 *
 * So it is now an env flag, DEFAULT OFF while the site is gated. Flipping it on
 * is a one-line config change in Vercel and belongs on the launch checklist:
 *
 *     JIMMY_SIGNED_ONLY=true
 *
 * Nothing else about the safety model moves. Tiering, signing, the knowledge
 * base and the approval flow all stay exactly as built; with the flag off they
 * are simply dormant. The emergency detector runs before this and is not
 * affected by it in either position.
 */
export function signedOnlyMode(): boolean {
  const raw = String(process.env.JIMMY_SIGNED_ONLY ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

export type JimmySettings = {
  id: number;
  provider_primary: string;
  provider_fallback: string;
  model_primary: string;
  model_fallback: string;
  kill_switch: boolean;
  customer_web_search: boolean;
  rate_limit_per_hour: number;
  daily_cost_cap_cents: number;
  temperature: number | null;
  prompt_version: string;
  updated_at?: string | null;
};

export type ChunkSource = { id: string | number; pack: string; section: string | null; tier: Tier | null };

export type JimmyAnswer = {
  text: string;
  tier: Tier | null;
  sources: ChunkSource[];
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  tokensIn: number;
  tokensOut: number;
  costCents: number;
  safetyTriggered: boolean;
  triggerId: string | number | null;
  /** true when this is a stored system notice (paused / rate limit / cap / no key) */
  notice: boolean;
  role: "jimmy" | "system";
};

export type JimmyChatInput = {
  conversationId: string | number;
  profileId?: string | number | null;
  message: string;
  idempotencyKey: string;
  /** console "Use latest knowledge" toggle — includes DRAFT chunks */
  includeDraft?: boolean;
  /** customer/preview surfaces are hard-locked to SIGNED-only retrieval */
  surface: "console" | "preview";
};

const PAUSED_NOTICE =
  "Jimmy is paused right now — the team has switched him off while they work on him. Your message has been saved and a person will pick it up.";
const RATE_LIMIT_NOTICE =
  "You've sent quite a few messages in the last hour, so Jimmy is taking a short break on this conversation. Please try again a little later — nothing you wrote is lost.";
const COST_CAP_NOTICE =
  "Jimmy's daily budget has been reached, so he can't generate new answers until tomorrow. Your message has been saved.";
const NO_KEY_NOTICE = "No AI provider key configured — add OPENAI_API_KEY in Vercel env";
const PROVIDER_DOWN_NOTICE =
  "Jimmy couldn't reach the AI provider just now. Your message is saved — please try again in a moment.";

export const DEFAULT_SETTINGS: JimmySettings = {
  id: 1,
  provider_primary: "openai",
  provider_fallback: "anthropic",
  model_primary: "gpt-4o",
  model_fallback: "claude-sonnet-4-5",
  kill_switch: false,
  customer_web_search: false,
  rate_limit_per_hour: 60,
  daily_cost_cap_cents: 500,
  temperature: 0.3,
  prompt_version: "jimmy-v0.1-en",
};

export async function loadSettings(sb: SupabaseClient): Promise<JimmySettings> {
  const { data } = await sb.from("jimmy_settings").select("*").eq("id", 1).maybeSingle();
  if (!data) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...data } as JimmySettings;
}

/* ---------- text normalisation (shared by triggers + retrieval) ---------- */

export function normaliseText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, " ") // strip punctuation
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s: string): string[] {
  return normaliseText(s)
    .split(" ")
    .filter((w) => w.length >= 3);
}

/* ---------- deterministic emergency check ---------- */

type TriggerRow = {
  id: string | number;
  category: string | null;
  patterns: string | null;
  fixed_response: string | null;
  severity: string | null;
  active: boolean;
};

// One alternative group: "(a/b/c)" or plain text. Matches if ANY alternative
// is present as a whole-word phrase. Parsed BEFORE normalisation (normalising
// first would strip the ()/+ syntax characters).
function altGroupMatches(norm: string, rawGroup: string): boolean {
  const inner = rawGroup.replace(/^\s*\(/, "").replace(/\)\s*$/, "");
  for (const alt of inner.split("/")) {
    const a = normaliseText(alt);
    if (a && norm.includes(` ${a} `)) return true;
  }
  return false;
}

export function matchTrigger(message: string, triggers: TriggerRow[]): TriggerRow | null {
  const norm = ` ${normaliseText(message)} `;
  if (norm.trim().length === 0) return null;
  for (const t of triggers) {
    if (!t.active || !t.patterns) continue;
    for (const rawPattern of t.patterns.split("|").map((s) => s.trim()).filter(Boolean)) {
      // Trigger List co-occurrence notation: "a + (b/c)" = ALL +-separated
      // parts must match; each part may be an any-of group.
      const parts = rawPattern.split("+").map((s) => s.trim()).filter(Boolean);
      if (parts.length > 0 && parts.every((part) => altGroupMatches(norm, part))) {
        return t;
      }
    }
  }
  return null;
}

/* ---------- grounded retrieval (inline v1) ---------- */

type KnowledgeRow = {
  id: string | number;
  pack: string;
  section: string | null;
  content: string | null;
  tier: Tier | null;
  status: string;
  keywords: string | null;
};

export function scoreChunks(queryText: string, chunks: KnowledgeRow[], topN = 6): KnowledgeRow[] {
  const qTokens = Array.from(new Set(tokenize(queryText)));
  if (qTokens.length === 0) return [];
  const scored = chunks
    .map((c) => {
      const kw = normaliseText(c.keywords || "");
      const section = normaliseText(c.section || "");
      const content = normaliseText(c.content || "");
      let score = 0;
      for (const tok of qTokens) {
        if (kw.includes(tok)) score += 3;
        if (section.includes(tok)) score += 2;
        if (content.includes(tok)) score += 1;
      }
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, topN).map((x) => x.c);
}

/* ---------- message store helpers ---------- */

async function storeMessage(sb: SupabaseClient, row: Record<string, any>): Promise<any | null> {
  const { data, error } = await sb.from("jimmy_messages").insert(row).select("*").maybeSingle();
  if (error) throw error;
  return data;
}

function answerFromStored(m: any): JimmyAnswer {
  return {
    text: m.content || "",
    tier: (m.tier as Tier) || null,
    sources: Array.isArray(m.sources) ? m.sources : [],
    provider: m.provider || null,
    model: m.model || null,
    promptVersion: m.prompt_version || null,
    tokensIn: m.tokens_in ?? 0,
    tokensOut: m.tokens_out ?? 0,
    costCents: Number(m.cost_cents ?? 0),
    safetyTriggered: Boolean(m.safety_triggered),
    triggerId: m.trigger_id ?? null,
    notice: m.role === "system",
    role: m.role === "system" ? "system" : "jimmy",
  };
}

async function storeNotice(
  sb: SupabaseClient,
  conversationId: string | number,
  content: string,
  promptVersion: string | null
): Promise<JimmyAnswer> {
  const stored = await storeMessage(sb, {
    conversation_id: conversationId,
    idempotency_key: `sys-${crypto.randomUUID()}`,
    role: "system",
    content,
    tier: null,
    sources: [],
    provider: null,
    model: null,
    prompt_version: promptVersion,
    tokens_in: 0,
    tokens_out: 0,
    cost_cents: 0,
    safety_triggered: false,
  });
  return answerFromStored(stored || { role: "system", content });
}

/* ---------- the pipeline ---------- */

export async function runJimmyChat(input: JimmyChatInput): Promise<JimmyAnswer> {
  const sb = supabaseAdmin();
  if (!sb) throw new Error("supabase not configured");

  // 1) settings (per-request cache: loaded once here, passed down)
  const settings = await loadSettings(sb);
  const promptVersion = settings.prompt_version || DEFAULT_SETTINGS.prompt_version;

  // 2) STORE-BEFORE-AI — insert the user message first, idempotently.
  let userMsg: any = null;
  try {
    userMsg = await storeMessage(sb, {
      conversation_id: input.conversationId,
      idempotency_key: input.idempotencyKey,
      role: "user",
      content: input.message,
      tier: null,
      sources: [],
      tokens_in: 0,
      tokens_out: 0,
      cost_cents: 0,
      safety_triggered: false,
    });
  } catch (e: any) {
    const code = e?.code || "";
    const msg = String(e?.message || e);
    if (code === "23505" || msg.includes("duplicate key") || msg.includes("unique")) {
      // True idempotency: return the answer already stored for this key, if any.
      const { data: existing } = await sb
        .from("jimmy_messages")
        .select("*")
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle();
      if (existing) {
        const { data: reply } = await sb
          .from("jimmy_messages")
          .select("*")
          .eq("conversation_id", existing.conversation_id)
          .neq("role", "user")
          .gte("created_at", existing.created_at)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (reply) return answerFromStored(reply);
        userMsg = existing; // stored but unanswered — continue without re-inserting
      }
    } else {
      throw e;
    }
  }

  // 1b) kill switch — message is stored, but NO model call.
  if (settings.kill_switch) {
    return storeNotice(sb, input.conversationId, PAUSED_NOTICE, promptVersion);
  }

  // 3) DETERMINISTIC EMERGENCY CHECK — before any model.
  const { data: triggerRows } = await sb.from("jimmy_triggers").select("*").eq("active", true);
  const fired = matchTrigger(input.message, (triggerRows || []) as TriggerRow[]);
  if (fired) {
    const stored = await storeMessage(sb, {
      conversation_id: input.conversationId,
      idempotency_key: `trg-${crypto.randomUUID()}`,
      role: "jimmy",
      content: fired.fixed_response || "This sounds like an emergency. Please call 112 now.",
      tier: "RED",
      sources: [],
      provider: null,
      model: null,
      prompt_version: promptVersion,
      tokens_in: 0,
      tokens_out: 0,
      cost_cents: 0,
      safety_triggered: true,
      trigger_id: fired.id,
    });
    return answerFromStored(stored);
  }

  // 4a) RATE LIMIT — user messages in this conversation in the last hour.
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const { count: recentCount } = await sb
    .from("jimmy_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", input.conversationId)
    .eq("role", "user")
    .gte("created_at", hourAgo);
  const limit = settings.rate_limit_per_hour ?? 60;
  if ((recentCount ?? 0) > limit) {
    return storeNotice(sb, input.conversationId, RATE_LIMIT_NOTICE, promptVersion);
  }

  // 4b) DAILY COST CAP — sum today's cost across ALL conversations.
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { data: todayCosts } = await sb
    .from("jimmy_messages")
    .select("cost_cents")
    .gte("created_at", dayStart.toISOString())
    .gt("cost_cents", 0);
  const spentToday = (todayCosts || []).reduce((acc: number, r: any) => acc + Number(r.cost_cents || 0), 0);
  const cap = settings.daily_cost_cap_cents ?? 500;
  if (spentToday >= cap) {
    return storeNotice(sb, input.conversationId, COST_CAP_NOTICE, promptVersion);
  }

  // 5) RETRIEVAL. In signed-only mode the old rule stands: console may include
  //    DRAFT, customer/preview sees SIGNED only. With the flag off, every
  //    surface sees DRAFT+SIGNED — the knowledge is context to lean on rather
  //    than a fence to stay inside. No web search of any kind, either way.
  const strict = signedOnlyMode();
  const includeDraft = strict ? input.surface === "console" && Boolean(input.includeDraft) : true;
  let kq = sb
    .from("jimmy_knowledge")
    .select("id,pack,section,content,tier,status,keywords");
  kq = includeDraft ? kq.in("status", ["DRAFT", "SIGNED"]) : kq.eq("status", "SIGNED");
  const { data: knowledgeRows } = await kq.limit(2000);

  // query = current message + last 2 prior user turns
  const { data: priorUsers } = await sb
    .from("jimmy_messages")
    .select("content, created_at")
    .eq("conversation_id", input.conversationId)
    .eq("role", "user")
    .lt("created_at", userMsg?.created_at || new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(2);
  const queryText = [input.message, ...(priorUsers || []).map((m: any) => m.content || "")].join(" \n ");
  const chunks = scoreChunks(queryText, (knowledgeRows || []) as KnowledgeRow[], 6);

  // 6) BUILD MESSAGES
  const { data: promptRow } = await sb
    .from("jimmy_prompts")
    .select("version,content,status")
    .eq("version", promptVersion)
    .maybeSingle();
  /* The fallback prompt used to end "answer only from the grounded chunks
     below", which quietly re-imposed the very rule the flag turns off. It now
     follows the flag like everything else. */
  const fallbackPrompt = strict
    ? `You are Jimmy, StealthCrafter's preparedness companion. (System prompt "${promptVersion}" is not loaded yet — knowledge seeding in progress. Be brief, honest, and answer only from the grounded chunks below.)`
    : `You are Jimmy, StealthCrafter's preparedness companion — practical, calm and straight-talking, helping European households get ready for the things that actually happen: power cuts, storms, floods, water outages, heat. (System prompt "${promptVersion}" is not loaded yet, so this is your working brief.) Be brief and useful. Never invent details about StealthCrafter's products, prices or stock.`;
  const basePrompt = promptRow?.content || fallbackPrompt;

  // household context from the test profile
  const profileId = input.profileId ?? null;
  let householdBlock = "";
  if (profileId != null) {
    const { data: profile } = await sb
      .from("jimmy_profiles")
      .select("id,name,is_test,household,equipment")
      .eq("id", profileId)
      .maybeSingle();
    if (profile) {
      householdBlock =
        `\n\n=== HOUSEHOLD CONTEXT (test profile "${profile.name}"${profile.is_test ? " — FICTIONAL" : ""}) ===\n` +
        `Household: ${JSON.stringify(profile.household ?? {})}\n` +
        `Equipment: ${JSON.stringify(profile.equipment ?? {})}`;
    }
  }

  /* CATALOGUE — a tool in effect, not in protocol (the provider layer has no
     function calling yet). Shop questions are answered from the products table
     directly and never routed through the knowledge base: doctrine cannot know
     what we stock, and asking it to try is what made Jimmy refuse to say
     whether we sell tents. Best-effort — a catalogue failure must not take the
     answer down with it. */
  let catalogueBlock = "";
  if (looksLikeShopQuestion(input.message)) {
    try {
      const [hits, size] = await Promise.all([searchCatalogue(input.message), catalogueSize()]);
      if (size.products > 0) catalogueBlock = formatCatalogueBlock(hits, size);
    } catch {
      catalogueBlock = "";
    }
  }

  const instruction = strict
    ? "Answer ONLY from the grounded chunks above. If they don't cover it, say you don't want to guess and offer a person. "
    : /* Flag off: he is a knowledgeable person who works here, not a lookup
         table. The knowledge is a head start, not a boundary. The catalogue is
         the one hard boundary — being wrong about doctrine is a bad answer,
         being wrong about what we sell is a lie about our own shop. */
      "Use the knowledge above where it helps, but you are NOT limited to it. Answer the question properly and " +
      "practically from what you know, in plain language, as a well-read person who works here would. " +
      "Do not refuse because something is missing from the chunks above, and do not say you have no verified " +
      "answer unless you genuinely do not know. No hedging preamble about your sources — just answer. " +
      "THE ONE EXCEPTION is our shop: anything about what we sell, stock, or charge must come from the CATALOGUE " +
      "block. If there is no catalogue block, or nothing in it matches, say we may not carry it rather than " +
      "inventing a product, a price or a stock position. " +
      "If something is genuinely dangerous to get wrong — medical, structural, electrical, gas — say so plainly " +
      "and point at professional help, as you would anyway. ";

  const groundingBlock =
    "\n\n=== GROUNDING — " +
    (strict ? "APPROVED KNOWLEDGE CHUNKS" : "OUR OWN KNOWLEDGE (may include unsigned drafts)") +
    " ===\n" +
    (chunks.length
      ? chunks
          .map((c) => `[${c.pack}/${c.section || "general"} — ${c.tier || "AMBER"}]\n${c.content || ""}`)
          .join("\n\n")
      : strict
      ? "(no matching approved knowledge found for this question)"
      : "(nothing in our own knowledge base matches this question — answer from what you know)") +
    catalogueBlock +
    householdBlock +
    "\n\n=== INSTRUCTION ===\n" +
    instruction +
    "End with the exact tier tag <tier>GREEN|AMBER|RED</tier> reflecting the most cautious tier of content you relied on.";

  const messages: ChatMsg[] = [{ role: "system", content: basePrompt + groundingBlock }];

  // bounded conversation memory — last 10 prior non-system turns
  const { data: history } = await sb
    .from("jimmy_messages")
    .select("role,content,created_at,id")
    .eq("conversation_id", input.conversationId)
    .in("role", ["user", "jimmy"])
    .order("created_at", { ascending: false })
    .limit(11);
  const ordered = (history || [])
    .filter((m: any) => !(userMsg && m.id === userMsg.id))
    .reverse()
    .slice(-10);
  for (const m of ordered) {
    messages.push({ role: m.role === "jimmy" ? "assistant" : "user", content: m.content || "" });
  }
  messages.push({ role: "user", content: input.message });

  // 7) PROVIDER ROUTER — primary per settings, auto-fallback, never crash.
  let routed;
  try {
    routed = await routeChat(settings, messages);
  } catch (e) {
    const text = e instanceof NoProviderKeyError ? NO_KEY_NOTICE : PROVIDER_DOWN_NOTICE;
    return storeNotice(sb, input.conversationId, text, promptVersion);
  }

  // 8) Parse the <tier> tag (strip from display; default AMBER when missing).
  const tierMatch = routed.text.match(/<tier>\s*(GREEN|AMBER|RED)\s*<\/tier>/i);
  const tier: Tier = tierMatch ? (tierMatch[1].toUpperCase() as Tier) : "AMBER";
  const display = routed.text.replace(/<tier>[\s\S]*?<\/tier>/gi, "").trim();

  const sources: ChunkSource[] = chunks.map((c) => ({
    id: c.id,
    pack: c.pack,
    section: c.section,
    tier: c.tier,
  }));
  const costCents = estimateCostCents(routed.tokensIn, routed.tokensOut);

  const stored = await storeMessage(sb, {
    conversation_id: input.conversationId,
    idempotency_key: `ans-${crypto.randomUUID()}`,
    role: "jimmy",
    content: display,
    tier,
    sources,
    provider: routed.provider,
    model: routed.model,
    prompt_version: promptVersion,
    tokens_in: routed.tokensIn,
    tokens_out: routed.tokensOut,
    cost_cents: costCents,
    safety_triggered: false,
  });

  return answerFromStored(
    stored || {
      role: "jimmy",
      content: display,
      tier,
      sources,
      provider: routed.provider,
      model: routed.model,
      prompt_version: promptVersion,
      tokens_in: routed.tokensIn,
      tokens_out: routed.tokensOut,
      cost_cents: costCents,
    }
  );
}
