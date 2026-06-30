import localforage from "localforage";

/**
 * Separate IndexedDB store for user-uploaded GLB models (fish / decor / tank).
 *
 * GLB files can be several MB; keeping them out of the synced zustand state
 * avoids re-serializing megabytes on every small state change. Values are
 * stored as base64 data URLs keyed by slot ("smallFish", "rock", "tank", …).
 */

const store = localforage.createInstance({ name: "cihai", storeName: "models" });

export type ModelSlot =
  | "smallFish" | "moonFish" | "clownfish" | "bigFish" | "turtle"
  | "rock" | "coral" | "anemone" | "seaweed" | "tank";

type Listener = (slot: ModelSlot) => void;
const listeners = new Set<Listener>();
const present = new Set<ModelSlot>();
let ready = false;

/**
 * Slots that ship with a bundled default model at public/models/<slot>.glb.
 * Add a slot here once its .glb is placed in public/models (release build).
 * Empty = every slot uses the built-in procedural fish until a player uploads.
 */
export const BUNDLED_MODELS = new Set<ModelSlot>(["bigFish", "clownfish", "turtle"]);

/** URL of the bundled default .glb for a slot, or null if none is shipped. */
export function bundledModelUrl(slot: ModelSlot): string | null {
  return BUNDLED_MODELS.has(slot) ? import.meta.env.BASE_URL + "models/" + slot + ".glb" : null;
}

/** URL of a bundled decor style variant: public/models/<type><n>.glb */
export function decorVariantUrl(type: string, variant: number): string {
  return import.meta.env.BASE_URL + "models/" + type + variant + ".glb";
}

/**
 * Pinned orientation (radians) for the BUNDLED default models — applied only
 * when the player hasn't uploaded their own model for that slot, so the shipped
 * fish face the right way out of the box without the player touching anything.
 * (A player who uploads their own model gets the live 转向/翻正 controls instead.)
 */
const DEFAULT_HEADING: Partial<Record<ModelSlot, number>> = {};
const DEFAULT_PITCH: Partial<Record<ModelSlot, number>> = {};

export async function initModels(): Promise<void> {
  const keys = await store.keys();
  for (const k of keys) present.add(k as ModelSlot);
  ready = true;
  listeners.forEach((l) => l("tank")); // nudge subscribers to re-read
}

export function modelsReady() {
  return ready;
}
export function hasModel(slot: ModelSlot): boolean {
  return present.has(slot);
}
export function getModel(slot: ModelSlot): Promise<string | null> {
  return store.getItem<string>(slot);
}
/** All slots that currently have a locally-stored model. */
export async function localModelSlots(): Promise<ModelSlot[]> {
  return (await store.keys()) as ModelSlot[];
}
export async function setModel(slot: ModelSlot, dataUrl: string): Promise<void> {
  await store.setItem(slot, dataUrl);
  present.add(slot);
  listeners.forEach((l) => l(slot));
}
export async function clearModel(slot: ModelSlot): Promise<void> {
  await store.removeItem(slot);
  present.delete(slot);
  listeners.forEach((l) => l(slot));
}
export function subscribeModels(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/* ---------- per-slot heading offset (fix model facing) ---------- */
const HEADING_KEY = "cihai-model-heading";
let headings: Record<string, number> = (() => {
  try {
    return JSON.parse(localStorage.getItem(HEADING_KEY) || "{}");
  } catch {
    return {};
  }
})();

export function getHeading(slot: ModelSlot): number {
  // Player's own adjustment wins; otherwise a bundled default's pinned value
  // (only when they haven't uploaded their own model for this slot).
  if (slot in headings) return headings[slot];
  return hasModel(slot) ? 0 : (DEFAULT_HEADING[slot] ?? 0);
}
export function cycleHeading(slot: ModelSlot) {
  // The engine reads heading live each frame, so no model reload is needed.
  headings = { ...headings, [slot]: (((headings[slot] || 0) + Math.PI / 2) % (Math.PI * 2)) };
  try {
    localStorage.setItem(HEADING_KEY, JSON.stringify(headings));
  } catch {
    /* ignore */
  }
}

/* ---------- per-slot pitch (roll a "lying flat" model upright) ---------- */
const PITCH_KEY = "cihai-model-pitch";
let pitches: Record<string, number> = (() => {
  try {
    return JSON.parse(localStorage.getItem(PITCH_KEY) || "{}");
  } catch {
    return {};
  }
})();
export function getPitch(slot: ModelSlot): number {
  if (slot in pitches) return pitches[slot];
  return hasModel(slot) ? 0 : (DEFAULT_PITCH[slot] ?? 0);
}
export function cyclePitch(slot: ModelSlot) {
  pitches = { ...pitches, [slot]: (((pitches[slot] || 0) + Math.PI / 2) % (Math.PI * 2)) };
  try {
    localStorage.setItem(PITCH_KEY, JSON.stringify(pitches));
  } catch {
    /* ignore */
  }
}

/** Read a File as a base64 data URL (for persisting GLB bytes). */
export function fileToDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(f);
  });
}
