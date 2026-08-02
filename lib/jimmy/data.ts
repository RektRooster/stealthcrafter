// Server fetchers for the Jimmy Admin Console. Every fetcher degrades to an
// empty result — the console renders "seeding in progress" / "needs data"
// states instead of crashing while tables are empty.

import { supabaseAdmin } from "../supabase";
import { DEFAULT_SETTINGS, JimmySettings, loadSettings } from "./service";

export type JimmySource = {
  id: string | number;
  title: string | null;
  publisher: string | null;
  url: string | null;
  status: string;
  signed_by: string | null;
  signed_at: string | null;
  notes: string | null;
};

export type JimmyKnowledgeChunk = {
  id: string | number;
  pack: string;
  section: string | null;
  content: string | null;
  tier: "GREEN" | "AMBER" | "RED" | null;
  status: string;
  source_id: string | number | null;
  keywords: string | null;
  version: string | number | null;
  signed_by: string | null;
  signed_at: string | null;
};

export type JimmyProfile = {
  id: string | number;
  name: string;
  is_test: boolean;
  household: any;
  equipment: any;
  notes: string | null;
};

export type JimmyScenario = {
  id: string | number;
  name: string;
  category: string | null;
  prompt: string;
  expected_behaviour: string | null;
  active: boolean;
};

export type JimmyMessageRow = {
  id: string | number;
  conversation_id: string | number;
  role: string;
  content: string | null;
  tier: string | null;
  sources: any;
  provider: string | null;
  model: string | null;
  prompt_version: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_cents: number | null;
  safety_triggered: boolean | null;
  trigger_id: string | number | null;
  created_at: string;
};

export type JimmyConversationRow = {
  id: string | number;
  profile_id: string | number | null;
  surface: string | null;
  started_at: string | null;
  meta: any;
  messageCount: number;
  safetyFires: number;
  messages: JimmyMessageRow[];
};

export type JimmyAnalytics = {
  conversations: number | null;
  messages: number | null;
  safetyFires: number | null;
  avgResponseChars: number | null;
  evalRunsTotal: number;
  evalRunsGraded: number;
  evalRunsPassed: number;
  /** null until at least one graded run exists */
  challengePassRate: number | null;
  providerCounts: Record<string, number>;
  spendTodayCents: number;
};

export type JimmyConsoleData = {
  configured: boolean;
  settings: JimmySettings;
  prompt: { version: string; status: string; contentChars: number } | null;
  knowledge: JimmyKnowledgeChunk[];
  sources: JimmySource[];
  triggersActive: number;
  profiles: JimmyProfile[];
  scenarios: JimmyScenario[];
  conversations: JimmyConversationRow[];
  analytics: JimmyAnalytics;
  keys: { openai: boolean; anthropic: boolean };
};

const EMPTY_ANALYTICS: JimmyAnalytics = {
  conversations: null,
  messages: null,
  safetyFires: null,
  avgResponseChars: null,
  evalRunsTotal: 0,
  evalRunsGraded: 0,
  evalRunsPassed: 0,
  challengePassRate: null,
  providerCounts: {},
  spendTodayCents: 0,
};

