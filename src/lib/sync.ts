import type { SupabaseClient } from "@supabase/supabase-js";
import { loadSupabaseConfig } from "./supabaseConfig";
import { useStore } from "../store";
import { toast } from "../ui/toast";
import { setModel as setLocalModel, getModel as getLocalModel, localModelSlots, type ModelSlot } from "../features/aquarium-3d/modelStore";
import { getBgm, setBgm as setLocalBgm, bgmName } from "./bgmStore";

const BUCKET = "cihai-models";

/**
 * Cross-device sync via Supabase.
 *
 * Table (run once in the Supabase SQL editor):
 *
 *   create table if not exists cihai_state (
 *     user_id uuid primary key references auth.users on delete cascade,
 *     data jsonb not null,
 *     updated_at timestamptz not null default now()
 *   );
 *   alter table cihai_state enable row level security;
 *   create policy "own row" on cihai_state
 *     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
 *
 * Strategy: pull on login, last-write-wins by timestamp, debounced push on change.
 */

const TABLE = "cihai_state";

export type SyncStatus = {
  state: "off" | "signedOut" | "idle" | "syncing" | "error";
  email?: string;
  message?: string;
};

let status: SyncStatus = { state: "off" };
const listeners = new Set<(s: SyncStatus) => void>();
function setStatus(s: SyncStatus) {
  status = s;
  listeners.forEach((l) => l(s));
}
export function getSyncStatus() {
  return status;
}
export function subscribeSync(l: (s: SyncStatus) => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

let client: SupabaseClient | null = null;
let clientUrl = "";

/**
 * Lazily create the Supabase client — and only dynamically import the
 * (~55KB gz) library when sync is actually configured, so users who never
 * set up sync don't pay for it on first load.
 */
async function ensureClient(): Promise<SupabaseClient | null> {
  const cfg = loadSupabaseConfig();
  if (!cfg) return null;
  if (!client || clientUrl !== cfg.url) {
    const { createClient } = await import("@supabase/supabase-js");
    client = createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    clientUrl = cfg.url;
  }
  return client;
}

async function getUser() {
  const c = await ensureClient();
  if (!c) return null;
  const { data } = await c.auth.getUser();
  return data.user ?? null;
}

/* ---------- content fingerprint (avoid push loops) ---------- */
let lastContent = "";
function contentKey(): string {
  const s = useStore.getState().exportState();
  const { _syncedAt, _device, ...rest } = s;
  return JSON.stringify(rest);
}

/* ---------- auth ---------- */
export async function signUp(email: string, password: string) {
  const c = await ensureClient();
  if (!c) return toast("请先填 Supabase 配置");
  const { error } = await c.auth.signUp({ email, password });
  if (error) {
    setStatus({ state: "error", message: error.message });
    toast("注册失败：" + error.message);
  } else {
    toast("注册成功，请登录（若开了邮箱验证，先去邮箱确认）");
  }
}

export async function signIn(email: string, password: string) {
  const c = await ensureClient();
  if (!c) return toast("请先填 Supabase 配置");
  setStatus({ state: "syncing", message: "登录中…" });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) {
    setStatus({ state: "error", message: error.message });
    toast("登录失败：" + error.message);
    return;
  }
  setStatus({ state: "idle", email: data.user?.email });
  await afterLogin();
}

export async function signOut() {
  const c = await ensureClient();
  if (c) await c.auth.signOut();
  setStatus({ state: "signedOut" });
  toast("已退出登录");
}

/** Turn raw Postgres/PostgREST errors into a one-line actionable hint. */
function friendlyError(msg: string): string {
  if (/find the table|schema cache|does not exist|relation .* does not exist|PGRST205/i.test(msg)) {
    return "云端还没建表。请在 Supabase → SQL Editor 跑一遍「建表 + 建桶 SQL」（词库 → 云同步里有按钮）";
  }
  if (/bucket|storage/i.test(msg)) {
    return "云端缺少模型文件桶。请重跑一遍「建表 + 建桶 SQL」";
  }
  return msg;
}

