# 指代器 AI HTML 编辑器 · 对抗式代码审查报告

审查者：对抗式审查子代理（只读代码，未修改 `src/`、`tools/` 任何文件；本文件是本次唯一新建的文件）。
审查方式：逐行阅读 `CONTRACT.md` + `src/*.mjs` + `tools/*.mjs`；对纯逻辑与可构造的 DOM 场景用 `node` + `tools/dom-shim.mjs` 实际运行验证。**未启动浏览器**（按约束）。

---

## 0. 关于"审查期间代码一直在被改动"（必读）

本次审查期间目标仓库被**并发修改**（另一个 agent 在持续写入，`src/`、`tools/` 的 mtime 从 21:34 一直推到 22:03，还出现过 `tools/_probe3.mjs`、`tools/_p4.mjs` 这样的临时探针文件）。

这直接影响结论的可复现性，所以：

* 我最初读到的版本与最终验证的版本**不是同一份**。例如 `patch.mjs` 我最初读到的是"无事务回滚"的 356 行版本（`applyPatch` 中途失败会留下改了一半的页面），21:51 之后被改成带 `try/catch` 全量回滚的版本 —— 该问题**已被并发修改者修掉**，本报告按"当前版本已修复"记录。
* 另一个例子：21:50 的版本里 `app.mjs` 调用 `rpc('extractHtml')`，而 `bridge.mjs` 只暴露 `extractCleanHtml`（未知 op → `E_NO_OP`），预览主流程整条死掉；22:0x 已被改成 `extractCleanHtml`，**同样已修复**。
* 因此下文每条结论都标注了验证状态；**行号以文末"锁定的修订"表格里的 sha256 前 12 位为准**，若文件继续变动，请用每条给出的 grep/命令重新定位，而不要只信行号。

**锁定的修订（两次哈希采样）**

| 文件 | 21:59:29 采样（quiescent 90s） | 22:04 最终验证时 | 备注 |
| --- | --- | --- | --- |
| `src/app.mjs` | 389ED3AC0130 | 389ED3AC0130 | 未再变 |
| `src/bridge.mjs` | 15BCDD469857 | 15BCDD469857 | 未再变 |
| `src/patch.mjs` | 8CFCDD3DDA76 | 5340A5A83CE8 | 仍在改（insertHtml 撤销重写） |
| `src/anchor.mjs` | 0174731C378B→BDB0F8ACA8FF | ED0889913126 | 22:02 新增 `ensureUniquePids` |
| `src/schema.mjs` | DAA5AEE1D227 | DAA5AEE1D227 | 未变 |
| `src/snapshot.mjs` | FA8902762ECE | FA8902762ECE | 未变 |
| `src/provider.mjs` | 6D445EC7965C | 6D445EC7965C | 未变 |
| `src/picker.mjs` | 6C6B1F6858FE | 6C6B1F6858FE | 未变 |
| `src/selftest.mjs` | 350967F8C845 | 350967F8C845 | 未变 |
| `tools/build.mjs` | E4523EEDE90A | E4523EEDE90A | 未变 |
| `tools/serve.mjs` | B4D666C56CCE | B4D666C56CCE | 未变 |
| `tools/dom-shim.mjs` | 0174731C378B | 0174731C378B | 未变 |

最终一批动态验证（F-* 系列）在 **22:04** 跑，即 `patch.mjs=5340A5A83CE8`、`anchor.mjs=ED0889913126`。

> 补充：写报告时再次采样发现 `patch.mjs` 在 22:04 之后**又被改过一次**（`insertHtml` 撤销改成按节点引用回收，`removeNode` 逆条目从约 350 行漂到约 368 行）。因此**本文所有 `patch.mjs` 行号都可能整体漂移十几到几十行**；每条我都同时写了函数名与代码片段，请用片段 grep 定位，行号只作参考（写完本报告时又采样到 `build.mjs`、`selftest.mjs` 在 22:06 各被改过一次 —— §7、§8.6 的结论是对 22:04 前版本的验证）。

---

## 1) 锚点（重复 data-pid / pid 漂移 / `seen` 生命周期 / 快照与 stripPids 交互）

### 1.1 【严重·数据丢失】撤销会重算 pid，凡不是"结构哈希原值"的 pid 一律变号

* 定位：`src/patch.mjs:~148-171`（`restoreElement` 末尾 `anchor.ensure(el)` + `anchor.injectSubtree(el)`）；`src/anchor.mjs:125-151`（新加的 `ensureUniquePids` 用 `computePid(el)-n` 重编号）；`src/anchor.mjs:68-103`（`ensure` 的碰撞后缀）。
* 触发条件：任何一条逆操作走 `restoreElement`（`setText/setAttr/setStyle/setHtml/removeNode/insertHtml` 兜底全都走它），而被还原的子树里存在**非规范 pid** 的元素：
  1. 导入的 HTML 自带 `data-pid`（`ensure` 直接沿用，见 1.3）；
  2. 用户 HTML 自带重复 pid，`injectAll → ensureUniquePids` 给它发了 `computePid(el)-1`；
  3. 曾经因为碰撞被 `ensure` 发过 `p-xxxx-1` 后缀的元素。
* 后果：撤销后该元素拿到的是"按当前结构重算"的新 pid，`data-pid` 变了。于是
  * 快照里记录的 `targetPid`（`app.mjs:573`）与 `picker.selectedPid` 失配；
  * `app.mjs:597-600` 取消预览后用 `scopePid` 重新选中会失败（`select` 返回 null），`cancelPreview` 只打一条 toast，UI 上仍显示旧选区；
  * iframe 内 500ms 看门狗（`bridge.mjs:233-239`）随后发 `selection-lost`。
  即"改动→撤销"之后锚点不再指向同一个元素，与 `CONTRACT.md §2`、`patch.mjs:66-72` 注释里"重算结果与原来一致"的假设相矛盾（该假设只对规范哈希成立）。
* 已验证（node + dom-shim）：
  ```
  [F-... / 早期 V4b] before=<h1 data-pid="p-h1">T<pre data-pid="p-pre">用法: data-pid=abc</pre></h1>
                    after =<h1 data-pid="p-h1">T<pre data-pid="p-1fb67cb0">用法:</pre></h1>
  ```
  同一个测试里还同时暴露了 3.1 的文字被吃掉问题。命令见 §B-4。
* 最小复现思路（真浏览器同样成立）：在 DOM 里手工给某元素写上非规范 `data-pid`（或导入一份自带 `data-pid` 的 HTML），选中它的祖先，发一条 `setStyle`，`cancel()`，再 `resolve(旧 pid)` → null。

### 1.2 【轻微】`seen` 与 `isLiveConflict` 是死代码，注释承诺的保护并不存在

* 定位：`src/anchor.mjs:75-99`。`ensure` 先判 `this.doc.querySelector('[data-pid=...]')`；只有它**没命中**时才会走 `else if (isLiveConflict(pid))`，而 `isLiveConflict` 内部第一件事又是同一个 `querySelector` 并要求 `holder` 非空 —— 该分支恒为 false，不可达。
* 后果：注释（`anchor.mjs:64-66`）宣称"已消失元素的 pid 不继续占名额"，实际这个判定根本没参与；`seen` 实际只是计数器。**不产生重复 pid，也不产生漂移**，属于"注释与实现不符 + 冗余代码"，无行为错误。
* 已验证：把一个文档里不存在的 pid 塞进 `seen` 后 `ensure` 新元素 → 得到规范 pid（无 `-1` 后缀）。
* 检查过的路径：`ensure` / `rescan` / `injectAll` / `injectSubtree` / `stripAll` / `resolve` / `pathKey`（`guard++ < 256` 截断只在 >256 层嵌套时才会让两个不同元素算出同一路径，此时走 1.1 的碰撞后缀路径，仍不会重复）。

### 1.3 【中等】用户自带的 `data-pid` 被信任，但导出/快照时被无条件剥掉

