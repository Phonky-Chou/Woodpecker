# 指代器 · AI HTML 编辑器

把"改网页"从**写代码**变成**指着说**：

> 鼠标变成准星 → 悬停看到元素链 → 按住左键、松开选中 → 用大白话说"标题再大一点，换成深蓝"
> → AI 只改你选中的那一块 → 先预览 → 你说"接受"才存成一个版本 → 随时撤销、重做、回看。

**面向零代码用户**：界面上不出现 `p.lede` 这类代码名，一律说人话 ——
「橙色按钮「预约到店」」「简介文字「每周从 3 个产区空运…」」「首屏大区块」「整个页面」。
代码信息不删除，但降级到 tooltip 与右侧面板的折叠区里。

一句话验收：**连续改三次，能逐级撤销回初始版本，再逐级重做回去。**

> 界面语言优化（R1–R5）的实现与验收映射见 [docs/UI-OPTIMIZATION.md](docs/UI-OPTIMIZATION.md)。

---

## 30 秒上手

**方式一（最简单，不需要命令行）：双击打开单文件版**

```
out/zhidaiqi.html
```

双击即用。默认接的是**离线 Mock 模型**（规则引擎，不联网、不要 key），可以先完整跑通
"选中 → 说人话 → 预览 → 接受 → 撤销 → 回看"这条链路。

**方式二（接真实模型，推荐）**

模型 key 放在本机服务里，浏览器完全不接触 key：

```powershell
$env:ZHI_API_KEY="sk-你的key"
$env:ZHI_BASE_URL="https://api.siliconflow.cn/v1"
$env:ZHI_MODEL="deepseek-ai/DeepSeek-V4-Flash"
node tools/serve.mjs                 # 打开 http://127.0.0.1:5188
```

打开页面 → 右上角 **⚙ 设置** → Provider 选 **本地代理 → 真实模型** → 保存。

> 已实测可用（本机跑过）：SiliconFlow 的 `deepseek-ai/DeepSeek-V4-Flash`，
> 约 2.6s 返回合法 Patch v1；让它"改整页背景"时它会**主动拒绝越界**并说明"只能改选中的元素"。
> DeepSeek 官方端点同理：`ZHI_BASE_URL=https://api.deepseek.com`、`ZHI_MODEL=deepseek-chat`。

其他兼容端点（任何 OpenAI 兼容服务都行）：

| 服务 | ZHI_BASE_URL | ZHI_MODEL 示例 |
| --- | --- | --- |
| 硅基流动 | `https://api.siliconflow.cn/v1` | `deepseek-ai/DeepSeek-V4-Flash` |
| DeepSeek 官方 | `https://api.deepseek.com` | `deepseek-chat` |
| 本地 Ollama（无需 key） | 页面设置里选 Ollama：`http://localhost:11434/v1` | `qwen2.5:7b` |

---

## 指代器开关：页面什么时候能点、什么时候不能点

顶栏左侧那个**「指代器已开启」药丸**就是开关（也可以按 `P`）。它的行为是**非此即彼**的：

| 状态 | 鼠标/键盘的去向 | 用它能做什么 |
| --- | --- | --- |
| **指代器已开启**（默认） | **只属于指代器**。页面自身收不到任何输入：绑在元素、容器、`document`、`window` 上的点击/按键监听全都收不到 | 悬停看"这是哪一块"、按住左键选层级、让 AI 改；**不会误触发页面自己的交互** |
| **指代器已关闭** | **完全交给页面**。指代器一个事件都不拦 | 正常使用导入的 HTML：翻页、切标签、点按钮、演示动画… |

为什么非要如此：导入的 HTML 常常自带交互。比如 reveal.js 风格的演示页把"鼠标左键"和"方向键"绑成翻页 ——
如果指代器不隔离，你按下左键想选元素，页面却先翻了一页，元素跟着换掉，根本没法改。

