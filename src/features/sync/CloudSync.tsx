import { useEffect, useState } from "react";
import { loadSupabaseConfig, saveSupabaseConfig, buildConfigLink } from "../../lib/supabaseConfig";
import {
  getSyncStatus, subscribeSync, signIn, signUp, signOut, pushNow, pullNow, reinitSync
} from "../../lib/sync";
import { toast } from "../../ui/toast";
import { IS_RELEASE } from "../../lib/release";

const SQL = `-- 进度表
create table if not exists cihai_state (
  user_id uuid primary key references auth.users on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table cihai_state enable row level security;
drop policy if exists "own row" on cihai_state;
create policy "own row" on cihai_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 模型文件桶（私有）+ 仅本人可读写自己文件夹
insert into storage.buckets (id, name, public)
values ('cihai-models', 'cihai-models', false)
on conflict (id) do nothing;
drop policy if exists "cihai own models" on storage.objects;
create policy "cihai own models" on storage.objects for all
  using (bucket_id = 'cihai-models' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'cihai-models' and (storage.foldername(name))[1] = auth.uid()::text);`;

export function CloudSync() {
  const existing = loadSupabaseConfig();
  const [url, setUrl] = useState(existing?.url || "");
  const [anonKey, setAnonKey] = useState(existing?.anonKey || "");
  const [configured, setConfigured] = useState(!!existing);
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [showSql, setShowSql] = useState(false);
  const [status, setStatus] = useState(getSyncStatus());
  useEffect(() => subscribeSync(setStatus), []);

  function saveConfig() {
    if (!url || !anonKey) {
      toast("请填 Project URL 和 anon key");
      return;
    }
    saveSupabaseConfig({ url: url.trim(), anonKey: anonKey.trim() });
    setConfigured(true);
    reinitSync();
    toast("Supabase 已配置");
  }

  const signedIn = status.state === "idle" || status.state === "syncing";

  function copyConfigLink() {
    const link = buildConfigLink();
    if (!link) {
      toast("先填好 Supabase 配置");
      return;
    }
    navigator.clipboard?.writeText(link).then(
      () => toast("续接链接已复制 · 发到 iPad 打开即可自动配置"),
      () => window.prompt("复制这条链接，在 iPad 打开：", link)
    );
  }

  return (
    <div className="cos-section">
      <h3>云同步 · Supabase {signedIn ? `· ${status.email || "已登录"}` : configured ? "· 未登录" : "· 未配置"}</h3>

      {!configured ? (
        <>
          <div style={{ fontSize: 11, color: "var(--ink-soft)", lineHeight: 1.7, marginBottom: 8 }}>
            在 <a href="https://supabase.com" target="_blank" rel="noreferrer">supabase.com</a> 免费建一个项目，
            到 Settings → API 复制 <code>Project URL</code> 和 <code>anon public</code> key 填到这里。
            再去 SQL Editor 跑一次下面的 SQL（建进度表 + 建模型文件桶）。
          </div>
          <div className="ai-row"><label>Project URL</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" /></div>
          <div className="ai-row"><label>anon key</label>
            <input value={anonKey} onChange={(e) => setAnonKey(e.target.value)} placeholder="eyJ..." /></div>
          <div className="vocab-row"><button onClick={saveConfig}>保存配置</button></div>
        </>
      ) : !signedIn ? (
        <>
          <div className="ai-row"><label>邮箱</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="username" /></div>
          <div className="ai-row"><label>密码</label>
            <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="current-password" /></div>
          <div className="vocab-row">
            <button onClick={() => signIn(email, pwd)}>登录</button>
            <button onClick={() => signUp(email, pwd)}>注册</button>
            <button onClick={() => { saveSupabaseConfig(null); setConfigured(false); reinitSync(); }}>改配置</button>
          </div>
          <div className="ai-note">
            首次用「注册」建账号。若 Supabase 开了邮箱验证，注册后要先去邮箱点确认；嫌麻烦可在 Supabase →
            Authentication → Providers → Email 关掉 “Confirm email”。
          </div>
        </>
      ) : (
        <>
          <div className="ai-note">
            状态：{status.message || "已连接"}。进度会在改动后自动上传，换设备登录同一账号即可同步。
          </div>
          <div className="vocab-row">
            <button onClick={() => pushNow()}>立即上传</button>
            <button onClick={() => { if (confirm("用云端进度覆盖本机？")) pullNow(); }}>从云端载入</button>
            <button onClick={() => signOut()}>退出登录</button>
          </div>
        </>
      )}

      {/* Dev/maintenance plumbing — hidden in the public release build. */}
      {!IS_RELEASE && (
        <>
          <div className="vocab-row" style={{ marginTop: 8 }}>
            <button onClick={() => setShowSql((v) => !v)}>{showSql ? "隐藏 SQL" : "建表 + 建桶 SQL"}</button>
            {configured && <button onClick={copyConfigLink}>复制 iPad 续接链接</button>}
          </div>
          {configured && (
            <div className="ai-note">
              「续接链接」把本机的 Supabase 配置打包进网址，发到 iPad 打开就自动填好配置，只需再登录一次。
            </div>
          )}
        </>
      )}
      {showSql && <pre className="sql-box">{SQL}</pre>}
    </div>
  );
}
