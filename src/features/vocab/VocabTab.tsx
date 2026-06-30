import { useState } from "react";
import { useStore } from "../../store";
import { toast } from "../../ui/toast";
import { AiSettings } from "./AiSettings";
import { SaveBackup } from "./SaveBackup";
import { CloudSync } from "../sync/CloudSync";

const JSON_EXAMPLE = JSON.stringify(
  [
    {
      word: "sample",
      phonetic: "/ˈsɑːmpl/",
      meaning: "n./v. 样本；取样",
      forms: "sampled; sampling",
      context: "general",
      sentences: [
        { en: "She took a sample of water.", zh: "她取了一份水样。" },
        { en: "We sampled the local food.", zh: "我们品尝了当地的食物。" }
      ]
    }
  ],
  null,
  2
);

function parseSimple(text: string): any[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|").map((x) => x.trim());
      return { word: parts[0], meaning: parts[1] || "" };
    })
    .filter((x) => x.word);
}

function parseVocab(text: string): any[] {
  const t = text.trim();
  if (t.startsWith("[") || t.startsWith("{")) {
    try {
      const j = JSON.parse(t);
      return (Array.isArray(j) ? j : [j]).filter((x) => x && x.word);
    } catch {
      toast("JSON 格式有误");
      return [];
    }
  }
  return parseSimple(t);
}

export function VocabTab() {
  const vocab = useStore((s) => s.vocab);
  const appendVocab = useStore((s) => s.appendVocab);
  const replaceVocab = useStore((s) => s.replaceVocab);
  const resetAll = useStore((s) => s.resetAll);
  const [text, setText] = useState("");

  function doAppend() {
    const arr = parseVocab(text);
    if (!arr.length) {
      toast("空文本");
      return;
    }
    const n = appendVocab(arr);
    setText("");
    toast(`+ ${n} 个词`);
  }
  function doReplace() {
    const arr = parseVocab(text);
    if (!arr.length) {
      toast("空文本");
      return;
    }
    if (!window.confirm(`用 ${arr.length} 个新词替换全部？（已学进度会清空）`)) return;
    replaceVocab(arr);
    setText("");
    toast("词库已替换");
  }
  function doReset() {
    if (!window.confirm("清空全部数据（鱼缸、奖牌、词库进度）？")) return;
    resetAll();
    toast("已清空");
  }

  return (
    <div className="pane">
      <div className="vocab-area">
        <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 6 }}>
          简单格式：<code>word | 释义</code> 每行一个。<br />
          完整格式：<code>[</code> 开头粘贴 JSON 数组（含 phonetic, forms, context, sentences）。
          <button
            style={{
              marginLeft: 6,
              fontSize: 11,
              padding: "2px 6px",
              cursor: "pointer",
              background: "var(--paper)",
              border: "1px solid var(--line)",
              borderRadius: 4
            }}
            onClick={() => setText(JSON_EXAMPLE)}
          >
            示例
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"ephemeral | adj. 短暂的\nsolace | n. 慰藉"}
        />
        <div className="vocab-row">
          <button onClick={doAppend}>追加</button>
          <button onClick={doReplace}>替换全部</button>
          <button onClick={doReset}>清空进度</button>
        </div>
      </div>
      <div className="vocab-list">
        {vocab.slice(0, 200).map((w) => (
          <div key={w.id}>
            <span>
              {w.learned ? "✓" : "·"} {w.word}
              {w.mastered && <span className="mastery-badge">掌握</span>}
            </span>
            <span style={{ color: "var(--ink-soft)" }}>✓{w.known} ✗{w.miss}</span>
          </div>
        ))}
        {vocab.length > 200 && <div>…还有 {vocab.length - 200} 个未列出</div>}
      </div>
      <SaveBackup />
      <AiSettings />
      <CloudSync />
    </div>
  );
}
