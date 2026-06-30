/**
 * Framework-agnostic toast bus.
 *
 * The legacy app called a global `toast()` from everywhere (store logic,
 * UI handlers, the aquarium). Keeping a tiny pub/sub here lets non-React
 * modules (store.ts, the aquarium engine) emit toasts without importing React.
 */

type Listener = (msg: string) => void;
const listeners = new Set<Listener>();

export function toast(msg: string): void {
  listeners.forEach((l) => l(msg));
}

export function subscribeToasts(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
