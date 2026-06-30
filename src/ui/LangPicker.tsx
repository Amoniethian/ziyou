import { useLang, setLang, TARGET_LANGS, NATIVE_LANGS } from "../lib/lang";

/**
 * Compact header control for the study-language pair: what you're learning
 * (学习) and the language to explain it in (语言). "其他…" prompts for a
 * language not in the preset list.
 */
export function LangPicker() {
  const { target, native } = useLang();
  const targetOpts = TARGET_LANGS.includes(target) ? TARGET_LANGS : [target, ...TARGET_LANGS];
  const nativeOpts = NATIVE_LANGS.includes(native) ? NATIVE_LANGS : [native, ...NATIVE_LANGS];

  function pick(which: "target" | "native", v: string) {
    if (v === "__custom__") {
      const cur = which === "target" ? target : native;
      const c = window.prompt(which === "target" ? "输入要学习的语言" : "输入解释用的语言", cur);
      if (!c || !c.trim()) return;
      v = c.trim();
    }
    setLang(which === "target" ? { target: v, native } : { target, native: v });
  }

  return (
    <div className="lang-picker">
      <label>
        学习
        <select value={target} onChange={(e) => pick("target", e.target.value)} title="正在学习的语言">
          {targetOpts.map((l) => <option key={l} value={l}>{l}</option>)}
          <option value="__custom__">其他…</option>
        </select>
      </label>
      <label>
        语言
        <select value={native} onChange={(e) => pick("native", e.target.value)} title="释义 / 翻译使用的语言">
          {nativeOpts.map((l) => <option key={l} value={l}>{l}</option>)}
          <option value="__custom__">其他…</option>
        </select>
      </label>
    </div>
  );
}
