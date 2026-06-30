import { useSyncExternalStore } from "react";
import { useStore } from "../../store";
import { pomodoro } from "./timer";
import { breakTimer } from "./breakTimer";
import { FocusIcon, BreakIcon } from "../../ui/TimerIcons";

const PRESETS = [15, 25, 45, 60];
const BREAK_PRESETS = [3, 5, 10];

/** Minutes → "X 小时 Y 分钟" (drops empty parts), or "0 分钟". */
function fmtDuration(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h && r) return `${h} 小时 ${r} 分钟`;
  if (h) return `${h} 小时`;
  return `${r} 分钟`;
}

export function Pomodoro() {
  const minutes = useStore((s) => s.today.minutes);
  const totalFocusMin = useStore((s) => s.totalFocusMin);
  const totalBreakMin = useStore((s) => s.totalBreakMin);
  const st = useSyncExternalStore(pomodoro.subscribe, pomodoro.getState);
  const bk = useSyncExternalStore(breakTimer.subscribe, breakTimer.getState);

  const mm = String(Math.floor(st.remain / 60)).padStart(2, "0");
  const ss = String(st.remain % 60).padStart(2, "0");
  const curMin = Math.round(st.duration / 60);
  const bMM = String(Math.floor(bk.remain / 60)).padStart(2, "0");
  const bSS = String(bk.remain % 60).padStart(2, "0");
  const bMin = Math.round(bk.duration / 60);

  return (
    <div className="pane">
      <div className="timer-display">{mm}:{ss}</div>
      <div className="timer-sub"><FocusIcon size={14} /> 专注种下海草</div>

      <div className="pomo-presets">
        {PRESETS.map((m) => (
          <button
            key={m}
            className={"pomo-preset" + (curMin === m && !st.running ? " on" : "")}
            onClick={() => pomodoro.setMinutes(m)}
            disabled={st.running}
          >
            {m} 分
          </button>
        ))}
        <input
          type="number"
          min={1}
          max={120}
          value={curMin}
          onChange={(e) => pomodoro.setMinutes(Number(e.target.value))}
          disabled={st.running}
          className="pomo-input"
          aria-label="自定义分钟"
        />
      </div>

      <div className="timer-actions">
        <button className="primary" onClick={() => (st.running ? pomodoro.pause() : pomodoro.start())}>
          {st.running ? "暂停" : st.remain < st.duration ? "继续" : "开始"}
        </button>
        <button onClick={() => pomodoro.reset()}>重置</button>
      </div>

      <div className="pom-stat">今日累计 {Math.round(minutes)} 分钟 · 切页面 / 刷新都不打断计时</div>
      <div className="pom-stat">20 分 → 海草 · 40 分 → 海葵 · 60 分 → 珊瑚</div>

      <div className="companion-line">
        在字游的陪伴下，<br />
        学习了 <strong>{fmtDuration(totalFocusMin)}</strong>，休息了 <strong>{fmtDuration(totalBreakMin)}</strong>。
      </div>

      <div className="break-box">
        <div className="break-head">
          <span className="break-title"><BreakIcon size={15} /> 休息一下</span>
          {bk.running && <span className="break-clock">{bMM}:{bSS}</span>}
        </div>
        {!bk.running ? (
          <>
            <div className="pomo-presets">
              {BREAK_PRESETS.map((m) => (
                <button
                  key={m}
                  className={"pomo-preset" + (bMin === m ? " on" : "")}
                  onClick={() => breakTimer.setMinutes(m)}
                >
                  {m} 分
                </button>
              ))}
            </div>
            <div className="timer-actions">
              <button className="primary" onClick={() => breakTimer.start()}>开始休息</button>
            </div>
          </>
        ) : (
          <div className="timer-actions">
            <button onClick={() => breakTimer.reset()}>结束休息</button>
          </div>
        )}
        <div className="pom-stat">起来走走、看看远处，让眼睛歇会儿 · 休息满 → 一条金红超级小鱼 🐟</div>
      </div>
    </div>
  );
}
