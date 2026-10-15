# 指代器 AI 编辑器 · 接口契约（阶段 0）

> 本文是"动手写代码之前先说清楚"的产物。任何实现都必须服从本文；
> 改契约 = 改本文 + 通知所有人。对应 `docs/` 里的验收脚本。

## 0. 一句话目标

把"改网页"从"写代码"变成"指着说"：**指着元素 → 说一句话 → AI 只改这一块 → 看着满意再落盘**。

## 1. 系统分层

```
┌─ 父窗口（编辑器外壳 editor shell）───────────────────────────────┐
│  顶部栏：导入 / 导出 / 保存 / 撤销 / 重做 / Provider              │
│  左侧：预览舞台（iframe + 高亮框 + 环绕泡泡）                     │
│  右侧：AI 对话框（选区卡片 / 对话 / patch 预览 / 接受取消）        │
│  右侧：版本历史面板（列表 / 回看 / 还原 / 导出）                   │
│                                                                  │
│   ┌─ iframe（用户 HTML 沙箱，srcdoc，sandbox=allow-scripts …）─┐ │
│   │  anchor.mjs   → data-pid 稳定锚点                          │ │
│   │  picker.mjs   → 命中测试 / 元素链 / 悬停与选中状态           │ │
│   │  patch.mjs    → 结构化 patch 执行器（唯一能改 DOM 的地方）    │ │
│   │  bridge.mjs   → postMessage RPC，只暴露"能力"，不含 UI 决策   │ │
│   └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

**为什么用沙箱 iframe 而不是直接改当前页**：用户 HTML 会带自己的 CSS 与 `<script>`；
放进 iframe 才不会污染编辑器外壳，也才能"整页 HTML 进出"地为快照做序列化。
高亮框与泡泡画在**父窗口覆盖层**里（位置由 iframe 回传的 rect 决定），
这样绝不用往用户页面注入任何样式，避免污染快照。

## 2. 锚点方案（data-pid）

| 问题 | 决定 |
| --- | --- |
| 注入时机 | **导入时全量惰性注入**：`injectAll(doc)` 首次遍历全文档注入；之后用 `ensure(node)` 兜底。 |
| 唯一 id | **可复现**：`hash(祖先路径 + 标签 + 同级序号)` → `p-<8位>`。同一份 HTML 每次打开得到同一套 pid，模型对元素的指代跨会话稳定。**注意前提**：pid 由结构决定，因此"插入/删除兄弟节点"这类结构性改动会让其后兄弟的 pid 变化——这是设计取舍（换来跨会话可复现）；撤销时则**按快照记录的 pid 原样恢复**，不会重算漂移。 |
| 不重复 | 注入前查 `seen` Set + `querySelector`；用户 HTML 自带重复 pid 时由 `ensureUniquePids()` 统一修复（后出现的重新分配）。 |
| 不丢 | patch 执行器**硬性保护**：任何 `setAttribute` 若 key 为 `data-pid` 或 key 以 `on` 开头 → 直接拒绝；`setHtml` 注入的子树自动重新注入 pid。 |
| AI 能不能改 pid | 不能。见上一行；`changes` 里的 `target` 只能引用 pid，不能产生 pid。 |
| 选择器 | `[data-pid]`；选中态标记 `.picker-selected`（仅存在于 iframe 内，序列化时会被剥掉）。 |

## 3. 发给模型的输入格式（ContextEnvelope v1）

```jsonc
{
  "kind": "zhidaiqi.context",
  "version": 1,
  "target": {
    "pid": "p-1a2b3c4d",
    // 只允许出现在 changes[].target 里的 pid（= 选中元素自身 + 它内部元素的 pid）
    "modifiablePids": ["p-1a2b3c4d", "p-5e6f7a8b"],
    "humanName": "标题「我们怎么烘豆」",   // 用户在界面上看到的名字（模型据此对应"用户说的这块"）
    "elementKind": "heading",
    "selectorPath": "body > main > section#story > h2",
    // 祖先链：**只读上下文**。刻意不提供 pid，避免模型拿它去改然后撞"越界"
    "chain": [
      { "ref": "ancestor-4", "modifiable": false, "tag": "html", "humanName": "整个页面" },
      { "ref": "ancestor-2", "modifiable": false, "tag": "main", "humanName": "整个页面" },
      { "ref": "target", "modifiable": false, "tag": "h2", "humanName": "标题「我们怎么烘豆」" }
    ],
    "outerHtml": "<h2 data-pid=\"p-1a2b3c4d\">我们怎么烘豆</h2>",
    "innerText": "我们怎么烘豆",
    "rect": { "x": 0, "y": 0, "w": 640, "h": 48 },
    "computed": { "font-size": "22px", "color": "rgb(31,41,55)", "...": "…" },
    "matchedCssRules": [ { "selector": "#story h2", "cssText": "font-size: 22px;", "origin": "…" } ],
    "childCount": 0
  },
  "request": "我希望这段文字下面有垫色块，字体和色块颜色对比明显",
  // 上一次被拒时的反馈（越界自愈用）：告诉模型"你能用哪些 pid"以及为什么被拒
  "retry": { "error": "改动越界：setStyle 想改 p-xxx，但它不在当前选中元素范围内", "allowedPids": ["p-1a2b3c4d"] },
  "history": [ { "role": "user", "text": "…" }, { "role": "assistant", "text": "…" } ]
}
```

**为什么祖先不给 pid（重要）**：早期版本把祖先的 `pid` 也放进了上下文，
模型看到"给这段文字加垫色块"这类需求时会顺手引用祖先的 pid（想加在外层容器上），
结果必然撞"改动越界"、整单被拒，用户只看到一句错误——**功能像坏了一样**。
现在祖先只给 `ref` 并标注 `modifiable: false`，同时给出 `modifiablePids` 白名单。

**越界的三层防护**（见 `docs/UI-OPTIMIZATION.md` 第三轮）：

1. **预防**：只提供可用的 pid（上一条）；
2. **自愈**：真的越界时，父窗口把「被拒原因 + 可用 pid 白名单」回喂给模型，自动重新生成一次
   （提示词里明确要求"改用选中元素自身能实现的方式满足需求"）；
3. **出路**：自愈仍失败时，弹出可操作卡片：「改选外层容器「大区块」并重试」一键完成。


`outerHtml` 超长截断（默认 24 KB），`computed` 只取白名单属性，
`matchedCssRules` 用 `document.styleSheets` 反查命中的规则（让模型知道"为什么现在是这个样子"）。

## 4. 模型输出格式（Patch v1）——**只认 JSON，不认 HTML 字符串**

```jsonc
{
  "version": 1,
  "target": "p-1a2b3c4d",
  "summary": "标题放大到 48px 并改为蓝色",
  "changes": [
    { "op": "setStyle", "target": "p-1a2b3c4d", "prop": "font-size", "value": "48px" },
    { "op": "setStyle", "target": "p-1a2b3c4d", "prop": "color", "value": "#2563eb" },
    { "op": "setText",  "target": "p-1a2b3c4d", "value": "新标题" },
    { "op": "setAttr",  "target": "p-1a2b3c4d", "name": "class", "value": "hero-title" },
    { "op": "setHtml",  "target": "p-1a2b3c4d", "html": "<b>粗体</b>" },
    { "op": "insertHtml", "target": "p-1a2b3c4d", "position": "before|after|append|prepend", "html": "<p>…</p>" },
    { "op": "removeNode", "target": "p-1a2b3c4d" }
  ]
}
```

字段规则：

- `version` 必须为 `1`；`target` 必须是本次选中元素或其后代（**硬校验，越界即整单拒绝**），
  且**整单是事务性的**：任一条不合法，已应用的改动全部回滚，DOM 回到调用前。
- `changes` 非空数组，单次上限 50 条（防"整页重写"式输出）。
- `setStyle` 的 `prop` 必须在白名单内（布局/排版/颜色/圆角/阴影/变换等），
  `value` 为 CSS 字面量字符串；值以 `!important` 结尾会被拆出来设置 `priority`。
- `setText` 只改文本，不解析 HTML；`setHtml` 才解析 HTML（内部自动重注入 pid）。
- **插入落点规则**（`insertHtml`）：`append`/`prepend` 插到 target 内部；
  `before`/`after` 插成 target 的兄弟。允许的情形只有两种：
  ① 插入点的父节点就是 scope 或 scope 的祖先（落点在选区内）；
  ② target 就是选中元素本身、插入点父节点 = 它的父节点（"在这块旁边加东西"）。
  其余（例如选中卡片里的 `<h3>` 却把节点插到卡片外层）一律拒绝。
  另外 `sanitizeHtmlFragment` 会把 `<script>/<style>/<iframe>/on*` 等剥离，清洗后为空则不产生任何改动。
- 禁止 `op` 之外的自定义字段；未知 `op` → 整单拒绝（不猜、不忽略）。
- 模型若返回 ```json 代码围栏或前后废话，`extractJson()` 负责剥离；剥不出来 → 报错重试，**绝不**把原文当 HTML 用。

