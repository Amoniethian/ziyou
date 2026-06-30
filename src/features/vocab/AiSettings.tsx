import { useState } from "react";
import { PROVIDERS, loadLlmConfig, saveLlmConfig } from "../../lib/llmConfig";
import { enrichWord } from "../../lib/llm-enrich";
import { toast } from "../../ui/toast";

/** Lets the user paste their own LLM API key (stored locally) to enable quick-capture enrichment. */
export function AiSettings() {
  const existing = loadLlmConfig();
  const [providerId, setProviderId] = useState(() => {
    const m = PROVIDERS.find((p) => p.endpoint === existing?.endpoint);
    return m ? m.id : existing ? "custom" : "openrouter-free";
  });
  const preset = PROVIDERS.find((p) => p.id === providerId)!;
  const [endpoint, setEndpoint] = useState(existing?.endpoint || preset.endpoint);
  const [apiKey, setApiKey] = useState(existing?.apiKey || "");
  const [model, setModel] = useState(existing?.model || preset.model);
  const [connected, setConnected] = useState(!!existing);
  const [testing, setTesting] = useState(false);

  // Switching to a known provider fills its endpoint + default model. (Done on
  // change, not in an effect, so opening settings never clobbers saved values.)
  function pickProvider(id: string) {
    setProviderId(id);
    const p = PROVIDERS.find((x) => x.id === id)!;
    if (id !== "custom") {
      setEndpoint(p.endpoint);
      setModel(p.model);
    }
  }

  function save() {
    if (!endpoint || !apiKey) {
      toast("请填入接口地址和 API key");
      return;
    }
    saveLlmConfig({ endpoint, apiKey, model: model || preset.model });
    setConnected(true);
    toast("AI 富化已启用");
  }
  function clear() {
    saveLlmConfig(null);
    setApiKey("");
    setConnected(false);
    toast("已断开 AI 富化");
  }
  async function test() {
    if (!endpoint || !apiKey) {
      toast("先填接口和 key");
      return;
    }
    setTesting(true);
    try {
      const r = await enrichWord("serendipity", { endpoint, apiKey, model: model || preset.model });
      toast("测试成功：" + (r.meaning || "已返回"));
    } catch (e: any) {
      toast("测试失败：" + (e?.message || e));
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="cos-section">
      <h3>AI 速记富化 {connected ? "· 已连接" : "· 未连接"}</h3>
      <div style={{ fontSize: 11, color: "var(--ink-soft)", lineHeight: 1.7, marginBottom: 8 }}>
        填入你自己的 API key（只存在本机浏览器，不上传、不进代码）。配好后，「学习」页顶部速记新词会自动补音标、释义、例句。
      </div>
      <div className="ai-row">
        <label>服务商</label>
        <select value={providerId} onChange={(e) => pickProvider(e.target.value)}>
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </div>
      {preset.note && <div className="ai-note">{preset.note}</div>}
      <div className="ai-row">
        <label>接口地址</label>
        <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://…/chat/completions" />
      </div>
      <div className="ai-row">
        <label>API key</label>
        <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" autoComplete="off" />
      </div>
      <div className="ai-row">
        <label>模型</label>
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o-mini" />
      </div>
      <div className="vocab-row">
        <button onClick={save}>保存启用</button>
        <button onClick={test} disabled={testing}>{testing ? "测试中…" : "测试"}</button>
        {connected && <button onClick={clear}>断开</button>}
      </div>
      <div className="ai-note">
        提示：浏览器直连部分服务商会被跨域(CORS)拦截；OpenRouter 最稳。OpenAI 兼容接口（DeepSeek / Moonshot 等）大多可用。
      </div>
    </div>
  );
}
