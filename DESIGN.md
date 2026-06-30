# 词海 · 完整设计策划案

> A vocabulary study app structured as a slow-living virtual aquarium.
> 一份给开发者用的产品规格——足够你接手实现，不需要再来问我"上下文"。

---

## 0. 写作约定

- "用户"指最终学习者（你自己）。
- 所有"必须"是产品定义的硬约束；"建议"是出于体验的强偏好；"可选"是 v2+ 的扩展。
- 中文术语保留原文以避免翻译漂移：**鱼缸 (aquarium)**、**词海 (cihai/the app itself)**、**奖牌 (medal)**、**速记 (quick capture)**。

---

## 1. 愿景

词海是一个**反 Duolingo** 的背单词工具。Duolingo 用排行榜、连续天数、推送通知制造焦虑；词海借鉴 **Forest** 的克制美学：把每一次记住的单词转化为鱼缸里一只缓慢游动的生物。鱼缸常驻屏幕一角，用户可以**只是看**而不学，但当用户决定学时，每一个被牢记的词都会让鱼缸更生动。

核心情绪：**安静、缓慢、连续**。任何会让用户产生"被监督感"或"被惩罚感"的设计都应被回避——惩罚以"鱼暂时离缸 24 小时"的形式存在，而非"-10 分"或弹窗警告。

视觉方向：**低多边形 3D + 柔和色调**。氛围接近游戏 *Abzu*、*Endling*、*Spiritfarer* 的水下段。

---

## 2. 核心循环

### 2.1 单词级（per word）

每一个未学的词走完**四步**才算"已学 (learned)"：

1. **熟悉** — 一页展示：单词、IPA 音标、点击播放发音、词形变化（时态/派生）、中文释义、语境标签（如"phenomenology" / "academic hedge"）、备注、若干例句（英中对照，目标词用浅色背景高亮）。用户点"已熟悉"进入下一步。
2. **句子配对** — 若该词有 ≥2 个例句：左右两列分别打乱英文与中文，用户连线配对。错误时抖动 + 红边，正确时变浅并锁定。
3. **选词成句** — 把所有例句的英文词打乱放在顶部"词袋"，下方按例句顺序显示中文翻译 + 空白横线槽。用户从词袋点词填入对应位置，"检查"按钮判定。槽位错误时高亮红底，可点已填的槽把词送回袋中。
4. **默写单词** — 自动播放发音，屏幕显示中文释义。用户在输入框写单词。回车提交，错则提示首字母再试。

### 2.2 组级（per 10 words）

10 个词完成四步后，进入**英中拼配测验**：

- 左侧"词袋"：10 个英文词打乱
- 右侧 10 行：每行是中文释义 + 横线槽
- 用户点词、点槽，把英文词放到对应中文位置
- "交卷"判定，结果计入 today.attempts / today.correct

紧接着是**3 句默写小测**：

- 从这 10 个词的所有例句中随机抽 3 句
- 每句：上方中文，下方英文（目标词被挖空为 `_____`），输入框
- 一次提交判定，错误显示正确答案，1.2 秒后进入下一句

10 词 + 整组测验 + 3 句默写 = 一组完成。

### 2.3 套级（per 50 words）

每 50 个词构成一个**词库套**。

- 用户在该套所有词都已学 (`learned: true`) 且**复习正确率累计 ≥ 90%** 时，该套被标记为 `mastered: true`
- 该套内的所有词进入**整句默写模式**：复习页改为"上方中文，下方空白文本框，用户写出整句英文"，按词比对，≥90% 正确率算通过
- 给用户一个 toast：「第 N 套词已掌握，复习升级为整句默写」

### 2.4 复习

复习页不显示未学词。两种模式按词的状态切换：

| 词状态 | 复习方式 | 通过判定 |
|---|---|---|
| `learned=true, mastered=false`, 有例句 | **句子填空**：随机一句，目标词位置挖空 | 用户输入正确则通过；3 次机会用完算错 |
| `mastered=true`, 有例句 | **整句默写**：仅显示中文，用户写整句 | 与原句按 normalize 后逐词比对，≥90% 通过 |
| `learned=true`, 无例句（用户简单格式录入的） | 闪卡：正反翻转，自报"记得 / 忘记" | 用户主观判定 |