export async function getJimmyConsoleData(): Promise<JimmyConsoleData> {
  const keys = {
    openai: Boolean(process.env.OPENAI_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
  };
  const sb = supabaseAdmin();
  if (!sb) {
    return {
      configured: false,
      settings: { ...DEFAULT_SETTINGS },
      prompt: null,
      knowledge: [],
      sources: [],
      triggersActive: 0,
      profiles: [],
      scenarios: [],
      conversations: [],
      analytics: { ...EMPTY_ANALYTICS },
      keys,
    };
  }

  const settings = await loadSettings(sb);

  const [promptRes, knowledgeRes, sourcesRes, triggersRes, profilesRes, scenariosRes, convRes] =
    await Promise.all([
      sb
        .from("jimmy_prompts")
        .select("version,status,content")
        .eq("version", settings.prompt_version)
        .maybeSingle(),
      sb
        .from("jimmy_knowledge")
        .select("id,pack,section,content,tier,status,source_id,keywords,version,signed_by,signed_at")
        .order("pack", { ascending: true })
        .limit(2000),
      sb
        .from("jimmy_sources")
        .select("id,title,publisher,url,status,signed_by,signed_at,notes")
        .order("title", { ascending: true })
        .limit(500),
      sb.from("jimmy_triggers").select("id", { count: "exact", head: true }).eq("active", true),
      sb.from("jimmy_profiles").select("id,name,is_test,household,equipment,notes").limit(200),
      sb
        .from("jimmy_scenarios")
        .select("id,name,category,prompt,expected_behaviour,active")
        .eq("active", true)
        .order("category", { ascending: true })
        .limit(500),
      sb
        .from("jimmy_conversations")
        .select("id,profile_id,surface,started_at,meta")
        .order("started_at", { ascending: false })
        .limit(50),
    ]);

  const convRows = convRes.data || [];
  const convIds = convRows.map((c: any) => c.id);
  let msgRows: JimmyMessageRow[] = [];
  if (convIds.length > 0) {
    const { data } = await sb
      .from("jimmy_messages")
      .select(
        "id,conversation_id,role,content,tier,sources,provider,model,prompt_version,tokens_in,tokens_out,cost_cents,safety_triggered,trigger_id,created_at"
      )
      .in("conversation_id", convIds)
      .order("created_at", { ascending: true })
      .limit(5000);
    msgRows = (data || []) as JimmyMessageRow[];
  }
  const byConv: Record<string, JimmyMessageRow[]> = {};
  for (const m of msgRows) (byConv[String(m.conversation_id)] ||= []).push(m);
  const conversations: JimmyConversationRow[] = convRows.map((c: any) => {
    const msgs = byConv[String(c.id)] || [];
    return {
      ...c,
      messageCount: msgs.length,
      safetyFires: msgs.filter((m) => m.safety_triggered).length,
      messages: msgs,
    };
  });

  // ---- analytics rollup (computed real; '—' rendered client-side when null) ----
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const [convCount, msgCount, fireCount, evalRes, jimmyMsgsRes, todayRes] = await Promise.all([
    sb.from("jimmy_conversations").select("id", { count: "exact", head: true }),
    sb.from("jimmy_messages").select("id", { count: "exact", head: true }),
    sb
      .from("jimmy_messages")
      .select("id", { count: "exact", head: true })
      .eq("safety_triggered", true),
    sb.from("jimmy_eval_runs").select("id,passed,provider").limit(2000),
    sb.from("jimmy_messages").select("content,provider").eq("role", "jimmy").limit(2000),
    sb
      .from("jimmy_messages")
      .select("cost_cents")
      .gte("created_at", dayStart.toISOString())
      .gt("cost_cents", 0),
  ]);

  const evalRows = evalRes.data || [];
  const graded = evalRows.filter((r: any) => r.passed !== null);
  const passed = graded.filter((r: any) => r.passed === true);

  const jimmyMsgs = jimmyMsgsRes.data || [];
  const avgChars =
    jimmyMsgs.length > 0
      ? Math.round(jimmyMsgs.reduce((a: number, m: any) => a + (m.content?.length || 0), 0) / jimmyMsgs.length)
      : null;
  const providerCounts: Record<string, number> = {};
  for (const m of jimmyMsgs) {
    if (m.provider) providerCounts[m.provider] = (providerCounts[m.provider] || 0) + 1;
  }
  const spendTodayCents = (todayRes.data || []).reduce(
    (a: number, r: any) => a + Number(r.cost_cents || 0),
    0
  );

  const analytics: JimmyAnalytics = {
    conversations: convCount.count ?? null,
    messages: msgCount.count ?? null,
    safetyFires: fireCount.count ?? null,
    avgResponseChars: avgChars,
    evalRunsTotal: evalRows.length,
    evalRunsGraded: graded.length,
    evalRunsPassed: passed.length,
    challengePassRate: graded.length > 0 ? Math.round((passed.length / graded.length) * 100) : null,
    providerCounts,
    spendTodayCents: Math.round(spendTodayCents * 100) / 100,
  };

  return {
    configured: true,
    settings,
    prompt: promptRes.data
      ? {
          version: promptRes.data.version,
          status: promptRes.data.status || "DRAFT",
          contentChars: promptRes.data.content?.length || 0,
        }
      : null,
    knowledge: (knowledgeRes.data || []) as JimmyKnowledgeChunk[],
    sources: (sourcesRes.data || []) as JimmySource[],
    triggersActive: triggersRes.count ?? 0,
    profiles: (profilesRes.data || []) as JimmyProfile[],
    scenarios: (scenariosRes.data || []) as JimmyScenario[],
    conversations,
    analytics,
    keys,
  };
}