* 定位：`src/anchor.mjs:68-74`（有 `data-pid` 就沿用）；`src/patch.mjs` 的 `scrubEditorArtifacts` 里 `if (el.hasAttribute('data-pid')) el.removeAttribute('data-pid')`（约 129 行）。
* 触发条件：导入一份"自己带 `data-pid`（例如来自别的工具/上一版导出未清理）"的 HTML。
* 后果：运行期沿用用户的 pid（可被"指代"），但**接受改动后的快照/导出里这些 pid 全没了** —— 用户文件里的锚点被编辑器静默删除；同时它们又是 1.1 的漂移源。契约未定义"用户自带 pid"的行为，属于未加防护的取值。
* 已验证：`用户自带 data-pid 运行期保留=p-user 导出时被删=true`。

### 1.4 【严重】`removeNode` 选中 `<html>` 后撤销无法还原（选区最外层是可选的）

* 定位：`src/patch.mjs` 的 `removeNode` 逆条目（约 368 行：`snapshots: [{ pid: anchor.pidOf(parent.nodeType === 1 ? parent : doc.documentElement), html: parent.innerHTML, outer: '' }]` —— `data-pid` 挂在 `documentElement` 上所以能取到，但 `parentPid` 为 null），随后 `el.remove()`（约 373 行），`src/patch.mjs:382+` 的 `undoPatch` 里 `anchor.resolve(snap.pid)` 在元素已脱离文档后返回 null → 直接跳过还原。
* 触发条件：指代器元素链最外层就是 `documentElement`（`picker.mjs:96-106` 的 `chainAt` 会上溯到 `html`；`selftest.mjs:74` 还断言链尾必须是 `html`），用户按住左键选到 `html`，然后说"删掉它"（mock 的 `removeNode` 触发词包含"删掉/删除/去掉/移除"，`provider.mjs:219-221`）。
* 后果：`<html>` 被 `el.remove()` 移出 Document，页面瞬间空白；`cancelPreview`（`app.mjs:588-609`）里 `undoPatch` **不抛错**（`undone` 照常返回），所以 `precise = true`，界面提示"已取消，改动已精确回滚" —— 实际页面已经报废，只有 undo/redo/jumpTo/重新导入才能救。
* 已验证（node + dom-shim）：
  ```
  [F-removeHtml] FAIL removeNode(<html>): 删除后 documentElement 为空=true, undo 后恢复=false
                 (inverse.parentPid=null, snapshot.pid=p-8d1b7c2a)
  ```
* 建议的最小修复方向（供修复者参考，不作为结论）：`applyPatch` 的 scope 校验应显式拒绝 `documentElement`（或 `removeNode` 前拒绝 parent 不是 Element 的情况），并在 `undoPatch` 里对无法解析的父快照给出可观测失败而不是静默跳过。

### 1.5 【中等】`sanitizeHtmlFragment` 与快照之间的 `data-z-*` 交互会把内容整块删掉

* 定位：`src/patch.mjs:30-58`（清洗器**不剥** `data-z-*` 属性）+ `src/patch.mjs:~116-124`（`scrubEditorArtifacts`：带 `data-z-inject` / `data-z-chrome` 的元素**整块 remove**）。
* 触发条件：模型用 `setHtml`/`insertHtml` 塞进 `<div data-z-chrome="1">…</div>`（`schema.mjs:58` 只拦 `setAttr name="data-z-*"`，**不拦 HTML 片段里的属性**）；或用户自己的 HTML 里本来就有这些属性。
* 后果：活 DOM 里有该元素、用户看到并点了"接受"，但快照 html（`app.mjs:566`）里它已经被删掉 → 之后的 undo/redo/jumpTo/导出/工程重开都会缺这一块；"所见即所存"被打破。
* 已验证（node + dom-shim）：`sanitize` 输出里 `data-z-chrome` 原样保留；`scrubEditorArtifacts` 把该元素整块删除，普通元素保留。
* 复现：`PA.sanitizeHtmlFragment(doc,'<div data-z-chrome="1">AI</div>')` → 属性仍在；`PA.scrubEditorArtifacts(doc.documentElement.cloneNode(true),'html')` → 该 `div` 消失。

### 1.6 【轻微】`stripPids` 是纯正则，会吃掉正文里的 `" data-pid=..."`

见 §3.1（同一根因，落在撤销精确性条目里，因为它直接破坏"逐字节还原"）。

---

## 2) 范围越界（`validatePatchScope` 与 `applyPatch` 内部二次检查是否等价 / 插入点 / 删除 scope）

### 2.1 两条 target 检查在语义上等价（未发现可绕过的 target 路径）

* 定位：`src/patch.mjs` 的 `validatePatchScope(patch, (pid) => …)`（约 234-237 行，前置全量范围校验）与循环内的 `if (!scope)` / `if (el !== scope && !scope.contains(el))`（约 247-261 行，二次检查）。
* 结论：两者都通过 `anchor.resolve(pid)`（`anchor.mjs:154-157`，`querySelector` 文档序第一个）判定，差别只有前置检查里的 `pid === scopePid` 捷径与循环里 `el !== scope && !scope.contains(el)`：
  * 若 scope 的 pid 被重复持有（只有用户自带重复 pid 才可能，且 `injectAll` 现在会 `ensureUniquePids` 修掉），前置检查可能放行而循环内检查抛 `E_PATCH_OUT_OF_SCOPE`；此时**事务回滚生效**（已验证 F/V7 系列），最终结果是"整单拒绝 + DOM 零改动"，不会改到范围外的元素。
  * 我尝试的"scope 自身被 removeNode 删除后再改它的兄弟"这条路径**被前置检查直接拦下**（兄弟不在 scope 内 → `E_PATCH_OUT_OF_SCOPE`，DOM 逐字节未变，已验证）。"再改它的后代"会命中 `E_PATCH_TARGET_MISSING`（后代随 scope 一起被删），同样回滚。
* 已验证（node + dom-shim）：
  ```
  [V7a] removeNode(scope)+再改它        -> E_PATCH_TARGET_MISSING  DOM未变=true
  [V7b] 含越界 target(兄弟/祖先外)      -> E_PATCH_OUT_OF_SCOPE    DOM未变=true
  [V7c] 第二条 target 不存在(不存在的pid)-> E_PATCH_OUT_OF_SCOPE   DOM未变=true
  ```

### 2.2 【中等】`insertHtml` 的插入点不受任何范围校验：`position=before|after` 会把内容放到选区之外

* 定位：`src/patch.mjs`（约 292 行）：`const parent = change.position === 'before' || change.position === 'after' ? el.parentNode : el;`。范围校验只校验 `target` 是 scope 或其后代（同前，约 234-237 行），**从不校验真正的插入父节点**。
* 触发条件（两个都已验证）：
  1. `target = scopePid`，`position = "before" | "after"` → 新节点成为 **scope 的兄弟**，完整落在选区之外（用户特意设计的"只能改这一块"被绕过）；
  2. `target = <html> 的 pid`（链最外层可选）→ `parent` 是 Document（nodeType 9），新元素被插进 Document、成为 `<html>` 的兄弟。
* 后果：
  * 情形 1：AI 可以往选区外塞任意（已清洗的）内容，`position:fixed` 覆盖层之类能整页挡住的元素都能从"小块"里插进去；
  * 情形 2：导出走 `documentElement.outerHTML`（`bridge.mjs:122-126` / `patch.mjs:100-126`），插进 Document 的节点**静默不进快照/导出**，而它确实活着并影响渲染 → 快照与 DOM 不一致。
* 已验证：
  ```
  [F-insertOutside] PASS insertHtml(target=scope,position=before) applied=1 新节点父=MAIN hero.contains=false
  [F-insertHtmlRoot] FAIL insertHtml(target=<html>,before): err=null 进了 Document=true 导出里存在=false
  ```