每个会话结束（用户点"结束本次会话并结算"）触发**鱼缸惩罚结算**（详见 §3.3）。

### 2.5 速记新词

用户在学习页顶部的输入框敲入英文词、回车，立刻：

1. 词条入库，状态 `enrichmentStatus: "loading"`
2. 后台调用 LLM（建议 Claude Haiku 或 GPT-4o-mini 等廉价模型）补全：phonetic / meaning / forms / context / 2 个带中译的例句，返回严格 JSON
3. 收到响应后填入字段，状态改为 `"done"`
4. 若 LLM 不可用或失败，状态改为 `"failed"`，用户可手动补释义

用户应能持续追加，每凑 10 个未学词便可"开始一组"。

---

## 3. 鱼缸 / 奖惩

### 3.1 物种与数值

#### 词汇产出（游动生物）

| 阈值 | 物种 | 行为 |
|---|---|---|
| 每 10 词 | 小鱼 (smallFish) | 成群游动（鸟群算法/Boids 简化版） |
| 每 25 词 | 月亮鱼 (moonFish) | 缓慢独行，偶尔上下飘 |
| 每 50 词 | 小丑鱼 (clownfish) | 优先朝最近的海葵游去，停靠时左右摆动 |
| 每 100 词 | 大鱼 (bigFish) | 缓慢、独立、徘徊式游动 |
| 每 200 词 | 海龟 (turtle) | 偶尔出现，最慢、最大，斜向漂浮 |

#### 时长产出（造景）

通过番茄钟（默认 25 分/番茄）累计专注分钟数：

| 阈值 | 物种 | 位置 |
|---|---|---|
| 每 20 分钟 | 海草 (seaweed) | 沙底，随机位置 |
| 每 40 分钟 | 海葵 (anemone) | 沙底，靠岩石分布 |
| 每 60 分钟 | 珊瑚 (coral) | 沙底，造型分枝 |

### 3.2 转化（防止鱼缸装不下）

每达阈值自动凝成奖牌存入鱼缸下方奖牌架（每次转化产出一枚奖牌）：

| 物种 | 阈值 → 留 | 备注 |
|---|---|---|
| 小鱼 | 50 → 25 | 移除 25 条 + 奖牌 |
| 月亮鱼 | 15 → 5 | 移除 10 条 + 奖牌 |
| 小丑鱼 | 10 → 5 | 移除 5 条 + 奖牌 |
| 大鱼 | 4 → 1 | 移除 3 条 + 奖牌 |
| 海草 | 20 → 5 | 移除 15 株 + 奖牌 |
| 海葵 | 10 → 5 | 移除 5 株 + 奖牌 |
| 珊瑚 | 8 → 2 | 移除 6 株 + 奖牌 |

海龟无转化（数量永远 0–N 累计）。

### 3.3 复习扣鱼

会话结束时按本次错误率（错题数 / 总题数）执行扣除：

| 错误率 | 扣除 |
|---|---|
| > 20% | -1 小鱼 |
| > 35% | -1 月亮鱼 |
| > 40% | -1 小丑鱼 |
| > 60% | -1 大鱼 |

被扣的鱼"暂时离缸"。24 小时内同一批词重复复习达标（错误率不超阈值）则归还；否则永久消失。

> v1 简化版可以先实现"立刻消失"，24 小时再生机制放到 v2。

---

## 4. 数据模型

### 4.1 词条

```typescript
type Vocab = {
  id: number;
  word: string;              // 单词或短语
  phonetic: string;          // IPA，如 "/ɪˈfemərəl/"
  meaning: string;           // 中文释义（含词性）
  forms: string;             // 变形/派生，如 "ephemerally (adv.); ephemerality (n.)"
  context: string;           // 短标签，如 "phenomenology" / "academic"
  note: string;              // 长备注（学术用法说明）
  sentences: { en: string, zh: string }[];
  // 学习状态
  learned: boolean;          // 完成四步学习
  known: number;             // 复习正确累计
  miss: number;              // 复习错误累计
  mastered: boolean;         // 所在 50 词套已 ≥90%，升级为整句默写
  // 速记状态
  enrichmentStatus?: "loading" | "done" | "failed" | "minimal";
};
```

