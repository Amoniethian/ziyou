import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Vocab } from "../../types";
import { useStore } from "../../store";
import { speak } from "../../lib/speech";
import { shuffle, tokenize, normToken } from "../../lib/text";
import { HighlightedEN } from "../../lib/sentence";
import { toast } from "../../ui/toast";
import { audio } from "../../lib/audio";
import { useLang } from "../../lib/lang";

export function confirmExit(exit: () => void) {
  if (window.confirm("退出本组学习？已完成的词会保留为已学。")) exit();
}

/** Shared footer for quiz steps: re-read the word, set it aside, or quit the group. */
function StuckBar({ children }: { children: ReactNode }) {
  const review = useStore((s) => s.learnReview);
  const skip = useStore((s) => s.learnSkipWord);
  const exit = useStore((s) => s.learnExit);
  return (
    <>
      <div className="step-actions">
        <button onClick={review} title="回去重看这个词的释义和例句">回看</button>
        <button onClick={skip} title="记不住，先跳过；这个词不算学会，留到下次再学">记不住</button>
        {children}
      </div>
      <button className="end-session" onClick={() => confirmExit(exit)}>退出本组</button>
    </>
  );
}

/* ---------- Step 0: Familiarize ---------- */
export function FamiliarizeStep({ w }: { w: Vocab }) {
  const advance = useStore((s) => s.learnAdvance);
  const exit = useStore((s) => s.learnExit);
  const { native } = useLang();
  return (
    <>
      <div className="learn-card">
        <div className="word-head">
          <button className="speak-btn" onClick={() => speak(w.word)}>🔊</button>
          <span className="word">{w.word}</span>
          {w.phonetic && <span className="phonetic">{w.phonetic}</span>}
          {w.context && <span className="context-tag">{w.context}</span>}
        </div>
        {w.forms && (
          <>
            <div className="field-label">变形</div>
            <div className="forms">{w.forms}</div>
          </>
        )}
        <div className="field-label">{native}</div>
        <div className="meaning-zh">{w.meaning}</div>
        {w.note && (
          <>
            <div className="field-label">备注</div>
            <div className="forms" style={{ lineHeight: 1.7 }}>{w.note}</div>
          </>
        )}
        {w.sentences.length > 0 && <div className="field-label">例句</div>}
        {w.sentences.map((sen, i) => (
          <div className="sentence" key={i}>
            <div className="en">
              {i + 1}. <HighlightedEN en={sen.en} word={w.word} />
            </div>
            <div className="zh">{sen.zh}</div>
          </div>
        ))}
      </div>
      <div className="step-actions">
        <button onClick={() => confirmExit(exit)}>退出</button>
        <button className="primary" onClick={advance}>已熟悉，下一步</button>
      </div>
    </>
  );
}

/* ---------- Step 1: Match EN ↔ ZH ---------- */
type Cell = { kind: "en" | "zh"; key: number; text: string };
export function MatchStep({ w }: { w: Vocab }) {
  const advance = useStore((s) => s.learnAdvance);
  const exit = useStore((s) => s.learnExit);
  const { ens, zhs, count } = useMemo(() => {
    const sentences = w.sentences.slice(0, 4);
    const ens: Cell[] = shuffle(sentences.map((s, i) => ({ kind: "en" as const, key: i, text: s.en })));
    const zhs: Cell[] = shuffle(sentences.map((s, i) => ({ kind: "zh" as const, key: i, text: s.zh })));
    return { ens, zhs, count: sentences.length };
  }, [w.id]);

  const [paired, setPaired] = useState<Set<number>>(new Set());
  const [sel, setSel] = useState<string | null>(null);
  const [wrong, setWrong] = useState<string[]>([]);
  const id = (c: Cell) => `${c.kind}:${c.key}`;

  function onClick(c: Cell) {
    if (paired.has(c.key)) return;
    const cid = id(c);
    if (!sel) { setSel(cid); return; }
    if (sel === cid) { setSel(null); return; }
    const [sKind, sKey] = sel.split(":");
    if (sKind === c.kind) { setSel(cid); return; }
    if (+sKey === c.key) {
      const np = new Set(paired);
      np.add(c.key);
      setPaired(np);
      setSel(null);
      audio.correct();
      if (np.size === count) setTimeout(advance, 400);
    } else {
      setWrong([sel, cid]);
      setSel(null);
      audio.wrong();
      setTimeout(() => setWrong([]), 400);
    }
  }

  const cls = (c: Cell) =>
    "match-item" +
    (paired.has(c.key) ? " paired" : "") +
    (sel === id(c) ? " selected" : "") +
    (wrong.includes(id(c)) ? " wrong" : "");

  return (
    <>
      <div className="learn-card">
        <div className="word-head">
          <button className="speak-btn" onClick={() => speak(w.word)}>🔊</button>
          <span className="word">{w.word}</span>
        </div>
        <div className="field-label">把两侧句子配成对</div>
        <div className="match-grid">
          <div className="match-col">
            {ens.map((c) => (
              <div key={c.key} className={cls(c)} onClick={() => onClick(c)}>{c.text}</div>
            ))}
          </div>
          <div className="match-col">
            {zhs.map((c) => (
              <div key={c.key} className={cls(c)} onClick={() => onClick(c)}>{c.text}</div>
            ))}
          </div>
        </div>
      </div>
      <StuckBar>
        <button onClick={advance}>跳过本练习</button>
      </StuckBar>
    </>
  );
}