* 检查过的路径：`append/prepend` 落在 `el` 内部（天然在 scope 内）；`before/after` 只在 `el` 为 scope 根（或 Document 根）时越界；`el.parentNode` 为 null 时会抛 `E_PATCH_INSERT_TARGET` 并回滚。

### 2.3 【已修复，记录】`applyPatch` 中途失败曾经会留下"改了一半"的页面

我初次读到的 356 行版本没有 `try/catch`，`[{removeNode: scope},{setText: scope}]` 这类 patch 会先删掉元素再抛错，且**不返回 inverse**，UI 侧无任何回滚句柄。当前版本（`patch.mjs:246` 起 `try`，`:364-368` 回滚）已修好，并已实测（V7a/b/c 全部 DOM 零改动）。

---

## 3) 撤销精确性（PreviewSession / undoPatch）

设计本身是对的：逆条目存的是"受影响子树在**该时刻**的完整属性+内容快照"，`undoPatch` 逆序回放，每次回放都把元素恢复到更早的快照，所以**多条逆操作不会互相覆盖**（逐条 fetch 早于自己的快照，最终收敛到最早状态）。

### 3.1 【中等·已验证】正文里出现 `data-pid=` 时，撤销会永久吃掉这段文字

* 定位：`src/patch.mjs:~100-102`（`stripPids = /\s+data-pid=("[^"]*"|'[^']*'|[^\s>]+)/gi` 是**纯文本**正则）、`snapshotTree` 的 `html: stripPids(el.innerHTML)`（约 92 行）、`restoreElement` 的 `el.innerHTML = stripPids(snap.html ?? '')`（约 151 行）。
* 触发条件：被补丁改动的元素子树里，**文本节点**含有 ` data-pid=...`（`<pre>`/`<code>`/`<textarea>` 里的代码示例、文档里贴的 HTML 片段、乃至脚本源码字符串）。
* 后果：快照生成的那一刻文字就被删了，撤销把"已被删过的快照"写回 DOM → 原文丢失且不可恢复（快照里也没有）。
* 已验证（node + dom-shim）：
  ```
  stripPids('<pre>用法: data-pid=abc 谢谢</pre>')  =>  '<pre>用法: 谢谢</pre>'
  [F-stripPids] undo 逐字节=false
     before=<h1 data-pid="p-h1">T<pre data-pid="p-pre">用法: data-pid=abc</pre></h1>
     after =<h1 data-pid="p-h1">T<pre data-pid="p-pre">用法:</pre></h1>
  ```
* 说明：`removeNode` 的逆条目用的是未剥 pid 的 `parent.innerHTML`（`patch.mjs:350`），同样在 `restoreElement` 里被 `stripPids` 过一遍，问题一致。

### 3.2 【中等】"逐字节还原"在涉及属性删除时不成立（属性顺序变化）

* 定位：`src/patch.mjs` 的 `restoreElement` 属性回填段（约 154-167 行）：先把"不在快照里的属性"删掉，再按 `Object.entries(snap.attrs)` 顺序重新 `setAttribute`；被删过的属性会**追加到属性表末尾**（真实 DOM 语义），`data-pid` 又由 `anchor.ensure` 在最后追加。
* 触发条件：patch 用 `setAttr value=null` 删掉一个原本排在 `data-pid` 之前的属性，然后取消预览。
* 后果：`outerHTML` 字符串与改动前不同（语义等价但字节不同）。`CONTRACT.md §5` 说"含属性顺序无关性"，但 `selftest.mjs:97-104` 与 `tools/test-e2e.mjs:405-411` 的验收断言就是**字符串逐字节相等**，一旦模型输出"删属性"就必然红。
* 已验证（node + dom-shim）：
  ```
  [F-attrOrder] before=<p id="x" class="y" data-pid="p-994c1636">T</p>
                after =<p class="y" id="x" data-pid="p-994c1636">T</p>
  ```

### 3.3 用户列的三种组合逐条结论

| 场景 | 结论 | 证据 |
| --- | --- | --- |
| 同一元素连续两次 `setStyle` 不同属性 | **逐字节还原**（逆序回放两个完整快照，收敛到最早） | `[V5a] 逐字节=true` |
| `setStyle` 之后又 `setHtml` | **逐字节还原** | `[V5b] 逐字节=true` |
| 同一 patch 里 `removeNode` 后再改它的子节点 | 整单拒绝 + 事务回滚，DOM 零改动（不会改坏） | `[V7a] E_PATCH_TARGET_MISSING / DOM未变=true` |
| 同一 patch 里删属性（`setAttr null`）后再取消 | 语义还原但字节不同（见 3.2） | `[F-attrOrder]` |
| 子树文本含 `data-pid=` | 文字永久丢失（见 3.1） | `[F-stripPids]` |

`PreviewSession`（`patch.mjs:317+`）本身的 `cancel/accept` 幂等（`settled`）没有发现问题；`cancel` 先 `clearMarks` 再 `undoPatch`，标记类（`z-preview-flash`）不会残留到撤销后的快照里（`scrubEditorArtifacts` 也会剥，`patch.mjs:122`）。

---

## 4) 消息协议（req/res 配对、超时、iframe 重载、并发、pending 泄漏、bridgeInstalled）

### 4.1 【严重·已验证】父窗口从未注册 `message` 监听：`onWindowMessage` 是死代码，`ensureBridge` 永久挂起

* 定位：`src/app.mjs:380`（定义 `onWindowMessage`）、`:383-385`（`type==='ready'` → `this.resolveReady?.(true)`）、`:311-313`（`loadHtml` 每次新建 `iframeReady`/`resolveReady`）、`:322`（`await this.iframeReady`）。全仓库（含 `out/app.bundle.js`）只有 `app.mjs:335` 一处 `window.addEventListener('message', …)`，它是 `ensureBridge` 内部的**临时**监听（只认 `bridge-installed`，`settle` 后立刻 `removeEventListener`）；`onWindowMessage` 没有任何注册点（`grep -n "onWindowMessage\|addEventListener('message'"`）。
* 触发条件：任何一次打开页面（构造函数 `app.mjs:45-48` 直接 `boot()`）。
* 后果（全链路死）：
  1. iframe 里 bootstrap 发的 `ready` 无人接收 → `iframeReady` 永不 resolve → `ensureBridge` 卡在 `await this.iframeReady`；
  2. 于是 `rpc` 连 `pending.set` 都没执行（`app.mjs:351-359`：超时定时器在 `await this.ensureBridge()` **之后**才创建），**既不会 resolve 也不会 reject**，`boot()→loadWorkspace()→await rpc('injectAnchors')` 永远停在半路，`renderVersions()` 等后续代码不执行；
  3. 即使绕过第 1 步（例如把桥装好了），`res`/`evt` 也没人收 → 选中、悬停、预览全部无响应。
* 已验证（静态 + 计数）：`app.mjs` 中 `addEventListener('message')` 出现 **1** 次（第 335 行），`onWindowMessage` 出现 **1** 次（仅定义）。
* 修复方向：构造函数或 `buildShell` 里补 `window.addEventListener('message', (e) => this.onWindowMessage(e))`（并建议在 `onWindowMessage` 里加 `e.source === this.frame.contentWindow` 校验，见 4.5）。

### 4.2 【严重·已验证】桥被装到了**父窗口自己的 document** 上，而不是 iframe

* 定位：`src/app.mjs:337`：`(0, eval)(this.bridgeSource);`（间接 eval → 在**父窗口全局作用域**执行）；`tools/build.mjs:153-155`：`bridgeSource()` 生成的是
  ```js
  (function () { var window = globalThis; … installBridge({ win: window, doc: window.document, … }) … })()
  ```
  所以在浏览器里 `window.document` = **编辑器自己的文档**。
