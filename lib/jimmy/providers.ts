// Jimmy provider router — server only.
// One tiny interface, two implementations (OpenAI + Anthropic), automatic
// fallback when the primary errors/times out and the other key exists.

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

export type ChatOpts = {
  model: string;
  temperature: number;
  maxTokens?: number;
  timeoutMs?: number;
};

export type ChatOut = { text: string; tokensIn: number; tokensOut: number };

export interface ChatProvider {
  name: "openai" | "anthropic";
  hasKey(): boolean;
  chat(messages: ChatMsg[], opts: ChatOpts): Promise<ChatOut>;
}

const TIMEOUT_MS = 25_000;

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = body?.error?.message || body?.message || `HTTP ${res.status}`;
      throw new Error(`provider error: ${msg}`);
    }
    return body;
  } finally {
    clearTimeout(t);
  }
}

export const openaiProvider: ChatProvider = {
  name: "openai",
  hasKey: () => Boolean(process.env.OPENAI_API_KEY),
  async chat(messages, opts) {
    const body = await fetchJson(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: opts.model,
          temperature: opts.temperature,
          max_tokens: opts.maxTokens ?? 1024,
          messages,
        }),
      },
      opts.timeoutMs ?? TIMEOUT_MS
    );
    const text = body?.choices?.[0]?.message?.content ?? "";
    return {
      text: String(text),
      tokensIn: Number(body?.usage?.prompt_tokens ?? 0),
      tokensOut: Number(body?.usage?.completion_tokens ?? 0),
    };
  },
};

export const anthropicProvider: ChatProvider = {
  name: "anthropic",
  hasKey: () => Boolean(process.env.ANTHROPIC_API_KEY),
  async chat(messages, opts) {
    // Anthropic takes the system prompt as a top-level param.
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const rest = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
    const body = await fetchJson(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY || "",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: opts.model,
          max_tokens: opts.maxTokens ?? 1024,
          temperature: opts.temperature,
          system: system || undefined,
          messages: rest.length ? rest : [{ role: "user", content: "(empty)" }],
        }),
      },
      opts.timeoutMs ?? TIMEOUT_MS
    );
    const text = Array.isArray(body?.content)
      ? body.content
          .filter((b: any) => b?.type === "text")
          .map((b: any) => b.text)
          .join("")
      : "";
    return {
      text: String(text),
      tokensIn: Number(body?.usage?.input_tokens ?? 0),
      tokensOut: Number(body?.usage?.output_tokens ?? 0),
    };
  },
};

const PROVIDERS: Record<string, ChatProvider> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
};

export function providerByName(name: string | null | undefined): ChatProvider | null {
  return PROVIDERS[String(name || "").toLowerCase()] || null;
}

export function providerKeyPresence(): { openai: boolean; anthropic: boolean } {
  return { openai: openaiProvider.hasKey(), anthropic: anthropicProvider.hasKey() };
}

// Rough estimate only — labelled as such wherever surfaced.
export function estimateCostCents(tokensIn: number, tokensOut: number): number {
  return Math.round((tokensIn * 0.0003 + tokensOut * 0.001) * 100) / 100;
}

export class NoProviderKeyError extends Error {
  constructor() {
    super("No AI provider key configured — add OPENAI_API_KEY in Vercel env");
    this.name = "NoProviderKeyError";
  }
}

export type RoutedChat = ChatOut & { provider: "openai" | "anthropic"; model: string };

/**
 * Route a chat through the configured primary provider, falling back to the
 * other provider (with its own model setting) on error/timeout when its key
 * exists. Throws NoProviderKeyError when neither key is available.
 */
export async function routeChat(
  settings: {
    provider_primary: string;
    provider_fallback: string;
    model_primary: string;
    model_fallback: string;
    temperature: number | null;
  },
  messages: ChatMsg[]
): Promise<RoutedChat> {
  const primary = providerByName(settings.provider_primary);
  const fallback = providerByName(settings.provider_fallback);
  const temperature = typeof settings.temperature === "number" ? settings.temperature : 0.3;

  const attempts: { p: ChatProvider; model: string }[] = [];
  if (primary && primary.hasKey()) attempts.push({ p: primary, model: settings.model_primary });
  if (fallback && fallback.hasKey() && fallback.name !== primary?.name)
    attempts.push({ p: fallback, model: settings.model_fallback });

  if (attempts.length === 0) throw new NoProviderKeyError();

  let lastErr: unknown = null;
  for (const a of attempts) {
    try {
      const out = await a.p.chat(messages, { model: a.model, temperature });
      return { ...out, provider: a.p.name, model: a.model };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
