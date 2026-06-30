import { useStore } from "../../store";
import { QuickAdd } from "./QuickAdd";
import { FamiliarizeStep, MatchStep, ReconstructStep, DictateStep } from "./steps";
import { GroupTest, GroupCheck } from "./group";

const STEP_LABELS = ["熟悉", "句子配对", "选词成句", "默写单词"];

export function LearnRoute() {
  const session = useStore((s) => s.learnSession);
  return (
    <div className="pane">
      <QuickAdd />
      {!session ? (
        <StartScreen />
      ) : session.mode === "word" ? (
        <WordStep />
      ) : session.mode === "group" ? (
        <GroupTest />
      ) : (
        <GroupCheck />
      )}
    </div>
  );
}

function StartScreen() {
  const vocab = useStore((s) => s.vocab);
  const start = useStore((s) => s.startLearnSession);
  const resetLearned = useStore((s) => s.resetLearned);

  const unlearned = vocab.filter((w) => !w.learned && w.enrichmentStatus !== "loading");
  const learnedCount = vocab.filter((w) => w.learned).length;
  const setIdx = Math.floor(learnedCount / 50);
  const setProgress = learnedCount - setIdx * 50;

  return (
    <>
      <div className="set-progress">
        当前在第 {setIdx + 1} 套（每套 50 词）· 进度 {setProgress} / 50 · 词库共 {vocab.length} 个 · 可学 {unlearned.length} 个
      </div>
      <div className="empty-hint" style={{ padding: "20px 10px" }}>
        {unlearned.length === 0 ? (
          <>所有词都已学过。<br />可以「重置已学标记」再过一组，或去复习页练习。</>
        ) : unlearned.length < 10 ? (
          <>还差 {10 - unlearned.length} 个词凑足一组。<br />可以先用顶部「速记」输入新词，或直接开始（仅 {unlearned.length} 个）。</>
        ) : (
          <>
            <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--ink-soft)", marginBottom: 6 }}>
              下一组将包含
            </div>
            <div style={{ lineHeight: 1.8 }}>{unlearned.slice(0, 10).map((w) => w.word).join(" · ")}</div>
          </>
        )}
      </div>
      <div className="step-actions">
        {unlearned.length === 0 ? (
          <button
            onClick={() => {
              if (window.confirm("把所有词的『已学』标记重置？")) resetLearned();
            }}
          >
            重置已学标记
          </button>
        ) : (
          <button className="primary" onClick={start}>
            开始一组（{Math.min(10, unlearned.length)} 词）
          </button>
        )}
      </div>
    </>
  );
}

function WordStep() {
  const session = useStore((s) => s.learnSession)!;
  const vocab = useStore((s) => s.vocab);
  const w = vocab.find((x) => x.id === session.queue[session.idx]);
  if (!w) return null;
  const step = session.step;
  return (
    <>
      <div className="step-head">
        <span>
          第 {session.idx + 1} / {session.queue.length} 词 · 第 {step + 1} 步：{STEP_LABELS[step]}
        </span>
        <span className="step-dots">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={"step-dot " + (i < step ? "done" : i === step ? "cur" : "")} />
          ))}
        </span>
      </div>
      {step === 0 && <FamiliarizeStep w={w} />}
      {step === 1 && <MatchStep w={w} />}
      {step === 2 && <ReconstructStep w={w} />}
      {step === 3 && <DictateStep w={w} />}
    </>
  );
}