* 后果：`installBridge` 会给编辑器的外壳 DOM 注入 `data-pid`、把 picker 的指针监听（capture 阶段）挂到编辑器自己的页面上、`win.parent.postMessage` 会把消息发给编辑器窗口自身；`extractCleanHtml` 会把**编辑器 UI** 当成"用户页面"序列化；`tools/test-e2e.mjs:210` 依赖的 `frame.contentWindow.__zBridge` 为 `undefined`（`window.__zBridge` 挂在父窗口上）。契约 §1 "iframe 内 anchor/picker/patch/bridge" 的分层不成立。
* 已验证（node + `vm`）：
  ```
  [F-globalThis] bridgeSource() 绑定到"执行它的 globalThis.document": __zBridge=true 该 document 注入 pid=4
  ```
  即：桥的目标文档完全由"谁 eval 它"决定；`app.mjs:337` 的 eval 发生在父窗口。
* 修复方向：改成在 iframe 的 realm 里执行，例如 `this.frame.contentWindow.eval(this.bridgeSource)`，或把源码包成 `(function(window){…})(frameWin)` 并把 `window.document` 换成 `frameWin.document`。

### 4.3 【中等】`ensureBridge` 的等待不在任何超时保护内，iframeeady 被重建时该 rpc 永久悬挂

* 定位：`src/app.mjs:320-347`（`await this.iframeReady` 无超时）；`:311-313`（`loadHtml` 每次覆盖 `iframeReady` 与 `resolveReady`）；`:351-358`（12s 超时只在 `ensureBridge` 之后生效）。
* 触发条件：`ensureBridge` 正在 `await` 旧 promise 时，又发生一次 `loadHtml`（连续两次撤销/重跳版本、或在装载过程中触发 `restoreHtml`）。
* 后果：旧 promise 的 resolver 只被旧的 `loadHtml` 闭包持有、`this.resolveReady` 已指向新 promise → 旧 promise 永不 settle → 那次 `rpc` 永不返回、永不 reject（`pending` 里也不会有它，所以既不是泄漏也不是超时）。挂住它的 `await`（如 `loadWorkspace`）后续代码不再执行。

### 4.4 【中等】`bridgeInstalled` 只在 `srcdoc` 赋值路径被重置；iframe 自行导航/重载后整台编辑器失联

* 定位：`src/app.mjs:310`（`loadHtml` 重置）、`:875`（`loadWorkspace`）、`:623`（`restoreHtml`）；iframe 元素上**没有** `load` 事件监听（grep `addEventListener('load'` 无结果）。
* 触发条件：用户页面自己有脚本（`file://` 模式下 `app.mjs:303-306` 干脆不加 `sandbox`；http(s) 下 `allow-scripts allow-same-origin` 也允许自身导航）执行 `location.reload()` / `location.href='…'`。
* 后果：iframe 文档被换掉、桥随之消失，但 `bridgeInstalled` 仍为 `true` → 之后每个 `rpc` 都把 `req` 投进没有桥的文档 → 全部 12s 超时；用户只能靠重新导入 HTML 或刷新编辑器恢复。

### 4.5 【轻微】`res`/`evt` 既不校验 `event.source` 也不校验 `event.origin`

* 定位：`src/app.mjs:380-401`（只比较 `d.__z` 与 `d.token`）；`bridge.mjs:197-218` 同样只比 token，`post`/`reply` 一律用 `'*'`。
* 后果：任何能拿到编辑器窗口句柄、且知道 token（token 写在 iframe 的 `window.__zToken` 上，同源用户页面可读）的窗口都能伪造 `ready`（提前 resolve `iframeReady`）或 `evt:select`（UI 显示假选区）。伪造 `res` 需要猜中 `uid('r')`，不可行。风险不高，但属于"没有来源校验"的缺口。

### 4.6 pending Map 泄漏与重复装桥

* `pending`：`resolve`/`reject`/超时三条路径都会 `delete`（`app.mjs:355-368`、`:388-390`），**未发现泄漏**；唯一问题是 4.3 里那种"连超时都没建立"的悬挂（它不占 `pending`，占的是调用方的 await）。
* 重复装桥：`ensureBridge` 只在入口判一次 `bridgeInstalled`，而它在 `await this.iframeReady` 处让出执行权；装载窗口内若有两个并发 `rpc`（例如 iframe 重载期间用户点了泡泡 → `onBubbleAction` 里 `this.rpc('select')` 不 await，`app.mjs:459/465`），两边都会 eval 一次 `bridgeSource` → **同一 iframe 上装两个桥**。两个桥各自监听同一条 `req` 并各自执行 `fn(...)`：`applyPatch` 会被执行两遍（`insertHtml` 真的会插两份；`removeNode` 第二遍抛错但错误回复因 `pending` 已删而被丢弃，用户看不到）；第二次 `reply` 也会因 `pending.delete` 被忽略，所以**配对不会错**，错的是副作用被执行了两次。
* 旧桥的 `setInterval`（`bridge.mjs:233-239`，500ms 看门狗）在整个文件里没有 `clearInterval`：每次 iframe 重载（每次 undo/redo/jumpTo 都会 `restoreHtml`）都会多留一个定时器与一份 anchor/picker 闭包，长期使用是缓慢的定时器泄漏（`bridge.mjs` 无 `clearInterval` 出现）。

---

## 5) 快照栈（SnapshotStore）

我用 `createMemoryStorage()` + 大字符串把各分支都跑了一遍（命令见 §B-6）。结论：

* **undo 后再 push**：未来分支被正确截断（`snapshot.mjs:87-89`），`cursor` 落在新末尾（实测 `len=6 末=branch cursor=5`）。
* **trim 丢最老**：保留 `snapshots[0]`（初始版本）与最近 `maxSnapshots-1` 条，`cursor` 被设到末尾（`snapshot.mjs:104-106`），实测 `len=5 首=初始版本 cursor=4` —— 与 `CONTRACT.md §6` "版本 0 永不丢弃"一致。
* **jumpTo 后再 push / peek / remove**：`remove` 的 `index<=0` 保护与 `cursor>=index` 时的左移（`snapshot.mjs:145-153`）在阅读意义上自洽；我没有构造出把 cursor 写坏的序列。
* **localStorage 超限分支**（`snapshot.mjs:188-199`）：我原本怀疑"cursor 指向 index 1 时被 splice 掉"，实测**不成立**：`push()` 先把 `cursor = length-1`，而 `undo/redo/jumpTo` 不会改变 payload 大小，所以一旦某次 `persist()` 成功，后续不会再次超限；实测超限时裁剪发生在 `push` 阶段，`cursor` 不会被删（`labels=[初始版本,big3,big4,big5] cursor=1 jumpTo(1) 得到 big3`，语义正确）。
* **初始版本**：`trim()` 与超限循环都只从 `index 1` 开始删，`index 0` 永远保留。**未发现丢初始版本或写坏 cursor 的路径。**
* 【轻微】`importProject` / `restore` 不做 `trim()`（`snapshot.mjs:210-220`、`:247-257`）：导入一份 500 版的工程后，直到下一次 `push()` 才会被裁到 `maxSnapshots`，期间 `list()`/面板要渲染 500 行。
* 【轻微】`restore()` 不校验快照形状：localStorage 里若某条 `html` 缺失，`restore()` 仍返回 true，`app.mjs:859-860` 会拿 `undefined` 去 `loadHtml`（`injectBootstrap(undefined)` → 空白页），而不是报错回退到示例页。
* 【轻微】`persist()` 失败/裁剪只设置 `persistWarning`，不 `emit`（`snapshot.mjs:194`、`:205`）：告警要等下一次 `renderVersions()` 才可见；`acceptPreview` 恰好会 render，所以影响很小。

---

## 6) Provider（parseModelOutput / coerceToPatch / HTTP 错误处理）