### 4.2 鱼缸库存

```typescript
type Inventory = {
  smallFish: number; moonFish: number; clownfish: number; bigFish: number; turtle: number;
  seaweed: number; anemone: number; coral: number;
  medals: { type: string; label: string; n: number }[];   // 奖牌历史

  // 24h 离缸队列（v2）
  pending?: { type: string; releaseAt: number; words: number[] }[];
};
```

### 4.3 完整状态

```typescript
type State = {
  vocab: Vocab[];
  inv: Inventory;
  today: { date: string; learnedToday: number; attempts: number; correct: number; minutes: number };

  // 奖励触发桶（避免每次重算阈值）
  rewardBuckets: { ten: number; twentyFive: number; fifty: number; hundred: number; twoHundred: number };
  timeBuckets:   { twenty: number; forty: number; sixty: number };

  // 会话上下文
  learnSession: LearnSession | null;
  reviewSession: { attempts: number; correct: number };

  // 视觉自定义
  cosmetics: {
    background: string | null;     // base64 data URL 或 GLB 文件引用
    creatures: { [type: string]: string | null };
    palette: { water: number; sand: number };
  };

  // 云同步元数据
  _syncedAt?: string;
  _device?: string;
};
```

### 4.4 vocab 库的简单与富格式

简单（每行一个）：

```
word | 中文释义
```

富（JSON 数组）：

```json
[
  {
    "word": "ephemeral",
    "phonetic": "/ɪˈfemərəl/",
    "meaning": "adj. 短暂的；瞬息的",
    "forms": "ephemerally (adv.); ephemerality (n.)",
    "context": "literary",
    "note": "可与 transient / fleeting 互换，但 ephemeral 更书面化。",
    "sentences": [
      { "en": "Her joy was ephemeral, fading with the dawn.", "zh": "她的喜悦是短暂的，随黎明一同消散。" },
      { "en": "All beauty is in some sense ephemeral.", "zh": "一切美在某种意义上都是短暂的。" }
    ]
  }
]
```

---

## 5. 技术栈推荐

### 5.1 应用形态

| 形态 | 推荐 | 备注 |
|---|---|---|
| **桌面 app** | Tauri + React | Rust 后端、体积 < 5 MB、跨平台、原生菜单 |
| **手机 app** | Capacitor + React | 同一份 React 代码包成 iOS / Android，调用原生通知 |
| **web 备份** | 同一份 React 源码出 PWA | 给非主力设备做兜底 |

> 若你只想一开始快速做 web，可以先纯 React + Vite + Cloudflare Pages 起手，后续再用 Tauri/Capacitor 包壳。

### 5.2 3D 引擎

- **Three.js** （建议 r150+），低多边形 + 物理材质 (`MeshPhysicalMaterial`) 模拟玻璃缸
- **GLTFLoader** 加载用户从 Fab / Sketchfab 下载的 .glb 模型
- **OrbitControls** 实现拖动旋转视角；锁定 `minPolarAngle` 避免从底部穿模
- 自动旋转默认开启（autoRotate, speed 0.4–0.8），用户聚焦时停下

### 5.3 后端 / 同步

**最小可用方案**：

- 客户端单机 + 用户自己的 Google Drive（OAuth2 `drive.file` scope）
- 每次状态变化进入 8–10 秒防抖窗口，停顿/暂离时推送 `Cihai/cihai-state.json`
- 启动时拉取并按 `_syncedAt` 比较，云新则提示覆盖本地

**更专业方案**（v2）：

- Supabase（PostgreSQL + Auth + Realtime）
- 用 Supabase Auth 直接 Google 登录，state 表存 JSONB
- Realtime 订阅实现多设备实时同步

### 5.4 AI 富化

用 OpenAI / Anthropic 任一便宜模型（GPT-4o-mini 或 Claude Haiku）。系统提示词模板：

