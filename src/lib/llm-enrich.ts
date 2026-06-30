/**
 * Quick-capture word enrichment via LLM.
 *
 * Given a bare word/phrase in the target language, returns phonetic, a
 * meaning in the learner's native language, inflection variants, a register
 * tag, and two example sentences with native-language translations. The
 * language pair is configurable (defaults to 英语 → 中文).
 *
 * Works with any OpenAI-compatible chat completion endpoint
 * (OpenAI, Anthropic via proxy, Deepseek, Moonshot, OpenRouter…).
 *
 * For production: do NOT bundle the API key in the client. Run the
 * call through a thin server function (Cloudflare Worker / Vercel
 * Edge / Supabase Edge Function) that proxies the request and keeps
 * the key server-side. The function below is suitable for local dev
 * only — see "deploying with key safety" below.
 */

import type { Sentence } from "../types";

export type EnrichedWord = {
  phonetic: string;
  meaning: string;
  forms: string;
  context: string;
  sentences: Sentence[];
};

export type EnrichConfig = {
  endpoint: string;     // e.g. "https://api.openai.com/v1/chat/completions"
  apiKey: string;       // dev only; in prod call your proxy instead
  model: string;        // e.g. "gpt-4o-mini" or "claude-haiku-4-5"
  /**
   * Optional contextual hint (e.g. "phenomenology", "casual English").
   * Steers the LLM toward usage examples in that domain.
   */
  domainHint?: string;
  /** Language being learned (default English) and the language to explain in (default Chinese). */
  targetLang?: string;
  nativeLang?: string;
};

function buildSystem(native: string, target: string): string {
  return `You are a vocabulary explainer for a ${native}-speaking learner studying ${target}.
You return ONLY a valid JSON object — no prose, no markdown fences.`;
}

function buildUserPrompt(word: string, target: string, native: string, domainHint?: string): string {
  const hint = domainHint ? `\n\nUsage context: ${domainHint}` : "";
  return `Given the ${target} word or phrase: "${word}"${hint}

Return ONLY a valid JSON object with this exact schema:
{
  "phonetic": "pronunciation guide appropriate to ${target} (IPA for English, pinyin for Chinese, romaji for Japanese, etc.) — empty string if not applicable",
  "meaning": "the meaning written in ${native}, including part of speech",
  "forms": "common variations (inflections, conjugations, derivatives) separated by '; ' — or '—' if none",
  "context": "short usage register tag in English (e.g. literary / academic / casual)",
  "sentences": [
    { "en": "A natural ${target} sentence using the word.", "zh": "its natural ${native} translation" },
    { "en": "Another contextually different ${target} sentence.", "zh": "another ${native} translation" }
  ]
}

Rules:
- The JSON keys "en"/"zh" are FIXED for compatibility: "en" always holds the ${target} sentence, "zh" always holds the ${native} translation (even when neither is actually English/Chinese).
- Sentences must be authentic and varied (not template-like).
- ${native} translations should be natural, not literal word-for-word.
- "forms" should be empty string or "—" if the word has no useful inflections.`;
}

/**
 * Read enrichment config from Vite env. Returns null when no key/endpoint is
 * configured — in that case quick-captured words are stored as "minimal" and
 * the user fills in the meaning by hand.
 */
export function enrichConfigFromEnv(): EnrichConfig | null {
  const endpoint = import.meta.env.VITE_LLM_ENDPOINT;
  const apiKey = import.meta.env.VITE_LLM_API_KEY;
  const model = import.meta.env.VITE_LLM_MODEL || "gpt-4o-mini";
  if (!endpoint || !apiKey) return null;
  return { endpoint, apiKey, model };
}

export async function enrichWord(word: string, config: EnrichConfig): Promise<EnrichedWord> {
  const target = config.targetLang || "英语";
  const native = config.nativeLang || "中文";
  const body = {
    model: config.model,
    temperature: 0.4,
    response_format: { type: "json_object" as const },
    messages: [
      { role: "system", content: buildSystem(native, target) },
      { role: "user", content: buildUserPrompt(word, target, native, config.domainHint) }
    ]
  };
  let r: Response;
  try {
    r = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(body)
    });
  } catch {
    // fetch only rejects on network-level failures — almost always a CORS
    // block (the provider won't allow a direct call from the browser) or no
    // connectivity. Neither is fixable from the page itself.
    throw new Error("连不上接口：多半是浏览器跨域(CORS)被该服务商拦了。建议在「AI 设置」里换成 OpenRouter，或用一个代理转发。");
  }
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(httpErrorMessage(r.status, detail));
  }
  const j = await r.json();
  const text: string = j.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("接口没有返回内容（可能模型名不对或额度不足）。");
  return parseEnriched(text);
}

/** Map an HTTP error + provider body into an actionable Chinese message. */
function httpErrorMessage(status: number, body: string): string {
  // Providers usually return { error: { message } } — surface it.
  let providerMsg = "";
  try {
    const o = JSON.parse(body);
    providerMsg = o?.error?.message || o?.message || "";
  } catch {
    providerMsg = body.slice(0, 160);
  }
  const tail = providerMsg ? `（${providerMsg}）` : "";
  if (status === 401 || status === 403) return `API key 无效或没有权限 (HTTP ${status})${tail}`;
  if (status === 404) return `接口地址或模型名不对 (HTTP 404)${tail}`;
  if (status === 422 || status === 400) return `请求被拒绝，多半是模型名或参数不对 (HTTP ${status})${tail}`;
  if (status === 429) return `太频繁或额度/余额不足 (HTTP 429)${tail}`;
  if (status >= 500) return `服务商暂时出错，稍后再试 (HTTP ${status})${tail}`;
  return `富化失败 (HTTP ${status})${tail}`;
}

function parseEnriched(text: string): EnrichedWord {
  let cleaned = text.trim();
  // Strip code fences if present
  cleaned = cleaned.replace(/^```(?:json)?/, "").replace(/```$/, "").trim();
  const i = cleaned.indexOf("{");
  const j = cleaned.lastIndexOf("}");
  if (i < 0 || j < 0) throw new Error("LLM response did not contain JSON");
  const obj = JSON.parse(cleaned.slice(i, j + 1));
  return {
    phonetic: obj.phonetic ?? "",
    meaning: obj.meaning ?? "",
    forms: obj.forms ?? "",
    context: obj.context ?? "",
    sentences: Array.isArray(obj.sentences) ? obj.sentences : []
  };
}

/* ─── Deploying with key safety ────────────────────────────────────────
   For production, replace `enrichWord` with a call to your proxy:

     export async function enrichWord(word: string): Promise<EnrichedWord> {
       const r = await fetch("/api/enrich", { method: "POST",
         headers: {"Content-Type": "application/json"},
         body: JSON.stringify({ word }) });
       return await r.json();
     }

   And on the proxy side (Cloudflare Worker example):

     export default {
       async fetch(req: Request, env: Env) {
         const { word } = await req.json();
         const r = await fetch("https://api.openai.com/v1/chat/completions", {
           method: "POST",
           headers: { Authorization: `Bearer ${env.OPENAI_KEY}`,
                      "Content-Type": "application/json" },
           body: JSON.stringify({ ... })
         });
         return new Response(await r.text(), {
           headers: { "Content-Type": "application/json" }
         });
       }
     };
─────────────────────────────────────────────────────────────────────── */
