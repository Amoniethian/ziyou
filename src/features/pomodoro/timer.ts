import { useStore } from "../../store";
import { audio } from "../../lib/audio";
import { toast } from "../../ui/toast";

/**
 * Module-level pomodoro timer.
 *
 * Lives for the whole app session (not tied to any component), so the
 * countdown keeps running when you switch to other tabs (e.g. keep learning).
 *
 * A running session is anchored to a wall-clock end time and persisted, so a
 * full page refresh resumes the countdown instead of losing it (and the
 * countdown stays accurate even while the tab is backgrounded). The duration
 * is adjustable and remembered in localStorage.
 */

export type PomoState = { duration: number; remain: number; running: boolean };

const KEY = "cihai-pomo-min";
const SESSION_KEY = "cihai-pomo-session";

type Session = { endsAt: number; duration: number };

function loadMin(): number {
  const v = Number(localStorage.getItem(KEY) || "25");
  return v >= 1 && v <= 120 ? v : 25;
}

let duration = loadMin() * 60;
let endsAt: number | null = null;
let state: PomoState = { duration, remain: duration, running: false };
const listeners = new Set<(s: PomoState) => void>();
let interval: number | undefined;

function set(patch: Partial<PomoState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
}

function saveSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** Grant the pomodoro reward, deferring until the store has hydrated so we
 * never clobber the persisted save with a pre-hydration write. */
function grantPomodoro(mins: number) {
  const run = () => useStore.getState().grantMinute(mins);
  const p = (useStore as unknown as { persist?: { hasHydrated?: () => boolean; onFinishHydration?: (cb: () => void) => () => void } }).persist;
  if (p?.hasHydrated && !p.hasHydrated() && p.onFinishHydration) {
    const unsub = p.onFinishHydration(() => {
      unsub?.();
      run();
    });
  } else {
    run();
  }
}

function complete(opts: { chime: boolean }) {
  window.clearInterval(interval);
  interval = undefined;
  endsAt = null;
  saveSession(null);
  grantPomodoro(Math.round(duration / 60));
  if (opts.chime) audio.pomodoroEnd();
  toast("一个番茄已成");
  set({ running: false, remain: duration });
}

function tick() {
  if (endsAt == null) return;
  const remain = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
  if (remain <= 0) complete({ chime: true });
  else set({ remain });
}

export const pomodoro = {
  getState: (): PomoState => state,
  subscribe(l: (s: PomoState) => void): () => void {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  start() {
    if (state.running) return;
    endsAt = Date.now() + state.remain * 1000;
    saveSession({ endsAt, duration });
    set({ running: true });
    interval = window.setInterval(tick, 1000);
  },
  pause() {
    if (!state.running) return;
    window.clearInterval(interval);
    interval = undefined;
    const remain = endsAt ? Math.max(0, Math.round((endsAt - Date.now()) / 1000)) : state.remain;
    endsAt = null;
    saveSession(null);
    set({ running: false, remain });
  },
  reset() {
    window.clearInterval(interval);
    interval = undefined;
    endsAt = null;
    saveSession(null);
    set({ running: false, remain: duration });
  },
  setMinutes(m: number) {
    const mins = Math.max(1, Math.min(120, Math.round(m || 0)));
    duration = mins * 60;
    try {
      localStorage.setItem(KEY, String(mins));
    } catch {
      /* ignore */
    }
    // If not mid-session, reflect the new length immediately.
    set({ duration, remain: state.running ? state.remain : duration });
  }
};

/** On load, resume a running session from its persisted wall-clock end time. */
function restore() {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
  if (!raw) return;
  let sess: Session | null = null;
  try {
    sess = JSON.parse(raw) as Session;
  } catch {
    /* ignore */
  }
  if (!sess || typeof sess.endsAt !== "number" || typeof sess.duration !== "number") {
    saveSession(null);
    return;
  }
  // Honour the in-session length so the eventual reward is correct.
  duration = sess.duration;
  const remain = Math.round((sess.endsAt - Date.now()) / 1000);
  if (remain > 0) {
    endsAt = sess.endsAt;
    set({ duration, running: true, remain });
    interval = window.setInterval(tick, 1000);
  } else {
    // The session elapsed while the page was closed — credit it once,
    // quietly (no chime on a fresh load).
    set({ duration });
    complete({ chime: false });
  }
}

restore();
