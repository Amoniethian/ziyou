/**
 * Google Drive sync for 词海.
 *
 * Uses Google Identity Services (GIS) for OAuth and the Drive REST API
 * to read/write a single state file in a "Cihai" folder.
 *
 * Setup:
 *   1. In Google Cloud Console, create an OAuth 2.0 Client ID (Web application type).
 *      Add your deployment origin(s) to "Authorized JavaScript origins".
 *   2. Set VITE_GOOGLE_CLIENT_ID in your .env (or pass clientId to createDriveSync).
 *   3. Call createDriveSync({ clientId }).init() once at app boot.
 *
 * The Drive API has no "update file" tool exposed in our scope, so each
 * push creates a new file. We always read the newest by modifiedTime.
 * Old files in the Cihai folder serve as automatic version backups.
 */

const FILE_NAME = "cihai-state.json";
const FOLDER_NAME = "Cihai";
const SCOPE = "https://www.googleapis.com/auth/drive.file";

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; expires_in?: number; error?: string }) => void;
          }) => TokenClient;
        };
      };
    };
  }
}
type TokenClient = {
  callback: (response: { access_token?: string; expires_in?: number; error?: string }) => void;
  requestAccessToken: (options?: { prompt?: string }) => void;
};

export type DriveSyncConfig = {
  clientId: string;
};

export type DriveSync = ReturnType<typeof createDriveSync>;

export function createDriveSync(config: DriveSyncConfig) {
  let accessToken: string | null = null;
  let tokenExpiresAt = 0;
  let tokenClient: TokenClient | null = null;
  let folderId: string | null = null;
  let gisReady = false;

  function loadGIS(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (window.google?.accounts) { resolve(); return; }
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true; s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("GIS load failed"));
      document.head.appendChild(s);
    });
  }

  async function init(): Promise<void> {
    if (!config.clientId) throw new Error("Missing Google Client ID");
    await loadGIS();
    if (!tokenClient) {
      tokenClient = window.google!.accounts.oauth2.initTokenClient({
        client_id: config.clientId,
        scope: SCOPE,
        callback: () => {}
      });
    }
    // Restore session token if still valid
    const cached = sessionStorage.getItem("cihai.oauthToken");
    if (cached) {
      try {
        const o = JSON.parse(cached);
        if (o.expiresAt > Date.now() + 60_000) {
          accessToken = o.token;
          tokenExpiresAt = o.expiresAt;
        }
      } catch {}
    }
    gisReady = true;
  }

  function requestToken(interactive: boolean): Promise<string> {
    if (!tokenClient) return Promise.reject(new Error("OAuth not initialized"));
    return new Promise((resolve, reject) => {
      tokenClient!.callback = (r) => {
        if (r.error || !r.access_token) {
          reject(new Error(r.error || "No token"));
          return;
        }
        accessToken = r.access_token;
        tokenExpiresAt = Date.now() + ((r.expires_in ?? 3600) - 60) * 1000;
        sessionStorage.setItem("cihai.oauthToken", JSON.stringify({
          token: accessToken, expiresAt: tokenExpiresAt
        }));
        resolve(accessToken);
      };
      tokenClient!.requestAccessToken({ prompt: interactive ? "consent" : "" });
    });
  }

  async function ensureToken(): Promise<string> {
    if (accessToken && Date.now() < tokenExpiresAt) return accessToken;
    if (!gisReady) await init();
    return requestToken(false);
  }

  async function driveFetch(input: string, init?: RequestInit): Promise<Response> {
    const tk = await ensureToken();
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${tk}`);
    return fetch(input, { ...init, headers });
  }

  async function ensureFolder(): Promise<string> {
    if (folderId) return folderId;
    const q = `name = '${FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const r = await driveFetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`
    );
    if (!r.ok) throw new Error("Drive folder search failed: " + r.status);
    const j = await r.json();
    if (j.files?.length) {
      folderId = j.files[0].id;
      return folderId!;
    }
    const cr = await driveFetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" })
    });
    if (!cr.ok) throw new Error("Drive folder create failed: " + cr.status);
    const cj = await cr.json();
    folderId = cj.id;
    return folderId!;
  }

  async function push<T extends object>(state: T, reason = "auto"): Promise<void> {
    const fid = await ensureFolder();
    const payload = JSON.stringify({
      ...state,
      _syncedAt: new Date().toISOString(),
      _device: navigator.userAgent.slice(0, 60),
      _reason: reason
    });
    const boundary = "-------cihai" + Math.random().toString(36).slice(2);
    const body =
      `--${boundary}\r\n` +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      JSON.stringify({ name: FILE_NAME, parents: [fid] }) + "\r\n" +
      `--${boundary}\r\n` +
      "Content-Type: application/json\r\n\r\n" +
      payload + "\r\n" +
      `--${boundary}--`;
    const r = await driveFetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body
      }
    );
    if (!r.ok) throw new Error("Drive upload failed: " + r.status);
  }

  async function pull<T>(): Promise<{ state: T; modifiedTime: string } | null> {
    const fid = await ensureFolder();
    const q = `name = '${FILE_NAME}' and '${fid}' in parents and trashed = false`;
    const r = await driveFetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}` +
      `&fields=files(id,name,modifiedTime)&pageSize=100`
    );
    if (!r.ok) throw new Error("Drive search failed: " + r.status);
    const j = await r.json();
    const files = j.files || [];
    if (!files.length) return null;
    files.sort((a: any, b: any) => (b.modifiedTime || "").localeCompare(a.modifiedTime || ""));
    const newest = files[0];
    const dl = await driveFetch(
      `https://www.googleapis.com/drive/v3/files/${newest.id}?alt=media`
    );
    if (!dl.ok) throw new Error("Drive download failed: " + dl.status);
    const text = await dl.text();
    return { state: JSON.parse(text) as T, modifiedTime: newest.modifiedTime };
  }

  function isLoggedIn(): boolean {
    return !!accessToken && Date.now() < tokenExpiresAt;
  }

  async function login(): Promise<void> {
    if (!gisReady) await init();
    await requestToken(true);
  }

  function logout(): void {
    accessToken = null;
    tokenExpiresAt = 0;
    sessionStorage.removeItem("cihai.oauthToken");
  }

  return { init, login, logout, isLoggedIn, push, pull };
}

/**
 * Debounce helper for state-driven sync.
 *
 * Usage:
 *   const debouncedPush = makeDebouncedSync(drive, 8000);
 *   useStore.subscribe(() => debouncedPush(useStore.getState()));
 */
export function makeDebouncedSync<T extends object>(
  drive: DriveSync,
  delayMs = 8000
) {
  let timer: number | null = null;
  let pending = false;
  return function debouncedPush(state: T, reason = "auto") {
    pending = true;
    if (timer) clearTimeout(timer);
    timer = window.setTimeout(async () => {
      if (!pending || !drive.isLoggedIn()) return;
      pending = false;
      try {
        await drive.push(state, reason);
      } catch (e) {
        console.warn("Sync failed:", e);
      }
    }, delayMs);
  };
}
