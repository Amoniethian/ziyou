import { useMemo, useRef, useState, useEffect } from "react";
import type { Vocab, Sentence } from "../../types";
import { useStore } from "../../store";
import { shuffle, normToken, matchSurface } from "../../lib/text";
import { BlankedEN } from "../../lib/sentence";
import { toast } from "../../ui/toast";
import { audio } from "../../lib/audio";
import { useLang } from "../../lib/lang";

/* ---------- Per-10 group matching quiz ---------- */
export function GroupTest() {
  const session = useStore((s) => s.learnSession)!;
  const vocab = useStore((s) => s.vocab);
  const exit = useStore((s) => s.learnExit);
  const finishGroupTest = useStore((s) => s.finishGroupTest);
  const { target, native } = useLang();

  const words = useMemo(
    () => session.queue.map((id) => vocab.find((v) => v.id === id)!).filter(Boolean) as Vocab[],
    [session.queue]
  );
  const bag = useMemo(() => shuffle(words.map((w) => w.word)), [session.queue]);

  const [slots, setSlots] = useState<(string | null)[]>(() => new Array(words.length).fill(null));
  const [sel, setSel] = useState<string | null>(null);
  const [results, setResults] = useState<("right" | "wrong" | null)[]>(() => new Array(words.length).fill(null));
  const [checked, setChecked] = useState(false);
  const used = new Set(slots.filter(Boolean) as string[]);

  function onSlot(row: number) {
    if (checked) return;
    if (slots[row]) {
      const next = [...slots];
      next[row] = null;
      setSlots(next);
      return;
    }
    if (!sel) return;
    const next = [...slots];
    next[row] = sel;
    setSlots(next);
    setSel(null);
  }

  function check() {
    let right = 0;
    const res = words.map((w, i) => {
      const ok = (slots[i] || "").toLowerCase() === w.word.toLowerCase();
      if (ok) right++;
      return ok ? ("right" as const) : ("wrong" as const);
    });
    setResults(res);
    setChecked(true);
    const total = words.length;
    setTimeout(() => {
      toast(`拼配正确率 ${((right / total) * 100).toFixed(0)}% · 进入 3 句默写`);
      const pool: { wordId: number; sentence: Sentence }[] = [];
      for (const w of words) for (const s of w.sentences) pool.push({ wordId: w.id, sentence: s });
      shuffle(pool);
      finishGroupTest(right, total, pool.slice(0, 3));
    }, 800);
  }

  return (
    <div className="learn-card">
      <div className="field-label">本组拼配测验：把左侧{target}放到右侧对应{native}</div>
      <div className="group-test-grid">
        <div className="gt-bag">
          {bag.map((word, i) => (
            <span
              key={i}
              className={"gt-word" + (used.has(word) ? " used" : "") + (sel === word ? " selected" : "")}
              onClick={() => {
                if (!used.has(word) && !checked) setSel(sel === word ? null : word);
              }}
            >
              {word}
            </span>
          ))}
        </div>
        <div>
          {words.map((w, i) => (
            <div className="gt-row" key={w.id}>
              <div
                className={
                  "slot" +
                  (slots[i] ? " filled" : "") +
                  (results[i] === "right" ? " right" : "") +
                  (results[i] === "wrong" ? " wrong" : "")
                }
                onClick={() => onSlot(i)}
              >
                {slots[i] || ""}
              </div>
              <div className="zh">{w.meaning}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="step-actions">
        <button onClick={exit}>放弃</button>
        <button className="primary" onClick={check} disabled={checked}>交卷</button>
      </div>
    </div>
  );
}

/* ---------- 3-sentence dictation after the group quiz ---------- */
export function GroupCheck() {
  const session = useStore((s) => s.learnSession)!;
  const vocab = useStore((s) => s.vocab);
  const finishItem = useStore((s) => s.finishGroupCheckItem);

  const { target } = useLang();
  const idx = session.checkIdx ?? 0;
  const item = session.checkPool![idx];
  const w = vocab.find((v) => v.id === item.wordId)!;
  const expected = matchSurface(item.sentence.en, w.word);

  const [val, setVal] = useState("");
  const [fb, setFb] = useState<{ text: string; cls: string }>({ text: "回车提交", cls: "" });
  const [locked, setLocked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setVal("");
    setFb({ text: "回车提交", cls: "" });
    setLocked(false);
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [idx]);

  function submit() {
    if (locked) return;
    const v = val.trim();
    if (!v) return;
    setLocked(true);
    if (normToken(v) === normToken(expected)) {
      setFb({ text: "✓ 正确", cls: "right" });
      audio.correct();
      setTimeout(() => finishItem(true), 350);
    } else {
      setFb({ text: `× 正确答案：${expected}`, cls: "wrong" });
      audio.wrong();
      setTimeout(() => finishItem(false), 1200);
    }
  }

  return (
    <>
      <div className="step-head">
        <span>整组默写 · 第 {idx + 1} / {session.checkPool!.length} 句</span>
        <span className="mode-tag">填空</span>
      </div>
      <div className="fill-card">
        <div className="fill-zh">{item.sentence.zh}</div>
        <div className="fill-en">
          <BlankedEN en={item.sentence.en} word={w.word} />
        </div>
        <input
          ref={inputRef}
          className="fill-input"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder={`填入对应的${target}单词`}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
        />
        <div className={"fill-feedback " + fb.cls}>{fb.text}</div>
      </div>
      <div className="step-actions">
        <button onClick={() => finishItem(false)}>跳过</button>
        <button className="primary" onClick={submit}>提交</button>
      </div>
    </>
  );
}