* **未发现"把非法输出当合法 patch 并执行"的路径**（逐条验证/阅读）：
  * 缺 `changes` 且没有 `op`：`coerceToPatch` 产出 `{changes: undefined}` → `validatePatchShape` 的 `!isPlainObject && !Array.isArray`（`schema.mjs:80`）→ 抛 `E_PATCH_SHAPE`；
  * `changes: {}`（对象）：`schema.mjs:82` 的 `!Array.isArray` → 抛；
  * op 拼写近似（`setStyle ` / `SetStyle` / `setInnerHTML`）：`OPS.includes` 精确匹配 → `E_PATCH_OP` 整单拒绝；
  * `target` 指向不存在的 pid：shape 校验（`provider.mjs:61` 的 `validatePatch` **不带 isWithin**）会放行，但真正执行前 bridge 侧 `applyPatch` 的 scope 校验会以 `E_PATCH_OUT_OF_SCOPE` 整单拒绝，且 DOM 零改动（实测 `[V7c]`）——结论是"不会执行非法 patch"，但**错误分类是越界而不是"pid 不存在"**，错误信息对用户略有误导；
  * `coerceToPatch` 的容错是有意的、且都收窄：裸数组→`changes`、单条 op→单元素 `changes`、`operations/edits` 别名、`removeAttr`→`setAttr(null)`、缺 `target` 补成上下文 pid。这些都不放宽 `op`/属性/值域校验。
  * 唯一"静默丢弃"的地方：changes 条目里的未知字段（契约 §4 说"禁止 op 之外的自定义字段"）被 `validatePatchShape` 直接丢掉而不是报错（`schema.mjs:102` 起重建 `out`）——属于契约与实现的小偏差，不会导致错误行为。
* 【中等】代理路径会**吞掉真实的失败原因**：`tools/serve.mjs:136-139` 在"模型输出不符合 Patch v1"时返回 **HTTP 200** + `{mode:'invalid', raw, error:'模型输出不符合 Patch v1：…'}`；而 `src/provider.mjs:372` 只取 `data.patch` / `data.raw` / `data.content`，**从不看 `error` 字段** → 又走一遍 `parseModelOutput(data.raw)`，用户最终看到的是泛化的"模型返回无法解析为合法 patch"，服务端已经给出的具体原因（哪个字段不合法）被丢弃（只有 `detail.raw` 还留着原文）。
* 【轻微】`parseModelOutput` 的注释写着"含一次自动修复机会"（`provider.mjs:57`），但修复逻辑在 `generateViaChat`（`:292-313`），`server` 的代理分支（`:356-374`）**完全绕过修复**：代理返回不合法 patch 时直接抛错，不会重试。`ms/attempts/repaired` 在代理路径下也偏缺失（`app.mjs:549-552` 会显示空）。
* 【轻微】`app.mjs:512-514` 调用 `provider.generate(context,{onDelta})` 从不传 `signal`，而三个 provider 都实现了 `signal` 透传 —— 没有任何取消/超时能力（模型卡住时 UI 只能等）。
* HTTP 层本身的错误处理是对的：`callOpenAiCompatible` 对 `!res.ok` 抛 `E_MODEL_HTTP`（含状态码与 body 片段）、非 JSON 抛 `E_MODEL_HTTP`、空内容抛 `E_MODEL_EMPTY`（`provider.mjs:257-289`）；`generateViaChat` 的重试只吞"解析失败"，网络/HTTP 错误直接冒泡（第一次调用在 try 之外）。

---

## 7) 打包器（tools/build.mjs 的正则转换）

我用"把 `build.mjs:46/48/50/52` 的四个正则原样取出、在 node 里对合成模块源码跑转换 + `new vm.Script()` 语法检查"的方式验证（不能往 `src/` 写文件，所以没有走真实 `readModule` 的入口；`buildHtml()` 的真实产物我也在内存里做了语法检查，见 §B-7）。

* 【中等·已验证】`import { a as b } from './x.mjs'` → 生成 `const { a as b } = __Z_REQ("./x.mjs");` —— **语法错误**（`Unexpected identifier 'as'`；ESM 的改名语法是 `a as b`，而对象解构要写 `a: b`）。产物"构建成功、打开即白屏"，`build.mjs:106-108` 的兜底只查 `export`，`test-bundle.mjs` 的残留 import 检查也抓不到（该行已经不是 `import` 开头了）。
* 【中等·已验证】以下 import 形式**完全不匹配** `IMPORT_RE`，语句会原样留在产物里 → `SyntaxError: Cannot use import statement outside a module`：
  * `import def, { a } from './x.mjs'`（默认 + 具名）
  * `import './x.mjs'`（仅副作用）
  * 同一行两条 import：`import {a} from './x'; import {b} from './y';`
  * `import * as ns from './x.mjs'`
  这些情况下 `deps` 也不会记录依赖，`verifyDependencies`（`build.mjs:29-44`）**不会报错** → 构建"成功"、产物运行即坏。（`npm test` 里的残留 import 断言能抓到后四种，但抓不到 `as` 那一种。）
* 【轻微·已验证】块注释里的 import 会被改写（仍是注释内容，语法无害），但会给 `deps` 塞进一个**幻影依赖** → `verifyDependencies` 抛"依赖 ghost.mjs，但它不在打包列表里"，报错信息与真实原因无关，排查成本高。
* **已证伪的怀疑**：多行 import（`import {\n a,\n b\n} from './x.mjs'`）**能**被正确处理（`[^}]*` 与 `\s*` 都跨行匹配）；`export { a, b as c } from './x'` 的再导出也被 `REEXPORT_RE` 正确处理（`build.mjs:60-73` 生成 `"c": __Z_REQ("x")["b"]`）。
* 【未发现】模板字符串里出现 `export function/class/const/let/var` 会被 `EXPORT_DECL_RE` 原地削掉关键字、`export {` 会被 `EXPORT_LIST_RE` 替换成 `Object.assign(exports, …)`，属于潜在陷阱；但**当前 `src/` 没有任何文件命中**，且这种残留会被 `build.mjs:106` 的兜底拦住（对 `export {` 之外的形态）。
* 【已验证·当前无问题】`buildHtml()` 在内存里生成的产物：`app` 与 `bridge` 两段都能通过 `new vm.Script()`，无残留 `import`，体积 256,892 字节。

---

## 8) 安全性

### 8.1 【严重·已验证】`setAttr` 只校验属性名，**完全不校验值** → 可直接写入 `javascript:` URL

* 定位：`src/schema.mjs:110-123`（`out.value = String(change.value)`，只有 `isForbiddenAttrName` 管名字）；`src/patch.mjs:268-273`（直接 `el.setAttribute`）。`sanitizeHtmlFragment` 里那套 `SAFE_URL` 白名单（`patch.mjs:18,46-49`）**只作用于 HTML 片段，不作用于 setAttr**。
* 已验证：
  ```
  validatePatch({op:'setAttr', name:'href', value:'javascript:alert(1)'})      → 通过，值原样保留
  validatePatch({op:'setAttr', name:'src',  value:'data:text/html,<script>x</script>'}) → 通过
  applyPatch 后 <a href="javascript:alert(1)"> 真的写进了 DOM
  ```
* 同类未拦的还有 `formaction`、`action`、`srcset`、`xlink:href`（片段路径会拦 `xlink:href`，setAttr 不拦）、`content`（`<meta http-equiv=refresh>` 的 meta 元素只能来自用户页面本身）。
* 后果：模型（或任何能改模型输出的人）可以给选区内的 `<a>`/`<iframe>`/表单控件写入 `javascript:` 或 `data:text/html`，等用户点击时在**同源 iframe** 内执行任意脚本 → 参见 8.4 的后果放大。

### 8.2 【严重·已验证】`sanitizeHtmlFragment` 放行 `<style>` → 全局 CSS 注入，"只改选中块"被绕过