## 5. patch 执行器与撤销

`applyPatch(doc, scopeEl, patch) → { applied: [...], inverse: [...] }`

- 先**全量校验**（结构 + 范围 + 属性名黑名单 + 插入落点），任一条不合法 → 抛错，DOM 一个字符都不动。
- **事务性**：改动过程中若某条出错（例如前面的 removeNode 删掉了后面要改的节点），
  已应用的改动会**逆序回滚**，不会留下"改了一半"的页面。
- 逐条应用，同时产出**逆操作**：`setStyle`↔记录旧值（含 old priority）、`setText`↔旧文本、
  `setAttr`↔旧值、`setHtml`↔旧 innerHTML+属性快照、`insertHtml`↔移除**当时插入的那些节点（含文本节点）**、
  `removeNode`↔在父节点原位置插回。逆操作记录的是**受影响子树的属性 + 内容快照**，所以交叉改动
  （同一元素先 setStyle 再 setHtml）也能精确回滚。
- **撤销不重算锚点**：还原时用快照里记录的 pid 原样写回，绝不用"当前结构重新哈希"——
  只要之前有过插入/删除兄弟的操作，重算就会让 pid 漂移。另在撤销后做一次重复 pid 体检。
- `cancel()`：逆序执行 inverse，回到 patch 前状态。`data-pid`、`on*` 永不写入；
  `setAttr(name="style")` 被拒绝（请用 `setStyle`，否则撤销无法精确）。

