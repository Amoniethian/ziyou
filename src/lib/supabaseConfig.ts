/**
 * Supabase connection config (project URL + anon key).
 *
 * The anon key is a public client key (safe to store client-side); Row Level
 * Security on the table is what protects each user's data. Kept in localStorage
 * per device, with VITE_SUPABASE_* env vars as a dev fallback.
 */

export type SupabaseConfig = { url: string; anonKey: string };

const KEY = "cihai-supabase";
type Listener = () => void;
const listeners = new Set<Listener>();

export function loadSupabaseConfig(): SupabaseConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const c = JSON.parse(raw);
      if (c.url && c.anonKey) return { url: c.url, anonKey: c.anonKey };
    }
  } catch {
    /* ignore */
  }
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (url && anonKey) return { url, anonKey };
  return null;
}

export function saveSupabaseConfig(c: SupabaseConfig | null) {
  if (!c) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, JSON.stringify(c));
  listeners.forEach((l) => l());
}

export function subscribeSupabaseConfig(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/**
 * Build a "续接链接" carrying this device's Supabase config in the URL fragment,
 * so a new device (e.g. an iPad) is configured in one tap instead of retyping
 * the long anon key. The anon key is a public client key and the fragment never
 * leaves the browser, so this is safe.
 */
export function buildConfigLink(): string | null {
  const cfg = loadSupabaseConfig();
  if (!cfg) return null;
  const payload = encodeURIComponent(btoa(JSON.stringify({ url: cfg.url, anonKey: cfg.anonKey })));
  return location.origin + location.pathname + "#cfg=" + payload;
}

/**
 * If the page was opened with a #cfg=… share link, import the Supabase config
 * from it and strip it from the URL. Returns true when a config was applied.
 * Call once at startup, before sync initialises.
 */
export function applyConfigFromUrl(): boolean {
  try {
    const m = location.hash.match(/[#&]cfg=([^&]+)/);
    if (!m) return false;
    const cfg = JSON.parse(atob(decodeURIComponent(m[1])));
    if (cfg && cfg.url && cfg.anonKey) {
      saveSupabaseConfig({ url: String(cfg.url), anonKey: String(cfg.anonKey) });
      history.replaceState(null, "", location.pathname + location.search);
      return true;
    }
  } catch {
    /* ignore a malformed link */
  }
  return false;
}
