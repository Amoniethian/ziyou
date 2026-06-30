import { useEffect, useRef, useState } from "react";
import { useStore } from "../../store";
import { toast } from "../../ui/toast";
import { AudioControls } from "../audio/AudioControls";
import {
  initModels,
  subscribeModels,
  hasModel,
  getModel,
  setModel,
  clearModel,
  fileToDataUrl,
  cycleHeading,
  cyclePitch,
  getHeading,
  getPitch,
  type ModelSlot
} from "../aquarium-3d/modelStore";
import { OrientPreview } from "../aquarium-3d/OrientPreview";
import { uploadModelFile, deleteModelFromCloud } from "../../lib/sync";
import { THEMES, getTheme, setTheme, subscribeTheme } from "../../lib/theme";

const FISH_SLOTS = new Set<ModelSlot>(["smallFish", "moonFish", "clownfish", "bigFish", "turtle"]);

/**
 * Download the model stored for a slot as a .glb, named by slot. If the model's
 * orientation was adjusted, the 转向/翻正 steps are encoded in the filename
 * (e.g. `小鱼_smallFish_h2p1.glb`) so the correct facing can be pinned when the
 * file is bundled into the release.
 */
async function exportModel(slot: ModelSlot, label: string) {
  const url = await getModel(slot);
  if (!url) {
    toast("这个槽位没有可导出的模型");
    return;
  }
  const blob = await (await fetch(url)).blob();
  const hSteps = Math.round(getHeading(slot) / (Math.PI / 2)) % 4;
  const pSteps = Math.round(getPitch(slot) / (Math.PI / 2)) % 4;
  const orient = hSteps || pSteps ? `_h${hSteps}p${pSteps}` : "";
  const dl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = dl;
  a.download = `${label}_${slot}${orient}.glb`;
  a.click();
  URL.revokeObjectURL(dl);
  toast(label + " 模型已导出");
}

const WATER_PRESETS: [number, string][] = [
  [0xb8dcd8, "浅青"], [0x6ba6a3, "深青"], [0xa5cce0, "浅蓝"], [0x3a78a5, "深蓝"], [0x4a5d8a, "暮色"]
];
const SAND_PRESETS: [number, string][] = [
  [0xc8a874, "暖沙"], [0xe8d3a3, "米沙"], [0xddcdb0, "贝壳"], [0x3a342c, "黑沙"]
];

const MODEL_ROWS: [ModelSlot, string][] = [
  ["tank", "缸子"],
  ["smallFish", "小鱼"], ["moonFish", "月亮鱼"], ["clownfish", "小丑鱼"], ["bigFish", "guppy"], ["turtle", "七彩麒麟"],
  ["rock", "岩石"], ["coral", "珊瑚"], ["anemone", "海葵"], ["seaweed", "海草"]
];

const hex = (n: number) => "#" + n.toString(16).padStart(6, "0");

export function Cosmetics() {
  const palette = useStore((s) => s.cosmetics.palette);
  const setPalette = useStore((s) => s.setPalette);

  // Reflect model presence (stored outside zustand) reactively.
  const [, bump] = useState(0);
  useEffect(() => {
    initModels().then(() => bump((v) => v + 1));
    return subscribeModels(() => bump((v) => v + 1));
  }, []);

  const [theme, setThemeState] = useState(getTheme());
  useEffect(() => subscribeTheme(() => setThemeState(getTheme())), []);

  return (
    <div className="pane">
      <div className="cos-section">
        <h3>界面主题</h3>
        <div className="theme-row">
          {THEMES.map((t) => (
            <button
              key={t.id}
              className={"theme-chip" + (theme === t.id ? " on" : "")}
              style={{ background: t.paper }}
              onClick={() => setTheme(t.id)}
              title={t.label}
            >
              <span className="theme-dot" style={{ background: t.accent }} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <AudioControls />

      <div className="cos-section">
        <h3>海缸配色</h3>
        <div className="cos-row">
          <label>水色</label>
          <div className="palette">
            {WATER_PRESETS.map(([c, name]) => (
              <div
                key={c}
                className={"swatch" + (palette.water === c ? " active" : "")}
                title={name}
                style={{ background: hex(c) }}
                onClick={() => setPalette(c, palette.sand)}
              />
            ))}
          </div>
        </div>
        <div className="cos-row">
          <label>沙色</label>
          <div className="palette">
            {SAND_PRESETS.map(([c, name]) => (
              <div
                key={c}
                className={"swatch" + (palette.sand === c ? " active" : "")}
                title={name}
                style={{ background: hex(c) }}
                onClick={() => setPalette(palette.water, c)}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="cos-section">
        <h3>替换为 GLB 模型</h3>
        <div style={{ fontSize: 11, color: "var(--ink-soft)", lineHeight: 1.7, marginBottom: 8 }}>
          在 <a href="https://fab.com" target="_blank" rel="noreferrer">fab.com</a> 搜
          {" "}<code>stylized aquarium</code> / <code>low poly fish</code> / <code>coral</code> 等，筛选「免费 + 可商用」，
          下载 <code>.glb</code> 后在这里上传替换占位模型（自动按大小缩放）。
        </div>
        {MODEL_ROWS.map(([slot, label]) => (
          <ModelRow key={slot} slot={slot} label={label} replaced={hasModel(slot)} />
        ))}
      </div>
    </div>
  );
}

function ModelRow({ slot, label, replaced }: { slot: ModelSlot; label: string; replaced: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
    <div className="cos-row">
      <label>{label}</label>
      <input
        ref={input}
        type="file"
        accept=".glb,.gltf,model/gltf-binary"
        style={{ display: "none" }}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            await setModel(slot, await fileToDataUrl(f));
            uploadModelFile(slot, f); // syncs to cloud if signed in
            toast(label + " 模型已替换");
          } catch {
            toast(label + " 模型加载失败");
          }
          e.target.value = "";
        }}
      />
      <button className="file-btn" onClick={() => input.current?.click()}>选择 .glb</button>
      <span className="model-status">{replaced ? "✓ 已替换" : "占位"}</span>
      {replaced && (
        <button className="file-btn" onClick={() => exportModel(slot, label)} title="把这个模型下载成 .glb（文件名含槽位与朝向）">导出</button>
      )}
      {replaced && (
        <button
          className="clear"
          onClick={() => clearModel(slot).then(() => { deleteModelFromCloud(slot); toast(label + " 已恢复占位"); })}
        >
          清除
        </button>
      )}
    </div>
    {replaced && FISH_SLOTS.has(slot) && (
      <div className="orient-row">
        <OrientPreview slot={slot} />
        <div className="orient-ctrls">
          <div className="orient-hint">把鱼头转到<b>红色箭头方向</b>（= 游动方向），点按钮实时调整：</div>
          <div className="orient-btns">
            <button className="file-btn" title="绕竖直轴转 90°：改左右朝向" onClick={() => cycleHeading(slot)}>↻ 转向</button>
            <button className="file-btn" title="翻正：把躺平/侧躺的模型立起来" onClick={() => cyclePitch(slot)}>⤧ 翻正</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