* 定位：`src/patch.mjs:17`（`DANGEROUS_TAGS` 没有 `STYLE`）、`:33-55`（只删 `SCRIPT/IFRAME/OBJECT/EMBED/LINK/META/BASE/FORM`）。`src/systemprompt.mjs:15` 明确禁止 `<style>`，但**提示词不是闸门**，唯一闸门是 `sanitizeHtmlFragment`。
* 已验证：`sanitizeHtmlFragment(doc,'<style>body{display:none}</style><b>x</b>')` → `<style>` 原样保留。
* 后果：`setHtml`/`insertHtml` 一个字符宽的改动即可把 `body{display:none}`、`position:fixed` 遮罩、`@import url(...)` 外链等**作用于整页**的规则注入用户页面；视觉层完全逃出 scope 约束，快照/导出里也会带上这段 CSS。

### 8.3 【中等·已验证】`data-z-*` 属性穿过清洗器，随后被 `scrubEditorArtifacts` 当作"编辑器垃圾"整块删除

见 1.5：AI 可以通过 HTML 片段给元素打上 `data-z-chrome`/`data-z-inject`，用户"接受"的那一刻该元素从快照里消失（活 DOM 仍在），此后 undo/redo/导出都缺内容；反过来，用户 HTML 里本就带这两个属性的元素也会被静默删除。

### 8.4 【严重·架构层】iframe 沙箱没有起到隔离作用，而 `apiKey` 存在 localStorage

* 定位：`src/app.mjs:303-306`：http(s) 下 `sandbox="allow-scripts allow-same-origin allow-modals allow-popups"`；`file://` 下**直接不加 sandbox**。srcdoc iframe 与父窗口同源，`allow-scripts` + `allow-same-origin` 组合使"沙箱"形同虚设：iframe 里的用户脚本可以访问 `parent.document`、`parent.__zApp`、以及**父窗口 localStorage**。
* 关键数据：`src/app.mjs:69-75` 把 `settings`（含 `apiKey`）写进 `localStorage['zhidaiqi/v1/settings']`；`src/ui.mjs:261` 对用户的说法是"key 只存在你自己的浏览器/本机服务里"。同源 iframe 里的任意脚本 `localStorage.getItem('zhidaiqi/v1/settings')` 即可拿到 key 并外发。
* 放大器：`src/app.mjs:270-282` 的 bootstrap 脚本会**主动删掉用户页面的 CSP `<meta>`**（"避免用户页面的脚本干扰选中"），进一步放开脚本；8.1/8.2 让"模型输出"本身也能在同源 iframe 里落地脚本。
* 结论：契约 §1 声称"沙箱 iframe 才不污染编辑器外壳/拿不到父窗口"，当前配置下不成立。修复方向：去掉 `allow-same-origin`（改用 `postMessage` + 结构化数据、或给 iframe 用 blob:/不同源），或至少不要把 `apiKey` 放进该源的 localStorage。

### 8.5 【未运行验证·规范推断】SVG/MathML 命名空间绕过 `DANGEROUS_TAGS`（大小写）

* 定位：`src/patch.mjs:17,35`：`DANGEROUS_TAGS` 是**大写**集合（`'SCRIPT'` 等），判定用 `child.tagName`。HTML 命名空间元素的 `tagName` 会被 DOM 规范上抛成大写，但**非 HTML 命名空间元素保留解析器给出的限定名**，即 `<svg><script>` 里的元素 `tagName === 'script'`（小写）→ `DANGEROUS_TAGS.has('script')` 为 false → **不会被删**。而 SVG 的 `<script>` 在插入文档后是会执行的。
* 我**没有**运行验证：这需要真实浏览器的解析器语义，而 `tools/dom-shim.mjs` 的 `El` 构造函数统一 `String(tag).toUpperCase()`（`dom-shim.mjs:94`），会把 SVG script 也变成 `SCRIPT`，因此 shim 上**复现不出来**（我按约束没有启动浏览器）。若要在浏览器里确认，一句就够：
  ```js
  const t=document.createElement('template'); t.innerHTML='<svg><script>window.__p=1<\/script></svg>';
  t.content.firstChild.firstChild.tagName;            // 期望 'script'（小写）→ 逃过 DANGEROUS_TAGS
  ```
  同类还可能涉及 `<svg><iframe>`、`<svg><object>` 等（这些在 SVG 里无行为，暂不算漏洞），以及 `<foreignObject>` 会切回 HTML 命名空间（`SCRIPT` 大写，正常删除）。
* 另：`sanitizeHtmlFragment` 的 `walk` 只递归 `node.children`，**不进入嵌套 `<template>` 的 `.content`**（`patch.mjs:33-55`）。`<template>` 内容插入后是惰性的、不会执行，所以不构成直接 XSS，但清洗器"逐层扫干净"的语义有缺口（防御纵深问题）。

### 8.6 【轻微·已验证】`z-picking` 类残留进快照/导出

* 定位：`src/picker.mjs:89-92`（`applyCursorClass` 把 `z-picking` 加在 `documentElement` 上，pick 模式是默认）、`src/patch.mjs` 的 `classList.remove('picker-selected', 'z-preview-flash', 'z-ai-touched')`（约 133 行，`scrubEditorArtifacts` 只 remove 这三个，**没有 `z-picking`**）。
* 后果：每个快照与导出文件的 `<html>` 都带 `class="z-picking"`（编辑器痕迹泄漏到"成品"；若用户 CSS 里恰好有 `.z-picking` 规则还会改变渲染）。`src/selftest.mjs:116-118,207,217` 的"快照 HTML 是干净的"断言只看 `data-pid`/`picker-selected`/`data-z-inject`/`__zToken`/`__zBridge`，**检不出这个残留**。
* 已验证：`scrubEditorArtifacts` 之后 `clone.classList.contains('z-picking') === true`、`contains('picker-selected') === false`（shim 的 `El.outerHTML` 从 `attributes` 数组生成、`ClassList` 改动不会同步回去，所以本条我只验证到 classList 层级；真实浏览器里 classList 的改动会反映到序列化）。
* 同类：`z-ai-touched`（`bridge.mjs:143`）现在会被清掉；`z-added`（mock 插入按钮时带的类，`provider.mjs:223`）属于 AI 内容，不算残留。

### 8.7 已检查、判定为非问题的点

* `data:` URL：`SAFE_URL` 只放行 `data:image/`（`patch.mjs:18`），`data:text/html` 在片段路径被剥；`<img src="data:image/svg+xml,...">` 在 img 上下文不执行脚本。**但** setAttr 路径完全绕过（8.1）。
* `expression()`：现代浏览器不支持 CSS `expression`，`style` 属性里只额外拦了 `javascript:`（`patch.mjs:50`）。非风险。
* 属性名大小写：`isForbiddenAttrName` 先 `trim().toLowerCase()`（`schema.mjs:53-61`），`DATA-PID`/`ONCLICK`/`Style`/`data-Z-*` 都能拦；`srcdoc`/`sandbox` 也拦。已验证（`tools/test-unit.mjs` 覆盖 + 我另跑了 `setAttr href` 的反例）。
* `setStyle` 值域：`;{}`、`url(javascript:)`、白名单（`schema.mjs:124-145`）都拦得住；`!important` 会被拆成 priority。**未发现**注入路径（`prop` 不在白名单即整单拒绝）。

---

# A. 按严重度排序的问题清单

### 严重（会让产品不可用 / 破坏安全边界 / 不可恢复地丢内容）

