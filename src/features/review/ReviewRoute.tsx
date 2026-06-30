import { useEffect, useRef, useState } from "react";
import { useStore } from "../../store";
import { normToken } from "../../lib/text";
import { BlankedEN } from "../../lib/sentence";
import { audio } from "../../lib/audio";
import { pickReviewItem, type ReviewItem } from "./pickItem";
import { useLang } from "../../lib/lang";

export function ReviewRoute() {
  const vocab = useStore((s) => s.vocab);
  const reviewFinish = useStore((s) => s.reviewFinish);
  const endReviewSession = useStore((s) => s.endReviewSession);
  const session = useStore((s) => s.reviewSession);

  const learnedCount = vocab.filter((w) => w.learned).length;
  const [item, setItem] = useState<ReviewItem | null>(null);

  // (Re)pick whenever there's no active item but learned words exist.
  useEffect(() => {
    if (!item && learnedCount > 0) setItem(pickReviewItem(vocab));
  }, [item, learnedCount]);

  if (learnedCount === 0) {
    return (
      <div className="pane">
        <div className="empty-hint">先去『学习』完成一组词，再来复习。</div>
      </div>
    );
  }
  if (!item) return <div className="pane" />;

  function finish(correct: boolean) {
    reviewFinish(item!.word.id, correct);
    setItem(null);
  }

  return (
    <div className="pane">
      {item.mode === "fillin" && <FillinReview key={item.word.id + ":" + item.sentence?.en} item={item} onFinish={finish} />}
      {item.mode === "dictation" && <DictationReview key={item.word.id + ":" + item.sentence?.en} item={item} onFinish={finish} />}
      {item.mode === "flashcard" && <FlashcardReview key={item.word.id} item={item} onFinish={finish} />}
      <div className="session-meta">
        <span>本次：{session.correct} / {session.attempts}</span>
        <span>
          错误率 {session.attempts ? Math.round(((session.attempts - session.correct) / session.attempts) * 100) : 0}%
        </span>
      </div>
      <button
        className="end-session"
        onClick={() => {
          endReviewSession();
          setItem(null);
        }}
      >
        结束本次会话并结算
      </button>
    </div>
  );
}

/* ---------- Fill-in (learned, not mastered) ---------- */
function FillinReview({ item, onFinish }: { item: ReviewItem; onFinish: (c: boolean) => void }) {
  const { target, native } = useLang();
  const [val, setVal] = useState("");
  const [used, setUsed] = useState(0);
  const [fb, setFb] = useState<{ text: string; cls: string }>({ text: "回车提交 · 每题 3 次机会", cls: "" });
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  function submit() {
    const v = val.trim();
    if (!v) return;
    if (normToken(v) === normToken(item.expected)) {
      setFb({ text: "✓ 正确", cls: "right" });
      audio.correct();
      setTimeout(() => onFinish(true), 400);
    } else {
      const u = used + 1;
      setUsed(u);
      audio.wrong();
      if (u >= 3) {
        setFb({ text: `× 三次未中。正确答案：${item.expected}`, cls: "wrong" });
        setTimeout(() => onFinish(false), 1400);
      } else {
        setFb({ text: `× 再试一次（提示首字母：${item.expected[0]}）`, cls: "wrong" });
        setVal("");
        inputRef.current?.focus();
      }
    }
  }

  return (
    <>
      <div className="step-head">
        <span>看{native} · 填关键{target}词</span>
        <span className="mode-tag">填空</span>
      </div>
      <div className="fill-card">
        <div className="fill-zh">{item.sentence!.zh}</div>
        <div className="fill-en">
          <BlankedEN en={item.sentence!.en} word={item.word.word} />
        </div>
        <input
          ref={inputRef}
          className="fill-input"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder={`填入${target}`}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
        />
        <div className={"fill-feedback " + fb.cls}>{fb.text}</div>
        <div className="chances">
          剩余机会 {3 - used}：
          {[0, 1, 2].map((i) => (
            <span key={i} className={"chance-dot" + (i >= 3 - used ? " used" : "")} />
          ))}
        </div>
      </div>
      <div className="step-actions">
        <button onClick={() => onFinish(false)}>放弃此题</button>
        <button className="primary" onClick={submit}>提交</button>
      </div>
    </>
  );
}