**预览态** = patch 已应用到 DOM + 变更处加 `.z-preview-flash` 一次性高亮；
**接受** = 序列化 → 压入快照栈；**取消** = 逆操作回滚。

## 6. 快照结构（Snapshot v1）

```jsonc
{
  "id": "s-<ts>-<n>",
  "version": 1,
  "createdAt": 1730000000000,
  "label": "标题放大到 48px 并改为蓝色",
  "prompt": "标题再大一点，换成蓝色",
  "targetPid": "p-1a2b3c4d",
  "patch": { "...": "原始 Patch v1" },
  "html": "<!doctype html>…（干净整页 HTML，已剥 pid / 选择器类 / 注入脚本）",
  "bytes": 12345,
  "parentId": "s-…",
  "source": "initial | ai | manual-edit | rollback"
}
```

- **每次"接受"= 一个快照**；栈式存储，`cursor` 指向当前版本。
- 撤销/重做 = 移动 `cursor` 并把目标快照的 `html` 还原进 iframe（还原后重新注入 pid，所以**选区 pid 依然有效**）。
- 存储：`localStorage`（键 `zhidaiqi/v1/…`），最多保留最近 `MAX_SNAPSHOTS = 40` 个；超出丢最老的，
  但**版本 0（初始版本）永不丢弃**。总量超 4 MB 时提示导出。
- 导出：单个 `.html`（干净页）或 `.zhidaiqi.json`（含全部快照，可再导入继续改）。

## 7. Provider（模型接入）

| provider | 用途 | 说明 |
| --- | --- | --- |
| `mock` | **默认**，离线可跑 | 确定性规则引擎，把自然语言映射成合法 Patch；用来演示与回归测试，不联网。 |
| `server` | 真实模型 | `tools/serve.mjs` 起本地服务，`POST /api/chat` 转发到 OpenAI 兼容端点，key 只存本机（`ZHI_API_KEY` 环境变量或页面设置里填写），浏览器拿不到 key。 |
| `ollama` | 本地模型 | `http://localhost:11434/v1`，无需 key。 |

契约：Provider 必须实现 `generate(context, {signal, onDelta}) → { raw, patch, usage }`，
其中 `patch` 已经过 `validatePatch`。任何 provider 都不允许返回"要直接 innerHTML 的 HTML 字符串"。

## 8. RPC 协议（bridge ↔ 父窗口）

父→子：`hello/injectAnchors/setMode/getElementInfo/getChain/getContext/getNodeHtml/applyPatch/revertPatch/extractHtml/serializeClean/highlight/clearHighlight/select/scrollTo/setPreviewHighlight/evalInPage`
子→父：`ready/pointermove/hover/select/cancel/pickError/response`

- 全部消息带 `__z` 命名空间与 `id`；请求-响应用 `Map<id, {resolve,reject}>` 配对，10 s 超时。
- 子窗口只上报**事实**（rect、pid、chain），所有 UI 决策与模型调用都在父窗口。

## 9. 四步交付与验收标准

| 步 | 内容 | 验收（可验证） |
| --- | --- | --- |
| 1 | 接模型、选中后弹对话框、返回 JSON（先 `console.log`） | 控制台能看到合法 Patch v1；`node tools/test-unit.mjs` 全绿 |
| 2 | patch 执行器 + 预览态 + 接受/取消 | 改完能看见；取消后 `outerHTML` 与改动前逐字节一致 |
| 3 | 接受写版本栈 + 撤销/重做 | 连续改 3 次，能逐级撤销回初始，再逐级重做 |
| 4 | 历史面板可回看/跳转 | 任意版本可还原，还原后还能继续选中同一元素（pid 仍有效） |

## 10. 明确不做（本期）

- 不做多用户协作、不做后端数据库、不做整页重写式"换皮"。
- 不做自动保存到本机文件（浏览器安全限制）；导出=下载，服务端模式的"保存到磁盘"作为可选。