/* ---------- pull / push ---------- */
async function pull(): Promise<{ data: any; updated_at: string } | null> {
  const c = await ensureClient();
  const u = await getUser();
  if (!c || !u) return null;
  const { data, error } = await c.from(TABLE).select("data, updated_at").eq("user_id", u.id).maybeSingle();
  if (error) {
    setStatus({ state: "error", email: u.email, message: error.message });
    return null;
  }
  return data as any;
}

export async function pushNow(silent = false): Promise<boolean> {
  const c = await ensureClient();
  const u = await getUser();
  if (!c || !u) return false;
  setStatus({ state: "syncing", email: u.email, message: "上传中…" });
  const snap = useStore.getState().exportState();
  const now = new Date().toISOString();
  snap._syncedAt = now;
  snap._device = navigator.userAgent.slice(0, 48);
  const { error } = await c.from(TABLE).upsert({ user_id: u.id, data: snap, updated_at: now });
  if (error) {
    setStatus({ state: "error", email: u.email, message: friendlyError(error.message) });
    // Auto-push failures only update the status pill; manual actions toast once.
    if (!silent) toast("同步失败：" + friendlyError(error.message));
    return false;
  }
  useStore.getState().markSynced(now);
  lastContent = contentKey();
  setStatus({ state: "idle", email: u.email, message: "已同步" });
  return true;
}

export async function pullNow(): Promise<void> {
  const remote = await pull();
  const u = await getUser();
  if (remote?.data) {
    useStore.getState().importState(remote.data);
    lastContent = contentKey();
    setStatus({ state: "idle", email: u?.email, message: "已载入云端" });
    toast("已从云端载入进度");
  } else {
    toast("云端暂无存档");
  }
}

async function afterLogin() {
  const remote = await pull();
  const u = await getUser();
  const localSyncedAt = useStore.getState()._syncedAt;
  if (remote?.data) {
    const remoteNewer = !localSyncedAt || new Date(remote.updated_at) > new Date(localSyncedAt);
    if (remoteNewer) {
      useStore.getState().importState(remote.data);
      lastContent = contentKey();
      toast("已从云端载入进度");
      setStatus({ state: "idle", email: u?.email, message: "已载入云端" });
    } else {
      if (await pushNow()) toast("已把本地进度推送到云端");
    }
  } else {
    if (await pushNow()) toast("已创建云端存档");
  }
  // Backfill any local-only models to the cloud, then pull the full set down.
  const pushed = await backfillModels();
  if (pushed > 0) toast(`已补传 ${pushed} 个模型到云端`);
  await pullModels();
  // Same for the uploaded BGM track.
  await backfillBgm();
  await pullBgm();
}

/* ---------- model files (Supabase Storage) ---------- */
function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(b);
  });
}

/** Upload a just-picked GLB to the user's folder (no-op when signed out). */
export async function uploadModelFile(slot: ModelSlot, file: File) {
  const c = await ensureClient();
  const u = await getUser();
  if (!c || !u) return;
  const { error } = await c.storage.from(BUCKET).upload(`${u.id}/${slot}.glb`, file, {
    upsert: true,
    contentType: "model/gltf-binary"
  });
  if (error) toast("模型上传云端失败：" + friendlyError(error.message));
}

export async function deleteModelFromCloud(slot: ModelSlot) {
  const c = await ensureClient();
  const u = await getUser();
  if (!c || !u) return;
  await c.storage.from(BUCKET).remove([`${u.id}/${slot}.glb`]);
}

/**
 * Backfill: upload any locally-stored models that aren't in the cloud yet
 * (e.g. uploaded before sync was set up). Additive only — never overwrites a
 * model already in the cloud, so it can't clobber a newer one from another
 * device. Returns the number of models pushed.
 */
async function backfillModels(): Promise<number> {
  const c = await ensureClient();
  const u = await getUser();
  if (!c || !u) return 0;
  const { data: files, error } = await c.storage.from(BUCKET).list(u.id);
  if (error) return 0;
  const cloud = new Set((files || []).filter((f) => f.name.endsWith(".glb")).map((f) => f.name.replace(/\.glb$/, "")));
  let pushed = 0;
  for (const slot of await localModelSlots()) {
    if (cloud.has(slot)) continue; // already in cloud — leave it
    const dataUrl = await getLocalModel(slot);
    if (!dataUrl) continue;
    const blob = await (await fetch(dataUrl)).blob();
    const { error: upErr } = await c.storage
      .from(BUCKET)
      .upload(`${u.id}/${slot}.glb`, blob, { upsert: true, contentType: "model/gltf-binary" });
    if (!upErr) pushed++;
  }
  return pushed;
}

