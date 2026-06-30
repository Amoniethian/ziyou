import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useStore } from "../../store";
import { toast } from "../../ui/toast";
import { ICONS } from "../../lib/icons";
import { HighlightedEN } from "../../lib/sentence";
import { AmbientToggle } from "../audio/AudioControls";
import { Aquarium3D as Engine, type Spoken } from "./engine3d";
import { initModels, subscribeModels } from "./modelStore";
import { pomodoro } from "../pomodoro/timer";
import { breakTimer } from "../pomodoro/breakTimer";
import { FocusIcon, BreakIcon } from "../../ui/TimerIcons";
import { DECOR_SIZES, DECOR_ROTS, emptyInventory, type DecorType, type DecorItem, type Inventory } from "../../types";

/** Demo mode (?demo in the URL): show 2 of every creature + a sampler of decor
 * variants, purely for viewing. Never persisted, never touches the real save. */
const IS_DEMO = typeof location !== "undefined" && new URLSearchParams(location.search).has("demo");
const DEMO_INV: Inventory = {
  ...emptyInventory(),
  smallFish: 4, moonFish: 2, clownfish: 2, bigFish: 2, turtle: 2, emberFish: 2
};
const DEMO_DECOR: DecorItem[] = [
  { id: "demo-rock-1", type: "rock", x: -4.2, z: 0.4, rot: 0.6, variant: 1 },
  { id: "demo-rock-2", type: "rock", x: -3.0, z: -0.6, rot: 2.1, variant: 2 },
  { id: "demo-rock-3", type: "rock", x: 4.3, z: 0.5, rot: 1.2, variant: 3 },
  { id: "demo-anem-1", type: "anemone", x: -1.6, z: 0.3, rot: 0, variant: 1 },
  { id: "demo-anem-2", type: "anemone", x: 0.2, z: -0.7, rot: 1.5, variant: 1 },
  { id: "demo-coral-1", type: "coral", x: 1.8, z: 0.4, rot: 0.4, variant: 1 },
  { id: "demo-coral-2", type: "coral", x: 2.9, z: -0.5, rot: 2.0, variant: 2 },
  { id: "demo-weed-1", type: "seaweed", x: -2.3, z: 0.8, rot: 0, variant: 1 },
  { id: "demo-weed-2", type: "seaweed", x: 3.6, z: 0.7, rot: 0, variant: 2 }
];

const DECOR_LABEL: Record<DecorType, string> = {
  rock: "岩石",
  coral: "珊瑚",
  anemone: "海葵",
  seaweed: "海草"
};
const TAU = Math.PI * 2;

/** Pick a random example sentence from a learned word, for the fish to "speak". */
function randomLearnedSentence(): Spoken | null {
  const vocab = useStore.getState().vocab;
  const pool = vocab.filter((w) => w.learned && w.sentences.length > 0);
  if (!pool.length) return null;
  const w = pool[Math.floor(Math.random() * pool.length)];
  const s = w.sentences[Math.floor(Math.random() * w.sentences.length)];
  return { en: s.en, zh: s.zh, word: w.word };
}