/* ---------- Whole-sentence dictation (mastered) ---------- */
function DictationReview({ item, onFinish }: { item: ReviewItem; onFinish: (c: boolean) => void }) {
  const { target, native } = useLang();
  const [val, setVal] = useState("");
  const [used, setUsed] = useState(0);
  const [fb, setFb] = useState<{ text: string; cls: string }>({ text: "回车提交", cls: "" });
  const [diff, setDiff] = useState<{ text: string; cls: string }[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const t = setTimeout(() => taRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  function submit() {
    const v = val.trim();
    if (!v) return;
    const exp = item.sentence!.en.split(/\s+/).filter(Boolean);
    const got = v.split(/\s+/).filter(Boolean);
    const len = Math.max(exp.length, got.length);
    let right = 0;
    const parts: { text: string; cls: string }[] = [];
    for (let i = 0; i < len; i++) {
      const e = exp[i];
      const g = got[i];
      if (!e) parts.push({ text: g, cls: "wrong" });
      else if (!g) parts.push({ text: e, cls: "missing" });
      else if (normToken(g) === normToken(e)) {
        parts.push({ text: g, cls: "right" });
        right++;
      } else {
        parts.push({ text: g, cls: "wrong" });
        parts.push({ text: e, cls: "missing" });
      }
    }
    setDiff(parts);
    const acc = right / exp.length;
    if (acc >= 0.9) {
      setFb({ text: `✓ ${(acc * 100).toFixed(0)}% 通过`, cls: "right" });
      audio.correct();
      setTimeout(() => onFinish(true), 1400);
    } else {
      const u = used + 1;
      setUsed(u);
      audio.wrong();
      if (u >= 3) {
        setFb({ text: `× 三次未达 90%。正确：${item.sentence!.en}`, cls: "wrong" });
        setTimeout(() => onFinish(false), 2000);
      } else {
        setFb({ text: `× 再试一次（${right} / ${exp.length} 词对）`, cls: "wrong" });
      }
    }
  }

  return (
    <>
      <div className="step-head">
        <span>看{native} · 默写整句 <span className="mastery-badge">已掌握</span></span>
        <span className="mode-tag">默写</span>
      </div>
      <div className="fill-card dictation-area">
        <div className="fill-zh" style={{ fontSize: 15 }}>{item.sentence!.zh}</div>
        <textarea
          ref={taRef}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
          }}
          placeholder={`写出对应的${target}整句（Ctrl/⌘ + 回车提交）`}
        />
        <div className={"fill-feedback " + fb.cls}>{fb.text}</div>
        <div className="dict-diff">
          {diff.map((p, i) => (
            <span key={i} className={p.cls}>{p.text} </span>
          ))}
        </div>
      </div>
      <div className="step-actions">
        <button onClick={() => onFinish(false)}>跳过</button>
        <button className="primary" onClick={submit}>提交</button>
      </div>
    </>
  );
}

/* ---------- Flashcard (no sentences) ---------- */
function FlashcardReview({ item, onFinish }: { item: ReviewItem; onFinish: (c: boolean) => void }) {
  const [revealed, setRevealed] = useState(false);
  const w = item.word;
  return (
    <>
      <div className="step-head">
        <span>无例句词：闪卡模式</span>
        <span className="mode-tag">闪卡</span>
      </div>
      <div className={"card" + (revealed ? " revealed" : "")} onClick={() => setRevealed((r) => !r)}>
        <div className="hint">点击翻面</div>
        <div className="word">{w.word}</div>
        <div className="meaning">{w.meaning || "(无释义)"}</div>
      </div>
      <div className="actions">
        <button onClick={() => onFinish(false)}>忘记</button>
        <button className="remember" onClick={() => onFinish(true)}>记得</button>
      </div>
    </>
  );
}