/** Download all of the user's model files into the local model store. */
async function pullModels() {
  const c = await ensureClient();
  const u = await getUser();
  if (!c || !u) return;
  const { data: files, error } = await c.storage.from(BUCKET).list(u.id);
  if (error || !files) return;
  for (const f of files) {
    if (!f.name.endsWith(".glb")) continue;
    const slot = f.name.replace(/\.glb$/, "") as ModelSlot;
    const { data: blob } = await c.storage.from(BUCKET).download(`${u.id}/${f.name}`);
    if (blob) await setLocalModel(slot, await blobToDataUrl(blob));
  }
}

/* ---------- BGM track (Supabase Storage) ---------- */
const bgmKey = (uid: string) => `${uid}/bgm.dat`;
const bgmNameKey = (uid: string) => `${uid}/bgm.name`;

/** Upload the current BGM track (call after the user picks a new one). */
export async function uploadBgm(dataUrl: string, name: string) {
  const c = await ensureClient();
  const u = await getUser();
  if (!c || !u) return;
  const blob = await (await fetch(dataUrl)).blob();
  await c.storage.from(BUCKET).upload(bgmKey(u.id), blob, { upsert: true });
  await c.storage.from(BUCKET).upload(bgmNameKey(u.id), new Blob([name], { type: "text/plain" }), { upsert: true });
}

export async function deleteBgmFromCloud() {
  const c = await ensureClient();
  const u = await getUser();
  if (!c || !u) return;
  await c.storage.from(BUCKET).remove([bgmKey(u.id), bgmNameKey(u.id)]);
}

/** Push a local-only BGM to the cloud if there isn't one there yet. */
async function backfillBgm() {
  const c = await ensureClient();
  const u = await getUser();
  if (!c || !u) return;
  const dataUrl = await getBgm();
  if (!dataUrl) return; // nothing local
  const { data: files } = await c.storage.from(BUCKET).list(u.id);
  if ((files || []).some((f) => f.name === "bgm.dat")) return; // already in cloud
  await uploadBgm(dataUrl, bgmName() || "BGM");
}

/** Download the cloud BGM if this device has none (avoids re-fetching MBs). */
async function pullBgm() {
  const c = await ensureClient();
  const u = await getUser();
  if (!c || !u) return;
  if (await getBgm()) return; // keep the local track
  const { data: blob } = await c.storage.from(BUCKET).download(bgmKey(u.id));
  if (!blob) return;
  let name = "云端 BGM";
  const nameRes = await c.storage.from(BUCKET).download(bgmNameKey(u.id));
  if (nameRes.data) name = (await nameRes.data.text()) || name;
  await setLocalBgm(await blobToDataUrl(blob), name);
}

/* ---------- auto-push on change ---------- */
let timer: number | undefined;
function scheduleAutoPush() {
  // Cheap synchronous guard (no Supabase import) when sync isn't configured.
  if (!loadSupabaseConfig()) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(async () => {
    const u = await getUser();
    if (!u) return;
    if (contentKey() === lastContent) return;
    await pushNow(true); // silent: no toast spam on repeated failures
  }, 8000);
}

let started = false;
export function initSync() {
  if (started) return;
  started = true;
  useStore.subscribe(scheduleAutoPush);
  if (!loadSupabaseConfig()) {
    setStatus({ state: "off" });
    return;
  }
  ensureClient().then((c) => {
    if (!c) {
      setStatus({ state: "off" });
      return;
    }
    c.auth.getSession().then(({ data }) => {
      if (data.session) {
        setStatus({ state: "idle", email: data.session.user.email });
        lastContent = contentKey();
        afterLogin();
      } else {
        setStatus({ state: "signedOut" });
      }
    });
  });
}

/** Re-evaluate after the user edits the Supabase config. */
export function reinitSync() {
  client = null;
  clientUrl = "";
  started = false;
  initSync();
}
