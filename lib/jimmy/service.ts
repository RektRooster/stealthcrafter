// Jimmy runtime core — the ONE pipeline every surface calls.
// Order of the deterministic layers is load-bearing:
//   kill switch → store-before-AI (idempotent) → emergency triggers →
//   rate limit → cost cap → grounded retrieval → provider router → store answer.
// Server only. Never crashes the caller: every failure path returns a stored notice.

import { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../supabase";
import { ChatMsg, NoProviderKeyError, estimateCostCents, routeChat } from "./providers";
import {
  CatalogueHit,
  CatalogueResult,
  formatCatalogueBlock,
  looksLikeShopQuestion,
  searchCatalogue,
} from "./catalogue-tool";
import { capabilityBlock } from "./capabilities";
import { detectBasketIntent, runBasketTool, type BasketAction } from "./basket-tool";
import {
  acceptanceBlock,
  acceptsOffer,
  declineBlock,
  declinesOffer,
  decideOffer,
  invitationBlock,
  looksLikeBuyingIntent,
  offerBlock,
  offerInvitation,
  resolveNomination,
  type BasketOffer,
} from "./offer";
import { basketView } from "../commerce/basket";
import { eur } from "../commerce/vat";

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
  /** product rows shown in this turn — carried into the next one, and the
      reason the answer badge can say where the answer really came from */
  catalogue: CatalogueHit[];
  /** true when this turn actually changed the basket, so the UI can refresh */
  basketChanged: boolean;
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
  /** who is shopping — lets Jimmy actually put things in a basket */
  customerId?: string | null;
  guestKey?: string | null;
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
    catalogue: Array.isArray(m.catalogue) ? m.catalogue : [],
    basketChanged: false,
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

/** Is this product already in their basket? Guards the acceptance path: a
 *  second "yes" long after an offer was taken up must not quietly add a second
 *  unit of the same thing. */
async function alreadyHolds(
  owner: { customerId?: string | null; guestKey?: string | null },
  productId: string
): Promise<boolean> {
  try {
    const view = await basketView(owner);
    return view.lines.some((l) => l.productId === productId);
  } catch {
    return false;
  }
}

/* Did the reply ASSERT that something went into the basket?
 *
 * Sentence-aware, because the difference between a claim and an offer is one
 * clause: "I've added the Vango" is a claim; "let me know if you'd like the
 * Vango added to your basket" contains the same words and is not. Overwriting a
 * customer-facing message is a blunt instrument, so it only fires on an
 * assertion with no conditional wrapper anywhere in that sentence. */
const CLAIM_PATTERNS =
  /\b(?:i(?:'ve| have)\s+(?:now\s+)?(?:added|put|popped)|(?:is|are)\s+now\s+in\s+your\s+basket|added\s+(?:it|that|them|these|those|two|three|four|\d+)\s+to\s+your\s+basket|in\s+your\s+basket\s+now)/i;

const CONDITIONAL =
  /\b(?:if you|would you|do you want|want me to|shall i|let me know|happy to|i can|i could|i'?ll\b|just say|say the word)\b/i;

export function claimsAnAdd(text: string): boolean {
  for (const sentence of text.split(/(?<=[.!?\n])\s+/)) {
    if (CLAIM_PATTERNS.test(sentence) && !CONDITIONAL.test(sentence)) return true;
  }
  return false;
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

  /* CARRIED CATALOGUE — the fix for the worst turn in the transcript.
     Jimmy listed eight tents, was asked which suited a family of three plus a
     dog, ran a FRESH search for "family tent", found nothing, and answered from
     emptiness — denying products he had named himself seconds earlier. Tool
     results have to survive the turn, so the rows shown are stored on the
     assistant message and handed back here. */
  let carried: CatalogueHit[] = [];
  try {
    const { data: lastShown } = await sb
      .from("jimmy_messages")
      .select("catalogue,created_at")
      .eq("conversation_id", input.conversationId)
      .eq("role", "jimmy")
      .not("catalogue", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const rows = (lastShown as any)?.catalogue;
    if (Array.isArray(rows)) carried = rows as CatalogueHit[];
  } catch {
    carried = [];
  }

  /* WHAT WE HAVE ALREADY OFFERED.
     Two things are needed from the record: the offer standing right now, so a
     bare "yes" knows what it is agreeing to; and every product offered anywhere
     in this conversation, so the same one is never put forward twice. An
     assistant that re-offers is a nag, and a nag costs more trust than the sale
     was worth. */
  let standingOffer: BasketOffer | null = null;
  const alreadyOffered: string[] = [];
  try {
    const { data: offerRows } = await sb
      .from("jimmy_messages")
      .select("offer,created_at")
      .eq("conversation_id", input.conversationId)
      .eq("role", "jimmy")
      .not("offer", "is", null)
      .order("created_at", { ascending: false })
      .limit(20);
    const rows = (offerRows as any[]) || [];
    for (const r of rows) {
      const o = r.offer as BasketOffer;
      if (o?.productId) alreadyOffered.push(o.productId);
    }
    // The most recent one is the only one a "yes" could plausibly mean.
    const latest = rows[0]?.offer as BasketOffer | undefined;
    if (latest?.productId) standingOffer = latest;
  } catch {
    standingOffer = null;
  }

  /* CATALOGUE — a tool in effect, not in protocol (the provider layer has no
     function calling yet). Shop questions are answered from the products table
     directly and never routed through the knowledge base: doctrine cannot know
     what we stock. Best-effort — a catalogue failure must not take the answer
     down with it. */
  let catalogueBlock = "";
  let shopResult: CatalogueResult | null = null;
  /* Buying intent counts as a shop question when there is something on the
     table. "that sounds right" names no product and matches no keyword, but in
     the light of the last turn it is the most commercial sentence in the
     conversation. */
  const hasCarried = carried.length > 0;
  if (
    looksLikeShopQuestion(input.message, hasCarried) ||
    (hasCarried && looksLikeBuyingIntent(input.message))
  ) {
    try {
      const priorText = (priorUsers || []).map((m: any) => m.content || "").join(" \n ");
      const r = await searchCatalogue(input.message, { carried, priorText });
      if (r.size.products > 0) {
        shopResult = r;
        catalogueBlock = formatCatalogueBlock(r, carried);
      }
    } catch {
      catalogueBlock = "";
    }
  }

  /* BASKET TOOLS. Performed BEFORE the model is called, so what it narrates is
     something that has already happened rather than something it intends. Never
     fatal: a basket that will not open must produce a sentence, not a 500. */
  let basketBlock = "";
  let basketChanged = false;
  let answerBlock = "";
  /* Which tool ran, if any. Needed by the false-claim backstop: after a VIEW the
     model has the real contents in front of it, so "the Vango is in your basket"
     may be perfectly true even though nothing changed this turn. After a failed
     add — or no tool at all — the same sentence is unfounded. */
  let basketAction: BasketAction = null;
  try {
    const owner = { customerId: input.customerId ?? null, guestKey: input.guestKey ?? null };
    const intent = detectBasketIntent(input.message, carried, Boolean(standingOffer));

    if (intent.action) {
      basketAction = intent.action;
      const done = await runBasketTool(owner, intent, input.message, carried);
      if (done) {
        basketBlock = done.block;
        basketChanged = done.changed;
      }
    } else if (standingOffer && acceptsOffer(input.message) && !(await alreadyHolds(owner, standingOffer.productId))) {
      // "yes" is only an instruction because an offer is standing. Resolved by
      // product id rather than by re-matching the name, so the thing that goes
      // in the basket is exactly the thing that was offered.
      const done = await runBasketTool(
        owner,
        { action: "add", ref: standingOffer.productId, qty: 1, numberAmbiguous: false },
        input.message,
        carried
      );
      if (done) {
        basketAction = "add";
        basketBlock = done.block;
        basketChanged = done.changed;
      }
      answerBlock = acceptanceBlock(standingOffer.name);
    } else if (standingOffer && declinesOffer(input.message)) {
      answerBlock = declineBlock(standingOffer.name);
    }
  } catch {
    basketBlock =
      "\n\n=== BASKET TOOL ===\nThe basket could not be reached just now and NOTHING WAS CHANGED. " +
      "Say so plainly and suggest they try again in a moment — do not claim anything was added.\n";
  }

  /* SHOULD HE OFFER? Every reason not to lives in decideOffer, and it says no
     far more often than yes. Only reached when nothing has already been added
     and the customer is weighing up exactly one thing. */
  let newOffer: BasketOffer | null = null;
  let offerBlockText = "";
  /* Set when the model has been INVITED to nominate one of several. Kept so the
     nomination can be resolved against the list it was actually shown, rather
     than against anything it might name. */
  let nominable: CatalogueHit[] | null = null;
  try {
    if (!basketChanged && !answerBlock && looksLikeBuyingIntent(input.message)) {
      // Only now worth the query: what is already in the basket must not be
      // offered again either.
      const inBasket = (
        await basketView({ customerId: input.customerId ?? null, guestKey: input.guestKey ?? null })
      ).lines.map((l) => l.productId);
      const ctx = {
        message: input.message,
        result: shopResult,
        carried,
        alreadyOffered,
        inBasket,
        basketActed: basketChanged || Boolean(basketBlock),
      };
      newOffer = decideOffer(ctx);
      if (newOffer) {
        offerBlockText = offerBlock(newOffer);
      } else {
        // Several on the table: let the answer decide which, since we cannot.
        nominable = offerInvitation(ctx);
        if (nominable) offerBlockText = invitationBlock(nominable);
      }
    }
  } catch {
    newOffer = null;
    nominable = null;
    offerBlockText = "";
  }

  /* THINGS WE HAVE NOT BUILT. An unbuilt feature gets a sentence, never an
     error — Ace's rule, and the right one: "something went wrong on our side"
     reads as a broken shop rather than an honest gap. */
  const gapsBlock = capabilityBlock(input.message);

  /* PERSONA OVERRIDE.
   *
   * This is not belt-and-braces. The stored system prompt (SC 03's
   * jimmy-v0.1-en) says in as many words: answer only from approved knowledge,
   * never fill the gap from general knowledge, hand to a human whenever unsure,
   * and "never set price or catalogue — that's the shop's job". Read literally,
   * "check with our store directly" is COMPLIANCE, not hallucination. Jimmy did
   * what he was told.
   *
   * SC 03 owns that prompt and should fold these rules into a v0.2. Until then
   * the runtime states plainly which parts it is overriding, rather than
   * appending a contradiction and hoping the model picks the right master.
   */
  const personaOverride =
    "\n\n=== RUNTIME OVERRIDE — these rules beat anything above that conflicts with them ===\n" +
    "1. YOU ARE STEALTHCRAFTER. Not a helper who works alongside the shop — the shop itself. " +
    "Where the brief above says the catalogue is \"the shop's job\", that job is YOURS. " +
    "NEVER tell a customer to \"check with our store\", \"contact the shop\", \"speak to the team about " +
    "stock\", \"try a local retailer\", \"explore local options\", or look anywhere else. There is no one " +
    "else to ask. Sending a ready-to-buy customer away is the single worst thing you can do.\n" +
    "2. NEVER DENY WHAT YOU HAVE ALREADY SHOWN. If products appear under ALREADY SHOWN, they are ours " +
    "and the customer has seen them. A follow-up about \"the best one\" refers to that list. Reason over " +
    "it before you go looking for anything else, and never claim we have nothing while it is on screen.\n" +
    "3. NEVER DEAD-END. When we cannot meet a request: (a) say plainly what we do not have; " +
    "(b) recommend the nearest thing we DO have and be honest about how it falls short; (c) tell them " +
    "what to look for so the advice is worth having anyway; (d) say you are flagging it to the buying " +
    "team — we log it, and it is true. Being honest about a real range is worth more to them than a " +
    "general AI's guesswork.\n" +
    "4. Handing off to a person is for safety and for things only a human can settle — never a way to " +
    "avoid answering a question about our own products.\n" +
    "5. THE BASKET IS NOT YOURS TO NARRATE. You may say something has been added, removed, or is in " +
    "the basket ONLY if a BASKET TOOL block appears below saying so. No block means nothing " +
    "happened, and you must not imply otherwise — not even softly, not even as 'I'll add that for " +
    "you'. If they asked for something and no block appeared, say plainly that you did not catch " +
    "which product they meant, and ask. Claiming an add that did not happen is the worst thing you " +
    "can do here: it is a lie about their money, and they will find out at the basket page.\n" +
    "6. DO NOT RAISE THE BASKET UNPROMPTED. Offer to add something only when an OFFER block below " +
    "says you may, and then exactly as it says — once, ONE named product, in your own words. With " +
    "no such block: do not ask 'would you like me to add one of these', do not close with 'let me " +
    "know if you want it in your basket', and NEVER offer a list for them to pick from. Listing " +
    "options is answering; asking which to buy is selling, and you only sell when told you may.\n" +
    "7. EVERY PRODUCT YOU MENTION APPEARS BENEATH YOUR REPLY AS A CARD — picture, price, and its " +
    "own Add button. So: never number your options and ask them to reply with a number, never ask " +
    "'shall I add 1 or 2', and never tell them to click, tap or press anything. Talk about the " +
    "products the way a person would; the cards do the rest. If you name a product they can act on " +
    "it without typing another word.\n";

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
    basketBlock +
    answerBlock +
    offerBlockText +
    gapsBlock +
    householdBlock +
    "\n\n=== INSTRUCTION ===\n" +
    instruction +
    "End with the exact tier tag <tier>GREEN|AMBER|RED</tier> reflecting the most cautious tier of content you relied on." +
    personaOverride;

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
  let display = routed.text.replace(/<tier>[\s\S]*?<\/tier>/gi, "").trim();

  /* The <offer> nomination, same mechanism as the tier tag. Stripped from the
     display either way — a tag the customer can see is a bug — and only turned
     into a real offer if it names something the model was actually shown. A
     nomination we cannot resolve is dropped in silence: the worst outcome is a
     "yes" that finds nothing standing, which is far better than adding a
     product nobody named. */
  const offerMatch = display.match(/<offer>([\s\S]{1,160}?)<\/offer>/i);
  display = display.replace(/<offer>[\s\S]*?<\/offer>/gi, "").trim();
  if (offerMatch && nominable && !newOffer) {
    newOffer = resolveNomination(offerMatch[1], nominable);
  }

  /* THE FALSE-CLAIM BACKSTOP.
   *
   * Live testing produced the worst possible failure: "I've added two Vango
   * Banshee Pro 200 2-Person Tents to your basket" — to a basket that was
   * empty, from a turn where no basket tool had run at all. Instructions alone
   * did not prevent it and cannot be trusted to; a model with a persona that
   * says it can use a basket will narrate using one.
   *
   * So the claim is checked against what actually happened. If it says
   * something went in and nothing did, the claim does not reach the customer.
   * Overwriting a model's words is heavy-handed and it is the right trade here:
   * the words are false, and the person reading them is about to rely on them.
   */
  if (!basketChanged && basketAction !== "view" && claimsAnAdd(display)) {
    console.error(
      "[jimmy] FALSE BASKET CLAIM suppressed — no tool ran this turn. said:",
      display.slice(0, 200)
    );
    const owner = { customerId: input.customerId ?? null, guestKey: input.guestKey ?? null };
    let view = null;
    try {
      view = await basketView(owner);
    } catch {
      view = null;
    }

    const options =
      carried.length > 1
        ? "\n\n" +
          carried
            .slice(0, 8)
            .map((h, i) => `${i + 1}. ${h.name}${h.price !== null ? ` — ${eur(h.price)}` : ""}`)
            .join("\n") +
          "\n\nTell me which one and how many, and I'll put it in properly."
        : carried.length === 1
        ? ` Say the word and I'll add the ${carried[0].name} for you.`
        : " Tell me which product you mean and I'll add it.";

    const state = view
      ? view.count
        ? `\n\nYour basket currently holds ${view.count} item${view.count === 1 ? "" : "s"}, ${eur(
            view.totals.grandTotal
          )} in total.`
        : "\n\nYour basket is empty at the moment."
      : "";

    display =
      "Hold on — I got ahead of myself. Nothing has actually gone into your basket, and I would " +
      "rather tell you that now than let you find out at checkout." +
      options +
      state;
  }

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
    // What was on screen this turn. Read back on the NEXT turn so a follow-up
    // reasons over the list instead of searching again and finding nothing.
    // Carried forward unchanged when this turn showed nothing new, so the
    // thread survives an intervening non-shop question.
    catalogue: shopResult ? shopResult.hits : carried.length ? carried : null,
    // Remembered so a "yes" next turn resolves, and so this product is never
    // offered a second time in this conversation.
    offer: newOffer,
  });

  /* THE GAP LOG. A customer asking for something we do not sell is free product
     research, not an error. Written deterministically — the model is not asked
     to remember to log anything — and best-effort, because failing to record a
     gap must never cost the customer their answer. SC 01 reads this table. */
  if (shopResult?.gap) {
    try {
      await sb.from("jimmy_range_gaps").insert({
        conversation_id: input.conversationId,
        message_id: stored?.id ?? null,
        asked: shopResult.gap.asked,
        missing: shopResult.gap.missing,
        category: shopResult.gap.category,
        requested_capacity: shopResult.gap.requestedCapacity,
        best_available_capacity: shopResult.gap.bestAvailableCapacity,
        surface: input.surface,
      });
    } catch {
      /* logging a gap is never worth failing a reply over */
    }
  }

  const answer = answerFromStored(
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
      catalogue: shopResult ? shopResult.hits : [],
    }
  );
  answer.basketChanged = basketChanged;
  return answer;
}