**实现上做了两层**（`bridge.mjs`）：

1. **全屏透明隔离层**：指代器开启时在页面里铺一层 `position:fixed; inset:0` 的透明元素，
   事件目标直接落在它身上 —— 页面元素既拿不到事件，也不会进入 `:hover` 状态；
   滚轮仍会转发给页面，所以**开着指代器照常能滚动**。
2. **window 捕获阶段守卫**：掐断事件传播，页面绑在容器 / `document` / `window` 上的监听也收不到。

> 顺序很关键：指代器自己的监听也在 `window` 捕获阶段，且**注册在守卫之前**
> —— 于是顺序是"指代器先处理 → 守卫再掐断"。
> 若把守卫放在 `document` 而指代器留在 `window`（或反过来），守卫会连指代器一起冻住。
> 这一条有专门的回归测试守着。

**指代器开启时键盘被冻住，但应用自己的快捷键不受影响**：`Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+S`
会由 iframe 转发给父窗口执行（撤销 / 重做 / 手动存版本）。

---

## 四步验收（对应"分阶段下指令"，每步都可验证）

| 步骤 | 怎么验 |
| --- | --- |
| **1. 接模型，返回结构化 JSON** | 选中元素 → 输入需求 → 按 F12 看控制台：`[zhidaiqi] 模型返回原文` 与 `[zhidaiqi] 解析后的 Patch v1`。输入框上方会出现"改动预览"卡，列出每条操作。 |
| **2. 预览 / 接受 / 取消** | 预览卡出现时页面上已经是改动后的样子；点**取消** → 元素 `outerHTML` 逐字节还原；点**接受并保存版本** → 右上角版本号 +1。 |
| **3. 撤销 / 重做** | 连续改三次 → 连按 `Ctrl+Z` 三次逐级回到初始版本 → `Ctrl+Shift+Z` 逐级重做回去。 |
| **4. 历史回看** | 右侧切到**版本历史** → 每条显示时间、来源、改动摘要、体积 → 点"回看并还原"跳回那一版；还原后**继续选中同一元素仍然有效**（锚点没漂）。 |

**选择界面不会消失**：在页面上**按住左键**弹出候选层级，**松开鼠标后这个界面会留在页面上**变成
"已选中工具条"，可以慢慢点 `✦ 让 AI 改这块` / `✎ 改名` / `复制选择器` / `✕`；
按住时把鼠标移到工具条上它会立刻"钉住"不再乱动。按 `Esc` 或点 `✕` 收起。

**一键自检**：顶栏 **更多 ▾ → 🧪 页面内自检** 会在真实浏览器里跑完整套验收清单（27 项），结果弹窗展示，
跑完自动把工作区还原到你自检前的那一版。**这是最推荐的第一次验收动作。**

---

## 它是怎么做的（关键设计）

```
父窗口（编辑器外壳）
├── 顶栏：导入 / 导出 / 导入导出工程 / 撤销 / 重做 / 重置 / 自检 / 设置
├── 舞台：iframe（用户 HTML） + 覆盖层（高亮框、环绕泡泡、提示）
└── 侧栏：AI 对话（选区卡 / 对话 / 改动预览卡） · 版本历史
        │  postMessage RPC（带 token，请求-响应配对，超时兜底）
        ▼
iframe 内（只有"能力"，没有决策）
   anchor.mjs   data-pid 稳定锚点
   picker.mjs   命中测试 / 元素链 / 悬停与选中
   patch.mjs    结构化 patch 执行器（唯一能改用户 DOM 的地方）
   bridge.mjs   能力表 RPC
```

四个"防翻车"决定，对应最容易踩的四个坑：