| # | 一句话结论 | 定位 |
| --- | --- | --- |
| S1 | 父窗口从未注册 `message` 监听，`onWindowMessage` 是死代码 → `iframeReady` 永不 resolve → `ensureBridge/rpc` 永久挂起，编辑器整体不可用 | `app.mjs:380`（定义）、`:383-385`（唯一 resolveReady 调用点）、`:311-313`、`:322` |
| S2 | 桥被 `(0,eval)` 装进**父窗口自己的** `globalThis.document`（不是 iframe），指代器/补丁会作用在编辑器 UI 上，`frame.contentWindow.__zBridge` 为空 | `app.mjs:337` + `build.mjs:153-155` |
| S3 | `setAttr` 只校验名字不校验值：`href="javascript:…"`、`src="data:text/html,…"` 都能通过校验并写进 DOM | `schema.mjs:110-123`、`patch.mjs:268-273` |
| S4 | `sanitizeHtmlFragment` 放行 `<style>` → 一次 `setHtml` 就能对整页注入全局 CSS，"只改选中块"被绕过 | `patch.mjs:17,33-55` |
| S5 | 选中 `<html>`（元素链最外层，可选）后 `removeNode` → 父快照 pid 为 null，撤销无法恢复，页面报废且 UI 仍报"已精确回滚" | `patch.mjs` `op:'removeNode'` 逆条目 + `el.remove()`（约 368、373 行）+ `app.mjs:597-606` |
| S6 | iframe 沙箱 `allow-scripts + allow-same-origin`（`file://` 干脆不加）+ 同源 srcdoc + `apiKey` 存 localStorage → 用户页面脚本可读 key 并操纵编辑器 | `app.mjs:303-306,69-75`、`ui.mjs:261` |
| S7 | `sanitizeHtmlFragment` 放行 `data-z-*` 属性，而导出时带 `data-z-chrome/-inject` 的元素被**整块删除** → "接受"后快照静默丢内容（用户自带这些属性的元素也会消失） | `patch.mjs:30-58`（清洗器）+ `scrubEditorArtifacts` 内两处 `el.remove()`（约 116-124 行） |

### 中等（特定输入下行为错误、可复现）

| # | 一句话结论 | 定位 |
| --- | --- | --- |
| M1 | `stripPids` 是纯正则，正文文字里的 `" data-pid=…"` 被吃掉 → 撤销永久丢字、快照内容被篡改 | `patch.mjs`：`stripPids` 定义（约 100 行）、`snapshotTree` 的 `html: stripPids(el.innerHTML)`（约 92 行）、`restoreElement` 的 `el.innerHTML = stripPids(snap.html ?? '')`（约 151 行） |
| M2 | `insertHtml position=before/after` 的插入点不做范围校验：`target=scope` 时内容落在选区之外；`target=<html>` 时插进 Document 且导出里静默丢失 | `patch.mjs` 的 `const parent = change.position === 'before' \|\| 'after' ? el.parentNode : el`（约 292 行）+ 前置校验只查 `target` |
| M3 | 撤销用 `ensure/injectSubtree` 重算 pid，非规范 pid（碰撞后缀、用户自带、`ensureUniquePids` 重编号）会变号 → 快照 `targetPid`/重新选中失配 | `patch.mjs` 的 `restoreElement`（约 148-171 行）、`anchor.mjs:125-151` |
| M4 | `ensureBridge` 的 `await this.iframeReady` 不在 12s 超时内，且 `loadHtml` 会重建该 promise → 在飞的 rpc 永久悬挂（不 resolve 也不 reject） | `app.mjs:320-347,311-313,351-358` |
| M5 | `bridgeInstalled` 只覆盖 `srcdoc` 赋值路径，iframe 自行导航/重载后失效，之后所有 rpc 12s 超时 | `app.mjs:310,875,623`（无 `load` 监听） |
| M6 | 并发 `rpc` 可能重复装桥（`ensureBridge` 在 await 处让出）→ 同一 `req` 被执行两次，`insertHtml` 会插两份 | `app.mjs:320-347`、`bridge.mjs:197-218` |
| M7 | `import {a as b}` 生成 `const {a as b}=…` 语法错误；`import def,{a}` / `import './x'` / 同行两条 import / `import * as ns` 完全不转换 → 构建成功、产物运行即白屏 | `build.mjs:46,54-121` |
| M8 | 代理路径吞掉真实失败原因：`serve.mjs` 用 200+`{error}` 报告"模型输出不合规"，`provider.mjs:372` 从不读 `error` | `serve.mjs:136-139`、`provider.mjs:372` |
| M9 | "逐字节还原"在 patch 删属性后不成立（属性顺序变化），而 selftest/e2e 正是拿 outerHTML 字符串做断言 | `patch.mjs` `restoreElement` 的属性回填段（约 154-167 行）、`selftest.mjs:97-104`、`test-e2e.mjs:405-411` |
| M10 | 【规范推断·未跑浏览器】`DANGEROUS_TAGS` 用大写 `tagName` 判定，SVG 命名空间下 `<svg><script>` 的 `tagName` 是小写 `script` → 清洗器放行可执行脚本 | `patch.mjs:17,35` |

### 轻微（不影响主流程，但会误导/泄漏/留下隐患）

| # | 一句话结论 | 定位 |
| --- | --- | --- |
| L1 | `z-picking` 类残留进每个快照/导出，而"快照干净"的自检断言查不到它 | `picker.mjs:89-92`、`patch.mjs` 的 `classList.remove('picker-selected','z-preview-flash','z-ai-touched')`（约 133 行）、`selftest.mjs:116-118,207,217` |
| L2 | 用户自带的 `data-pid` 运行期被信任、导出时被无条件剥掉 | `anchor.mjs:68-74`、`patch.mjs:118` |
| L3 | `ensure` 的 `isLiveConflict` 分支不可达（死代码），注释承诺的"消失 pid 不占名额"并不存在（但也不产生重复 pid） | `anchor.mjs:75-99` |
| L4 | `importProject`/`restore` 不 `trim()`、不校验快照形状（`html` 缺失 → 空白页而非报错） | `snapshot.mjs:210-220,247-257` |
| L5 | 旧桥的 500ms `setInterval` 从不 `clearInterval`，每次 iframe 重载泄漏一个定时器+闭包 | `bridge.mjs:233-239` |
| L6 | `res/evt` 不校验 `event.source/origin`（伪造 `ready`/假选区可行；伪造 `res` 不可行） | `app.mjs:380-401`、`bridge.mjs:197-218` |
| L7 | 块注释里的 `import` 被改写并制造幻影依赖 → `verifyDependencies` 抛出与真实原因无关的构建错误 | `build.mjs:46,29-44` |
| L8 | 代理分支绕过 `generateViaChat` 的"一次自动修复"，`attempts/repaired` 也缺失 | `provider.mjs:292-313,356-374` |
| L9 | `app.mjs` 从不把 `signal` 传给 provider → 模型卡住时无法取消 | `app.mjs:512-514` |
| L10 | 【已被并发修改者修复，仅记录】21:50 版本 `app.mjs` 调 `rpc('extractHtml')` 而桥只暴露 `extractCleanHtml` → 预览/导出/Ctrl+S 全废；同时 `patch.mjs` 当时无中途回滚 | `app.mjs:537,566,770,844`（旧）、`bridge.mjs:122` |

---

# B. 我实际运行验证过的结论（附命令）

工具：`node v24.21.0`；DOM 用仓库自带的 `tools/dom-shim.mjs`（**没有启动浏览器**）。
下面命令都在 `C:\Users\Windows\Documents\deepseek-harness\default-workspace\zhidaiqi` 下执行；多行脚本通过 `@'…'@ | node --input-type=module` 从 stdin 喂给 node（**没有写任何临时文件**）。

1. **rpc op 与 bridge 能力表交叉核对**（S10/L10 的发现与后续修复）
   ```
   node -e "const fs=require('fs');const app=fs.readFileSync('src/app.mjs','utf8');const br=fs.readFileSync('src/bridge.mjs','utf8');const ops=[...new Set([...app.matchAll(/this\.rpc\(\s*'([^']+)'/g)].map(m=>m[1]))];const api=[...new Set([...br.matchAll(/^\s{4}([A-Za-z_$][\w$]*):\s*\(/gm)].map(m=>m[1]))];console.log(ops.filter(o=>!api.includes(o)))"
   ```
   21:50 版本输出 `['extractHtml']`；**22:04 复跑输出 `[]`（已被修复）**。
