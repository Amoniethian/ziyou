import { useEffect, useState } from "react";
import { useStore } from "../../store";
import { toast } from "../../ui/toast";
import { enrichWord } from "../../lib/llm-enrich";
import { loadLlmConfig, subscribeLlm } from "../../lib/llmConfig";
import { useLang } from "../../lib/lang";

/** Quick-capture input: type a word, hit enter, optionally enrich via LLM. */
export function QuickAdd() {
  const [val, setVal] = useState("");
  const [cfgVer, setCfgVer] = useState(0);
  const [errors, setErrors] = useState<Record<number, string>>({});
  useEffect(() => subscribeLlm(() => setCfgVer((v) => v + 1)), []);
  const vocab = useStore((s) => s.vocab);
  const addQuickWord = useStore((s) => s.addQuickWord);
  const applyEnrichment = useStore((s) => s.applyEnrichment);
  const setEnrichmentStatus = useStore((s) => s.setEnrichmentStatus);
  const { target, native } = useLang();
  const base = loadLlmConfig();
  const cfg = base ? { ...base, targetLang: target, nativeLang: native } : null;
  void cfgVer;

  async function runEnrich(id: number, word: string) {
    if (!cfg) return;
    setErrors((e) => {
      const n = { ...e };
      delete n[id];
      return n;
    });
    setEnrichmentStatus(id, "loading");
    try {
      const e = await enrichWord(word, cfg);
      applyEnrichment(id, e);
      toast(word + " 已就绪");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "富化失败";
      setEnrichmentStatus(id, "failed");
      setErrors((e) => ({ ...e, [id]: msg }));
      toast(word + "：" + msg);
    }
  }

  async function doAdd() {
    const v = val.trim();
    if (!v) return;
    setVal("");
    const { id, duplicate } = addQuickWord(v);
    if (duplicate) {
      toast("已在词库");
      return;
    }
    if (!cfg) {
      toast("已加入（AI 未连接，可手动补释义）");
      return;
    }
    runEnrich(id, v);
  }

  const pending = vocab
    .filter((w) => w.enrichmentStatus === "loading" || w.enrichmentStatus === "failed")
    .slice(-12);

  return (
    <div className="quick-add">
      <div className="qa-row">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") doAdd();
          }}
          placeholder={`速记${target}新词，回车加入`}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
        />
        <button onClick={doAdd}>+ 加入</button>
      </div>
      <div className="qa-status">
        {cfg
          ? `已连接 AI 富化：输入${target}词，自动补音标、释义（${native}）、例句`
          : "AI 富化未连接：保存为简单词条（去「词库」页填入 API key 后启用）"}
      </div>
      <div className="qa-pending">
        {pending.map((w) => (
          <span
            key={w.id}
            className={"qa-chip " + (w.enrichmentStatus === "loading" ? "loading" : "failed")}
            title={
              w.enrichmentStatus === "loading"
                ? "AI 富化中…"
                : (errors[w.id] || "富化失败") + "（点一下重试）"
            }
            onClick={() => w.enrichmentStatus === "failed" && runEnrich(w.id, w.word)}
            style={w.enrichmentStatus === "failed" ? { cursor: "pointer" } : undefined}
          >
            {w.enrichmentStatus === "loading" ? (
              <>
                <span className="qa-spin" />
                {w.word}
              </>
            ) : (
              <>⚠ {w.word} ↻</>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