export function Aquarium3D({
  viewMode,
  onToggleView
}: {
  viewMode: boolean;
  onToggleView: () => void;
}) {
  const storeInv = useStore((s) => s.inv);
  const storeTankDecor = useStore((s) => s.tankDecor);
  const inv = IS_DEMO ? DEMO_INV : storeInv;
  const tankDecor = IS_DEMO ? DEMO_DECOR : storeTankDecor;
  const palette = useStore((s) => s.cosmetics.palette);
  const moveDecor = useStore((s) => s.moveDecor);
  const setDecorScale = useStore((s) => s.setDecorScale);
  const setDecorRot = useStore((s) => s.setDecorRot);
  const setDecorY = useStore((s) => s.setDecorY);
  const addDecor = useStore((s) => s.addDecor);
  const removeDecor = useStore((s) => s.removeDecor);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [autoRotate, setAutoRotate] = useState(false);
  const [arrange, setArrange] = useState(false);
  const [bubble, setBubble] = useState<Spoken | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Focus / break clock overlay: show whichever countdown is running over the tank.
  const pomo = useSyncExternalStore(pomodoro.subscribe, pomodoro.getState);
  const brk = useSyncExternalStore(breakTimer.subscribe, breakTimer.getState);
  const clock = brk.running
    ? { kind: "break" as const, remain: brk.remain }
    : pomo.running
      ? { kind: "focus" as const, remain: pomo.remain }
      : null;
  const clockMM = clock ? String(Math.floor(clock.remain / 60)).padStart(2, "0") : "";
  const clockSS = clock ? String(clock.remain % 60).padStart(2, "0") : "";

  const selected = arrange ? tankDecor.find((d) => d.id === selectedId) ?? null : null;

  // Create the engine once.
  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new Engine(canvasRef.current);
    engineRef.current = engine;
    engine.setPalette(palette.water, palette.sand);
    engine.setDecor(tankDecor);
    engine.setFish(inv);
    engine.setSentenceProvider(randomLearnedSentence);
    engine.setOnBubble(setBubble);
    engine.start();
    initModels().then(() => engine.loadAllModels());
    const unsub = subscribeModels((slot) => engine.refreshModel(slot));
    return () => {
      unsub();
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // While a bubble is shown, follow the fish each frame (via ref, no re-render).
  useEffect(() => {
    if (!bubble) return;
    let raf = 0;
    const place = () => {
      const p = engineRef.current?.projectBubble();
      const el = bubbleRef.current;
      if (p && el) {
        el.style.left = p.x + "px";
        el.style.top = p.y + "px";
        el.style.opacity = "1";
      } else if (el) {
        el.style.opacity = "0";
      }
    };
    place(); // position synchronously on first paint, before the first frame
    const follow = () => {
      place();
      raf = requestAnimationFrame(follow);
    };
    raf = requestAnimationFrame(follow);
    // Auto-dismiss after ~12s (tapping another fish resets this).
    const dismiss = window.setTimeout(() => setBubble(null), 12000);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(dismiss);
    };
  }, [bubble]);

  useEffect(() => { engineRef.current?.setFish(inv); }, [inv]);
  useEffect(() => { engineRef.current?.setDecor(tankDecor); }, [tankDecor]);
  // Keep the engine's highlight in sync with the UI selection (e.g. after
  // adding a rock via the button, or removing one). Runs after setDecor so the
  // freshly-built mesh exists to outline.
  useEffect(() => { engineRef.current?.selectDecor(arrange ? selectedId : null); }, [selectedId, arrange, tankDecor]);
  useEffect(() => { engineRef.current?.setPalette(palette.water, palette.sand); }, [palette.water, palette.sand]);
  useEffect(() => { engineRef.current?.setAutoRotate(autoRotate && !arrange); }, [autoRotate, arrange]);
  useEffect(() => {
    engineRef.current?.setArrange(
      arrange,
      (id, x, z) => moveDecor(id, x, z),
      (id) => setSelectedId(id)
    );
  }, [arrange, moveDecor]);

  return (
    <main className="aquarium-wrap">
      <div className="aq-head">
        <h2>海 缸</h2>
        <div className="aq-head-right">
          <button
            className={"aq-btn" + (autoRotate ? " on" : "")}
            title="自动旋转"
            onClick={() => setAutoRotate((v) => !v)}
          >
            ⟳ 自转
          </button>
          <button
            className={"aq-btn" + (arrange ? " on" : "")}
            title="布置模式：拖动造景到新位置"
            onClick={() => setArrange((v) => !v)}
          >
            ✥ 布置
          </button>
          {arrange && (
            <button
              className="aq-btn"
              title="添加一块造景石头（可调大小 / 朝向 / 上下）"
              onClick={() => setSelectedId(addDecor("rock"))}
            >
              ＋石头
            </button>
          )}
          {arrange && (
            <button
              className="aq-btn"
              title="把当前缸里的造景布局导出成预设（可作为发布版的初始造景）"
              onClick={() => {
                const decor = useStore.getState().tankDecor;
                const blob = new Blob([JSON.stringify(decor, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "造景预设.json";
                a.click();
                URL.revokeObjectURL(url);
                toast("造景预设已导出");
              }}
            >
              导出造景
            </button>
          )}
          <button className="aq-btn" title={viewMode ? "退出观赏" : "观赏模式：隐藏面板、专心看缸"} onClick={onToggleView}>
            {viewMode ? "✕ 退出" : "◉ 观赏"}
          </button>
          <AmbientToggle />
        </div>
      </div>
      <div className="canvas-frame canvas-3d">
        <canvas ref={canvasRef} />
        {clock && (
          <div className="aq-timer" title={brk.running ? "休息中" : "专注进行中"}>
            {clock.kind === "break" ? <BreakIcon size={14} /> : <FocusIcon size={14} />}
            <span>{clockMM}:{clockSS}</span>
          </div>
        )}
        {bubble && (
          <div ref={bubbleRef} className="fish-bubble" onClick={() => setBubble(null)}>
            <div className="fb-en"><HighlightedEN en={bubble.en} word={bubble.word || ""} /></div>
            <div className="fb-zh">{bubble.zh}</div>
          </div>
        )}
        <div className="aq-hint">
          {arrange
            ? selected
              ? "已选中：调大小 / 朝向，或拖动摆放"
              : "布置中：点一下缸里的造景来选中它"
            : "点一下鱼，它会说一句例句 · 拖动旋转"}
        </div>
        {selected && (
          <div className="arrange-panel">
            <div className="ap-title">{DECOR_LABEL[selected.type]}</div>
            <div className="ap-group">
              <span className="ap-label">大小</span>
              {DECOR_SIZES.map((s) => (
                <button
                  key={s.key}
                  className={"ap-btn" + ((selected.scale ?? 1) === s.scale ? " on" : "")}
                  onClick={() => setDecorScale(selected.id, s.scale)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="ap-group">
              <span className="ap-label">朝向</span>
              {DECOR_ROTS.map((r) => (
                <button
                  key={r.label}
                  className={"ap-btn" + (Math.abs((((selected.rot % TAU) + TAU) % TAU) - r.rot) < 0.01 ? " on" : "")}
                  onClick={() => setDecorRot(selected.id, r.rot)}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className="ap-group">
              <span className="ap-label">高低</span>
              <button className="ap-btn" title="升高" onClick={() => setDecorY(selected.id, (selected.y ?? 0) + 0.25)}>↑ 升</button>
              <button className="ap-btn" title="降低（贴近地面会自动吸附）" onClick={() => setDecorY(selected.id, (selected.y ?? 0) - 0.25)}>↓ 降</button>
              <button className="ap-btn" title="回到地面" onClick={() => setDecorY(selected.id, 0)}>贴地</button>
            </div>
            <div className="ap-group">
              <button
                className="ap-btn ap-del"
                title="移除这块造景"
                onClick={() => { removeDecor(selected.id); setSelectedId(null); }}
              >
                移除
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="medal-shelf">
        {inv.medals.map((m, i) => (
          <div key={i} className="medal" title={`${m.label} × ${m.n}`}>
            {ICONS[m.type] || "✦"}
          </div>
        ))}
      </div>
    </main>
  );
}