1. **锚点用结构哈希，不用随机 id。**
   `data-pid = hash(祖先路径 + 同级序号)`，同一份 HTML 每次打开得到**同一套 pid**，
   模型说"改 p-1a2b3c4d"跨会话依然指向同一个元素。
   **撤销/还原按快照记录的 pid 原样写回，不重算**（有回归测试守着：`撤销不重算 pid`）。
   前提要说清楚：pid 由结构决定，所以"插入/删除兄弟节点"这类**结构性改动**会让其后兄弟的 pid 变化；
   这是为"跨会话可复现"付出的代价。版本回看/撤销走整页还原也不会漂（有测试）。

2. **AI 只能交 JSON，不能交 HTML。**
   输出必须是 `{version,target,changes:[{op,...}]}`，6 种操作：`setStyle / setText / setAttr /
   setHtml / insertHtml / removeNode`，样式还有属性白名单。整页重写（>50 条改动）直接拒。
   只要不是合法 JSON，就报错并让模型自我修复一次，**绝不把原文当 HTML 用**。

3. **范围是硬边界，越界整单拒绝，且是事务性的。**
   每条 change 的 target 必须落在选中元素子树内；`<script>`、`on*` 属性会被剥离；`data-pid` 永远不许改。
   任何一条不合法 → 整个 patch 拒绝并**回滚已应用的改动**："要么全改、要么一点都不改"。

4. **改动先预览，接受才入栈。**
   撤销靠"受影响子树的属性 + 内容快照"逆序回放，不是靠猜；快照里刻意剥掉 pid，
   避免还原时出现重复锚点。**取消 = 逐字节还原**，包括"插入内容"这类操作
   （插入过的文本节点也会被精确摘掉，有回归测试守着）。
   版本快照存**干净整页 HTML**（无 pid、无编辑器注入），导出即成品。

细节见 [CONTRACT.md](CONTRACT.md)（接口契约：锚点方案 / 输入格式 / JSON schema / 执行器 / 快照结构），
验收证据与已知边界见 [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)。

---

## 目录

```
zhidaiqi/
├── out/zhidaiqi.html              ← 单文件成品（双击即用）
├── out/app.bundle.js, bridge.js   构建中间产物
├── src/                           源码（纯 ESM，零依赖）
│   ├── anchor.mjs                 data-pid 锚点
│   ├── picker.mjs                 指代器核心（命中 / 元素链 / 选中）
│   ├── patch.mjs                  patch 执行器 + 撤销（事务性）
│   ├── schema.mjs                 Patch v1 校验（形状 + 范围）
│   ├── selector.mjs               给模型的上下文（计算样式 + 命中 CSS 规则）
│   ├── provider.mjs               模型接入（mock / server / ollama）
│   ├── systemprompt.mjs           系统提示词 + 输入模板
│   ├── snapshot.mjs               版本快照栈（撤销/重做/回看/导入导出）
│   ├── bridge.mjs                 iframe 内 RPC（能力表）
│   ├── overlay.mjs                父窗口高亮 / 环绕泡泡
│   ├── ui.mjs                     对话、预览卡、版本面板、设置
│   ├── app.mjs                    主编排
│   ├── naming.mjs                 人话命名引擎（弹层/面包屑/面板/AI 上下文共用）
│   ├── selftest.mjs               页面内自检套件（27 项）
│   ├── app.css                    外壳样式（不会写进导出）
│   └── sample.html                示例页
├── tools/
│   ├── build.mjs                  打包成单文件（含依赖闭合 + 接线契约校验）
│   ├── serve.mjs                  开发服务 + 真实模型代理 /api/chat
│   ├── test-naming.mjs            16 项命名引擎测试
│   ├── test-unit.mjs              32 项纯逻辑单测
│   ├── test-dom-smoke.mjs         27 项最小 DOM 真实链路烟测
│   ├── test-app-wiring.mjs        21 项应用级接线测试（在 Node 里跑真正的 EditorApp）
│   ├── test-bundle.mjs            12 项打包产物 + 接线契约校验
│   ├── dom-shim.mjs               测试用的极小 DOM（含 iframe realm，不进产物）
│   └── test-e2e.mjs               可选：真浏览器端到端（需要能起浏览器）
├── docs/ACCEPTANCE.md             验收清单与已知边界
├── docs/UI-OPTIMIZATION.md        界面优化 R1–R5 的实现与验收映射
├── docs/REVIEW.md                 独立对抗式审查报告（含未修复项与未覆盖项）
└── CONTRACT.md                    接口契约（锚点 / 输入输出格式 / 执行器 / 快照）
```

