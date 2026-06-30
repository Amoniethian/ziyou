import { useStore } from "../../store";

/**
 * Rest-break timer (independent of the focus pomodoro).
 *
 * Same wall-clock + persisted approach as the focus timer, so it survives a
 * page refresh. Finishing a break grows one gold-red "super small fish" as a
 * reward for actually resting (eyes off the screen, get up and move).
 */

export type BreakState = { duration: number; remain: number; running: boolean };

const KEY = "cihai-break-min";
const SESSION_KEY = "cihai-break-session";

type Session = { endsAt: number; duration: number };

function loadMin(): number {
  const v = Number(localStorage.getItem(KEY) || "5");
  return v >= 1 && v <= 60 ? v : 5;
}

let duration = loadMin() * 60;
let endsAt: number | null = null;
let state: BreakState = { duration, remain: duration, running: false };
const listeners = new Set<(s: BreakState) => void>();
let interval: number | undefined;

function set(patch: Partial<BreakState>) {
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

function grantBreak(mins: number) {
  const p = (useStore as unknown as { persist?: { hasHydrated?: () => boolean; onFinishHydration?: (cb: () => void) => () => void } }).persist;
  const run = () => useStore.getState().grantBreak(mins);
  if (p?.hasHydrated && !p.hasHydrated() && p.onFinishHydration) {
    const unsub = p.onFinishHydration(() => { unsub?.(); run(); });
  } else {
    run();
  }
}

function complete() {
  window.clearInterval(interval);
  interval = undefined;
  endsAt = null;
  saveSession(null);
  grantBreak(Math.round(duration / 60));
  set({ running: false, remain: duration });
}

function tick() {
  if (endsAt == null) return;
  const remain = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
  if (remain <= 0) complete();
  else set({ remain });
}

export const breakTimer = {
  getState: (): BreakState => state,
  subscribe(l: (s: BreakState) => void): () => void {
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
  reset() {
    window.clearInterval(interval);
    interval = undefined;
    endsAt = null;
    saveSession(null);
    set({ running: false, remain: duration });
  },
  setMinutes(m: number) {
    const mins = Math.max(1, Math.min(60, Math.round(m || 0)));
    duration = mins * 60;
    try {
      localStorage.setItem(KEY, String(mins));
    } catch {
      /* ignore */
    }
    set({ duration, remain: state.running ? state.remain : duration });
  }
};

/** Resume a running break from its persisted wall-clock end time on load. */
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
  duration = sess.duration;
  const remain = Math.round((sess.endsAt - Date.now()) / 1000);
  if (remain > 0) {
    endsAt = sess.endsAt;
    set({ duration, running: true, remain });
    interval = window.setInterval(tick, 1000);
  } else {
    set({ duration });
    complete();
  }
}

restore();
