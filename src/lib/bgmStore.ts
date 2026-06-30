import localforage from "localforage";

/**
 * Stores a single user-uploaded BGM track (as a base64 data URL) in its own
 * IndexedDB keyspace. Kept local only — audio files are large and may be
 * copyrighted, so they are never synced to the cloud.
 */

const store = localforage.createInstance({ name: "cihai", storeName: "bgm" });
const K_DATA = "track";
const K_NAME = "name";

type Listener = () => void;
const listeners = new Set<Listener>();
let cachedName: string | null = null;
let ready = false;

export async function initBgm(): Promise<void> {
  cachedName = await store.getItem<string>(K_NAME);
  ready = true;
  listeners.forEach((l) => l());
}
export function bgmReady() {
  return ready;
}
export function bgmName(): string | null {
  return cachedName;
}
export function hasBgm(): boolean {
  return !!cachedName;
}
export function getBgm(): Promise<string | null> {
  return store.getItem<string>(K_DATA);
}
export async function setBgm(dataUrl: string, name: string): Promise<void> {
  await store.setItem(K_DATA, dataUrl);
  await store.setItem(K_NAME, name);
  cachedName = name;
  listeners.forEach((l) => l());
}
export async function clearBgm(): Promise<void> {
  await store.removeItem(K_DATA);
  await store.removeItem(K_NAME);
  cachedName = null;
  listeners.forEach((l) => l());
}
export function subscribeBgm(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
