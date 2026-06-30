/**
 * UI color themes. Each theme overrides CSS custom properties on
 * <html data-theme="...">. The choice is remembered in localStorage.
 */

export type ThemeDef = { id: string; label: string; paper: string; accent: string };

export const THEMES: ThemeDef[] = [
  { id: "paper", label: "纸", paper: "#fbf8f2", accent: "#6b8e7f" },
  { id: "dark", label: "夜", paper: "#1f2228", accent: "#7fb0a0" },
  { id: "ocean", label: "海", paper: "#eaf3f5", accent: "#3a8fb0" },
  { id: "dusk", label: "暮", paper: "#211d2b", accent: "#a98bd0" },
  { id: "matcha", label: "抹茶", paper: "#f0f1e6", accent: "#7a9a55" }
];

const KEY = "cihai-theme";
const listeners = new Set<() => void>();

export function getTheme(): string {
  return localStorage.getItem(KEY) || "paper";
}
function apply(id: string) {
  document.documentElement.dataset.theme = id;
}
export function setTheme(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
  apply(id);
  listeners.forEach((l) => l());
}
export function initTheme() {
  apply(getTheme());
}
export function subscribeTheme(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