## 命令

```powershell
node tools/build.mjs            # 生成 out/zhidaiqi.html
node tools/build.mjs --watch    # 改源码自动重新构建
node tools/test-naming.mjs      # 16 项 命名引擎（人话名 / 图标 / 快捷词）
node tools/test-unit.mjs        # 32 项纯逻辑
node tools/test-dom-smoke.mjs   # 27 项真实 DOM 链路
node tools/test-app-wiring.mjs  # 21 项应用级接线（真跑 EditorApp + iframe realm）
node tools/test-bundle.mjs      # 12 项打包产物 + 接线契约
node tools/serve.mjs            # 开发服务（含真实模型代理）
```

合计 **108 项**。页面内自检另有 **27 项**（顶栏「更多 ▾ → 🧪 页面内自检」）。

## 快捷键

| 键 | 作用 |
| --- | --- |
| 按住左键 / 松开 | 打开候选层 → 选中元素 |
| ↑ ↓ | 在候选层级间切换 |
| Esc | 取消泡泡 / 取消当前预览 |
| Ctrl+Enter | 发送需求；有预览时 = 接受 |
| Ctrl+Z / Ctrl+Shift+Z | 撤销 / 重做 |
| Ctrl+S | 手动存一个版本 |
| P | 开关指代器 |

## 已知边界（诚实交代）

- **像素级渲染与真实 CSS 级联只能在浏览器里证明。** 开发环境的进程沙箱不允许起浏览器，
  所以自动化的真浏览器端到端（`tools/test-e2e.mjs`）在本机没能跑通；替代方案是
  **页面内自检**（更多 ▾ → 🧪 页面内自检，27 项）+ Node 里的最小 DOM 真实链路烟测（26 项）+ 应用级接线测试（21 项）。
  前者请在浏览器里点一下确认，那是最有说服力的一次验收。
- **app ↔ bridge 的接线正确性由契约测试保证**（`test-bundle.mjs` 会检查 `app.mjs` 调用的每个
  `rpc('op')` 是否真的存在于桥的能力表）。这类错误在纯 Node 测试里不可见——
  开发过程中真的踩过：`rpc('extractHtml')` 与桥里的 `extractCleanHtml` 名字不一致，
  结果 AI 主流程整条断掉。现在它会在构建期就被拦住。
- 版本快照存在浏览器 `localStorage`（上限 4 MB / 最近 40 版，初始版本永不丢弃）。
  超限会自动丢最老的版本并提示导出；重要工作请用"导出工程"。
- 跨域样式表（`<link href="https://...">`）读不到 `cssRules`，模型看到的"命中规则"会少这部分；
  计算样式仍然准确。
- Mock 模型只懂常见指令（大一点/小一点/颜色/间距/圆角/加粗/居中/改文字/删除/插入）。
  它存在的意义是让链路离线可跑、可回归，不是替代真模型。
- 单文件版在 `file://` 下为了可用性**不加 iframe sandbox**（见 app.mjs 的 `frameSandboxAttr`）：
  带 sandbox 的 srcdoc iframe 在 file:// 下属于不透明源，父窗口将无法操作它，指代器会整体失效。
  用 `tools/serve.mjs` 的 http 页面时走 sandbox 隔离，更安全。

## 明确不做

- 不做整页重写式"换皮"、不做多人协作、不做后端数据库。
- 不自动写回本机源文件（浏览器安全限制）；导出 = 下载，需要落盘就用导出工程。