2. **父窗口消息监听数**：`grep -c "addEventListener('message'" src/app.mjs` → `1`（第 335 行，`ensureBridge` 内部临时监听）；`onWindowMessage` 仅出现在定义行 380。[S1]
3. **`bridgeSource` 绑定到执行它的 globalThis**（把我上面脚本里的 `V3` 段跑在 `vm` 里）：沙箱 document 被注入 4 个 `data-pid`，`sandbox.__zBridge` 为真 → 目标文档由"谁 eval"决定，`app.mjs:337` 在父窗口 eval。[S2]
4. **撤销/锚点/范围（一次跑完）**：
   ```
   [V5a] 两次 setStyle(不同属性)      undo 逐字节=true
   [V5b] setStyle 后 setHtml          undo 逐字节=true
   [V5c] setAttr 删 class(恰好是末位)  undo 逐字节=true
   [F-attrOrder] setAttr 删 id        undo 逐字节=false  <p id="x" class="y" data-pid=…> → <p class="y" id="x" data-pid=…>
   [F-stripPids] 文本含 " data-pid=abc" undo 逐字节=false：`用法: data-pid=abc` → `用法:`
   [F-...] 非规范 pid（p-pre）撤销后变 p-1fb67cb0
   [V6/F-insertOutside] insertHtml(target=scope,position=before) 新节点父=MAIN，hero.contains=false，applied=1
   [V7a] removeNode(scope)+再改它 → E_PATCH_TARGET_MISSING，DOM 逐字节未变
   [V7b] 含越界 target → E_PATCH_OUT_OF_SCOPE，DOM 未变
   [V7c] 第二条 target 为不存在的 pid → E_PATCH_OUT_OF_SCOPE，DOM 未变
   [F-removeHtml] removeNode(<html>) → documentElement 消失=true，undo 后恢复=false
   [F-insertHtmlRoot] insertHtml(target=<html>,before) → err=null，节点进了 Document=true，导出里存在=false
   ```
5. **导出/清洗（S7、8.2、8.3、8.6、L2）**：
   ```
   [F-style]        sanitizeHtmlFragment('<style>body{display:none}</style>…') → <style> 保留
   [F-scrubdrop]    scrubEditorArtifacts 删除 data-z-chrome 元素=true，保留普通元素=true
   [F-zpicking]     scrub 后 <html>.classList.contains('z-picking')=true
   [F-userpid]      用户自带 data-pid 运行期保留=p-user，导出时被删=true
   ```
6. **`setAttr` 值不校验（S3）**：
   ```
   validatePatch({op:'setAttr',name:'href',value:'javascript:alert(1)'}) → 通过，值原样保留
   applyPatch 后 <a href> = javascript:alert(1)
   validatePatch({op:'setAttr',name:'src',value:'data:text/html,<script>x</script>'}) → 通过
   ```
7. **打包器正则（M7、L7）**：把 `build.mjs:46/48/50/52` 的四个正则原样复制到 node 脚本里跑转换 + `new vm.Script()` 语法检查：
   ```
   import { a as b }        → const { a as b } = __Z_REQ("./x.mjs");   SyntaxError: Unexpected identifier 'as'
   import def, { a }        → 原样保留  SyntaxError: Cannot use import statement outside a module
   import './x.mjs'         → 原样保留  SyntaxError: …
   import {a}…; import {b}… → 原样保留  SyntaxError: …
   import * as ns           → 原样保留  SyntaxError: …
   多行 import              → 正确转换（证伪了我的怀疑）
   块注释里的 import        → 被改写，且 deps 多出 ./ghost.mjs（幻影依赖）
   ```
   另外用真实流水线 `build.mjs` 的 `buildHtml()` 在内存里生成产物并做语法检查：`app=SYNTAX-OK bridge=SYNTAX-OK 残留import=false bytes=256892`（当前 `src/` 未被这些陷阱命中）。
8. **快照栈（§5 全部结论）**：用 `createMemoryStorage()` 跑
   ```
   [V12a] undo 后再 push: len=6 末=branch cursor=5                （未来分支正确截断）
   [V12b] trim: len=5 首=初始版本 cursor=4                        （v0 永不丢）
   [F-snap] 5×1.2MB 快照: labels=[初始版本,big3,big4,big5] cursor=1，jumpTo(1)=big3（cursor 未被写坏）
   ```
9. **仓库自带的测试**（作为交叉参考，不是我写的新测试）：
   * `node tools/test-unit.mjs` → `tests 30 / pass 30 / fail 0`
   * `node tools/test-dom-smoke.mjs` → `tests 13 / pass 13 / fail 0`（注意它包含"事务性：中途失败必须回滚"与"删掉选中元素后再改它"两项 —— 这两项在 21:51 之前的 `patch.mjs` 上应当是红的，现在是绿的，说明我最初读到的版本确实更旧）
   * `node tools/test-bundle.mjs` 未跑（它要求 `out/` 比 `src/` 新，跑它就得重新构建并写 `out/`，与"只读"约束冲突）；`node tools/test-e2e.mjs` 未跑（会启动浏览器，违反约束）。

---

# C. 我明确没有覆盖的部分

1. **真实浏览器行为**：约束禁止启动浏览器，所以下列结论没有运行验证，只有代码/规范层面的推断：
   * 8.5 的 SVG/MathML 命名空间绕过（`<svg><script>` 的 `tagName` 是否为小写）—— `tools/dom-shim.mjs:94` 会把 tag 统一大写，shim 上**不可能**复现；
   * `sanitizeHtmlFragment` 依赖的真实 HTML 解析细节（`<template>.content`、外来内容插入点、`<noscript>` 文本化等）；
   * `classList` 改动反映到 `outerHTML` 的序列化（shim 的 `El.outerHTML` 从 `attributes` 数组生成，与 `ClassList` 不同步，所以 8.6 我只验证到 classList 层级）；
   * 真实 CSS 级联/布局（`<style>` 注入的实际影响范围）、`position:fixed` 覆盖效果；
   * `localStorage` 配额异常（QuotaExceededError）的真实触发阈值，我用的是内存 storage + 4MB 字符串模拟；
   * 指针事件/capture 阶段的真实顺序（`picker.mjs` 的 `pointerdown/up`、泡泡交互）、剪贴板、下载（`Blob`/`URL.createObjectURL`）。
2. **`app.mjs` / `bridge.mjs` / `selftest.mjs` / `ui.mjs` / `overlay.mjs` 的 DOM 交互与渲染**：没有浏览器就没有验证；`ui.mjs`、`overlay.mjs`、`diff.mjs`、`selector.mjs`、`systemprompt.mjs` 我只做了阅读，**没有发现会导致行为错误的问题**（检查过的路径：`renderSelection/setBusy/addPatchCard` 的转义、`Overlay` 的坐标换算与 `showHighlight` 空 box 处理、`describePatch/patchToHtml` 的转义、`computedSubset/matchedCssRules` 的取样式异常捕获、提示词与契约字段的一致性）。
3. **`tools/serve.mjs` 的服务端行为**：只做了阅读（未起服务，未发真实请求）；除了 M8 那条"错误字段被吞"以外，`/api/chat` 的 key 处理、上游错误码透传、`readBody` 上限、404 分支未发现行为错误。
4. **结束状态不可复现**：审查期间 `src/` 被并发修改（见 §0），我没有冻结副本（受"只能写 `docs/REVIEW.md`"约束），所以**行号会随修复漂移**；每条结论我都给了 grep 关键字/可复现命令，请以命令结果为准。
5. **未覆盖的组合场景**：多标签页同时打开同一 localStorage（无锁/无 `storage` 事件处理）；`importProject` 导入恶意构造的工程 JSON（除形状校验缺失外未做深入 fuzz）；`evalRead` 的能力面（`bridge.mjs:166-170` 暴露 `new Function`，任何能发 `req` 的上下文都能在页面内执行任意表达式 —— 属于"验收钩子"，我按设计意图未列为问题，但它确实是 iframe 内的任意求值口子）。
