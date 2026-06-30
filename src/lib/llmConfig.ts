import type { EnrichConfig } from "./llm-enrich";

/**
 * Runtime LLM config for quick-capture enrichment.
 *
 * Stored in localStorage on the user's own device — NOT baked into the public
 * build (a key in a GitHub Pages bundle would be world-readable). Falls back to
 * VITE_LLM_* env vars for local dev.
 */

export type LlmConfig = EnrichConfig; // { endpoint, apiKey, model, domainHint? }

const KEY = "cihai-llm";
type Listener = () => void;
const listeners = new Set<Listener>();

export type Provider = { id: string; label: string; endpoint: string; model: string; note?: string };

export const PROVIDERS: Provider[] = [
  { id: "openai", label: "OpenAI", endpoint: "https://api.openai.com/v1/chat/completions", model: "gpt-4o-mini" },
  { id: "openrouter", label: "OpenRouter", endpoint: "https://openrouter.ai/api/v1/chat/completions", model: "openai/gpt-4o-mini", note: "浏览器跨域最稳，可中转多家模型" },
  { id: "openrouter-free", label: "OpenRouter · 免费模型", endpoint: "https://openrouter.ai/api/v1/chat/completions", model: "deepseek/deepseek-chat-v3-0324:free", note: "免费！去 openrouter.ai 注册拿 sk-or- 开头的 key 填到下面。模型已选 DeepSeek 免费版，每天有免费额度，背单词够用（想换别的去 openrouter.ai/models 选带 :free 的）。若提示 data policy 报错，到 OpenRouter 设置 → Privacy 打开免费模型即可。" },
  { id: "deepseek", label: "DeepSeek", endpoint: "https://api.deepseek.com/chat/completions", model: "deepseek-chat" },
  { id: "moonshot", label: "Moonshot / Kimi", endpoint: "https://api.moonshot.cn/v1/chat/completions", model: "moonshot-v1-8k" },
  { id: "custom", label: "自定义", endpoint: "", model: "" }
];

export function loadLlmConfig(): LlmConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const c = JSON.parse(raw);
      if (c.endpoint && c.apiKey) return { endpoint: c.endpoint, apiKey: c.apiKey, model: c.model || "gpt-4o-mini" };
    }
  } catch {
    /* ignore */
  }
  const e = import.meta.env.VITE_LLM_ENDPOINT;
  const k = import.meta.env.VITE_LLM_API_KEY;
  const m = import.meta.env.VITE_LLM_MODEL;
  if (e && k) return { endpoint: e, apiKey: k, model: m || "gpt-4o-mini" };
  return null;
}

export function saveLlmConfig(c: LlmConfig | null) {
  if (!c) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, JSON.stringify(c));
  listeners.forEach((l) => l());
}

export function subscribeLlm(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
