# 字游 · Ziyou

A vocabulary study app structured as a slow-living virtual aquarium.
每一个被牢记的词，都会变成鱼缸里一只缓慢游动的生物。

> 完整产品规格见 [`DESIGN.md`](./DESIGN.md)。遇到设计抉择时，用文末三句美学锚点校准
> （「看 10 分钟也不无聊」「不奖励效率，奖励持续」）。

## 现状 · v0.1（单机 web）

已实现完整的学习 / 复习闭环 + 2D 鱼缸，本地持久化（IndexedDB）。

- **学习**：速记新词 → 四步学习（熟悉 → 句子配对 → 选词成句 → 默写单词）→ 每 10 词整组拼配测验 + 3 句默写。做题卡住时可「回看」该词，或「记不住」先跳过（不算学会、留到下次再学）
- **专注**：番茄钟，时长可调（15 / 25 / 45 / 60 或自定义）；切到别的页面计时继续走，跑满按实际分钟产出造景
- **复习**：按词状态切换 句子填空 / 整句默写 / 闪卡；**答对也会长鱼**（每 10 次对 → 一条小鱼）；会话结束按错误率扣鱼，但门槛较宽（错 > 55% 才掉小鱼）
- **奖惩**：每 10/20/30/40/60 词产出小鱼/月亮鱼/小丑鱼/海马/水母（脉动漂浮）；小鱼 ≥ 3 条成群游动；番茄钟时长产出海草/海葵/珊瑚；超阈值凝成奖牌
- **3D 海缸**（Three.js）：低多边形玻璃缸 + 沙底 + 默认造景；鱼按库存游动，OrbitControls 拖拽 360° 旋转/缩放、自动旋转
  - **观赏模式**：隐藏面板、海缸铺满屏幕
  - **布置模式**：拖动缸里的造景（岩石/海葵/珊瑚/海草）重新摆放，位置本地保存
  - **GLB 替换**：鱼 / 造景 / 整个缸子都能上传 Fab 的 `.glb`（自动按包围盒缩放）替换占位模型；上传的鱼会播放模型自带动画、保持直立朝游动方向（适配海马等竖直造型），可一键转 90° 调朝向；登录后模型经 Supabase Storage 跨设备同步
  - **配色**：水色 5 选 1、沙色 4 选 1
  - **氛围**：上升气泡、沙底动态焦散
  - **点鱼说话**：点一下缸里的鱼，它头顶冒出一个跟随游动的气泡，念一句随机的已学例句；点别的鱼气泡就转移过去
- **AI 速记富化**：在「词库」页填入自己的 LLM API key（仅存本机），速记新词即自动补音标 / 释义 / 例句；支持 OpenAI 兼容接口（OpenAI / OpenRouter / DeepSeek / Moonshot…）
- **跨设备同步**（Supabase）：在「词库」页填 Project URL + anon key、邮箱登录，进度改动后自动上传，换设备登录同一账号即同步（按时间戳「最后写入获胜」）
- **界面主题**：纸 / 夜 / 海 / 暮 / 抹茶 五套配色，本地记忆
- **音频**：Web Audio 合成的环境音（深海白噪 + 缓慢和声垫 + 气泡 / 水流）；反馈音用于答对 / 答错、新生物诞生、番茄结束、整套掌握；可**上传自己的音频做循环 BGM**（仅存本机）；没上传时播放**内置的轻柔原创旋律**（五声音阶、缓慢、零版权）。各路独立开关 + 音量，设置本地持久化
- **套级掌握**：每 50 词为一套，正确率 ≥ 90% 升级为整句默写

详见 [`DESIGN.md`](./DESIGN.md) §8 的版本路线图。下一步：v0.2 3D 鱼缸、v0.3 Drive 云同步、v0.4 AI 富化接线。

## Stack

- **Vite 5** + **React 18** + **TypeScript 5**
- **Zustand** + `persist` 中间件做状态管理
- **localforage**（IndexedDB）持久化
- **Three.js r160** —— 3D 海缸（玻璃缸 / OrbitControls / GLTFLoader 加载 .glb）
- 可选 Google Drive OAuth 同步（`src/lib/drive-sync.ts`，待接线）
- 可选 LLM 速记富化（`src/lib/llm-enrich.ts`，配置 `VITE_LLM_*` 后启用）

## Layout

```
.
├── index.html                # Vite 入口
├── package.json
├── vite.config.ts
├── tsconfig.json
├── DESIGN.md                 # 完整设计策划案（产品规格）
├── MIGRATION.md              # legacy HTML → TS 的逐函数映射
├── src/
│   ├── main.tsx              # ReactDOM 渲染 + 样式入口
│   ├── App.tsx               # 顶层布局：侧栏面板 | 鱼缸
│   ├── styles.css            # 全局样式
│   ├── types.ts              # 数据模型 + 阈值常量
│   ├── store.ts              # Zustand store：奖励/惩罚/学习/复习/掌握逻辑
│   ├── lib/                  # text / speech / sentence / icons / audio / drive-sync / llm-enrich
│   ├── data/
│   │   └── vocab-scholar-set1.json   # 31 个学术起始词条
│   └── features/
│       ├── learn/            # 四步学习 + 整组测验 + 速记
│       ├── review/           # 填空 / 默写 / 闪卡复习
│       ├── pomodoro/         # 番茄钟
│       ├── species/          # 物种库存
│       ├── audio/            # 声音设置（环境音 / 反馈音开关 + 音量）
│       ├── vocab/            # 词库导入 / 进度管理
│       ├── cosmetics/        # 背景 / 物种形象自定义
│       └── aquarium-2d/      # Canvas 2D 鱼缸引擎
└── legacy/
    ├── cihai-2d.html         # 原始 2D 版（行为参照）
    ├── cihai-3d-preview.html # 3D 鱼缸原型（视觉参照）
    └── *.md                  # 原设计文档与部署指南
```

## Getting started

```bash
npm install
npm run dev
# open http://localhost:5173
```

构建与检查：

```bash
npm run typecheck   # tsc --noEmit
npm run build       # tsc -b && vite build  → dist/
npm run preview     # 预览生产构建
```

## AI 富化（可选）

**推荐**：直接在 app 的「词库」页 → 「AI 速记富化」里选服务商、填 API key（只存你本机浏览器，不进代码、不上传），保存即用。支持 OpenAI 兼容接口（OpenAI / OpenRouter / DeepSeek / Moonshot）。浏览器直连个别服务商可能被 CORS 拦截，OpenRouter 最稳。

本地开发也可用 `.env`（复制 `.env.example`）：

```
VITE_LLM_ENDPOINT=https://api.openai.com/v1/chat/completions
VITE_LLM_API_KEY=sk-...
VITE_LLM_MODEL=gpt-4o-mini
```

> 公开站点不要把 key 写进构建。若要隐藏 key，用一个薄代理（Cloudflare Worker / Vercel Edge）
> 转发请求、把 key 留在服务端。`src/lib/llm-enrich.ts` 文末有示例。

## Deployment

- **静态 web**（推荐先做）：`npm run build` 产出 `dist/`，部署到 GitHub Pages / Netlify / Cloudflare Pages。`vite.config.ts` 已用相对 `base`，无需子路径配置。
- **桌面 / 手机 app**（v1.0+）：用 [Tauri](https://tauri.app)（桌面）或 [Capacitor](https://capacitorjs.com)（iOS/Android）包壳。

## License

**保留所有权利 (All rights reserved)** — 见 [`LICENSE`](./LICENSE)。
源码可见 ≠ 允许复制、修改、分发或商用；未经授权请勿照搬。
（个人自用、学习参考没问题。）