```
Given the English word or phrase: "{WORD}"
Return ONLY a valid JSON object (no prose, no markdown fences). Schema:
{
  "phonetic": "IPA in slashes, e.g. /ɪˈfemərəl/",
  "meaning": "Chinese meaning with part of speech, e.g. adj. 短暂的",
  "forms": "common variations (tense, comparative, derivatives) separated by '; ' — or '—' if none",
  "context": "short usage register tag, e.g. literary / academic / casual / philosophical",
  "sentences": [
    { "en": "...", "zh": "..." },
    { "en": "...", "zh": "..." }
  ]
}
Sentences must be authentic and varied. Chinese translations should be natural, not literal.
```

费率：单词富化约 200–400 tokens 输入 + 300 tokens 输出 ≈ ¥0.001 / 词。100 词月预算约 ¥0.10。

可选：允许用户在速记时附"领域提示"（如"现象学" / "后殖民"），让 AI 按语境产出更贴的例句。

---

## 6. 视觉规格

### 6.1 鱼缸

- 玻璃箱：`BoxGeometry(8, 5, 5)`，`MeshPhysicalMaterial` (transmission: 0.95, opacity: 0.15, roughness: 0.05)
- 黑色细边框（`EdgesGeometry` + `LineBasicMaterial`，opacity 0.45）暗示玻璃边
- 沙底：`BoxGeometry(7.9, 0.5, 4.9)` 顶面用顶点位移做轻微起伏，`MeshStandardMaterial` flatShading
- 水面：薄半透明 plane 紧贴顶部，slight ripple via `position.y += sin(time)`
- 默认相机：`PerspectiveCamera(40)`，位置 (8, 5, 11)，target (0, 0.5, 0)

### 6.2 配色

水色面板（5 选 1）：

| 名 | 色值 |
|---|---|
| 浅青 (默认) | `#b8dcd8` |
| 深青 | `#6ba6a3` |
| 浅蓝 | `#a5cce0` |
| 深蓝 | `#3a78a5` |
| 暮色 | `#4a5d8a` |

沙色面板（4 选 1）：

| 名 | 色值 |
|---|---|
| 暖沙 (默认) | `#c8a874` |
| 米沙 | `#e8d3a3` |
| 贝壳 | `#ddcdb0` |
| 黑沙 | `#3a342c` |

UI（侧栏）色调与 2D 版一致：bg #f3efe7, paper #fbf8f2, ink #2a2620, accent #6b8e7f。

### 6.3 物种模型

每个物种支持：

- **占位**：程序生成的低多边形几何（cone / sphere / cylinder 组合）
- **替换**：用户上传 .glb 后替换，自动按 bounding box 缩放到目标尺寸

**推荐目标尺寸**（世界坐标单位）：

| 物种 | 最大维 |
|---|---|
| 小鱼 | 0.4 |
| 月亮鱼 | 0.7 |
| 小丑鱼 | 0.5 |
| 大鱼 | 1.0 |
| 海龟 | 1.4 |
| 岩石 | 1.2 |
| 珊瑚 | 1.5 |
| 海葵 | 0.9 |
| 海草 | 1.5 |