/* ---------- Step 2: Reconstruct sentences ---------- */
export function ReconstructStep({ w }: { w: Vocab }) {
  const advance = useStore((s) => s.learnAdvance);
  const exit = useStore((s) => s.learnExit);
  const { target, native } = useLang();
  const { allTokens, lines, bagOrder } = useMemo(() => {
    const allTokens: string[] = [];
    const lines = w.sentences.map((s) => {
      const toks = tokenize(s.en);
      const startIdx = allTokens.length;
      for (const t of toks) allTokens.push(t);
      return { zh: s.zh, startIdx, len: toks.length };
    });
    const bagOrder = shuffle(allTokens.map((t, i) => ({ t, i })));
    return { allTokens, lines, bagOrder };
  }, [w.id]);

  // slot index -> bag index (or null); plus which slots are flagged wrong
  const [filled, setFilled] = useState<(number | null)[]>(() => new Array(allTokens.length).fill(null));
  const [wrong, setWrong] = useState<Set<number>>(new Set());
  const usedBag = new Set(filled.filter((x): x is number => x !== null));

  function placeBag(bi: number) {
    if (usedBag.has(bi)) return;
    const slot = filled.findIndex((x) => x === null);
    if (slot < 0) return;
    const next = [...filled];
    next[slot] = bi;
    setFilled(next);
  }
  function clearSlot(slot: number) {
    if (filled[slot] === null) return;
    const next = [...filled];
    next[slot] = null;
    setFilled(next);
    const nw = new Set(wrong);
    nw.delete(slot);
    setWrong(nw);
  }
  function check() {
    const nw = new Set<number>();
    let allRight = true;
    filled.forEach((bi, i) => {
      const got = bi !== null ? bagOrder[bi].t : "";
      if (normToken(got) !== normToken(allTokens[i])) {
        nw.add(i);
        allRight = false;
      }
    });
    setWrong(nw);
    if (allRight) {
      audio.correct();
      setTimeout(advance, 300);
    } else {
      audio.wrong();
      toast("有词不对，再看看");
    }
  }

  return (
    <>
      <div className="learn-card">
        <div className="word-head">
          <button className="speak-btn" onClick={() => speak(w.word)}>🔊</button>
          <span className="word">{w.word}</span>
        </div>
        <div className="field-label">用上面的词，按{native}意思拼出{target}</div>
        <div className="word-bag">
          {bagOrder.map((b, bi) => (
            <span
              key={bi}
              className={"bag-word" + (usedBag.has(bi) ? " used" : "")}
              onClick={() => placeBag(bi)}
            >
              {b.t}
            </span>
          ))}
        </div>
        <div>
          {lines.map((ln, li) => (
            <div className="recon-line" key={li}>
              <div className="zh">{ln.zh}</div>
              <div className="recon-slots">
                {Array.from({ length: ln.len }, (_, j) => {
                  const slot = ln.startIdx + j;
                  const bi = filled[slot];
                  return (
                    <span
                      key={slot}
                      className={
                        "recon-slot" +
                        (bi !== null ? " filled" : "") +
                        (wrong.has(slot) ? " wrong" : "")
                      }
                      onClick={() => clearSlot(slot)}
                    >
                      {bi !== null ? bagOrder[bi].t : ""}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <StuckBar>
        <button className="primary" onClick={check}>检查</button>
      </StuckBar>
    </>
  );
}

/* ---------- Step 3: Dictate the word ---------- */
export function DictateStep({ w }: { w: Vocab }) {
  const advance = useStore((s) => s.learnAdvance);
  const exit = useStore((s) => s.learnExit);
  const [val, setVal] = useState("");
  const [fb, setFb] = useState("回车提交");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    speak(w.word);
    return () => clearTimeout(t);
  }, [w.id]);

  function submit() {
    if (val.trim().toLowerCase() === w.word.toLowerCase()) {
      setFb("✓ 正确");
      audio.correct();
      setTimeout(advance, 250);
    } else {
      setFb("再试一次（提示首字母：" + w.word[0] + "）");
      audio.wrong();
      setVal("");
      inputRef.current?.focus();
    }
  }

  return (
    <>
      <div className="learn-card">
        <div className="word-head">
          <button className="speak-btn" onClick={() => speak(w.word)}>🔊</button>
          {w.phonetic && <span className="phonetic">{w.phonetic}</span>}
          {w.context && <span className="context-tag">{w.context}</span>}
        </div>
        <div className="field-label">听音 + 看义，默写单词</div>
        <div className="meaning-zh">{w.meaning}</div>
        <input
          ref={inputRef}
          className="dictate-input"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          placeholder="拼写"
        />
        <div className="dictate-feedback">{fb}</div>
      </div>
      <StuckBar>
        <button className="primary" onClick={submit}>提交</button>
      </StuckBar>
    </>
  );
}
