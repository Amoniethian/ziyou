import { useEffect, useState } from "react";
import { useStore } from "./store";
import { audio } from "./lib/audio";
import { initSync } from "./lib/sync";
import { initBgm, getBgm } from "./lib/bgmStore";
import { LearnRoute } from "./features/learn/LearnRoute";
import { ReviewRoute } from "./features/review/ReviewRoute";
import { Pomodoro } from "./features/pomodoro/Pomodoro";
import { Species } from "./features/species/Species";
import { VocabTab } from "./features/vocab/VocabTab";
import { Cosmetics } from "./features/cosmetics/Cosmetics";
import { Aquarium3D } from "./features/aquarium-3d/Aquarium3D";
import { Toaster } from "./ui/Toaster";
import { LangPicker } from "./ui/LangPicker";

type Tab = "learn" | "review" | "pomodoro" | "species" | "vocab" | "look";
const TABS: [Tab, string][] = [
  ["learn", "学习"], ["review", "复习"], ["pomodoro", "专注"],
  ["species", "物种"], ["vocab", "词库"], ["look", "外观"]
];

export function App() {
  const [tab, setTab] = useState<Tab>("learn");
  const [viewMode, setViewMode] = useState(false);
  const vocab = useStore((s) => s.vocab);
  const today = useStore((s) => s.today);
  const learnedTotal = vocab.filter((w) => w.learned).length;

  // Unlock + start the audio context on the first user gesture (browsers require it).
  useEffect(() => {
    const onGesture = () => audio.ensure();
    window.addEventListener("pointerdown", onGesture, { once: true });
    return () => window.removeEventListener("pointerdown", onGesture);
  }, []);

  // Restore cloud session + wire auto-sync (no-op until Supabase is configured).
  useEffect(() => {
    initSync();
  }, []);

  // Load a previously uploaded BGM track so it's ready to play on first gesture.
  useEffect(() => {
    initBgm().then(async () => {
      const url = await getBgm();
      if (url) audio.setMusic(url);
    });
  }, []);

  return (
    <>
      <div className={"app" + (viewMode ? " view-mode" : "")}>
        <aside className="panel">
          <div className="brand">
            <h1>字游</h1>
            <div className="brand-right">
              <LangPicker />
              <div className="sync-pill" title="本地保存（IndexedDB）">
                <span className="dot" />
                <span>本地</span>
              </div>
            </div>
          </div>

          <div className="stats">
            <div><strong>{today.learnedToday}</strong>今日新学</div>
            <div><strong>{learnedTotal}</strong>累计已学</div>
            <div><strong>{today.attempts ? Math.round((today.correct / today.attempts) * 100) + "%" : "—"}</strong>正确率</div>
            <div><strong>{Math.round(today.minutes)}</strong>专注分钟</div>
          </div>

          <div className="tabs">
            {TABS.map(([k, label]) => (
              <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </div>

          {tab === "learn" && <LearnRoute />}
          {tab === "review" && <ReviewRoute />}
          {tab === "pomodoro" && <Pomodoro />}
          {tab === "species" && <Species />}
          {tab === "vocab" && <VocabTab />}
          {tab === "look" && <Cosmetics />}
        </aside>

        <Aquarium3D viewMode={viewMode} onToggleView={() => setViewMode((v) => !v)} />
      </div>
      <Toaster />
    </>
  );
}
