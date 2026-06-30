import { useEffect, useRef, useState } from "react";
import { audio } from "../../lib/audio";
import { useAudioSettings } from "./useAudio";
import { fileToDataUrl } from "../aquarium-3d/modelStore";
import { initBgm, bgmName, subscribeBgm, setBgm, clearBgm } from "../../lib/bgmStore";
import { uploadBgm, deleteBgmFromCloud } from "../../lib/sync";
import { toast } from "../../ui/toast";

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={"switch" + (on ? " on" : "")}
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
    >
      <span className="knob" />
    </button>
  );
}

/** Audio settings block, shown in the 外观 tab. */
export function AudioControls() {
  const s = useAudioSettings();
  const [, bump] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    initBgm().then(() => bump((v) => v + 1));
    return subscribeBgm(() => bump((v) => v + 1));
  }, []);
  const name = bgmName();

  return (
    <div className="cos-section">
      <h3>声音</h3>
      <div className="audio-row">
        <label>环境音</label>
        <Toggle on={s.ambientOn} onChange={(v) => audio.setSettings({ ambientOn: v })} />
        <input
          type="range" min={0} max={100}
          value={Math.round(s.ambientVol * 100)}
          onChange={(e) => audio.setSettings({ ambientVol: +e.target.value / 100 })}
          aria-label="环境音音量"
        />
      </div>
      <div className="audio-row">
        <label>反馈音</label>
        <Toggle on={s.fxOn} onChange={(v) => audio.setSettings({ fxOn: v })} />
        <input
          type="range" min={0} max={100}
          value={Math.round(s.fxVol * 100)}
          onChange={(e) => audio.setSettings({ fxVol: +e.target.value / 100 })}
          aria-label="反馈音音量"
        />
      </div>
      <div className="audio-row">
        <label>音乐 · BGM</label>
        <Toggle on={s.musicOn} onChange={(v) => { audio.ensure(); audio.setSettings({ musicOn: v }); }} />
        <input
          type="range" min={0} max={100}
          value={Math.round(s.musicVol * 100)}
          onChange={(e) => audio.setSettings({ musicVol: +e.target.value / 100 })}
          aria-label="音乐音量"
        />
      </div>

      <div className="cos-row">
        <label>自定义曲</label>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          style={{ display: "none" }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              const url = await fileToDataUrl(f);
              await setBgm(url, f.name);
              uploadBgm(url, f.name); // syncs to cloud if signed in
              audio.setMusic(url);
              audio.ensure();
              audio.setSettings({ musicOn: true });
              toast("BGM 已设置：" + f.name);
            } catch {
              toast("音频读取失败");
            }
            e.target.value = "";
          }}
        />
        <button className="file-btn" onClick={() => fileRef.current?.click()}>上传音频</button>
        <span className="model-status">{name || "未设置"}</span>
        {name && (
          <button className="clear" onClick={() => { clearBgm(); deleteBgmFromCloud(); audio.setMusic(null); toast("已移除 BGM"); }}>清除</button>
        )}
      </div>

      <div style={{ fontSize: 11, color: "var(--ink-soft)", lineHeight: 1.7 }}>
        环境音 = 深海白噪 + 缓慢和声垫；音乐 = 你上传的曲子（循环），没上传时播放内置的轻柔旋律。反馈音用于答对 / 答错、新生物诞生等。
        浏览器要求首次交互后才能发声。上传的音频只存本机、不上传云端，版权请自行确认。
      </div>
    </div>
  );
}

/** Compact ambient on/off button for the aquarium header. */
export function AmbientToggle() {
  const s = useAudioSettings();
  return (
    <button
      className="ambient-toggle"
      title={s.ambientOn ? "关闭环境音" : "开启环境音"}
      onClick={() => {
        audio.ensure();
        audio.setSettings({ ambientOn: !s.ambientOn });
      }}
    >
      {s.ambientOn ? "🌊 BGM" : "🔇 BGM"}
    </button>
  );
}
