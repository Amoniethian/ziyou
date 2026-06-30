import { useEffect, useState } from "react";

/**
 * The learner's language pair: the language being studied (`target`) and the
 * language explanations / translations are written in (`native`). Stored
 * locally, like the theme.
 *
 * Everything language-specific reads from here — the enrichment prompt, the
 * learn/review UI labels, and text-to-speech — so the app works for ANY
 * language, not just 英语 → 中文. (The Vocab/Sentence data keeps its legacy
 * `en`/`zh` field names; they just mean "target text" / "native translation"
 * now, so no migration is needed.)
 */

export type LangPair = { target: string; native: string };

const KEY = "cihai-lang";
const DEFAULT: LangPair = { target: "英语", native: "中文" };
const listeners = new Set<() => void>();

/** Common picks for the dropdowns; users can also type their own. */
export const TARGET_LANGS = [
  "英语", "日语", "韩语", "法语", "德语", "西班牙语",
  "意大利语", "俄语", "葡萄牙语", "泰语", "越南语", "阿拉伯语", "拉丁语"
];
export const NATIVE_LANGS = ["中文", "English"];

/** Target-language name → BCP-47 code for speech synthesis. */
const SPEECH: Record<string, string> = {
  英语: "en-US", 日语: "ja-JP", 韩语: "ko-KR", 法语: "fr-FR", 德语: "de-DE",
  西班牙语: "es-ES", 意大利语: "it-IT", 俄语: "ru-RU", 葡萄牙语: "pt-PT",
  泰语: "th-TH", 越南语: "vi-VN", 阿拉伯语: "ar-SA", 拉丁语: "la",
  中文: "zh-CN", English: "en-US"
};

export function getLang(): LangPair {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && o.target && o.native) return { target: String(o.target), native: String(o.native) };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT;
}

export function setLang(l: LangPair) {
  try {
    localStorage.setItem(KEY, JSON.stringify(l));
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn());
}

export function subscribeLang(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** BCP-47 speech code for the current (or a given) target language. */
export function speechLangFor(name?: string): string {
  return SPEECH[name ?? getLang().target] || "en-US";
}

/** React hook: current language pair, re-rendering when it changes. */
export function useLang(): LangPair {
  const [l, setL] = useState(getLang);
  useEffect(() => subscribeLang(() => setL(getLang())), []);
  return l;
}