模型来源建议：[fab.com](https://fab.com) 搜索关键词 `stylized aquarium` / `low poly fish` / `coral low poly` / `clownfish stylized`，过滤"免费"和"低多边形"。

### 6.4 行为

| 物种 | 行为 |
|---|---|
| 小鱼 | Boids（聚拢 + 对齐 + 分离），目标速度 0.3–0.5 单位/秒 |
| 月亮鱼 | 随机游走 + 缓慢 y 轴飘动 |
| 小丑鱼 | 找最近的海葵，靠近时（距离 < 0.5）原地左右摆动 |
| 大鱼 | 缓慢随机游走，速度 0.1–0.2，转向极慢 |
| 海龟 | 最慢；偶尔上浮接近水面，再下沉 |
| 海草 | 顶点摇摆动画（sine wave，幅度 ~0.05 单位） |
| 海葵 | 触手缓慢摇曳（每根触手独立 sine） |
| 珊瑚 | 静态，无动画 |

所有鱼的尾鳍/鳍均做轻微 sine 摆动（频率 0.5–2 Hz），强度按物种调，大鱼最稳。

### 6.5 鱼缸约束

- 所有游动生物的位置必须在玻璃箱内部边界 0.7 单位的"安全区"内，撞边反弹
- 装饰物（鱼草/海葵/珊瑚/岩石）必须贴沙底
- 海葵之间留间隔，避免遮挡

---

## 7. 音频规格

**两套系统并行，独立开关**：

### 7.1 环境音

- 深海低频白噪声循环（5–10 秒无缝 loop）
- 偶尔气泡声（每 8–20 秒随机一次）
- 偶尔水流声（每 30–60 秒）
- 整体音量默认 30%，可调

资源建议：[freesound.org](https://freesound.org) 搜 "underwater ambience" / "bubbles" CC0 协议的剪辑。

### 7.2 学习反馈

| 事件 | 音效 |
|---|---|
| 正确（填空/默写） | 一声清亮短钟（~600 ms） |
| 错误 | 一声柔和闷响（~300 ms），不刺耳 |
| 新生物诞生 | 单声温暖泛音（~800 ms），不同物种用不同基频 |
| 番茄结束 | 三声渐弱钟声 |
| 整套词掌握 | 一段约 2 秒的和声 |

建议用 **Web Audio API** 生成（OscillatorNode + GainNode envelope），避免捆绑音频文件；或预录短音频用 base64 内嵌。

整体音量默认 60%，可调，可静音。

---

## 8. 实现阶段建议

### v0.1 — 单机 web（一周）

- React + Vite + 单页应用
- 完整学习/复习闭环（不含 AI 富化、不含 3D）
- 2D 鱼缸（Canvas / SVG 都行）
- localStorage 持久化

### v0.2 — 3D 鱼缸（两周）

- 引入 Three.js
- 低多边形占位物种
- OrbitControls 拖动
- 玻璃缸 + 沙底 + 水面

### v0.3 — 云同步（一周）

- Google OAuth + Drive API
- 8 秒防抖推送，启动拉取，冲突由时间戳裁决

### v0.4 — AI 富化（半周）

- 速记输入接 LLM API
- 加载状态、失败兜底、领域提示

### v0.5 — 模型替换 + 音频（一周）

- GLB 上传替换占位物种
- 环境音 + 反馈音

### v1.0 — 打包成 app（一周）

- Tauri 桌面
- Capacitor 手机
- 应用图标、启动画面

---

## 9. 已知坑

1. **vocab 中文字符串里嵌引号会破语法**——用中文「」或全角""，绝不要在 JS 字符串里嵌 ASCII `"`
2. **Drive API 无 update**——只能 create_file 后多文件累积，按 modifiedTime 取最新
3. **GLB 模型方向不统一**——加载后用 bounding box 判断主轴，必要时旋转使头部对齐 +X
4. **OAuth 未验证警告**——测试模式下用户需点 "Advanced → Go to (unsafe)"，正式需走 verification
5. **Three.js 在 Cowork artifact 内不可用**——CDN 沙盒只放行 chart.js/gridjs/mermaid，所以 3D 版只能跑在独立部署

---

## 10. 美学锚点

写代码时遇到选择困惑（颜色？密度？速度？），用以下三句话校准：

1. **"如果 Forest 是一棵慢慢长大的树，词海是一缸慢慢游进生命的水。"**
   动作越慢越好。鱼的速度比直觉里的"该游多快"再慢 30%。
2. **"看 10 分钟也不无聊。"**
   设计任何视觉时问：盯着看半小时会不会烦？会的话减一层。
3. **"不奖励效率，奖励持续。"**
   不显示连续天数，不显示排名。只显示——你的鱼缸里有什么、何时长出。

---

附：本对话沉淀的两个可直接运行的原型：

- `index.html` / `cihai.html` —— 完整 2D 版（含学习全流程、Drive 同步、Cowork+OAuth 双模）
- `cihai-3d-preview.html` —— 3D 鱼缸预览（Three.js，仅展示视觉方向，未接入学习 UI）

第一份词库 JSON：`cihai-vocab-scholar-set1.json`（31 个学术词条，含我做的中文译句和你原表的备注）。
