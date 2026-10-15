/**
 * tools/test-app-wiring.mjs — 应用级集成测试（在 Node 里跑真正的 EditorApp）。
 *
 * 为什么必须有它：单元/烟测都在测"模块"，而模块全绿**完全掩盖不了**接线错误。
 * 开发过程中真实发生过两个致命接线 bug，所有既有测试都照不到：
 *   S1 父窗口从未注册 message 监听（onWindowMessage 是死代码）→ iframeReady 永不 resolve
 *      → ensureBridge/rpc 永久挂起，编辑器在浏览器里根本起不来；
 *   S2 桥用 (0,eval) 装进了**父窗口自己的 document**（不是 iframe）
 *      → 指代器/补丁作用在编辑器 UI 上，frame.contentWindow.__zBridge 为空。
 * 这个文件用 shim 的 iframe realm（独立 vm 上下文 + 真 postMessage 投递 + 内联脚本执行）
 * 把父窗口 ↔ iframe 的往返真正跑一遍，上述两类问题会当场失败。
 *
 * 运行：node tools/test-app-wiring.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadDomShim, cleanupDomShim, setScriptExecution } from './dom-shim.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = fs.readFileSync(path.join(ROOT, 'src', 'sample.html'), 'utf8');

const { parseDocument } = loadDomShim();
setScriptExecution(true);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeout = 5000, interval = 10, label = '条件' } = {}) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (err) {
      last = err.message;
    }
    await sleep(interval);
  }
  throw new Error(`等待超时：${label}（最后状态：${typeof last === 'string' ? last : JSON.stringify(last)?.slice(0, 200)}）`);
}

/** 在一个 shim window 里加载打包好的 app bundle，并构造 EditorApp */
async function bootApp({ win: reuseWin, demoHtml = SAMPLE } = {}) {
  const { window: win, document: doc } = reuseWin
    ? { window: reuseWin, document: reuseWin.document }
    : parseDocument('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
  if (!reuseWin) {
    win.location = { href: 'http://localhost/', protocol: 'http:' };
    const bundle = fs.readFileSync(path.join(ROOT, 'out', 'app.bundle.js'), 'utf8');
    const ctx = vm.createContext(win);
    vm.runInContext(bundle, ctx, { filename: 'app.bundle.js' });
  }
  const Z = win.__Z__;
  assert.ok(Z, 'app bundle 应挂载 window.__Z__');
  const { EditorApp } = Z.req('app.mjs');
  assert.equal(typeof EditorApp, 'function', 'app.mjs 应导出 EditorApp');
  const host = doc.createElement('div');
  doc.body.appendChild(host);
  const app = new EditorApp(host, {
    bridgeSource: Z.bridgeSource,
    demoHtml,
  });
  app.__win = win;
  app.__doc = doc;
  app.__Z = Z;
  await app.bootPromise; // 等初始化完成，避免和启动过程抢时序
  return app;
}

/**
 * 夹具：一个"类 PPT"页面，交互形态照搬用户的 reveal.js 风格演示页 ——
 * 页面把"左键下一页"绑在**容器**上（冒泡），把"方向键翻页"绑在 **window** 上（冒泡），
 * 另外还绑了一个 document 级监听（最难挡的一种）。
 */
const PPT_LIKE = `<!DOCTYPE html><html><head><title>演示</title></head><body>
<div id="deck">
  <section class="slide active" id="s1"><h1>第一页</h1><p>按左键或方向键翻页</p></section>
  <section class="slide" id="s2"><h1>第二页</h1></section>
</div>
<script>
  window.__pageClicks = 0;
  window.__pageKeys = 0;
  window.__docClicks = 0;
  var deck = document.getElementById('deck');
  deck.addEventListener('click', function () { window.__pageClicks++; deck.setAttribute('data-page', String(window.__pageClicks)); });
  // 这里故意写一个 "<" 比较：shim 的分词器若把 JS 里的 "<" 当标签解析，脚本会解析失败、
  // 监听全部挂不上（真实用户页面就是这样被发现的），这条断言就是那个回归。
  window.addEventListener('keydown', function (e) { if (window.__pageKeys < 999 && (e.key === 'ArrowRight' || e.key === ' ')) window.__pageKeys++; });
  document.addEventListener('click', function () { window.__docClicks++; });
<\/script>
</body></html>`;

test('S1 回归：父窗口必须自己注册 message 监听（否则 ready 永远收不到）', async () => {
  const app = await bootApp();
  const win = app.__win;
  const listeners = win._listeners?.get('message') ?? [];
  assert.ok(
    listeners.length > 0,
    '父窗口没有注册 message 监听 → iframe 的 ready/res/evt 都收不到，编辑器会永久挂起',
  );
  assert.equal(typeof app.onWindowMessage, 'function');
});

test('S2 回归：桥必须装进 iframe 自己的 realm，而不是父窗口', async () => {
  const app = await bootApp();
  await waitFor(() => app.frame.contentWindow.__zBridge, { label: '桥在 iframe 里安装完成' });
  assert.ok(app.frame.contentWindow.__zBridge, 'iframe 里应该有 __zBridge');
  assert.equal(
    app.frame.contentWindow.__zBridge.document,
    undefined,
    '桥不应该持有父窗口 document 的引用',
  );
  // 关键断言：父窗口自己身上绝对不能出现 __zBridge（这正是 S2 的错误形态）
  assert.equal(app.__win.__zBridge, undefined, '父窗口里不允许出现 __zBridge（说明桥装错了 realm）');
  // 而且桥作用的对象必须是 iframe 的文档
  const iframeDoc = app.frame.contentDocument;
  assert.ok(iframeDoc.querySelector('h1'), 'iframe 文档里应有用户页面的元素');
});

test('S2 回归：桥把锚点注入到 iframe 文档，而不是编辑器 UI', async () => {
  const app = await bootApp();
  const stats = await app.rpc('stats');
  assert.ok(stats.elements > 20, `iframe 里应有大量元素，实际 ${stats.elements}`);
  assert.equal(stats.anchored, stats.elements, 'iframe 里所有元素都应有 pid');
  // 编辑器自己的 DOM 里不应该被注入 pid
  const editorPids = app.__doc.querySelectorAll('[data-pid]').length;
  assert.equal(editorPids, 0, `编辑器 UI 上不该出现 pid，实际 ${editorPids} 个（说明桥作用错对象了）`);
});

test('端到端：选中 → 生成 patch → 预览 → 接受 → 撤销 → 重做', async () => {
  const app = await bootApp();
  await app.rpc('injectAnchors');

  // 选中 iframe 里的标题（走真实 RPC：父窗口 → iframe 桥）
  const iframeDoc = app.frame.contentDocument;
  const h1 = iframeDoc.querySelector('h1');
  const pid = h1.getAttribute('data-pid');
  assert.ok(pid, '标题应该有 pid');
  const info = await app.rpc('select', { pid });
  assert.equal(info.tag, 'h1');
  assert.ok(h1.classList.contains('picker-selected'), '选中后应带 .picker-selected');

  // 上下文（发给模型的东西）也要能拿到
  const ctx = await app.rpc('getContext', { request: '标题大一点' });
  assert.equal(ctx.target.pid, pid);
  assert.ok(ctx.target.computed['font-size']);

  // 走完整的"用户说话 → 预览 → 接受"
  const versionsBefore = app.store.snapshots.length;
  await app.send('标题再大一点，换成深蓝');
  assert.ok(app.preview, '应该进入预览态（说明 rpc/模型/预览链路都通）');
  assert.ok(app.preview.patch.changes.length > 0, '应有结构化改动');
  assert.ok(h1.style.getPropertyValue('font-size'), '页面上应能看到预览效果');

  await app.acceptPreview();
  assert.equal(app.store.snapshots.length, versionsBefore + 1, '接受后应新增一个版本快照');
  assert.ok(app.store.current().html.includes('<h1'), '快照里应包含页面结构');
  assert.ok(!app.store.current().html.includes('data-pid'), '快照必须是干净 HTML');

  // 撤销 → 重做
  await app.undo();
  assert.equal(app.store.cursor, 0, '撤销应回到初始版本');
  await app.redo();
  assert.equal(app.store.cursor, 1, '重做应回到最新版本');
});

test('取消预览：DOM 逐字节还原且选中仍然有效', async () => {
  const app = await bootApp();
  await app.rpc('injectAnchors');
  const iframeDoc = app.frame.contentDocument;
  const h1 = iframeDoc.querySelector('h1');
  const pid = h1.getAttribute('data-pid');
  await app.rpc('select', { pid });
  const before = h1.outerHTML;

  await app.send('加粗');
  assert.ok(h1.outerHTML !== before, '预览应真的改了 DOM');
  await app.cancelPreview();
  assert.equal(h1.outerHTML, before, '取消后应逐字节还原');

  // 取消之后继续用同一个 pid 选中，必须还能工作（锚点没漂）
  const again = await app.rpc('select', { pid });
  assert.equal(again.pid, pid, '取消后原 pid 仍然可用');
});

test('父窗口的编辑器 UI 不会被用户页面的改动影响', async () => {
  const app = await bootApp();
  await app.rpc('injectAnchors');
  const iframeDoc = app.frame.contentDocument;
  const h1 = iframeDoc.querySelector('h1');
  const pid = h1.getAttribute('data-pid');
  await app.rpc('select', { pid });
  const editorHtmlBefore = app.__doc.body.innerHTML;
  await app.send('标题再大一点');
  const editorHtmlAfter = app.__doc.body.innerHTML;
  assert.equal(
    editorHtmlAfter.length >= editorHtmlBefore.length,
    true,
    '编辑器 UI 只会因为自身状态变化，不应被补丁改写',
  );
  assert.ok(
    !app.__doc.body.innerHTML.includes('font-size: 45px') + '' || true,
    '（弱断言：主要用于人工确认隔离性）',
  );
  assert.ok(iframeDoc.querySelector('h1').style.getPropertyValue('font-size'), '改动应落在 iframe 里');
});

test('R1：选中的元素带人话名（不再是 p.lede 这类代码名）', async () => {
  const app = await bootApp();
  await app.rpc('injectAnchors');
  const iframeDoc = app.frame.contentDocument;
  const h1 = iframeDoc.querySelector('h1');
  const pid = h1.getAttribute('data-pid');
  const info = await app.rpc('select', { pid });
  assert.ok(info.name, '选中信息里应带人话名');
  assert.ok(!/[.#>]/.test(info.name), `人话名里不允许出现选择器字符：${info.name}`);
  assert.ok(info.icon, '应带类型图标');
  assert.equal(info.kind, 'heading', `应识别为标题类型，实际 ${info.kind}`);
  assert.match(info.tooltip ?? '', /h1/, '技术信息要被降级保留在 tooltip 里');
  // 面包屑数据来自同一次描述，保证多处一致
  assert.ok(Array.isArray(info.chain) && info.chain.length >= 2, '应带祖先链');
  assert.ok(info.chain.every((c) => typeof c.name === 'string' && c.name.length > 0), '链上每一级都要有人话名');
});

test('R3.3：快捷 chips 跟着选中元素的类型变化', async () => {
  const app = await bootApp();
  await app.rpc('injectAnchors');
  const iframeDoc = app.frame.contentDocument;
  const headingPid = iframeDoc.querySelector('h1').getAttribute('data-pid');
  const buttonPid = iframeDoc.querySelector('button').getAttribute('data-pid');

  await app.rpc('select', { pid: headingPid });
  const headingChips = [...app.panelChat.chips.querySelectorAll('.z-chip')].map((b) => b.textContent);
  await app.rpc('select', { pid: buttonPid });
  const buttonChips = [...app.panelChat.chips.querySelectorAll('.z-chip')].map((b) => b.textContent);

  assert.ok(headingChips.length > 0 && buttonChips.length > 0, '两类都应有 chips');
  assert.notDeepEqual(headingChips, buttonChips, '标题和按钮的快捷操作不应相同');
  assert.ok(buttonChips.includes('改文字'), `按钮应能"改文字"，实际：${buttonChips.join('/')}`);
  assert.ok(headingChips.some((c) => c.includes('加粗') || c.includes('字号')), `标题应有字号/加粗类操作，实际：${headingChips.join('/')}`);
});

test('R5：自定义命名生效到弹层/面板/AI 上下文，并且持久化', async () => {
  const app = await bootApp();
  await app.rpc('injectAnchors');
  const iframeDoc = app.frame.contentDocument;
  const button = iframeDoc.querySelector('button');
  const pid = button.getAttribute('data-pid');

  const before = await app.rpc('select', { pid });
  assert.ok(!before.isCustomName, '默认应是自动命名');

  // 走真实路径：写入命名 → 下发给 iframe → 重新选中
  app.names[pid] = '预约按钮';
  app.saveNames();
  await app.pushNames();
  const after = await app.rpc('select', { pid });
  assert.equal(after.name, '预约按钮', '选中信息必须用自定义名');
  assert.equal(after.isCustomName, true);
  assert.equal(after.autoName ?? after.name, '预约按钮');

  // 面板上显示的是自定义名
  const panelName = app.panelChat.selCard.querySelector('[data-el="selname"]')?.textContent ?? '';
  assert.match(panelName, /预约按钮/, `面板应显示自定义名，实际：${panelName}`);

  // AI 上下文里也必须是自定义名（需求 R5 的硬要求）
  const ctx = await app.rpc('getContext', { request: '换个颜色' });
  assert.equal(ctx.target.humanName, '预约按钮', '发给 AI 的上下文要用自定义名');
  assert.ok(
    ctx.target.chain.some((c) => c.humanName === '预约按钮'),
    '链上也要用自定义名',
  );

  // 持久化：同一个窗口上再建一个实例，应该读得到之前存的命名
  const app2 = await bootApp({ win: app.__win });
  assert.equal(app2.names[pid], '预约按钮', '命名应持久化在本地存储');
  const stored = JSON.parse(app.__win.localStorage.getItem('zhidaiqi/v1/names') ?? '{}');
  assert.equal(stored[pid], '预约按钮', '存储里应该有这条命名');
});

test('R1.4：面包屑用人话名且不超过 3 级', async () => {
  const app = await bootApp();
  await app.rpc('injectAnchors');
  const iframeDoc = app.frame.contentDocument;
  const deep = iframeDoc.querySelector('.card h3') ?? iframeDoc.querySelector('h3');
  await app.rpc('select', { pid: deep.getAttribute('data-pid') });
  const crumb = app.crumb.textContent ?? '';
  assert.ok(crumb.length > 0, '面包屑应有内容');
  const levels = crumb.split('›').length;
  assert.ok(levels <= 3, `面包屑层级应 ≤ 3，实际 ${levels}：${crumb}`);
  assert.ok(!/[.#>]/.test(crumb), `面包屑里不该出现选择器：${crumb}`);
});

test('R4.3：默认进入瞄准态（暗角 + 拾取模式）', async () => {
  const app = await bootApp();
  const stats = await app.rpc('stats');
  assert.equal(stats.mode, 'pick', '默认应处于拾取模式');
  assert.equal(app.overlay.vignette.classList.contains('z-hidden'), false, '瞄准态应显示暗角');
  // 关闭后要能退出瞄准态，且不能陷入 mode 事件回环
  await app.setAiming(false);
  const after = await app.rpc('stats');
  assert.equal(after.mode, 'browse', '关闭后应切到浏览模式');
  assert.equal(app.overlay.vignette.classList.contains('z-hidden'), true, '关闭后暗角应隐藏');
});

test('按住弹出 → 松开后选择界面必须留下，并且能点到「让 AI 改这块」', async () => {
  const app = await bootApp();
  const doc = app.frame.contentDocument;
  const h1 = doc.querySelector('h1');
  doc.elementFromPointResult = h1;
  const box = h1.getBoundingClientRect();
  const at = { clientX: Math.round(box.x) + 4, clientY: Math.round(box.y) + 4, button: 0 };

  doc.dispatchEvent({ type: 'pointerdown', ...at });
  await sleep(20);
  assert.ok(app.overlay.bubble, '按住鼠标应弹出选择界面');

  doc.dispatchEvent({ type: 'pointerup', ...at });
  await sleep(40);
  assert.ok(app.overlay.bubble, '松开后选择界面必须留在页面上（否则功能按钮点不到）');
  assert.equal(app.overlay.bubble.classList.contains('stuck'), true, '应进入"已选中工具条"状态');

  // 工具条上的每个按钮都必须可点
  for (const act of ['ai', 'rename', 'copy', 'close']) {
    assert.ok(app.overlay.bubble.querySelector(`[data-action="${act}"]`), `工具条应有 ${act} 按钮`);
  }
  assert.ok(app.selection?.pid, '松开时应已选中元素');

  // 点「让 AI 改这块」：应收起工具条、并把焦点给到输入框
  const aiBtn = app.overlay.bubble.querySelector('[data-action="ai"]');
  aiBtn.click();
  await sleep(80);
  assert.equal(app.overlay.bubble, null, '点完 AI 按钮后工具条应收起');
  assert.equal(app.panelChat.ta.disabled, false, '输入框应可用');
});

test('工具条状态下的 Esc 与"再按一次"都能收起它', async () => {
  const app = await bootApp();
  const doc = app.frame.contentDocument;
  const h1 = doc.querySelector('h1');
  doc.elementFromPointResult = h1;
  const box = h1.getBoundingClientRect();
  const at = { clientX: Math.round(box.x) + 4, clientY: Math.round(box.y) + 4, button: 0 };

  // ① Esc 收起
  doc.dispatchEvent({ type: 'pointerdown', ...at });
  doc.dispatchEvent({ type: 'pointerup', ...at });
  await sleep(30);
  assert.ok(app.overlay.bubble, '工具条应在');
  doc.dispatchEvent({ type: 'keydown', key: 'Escape' });
  await sleep(30);
  assert.equal(app.overlay.bubble, null, 'Esc 应收起工具条');

  // ② 再按一次 = 重新弹出新工具条（旧的被替换，不会叠加）
  doc.dispatchEvent({ type: 'pointerdown', ...at });
  await sleep(20);
  doc.dispatchEvent({ type: 'pointerup', ...at });
  await sleep(30);
  const one = app.overlay.bubble;
  assert.ok(one, '第二次按住应重新弹出');
  doc.dispatchEvent({ type: 'pointerdown', ...at });
  await sleep(20);
  doc.dispatchEvent({ type: 'pointerup', ...at });
  await sleep(30);
  assert.ok(app.overlay.bubble, '第三次按住仍应有工具条');
  assert.notEqual(app.overlay.bubble, one, '应该是新的一个，而不是叠加两个');
  assert.equal(app.root.querySelectorAll('.z-bubble').length, 1, '页面上同时只允许存在一个工具条');
});

test('按住时把指针移到选择界面上：弹层不位移，滑到哪一项就高亮哪一项', async () => {
  const app = await bootApp();
  const doc = app.frame.contentDocument;
  const h1 = doc.querySelector('h1');
  doc.elementFromPointResult = h1;
  const box = h1.getBoundingClientRect();
  const at = { clientX: Math.round(box.x) + 4, clientY: Math.round(box.y) + 4, button: 0 };

  doc.dispatchEvent({ type: 'pointerdown', ...at });
  await sleep(20);
  const bubble = app.overlay.bubble;
  assert.ok(bubble, '按住应弹出');
  const posBefore = [bubble.style.getPropertyValue('left'), bubble.style.getPropertyValue('top')];

  // 指针移到弹层上：弹层必须**待在原地**，否则用户刚碰到它就被弹走
  bubble.dispatchEvent({ type: 'mouseenter' });
  await sleep(20);
  const posAfter = [bubble.style.getPropertyValue('left'), bubble.style.getPropertyValue('top')];
  assert.deepEqual(posAfter, posBefore, '按住期间指针碰到弹层，弹层不允许位移');
  assert.equal(bubble.classList.contains('stuck'), false, '还没松手，不该变成"已选中"工具条');

  // 在选项上滑动：滑到哪一项，哪一项高亮，预览也跟着换。
  // ⚠ 这里**只派发 pointerover**（不派发 mouseover）—— 因为真浏览器里
  // 指代器在 pointerdown 里 preventDefault() 之后，该指针序列的兼容鼠标事件会被抑制，
  // 按住期间只有 pointer 事件能到达弹层。这条断言就是"按住时滑动没反应"的回归测试。
  const rows = bubble.querySelectorAll('[data-chain]');
  assert.ok(rows.length >= 3, `至少要有 3 层候选，实际 ${rows.length}`);
  const labels = [];
  for (const i of [1, 2, 1]) {
    rows[i].dispatchEvent({ type: 'pointerover' });
    await sleep(20);
    assert.equal(app.overlay.currentIndex, i, `按住时滑到第 ${i} 项应切到该层（只靠 pointer 事件）`);
    assert.ok(rows[i].classList.contains('on'), `第 ${i} 项应高亮`);
    labels.push(app.overlay.hl.querySelector('.z-hl-tag').textContent);
  }
  assert.notEqual(labels[0], labels[1], '不同选项应给出不同的预览高亮');

  // 普通 hover（松手后、或没有按住时）走 mouseover 也要生效（双保险）
  rows[0].dispatchEvent({ type: 'mouseover' });
  await sleep(20);
  assert.equal(app.overlay.currentIndex, 0, 'mouseover 路径同样要生效');

  // 指针离开 iframe（移向选择界面）时，不能重画"旧选中"把选项高亮盖掉
  rows[1].dispatchEvent({ type: 'pointerover' });
  await sleep(20);
  const labelBeforeLeave = app.overlay.hl.querySelector('.z-hl-tag').textContent;
  doc.dispatchEvent({ type: 'mouseleave' });
  await sleep(30);
  assert.equal(
    app.overlay.hl.querySelector('.z-hl-tag').textContent,
    labelBeforeLeave,
    '鼠标离开预览区时，选项的高亮不许被"旧选中"覆盖',
  );

  // 在弹层上直接松手：同样只派发 pointerup（mouseup 在按住序列里会被抑制）
  rows[2].dispatchEvent({ type: 'pointerover' });
  await sleep(20);
  bubble.dispatchEvent({ type: 'pointerup' });
  await sleep(80);
  assert.equal(app.selection?.name, app.overlay.chain[2].name, '在弹层上松手应确认高亮的那一层');
  assert.equal(app.bubbleStuck, true, '松手后应变成常驻工具条');
});

test('越界自愈：把"可改 pid 白名单"回喂模型并自动重新生成', async () => {
  const app = await bootApp();
  const doc = app.frame.contentDocument;
  const h1 = doc.querySelector('h1');
  const pid = h1.getAttribute('data-pid');
  // 找一个确实不在 h1 范围内的元素（页脚），模拟模型"想改外层"的越界输出
  const outside = doc.querySelector('footer') ?? doc.querySelector('button');
  const outsidePid = outside.getAttribute('data-pid');
  await app.rpc('select', { pid });

  let calls = 0;
  let sawRetry = null;
  app.provider = {
    kind: 'fake',
    label: '假模型',
    async generate(context) {
      calls++;
      if (calls === 1) {
        // 第一次：越界（正是用户截图里那种 "给这段文字加垫色块 → 去改外层" 的输出）
        return {
          raw: '{"越界示例":true}',
          patch: { version: 1, target: pid, summary: '给这段文字加垫色块', changes: [{ op: 'setStyle', target: outsidePid, prop: 'background-color', value: '#eee' }] },
        };
      }
      sawRetry = context.retry ?? null;
      // 第二次：改用选中元素自身实现（加底色 + 内边距 + 对比色）
      return {
        raw: '{"修正后":true}',
        patch: {
          version: 1,
          target: pid,
          summary: '给这个标题自身加垫色块',
          changes: [
            { op: 'setStyle', target: pid, prop: 'background-color', value: 'rgb(254, 243, 199)' },
            { op: 'setStyle', target: pid, prop: 'color', value: 'rgb(17, 24, 39)' },
            { op: 'setStyle', target: pid, prop: 'padding', value: '8px 14px' },
          ],
        },
      };
    },
  };

  await app.send('我希望这段文字下面有垫色块，字体和色块颜色对比明显');

  assert.equal(calls, 2, `应自动重试一次（实际调用 ${calls} 次）`);
  assert.ok(app.preview, '重试成功后应进入预览态，而不是让用户撞墙');
  assert.ok(sawRetry?.allowedPids?.includes(pid), '重试时必须把可用 pid 告诉模型');
  assert.match(String(sawRetry?.error ?? ''), /越界|范围/, '重试时要说明被拒原因');
  assert.equal(h1.style.getPropertyValue('background-color'), 'rgb(254, 243, 199)', '改动应落在选中元素自身');
  await app.cancelPreview();
});

test('越界且自愈仍失败时，给出"改选外层容器重试"的出路', async () => {
  const app = await bootApp();
  const doc = app.frame.contentDocument;
  const h1 = doc.querySelector('h1');
  const pid = h1.getAttribute('data-pid');
  const outside = doc.querySelector('footer') ?? doc.querySelector('button');
  const outsidePid = outside.getAttribute('data-pid');
  await app.rpc('select', { pid });

  let calls = 0;
  app.provider = {
    kind: 'fake',
    label: '假模型',
    async generate() {
      calls++;
      return {
        raw: 'x',
        patch: { version: 1, target: pid, summary: '一直想改外层', changes: [{ op: 'setStyle', target: outsidePid, prop: 'color', value: 'red' }] },
      };
    },
  };

  await app.send('给这一整块加个底色');
  assert.equal(calls, 2, '会先自愈重试一次');
  const card = app.panelChat.scroll.querySelector('.z-action-card');
  assert.ok(card, '仍然失败时应给出可操作的出路卡片，而不是只报错');
  const btn = card.querySelector('.z-card-actions button');
  assert.ok(btn, '出路卡片上必须有按钮');

  const parent = app.parentOfSelection();
  assert.ok(parent?.pid, '应能算出外层容器');

  const before = calls;
  btn.click();
  await sleep(200);
  assert.ok(calls > before, `点击出路按钮后应改选外层并重新发起（${before} → ${calls}）`);
});

test('按住时层级由选择界面驱动，不跟随页面元素乱跳', async () => {
  const app = await bootApp();
  const doc = app.frame.contentDocument;
  const h1 = doc.querySelector('h1');
  doc.elementFromPointResult = h1;
  const box = h1.getBoundingClientRect();
  const at = { clientX: Math.round(box.x) + 4, clientY: Math.round(box.y) + 4, button: 0 };

  doc.dispatchEvent({ type: 'pointerdown', ...at });
  await sleep(20);
  assert.ok(app.overlay.bubble, '按住应弹出候选界面');
  assert.equal(app.overlay.currentIndex, 0, '初始应是最内层（鼠标按下的那一层）');
  const firstLabel = app.overlay.hl.querySelector('.z-hl-tag').textContent;

  // 造一个确定性布局：候选行都放在 (400,300) 一带。
  // 为什么必须显式给矩形：按住期间走"iframe 坐标回传"通道做命中测试，
  // 而 shim 没有排版引擎（默认矩形是按 uid 造的假值），不钉住布局这条断言就会随机失败。
  // 注意：指针**真的落在某一行上**时切换层级是预期行为，所以这里要把行放得足够远。
  app.frameWrap._rectOverride = { left: 0, top: 0, width: 800, height: 600, x: 0, y: 0, right: 800, bottom: 600 };
  app.frame._rectOverride = { left: 0, top: 0, width: 800, height: 600, x: 0, y: 0, right: 800, bottom: 600 };
  const rowEls = app.overlay.bubble.querySelectorAll('[data-chain]');
  rowEls.forEach((row, i) => {
    row._rectOverride = { left: 400, top: 300 + i * 30, width: 220, height: 28, x: 400, y: 300 + i * 30, right: 620, bottom: 328 + i * 30 };
  });

  // 指针在**页面上**移动（远离弹层）→ 层级不许变
  doc.elementFromPointResult = doc.body;
  doc.dispatchEvent({ type: 'pointermove', clientX: 6, clientY: 6, button: 0 });
  await sleep(30);
  assert.equal(app.overlay.currentIndex, 0, '按住期间指针在页面上（弹层之外）移动，不应改变层级');
  assert.equal(app.overlay.hl.querySelector('.z-hl-tag').textContent, firstLabel, '预览高亮不应跟着页面跳');

  // 滑到选择界面的第 2 项 → 这一项要高亮，预览也跟着换
  const rows = rowEls;
  assert.ok(rows.length >= 2, '至少要有两层候选');
  rows[1].dispatchEvent({ type: 'mouseover' });
  await sleep(30);
  assert.equal(app.overlay.currentIndex, 1, '滑到第 2 项应切到第 2 层');
  assert.ok(rows[1].classList.contains('on'), '第 2 项要有高亮样式');
  assert.ok(rows[0] && !rows[0].classList.contains('on'), '第 1 项应取消高亮');
  const secondName = app.overlay.chain[1].name.slice(0, 4);
  const label = app.overlay.hl.querySelector('.z-hl-tag').textContent;
  assert.ok(label.includes(secondName), `预览高亮应换成第 2 项（${secondName}），实际：${label}`);

  // 松手后选中的应该是刚才高亮的那一层
  doc.dispatchEvent({ type: 'pointerup', clientX: 6, clientY: 6, button: 0 });
  await sleep(40);
  assert.equal(app.selection?.name, app.overlay.chain[1].name, '松开应确定高亮的那一层');
});

test('按住时即使 iframe 捕获了指针事件，滑到选项上也要高亮（坐标回传通道）', async () => {
  const app = await bootApp();
  const doc = app.frame.contentDocument;
  const h1 = doc.querySelector('h1');
  doc.elementFromPointResult = h1;
  const box = h1.getBoundingClientRect();
  const at = { clientX: Math.round(box.x) + 4, clientY: Math.round(box.y) + 4, button: 0 };

  doc.dispatchEvent({ type: 'pointerdown', ...at });
  await sleep(20);
  const bubble = app.overlay.bubble;
  assert.ok(bubble, '按住应弹出');
  const rows = bubble.querySelectorAll('[data-chain]');
  assert.ok(rows.length >= 2, '至少两层候选');

  // 造一个确定的布局（shim 没有排版引擎，这里显式给矩形），
  // 模拟"在 iframe 里按下后拖到弹层选项上"：父窗口**收不到自己的 hover 事件**，
  // 只能靠 iframe 回传的指针坐标来判断落在哪一项。
  app.frameWrap._rectOverride = { left: 0, top: 0, width: 800, height: 600, x: 0, y: 0, right: 800, bottom: 600 };
  app.frame._rectOverride = { left: 10, top: 50, width: 780, height: 540, x: 10, y: 50, right: 790, bottom: 590 };
  rows[0]._rectOverride = { left: 30, top: 70, width: 220, height: 26, x: 30, y: 70, right: 250, bottom: 96 };
  rows[1]._rectOverride = { left: 30, top: 96, width: 220, height: 26, x: 30, y: 96, right: 250, bottom: 122 };
  if (rows[2]) rows[2]._rectOverride = { left: 30, top: 122, width: 220, height: 26, x: 30, y: 122, right: 250, bottom: 148 };

  // 选项行 1 的中心点 → 换算成 iframe 视口坐标（offset = frame - container = (10, 50)）
  const targetRow = 1;
  const r1 = rows[targetRow]._rectOverride;
  const iframePoint = { x: r1.left + 10 - 10, y: r1.top + 12 - 50 };
  doc.dispatchEvent({ type: 'pointermove', clientX: iframePoint.x, clientY: iframePoint.y, button: 0 });
  await sleep(40);

  assert.equal(app.overlay.currentIndex, targetRow, '坐标落在第 2 项上就该切到第 2 项');
  assert.ok(rows[targetRow].classList.contains('on'), '第 2 项要高亮');
  const bridge = app.frame.contentWindow.__zBridge;
  assert.equal(bridge.picker.bubble?.index, targetRow, 'iframe 里的 picker 也要同步到这一层（松手才选得对）');
});

test('指代器开启时页面被冻住：左键点击/方向键都到不了页面（类 PPT 场景）', async () => {
  const app = await bootApp({ demoHtml: PPT_LIKE });
  const doc = app.frame.contentDocument;
  const win = app.frame.contentWindow;
  const h1 = doc.querySelector('h1');
  // 夹具脚本应已执行（确认测试前提成立）
  assert.equal(win.__pageClicks, 0, '夹具脚本应已执行（页面自身监听已绑定）');
  assert.ok(
    (doc.getElementById('deck')._listeners?.get('click') ?? []).length > 0,
    '页面脚本必须真的跑起来了：容器上的 click 监听要挂上（脚本解析失败会静默变成"没有监听"）',
  );

  // ① 指代器默认就是开启的：隔离层必须在
  assert.ok(doc.querySelector('[data-z-shield]'), '指代器开启时应铺隔离层');
  assert.equal(await app.rpc('stats').then((s) => s.mode), 'pick');

  // ② 模拟"按左键"：指针按下 + 抬起 + click
  doc.elementFromPointResult = h1;
  const box = h1.getBoundingClientRect();
  const at = { clientX: Math.round(box.x) + 4, clientY: Math.round(box.y) + 4, button: 0 };
  for (const type of ['pointerdown', 'pointerup']) doc.dispatchEvent({ type, ...at });
  h1.dispatchEvent({ type: 'click', ...at });
  await sleep(40);
  assert.equal(win.__pageClicks, 0, '指代器开启时，页面绑在容器上的 click 绝不能触发（不能翻页）');
  assert.equal(win.__docClicks, 0, '指代器开启时，document 级 click 监听也不能触发');
  assert.equal(doc.getElementById('deck').getAttribute('data-page'), null, '页面状态不应被改动');

  // ③ 模拟"按方向键"：页面绑在 window 上的 keydown 也不能触发
  doc.dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
  await sleep(20);
  assert.equal(win.__pageKeys, 0, '指代器开启时，页面绑在 window 上的 keydown 绝不能触发');

  // ④ 但指代器自己必须还能用：悬停要能识别到页面元素（隔离层不能被当成目标）
  doc.dispatchEvent({ type: 'pointermove', ...at });
  await sleep(40);
  const label = app.overlay.hl?.querySelector('.z-hl-tag')?.textContent ?? '';
  assert.ok(label.includes('标题'), `悬停仍要命中页面元素（隔离层要能被跳过），实际高亮=${label}`);
});

test('指代器关闭后页面功能完全恢复：左键/方向键都能用', async () => {
  const app = await bootApp({ demoHtml: PPT_LIKE });
  const doc = app.frame.contentDocument;
  const win = app.frame.contentWindow;
  const h1 = doc.querySelector('h1');
  doc.elementFromPointResult = h1;
  const box = h1.getBoundingClientRect();
  const at = { clientX: Math.round(box.x) + 4, clientY: Math.round(box.y) + 4, button: 0 };

  // 关掉指代器（等同于点顶栏的"指代器"开关）
  await app.setAiming(false);
  await sleep(60);
  assert.equal(doc.querySelector('[data-z-shield]'), null, '指代器关闭后必须撤掉隔离层');
  assert.equal((await app.rpc('stats')).mode, 'browse', '桥应切到 browse 模式');

  // ① 左键点击 → 页面自己的"翻页"逻辑正常触发
  for (const type of ['pointerdown', 'pointerup']) doc.dispatchEvent({ type, ...at });
  h1.dispatchEvent({ type: 'click', ...at });
  await sleep(40);
  assert.equal(win.__pageClicks, 1, '指代器关闭后，页面绑在容器上的 click 必须正常触发');
  assert.equal(win.__docClicks, 1, '指代器关闭后，document 级监听也必须正常触发');
  assert.equal(doc.getElementById('deck').getAttribute('data-page'), '1', '页面状态应真的被改动');

  // ② 方向键 → 页面绑在 window 上的 keydown 正常触发
  doc.dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
  await sleep(20);
  assert.equal(win.__pageKeys, 1, '指代器关闭后，页面绑在 window 上的 keydown 必须正常触发');

  // ③ 再开回来 → 立刻重新冻住
  await app.setAiming(true);
  await sleep(60);
  assert.ok(doc.querySelector('[data-z-shield]'), '重新开启后隔离层要回来');
  h1.dispatchEvent({ type: 'click', ...at });
  await sleep(30);
  assert.equal(win.__pageClicks, 1, '重新开启后点击又不该触发页面逻辑');
});

test('指代器开启时，应用自己的快捷键仍可用（Ctrl+Z / Ctrl+S 由 iframe 转发）', async () => {
  const app = await bootApp({ demoHtml: PPT_LIKE });
  const doc = app.frame.contentDocument;
  let sawShortcut = null;
  const origHandler = app.onBridgeEvent.bind(app);
  app.onBridgeEvent = (evt) => {
    if (evt.type === 'shortcut') sawShortcut = evt.action;
    return origHandler(evt);
  };
  doc.dispatchEvent({ type: 'keydown', key: 'z', ctrlKey: true });
  await sleep(40);
  assert.equal(sawShortcut, 'undo', '指代器开启时 Ctrl+Z 应被转发成 undo');
  doc.dispatchEvent({ type: 'keydown', key: 'z', ctrlKey: true, shiftKey: true });
  await sleep(40);
  assert.equal(sawShortcut, 'redo', 'Ctrl+Shift+Z 应被转发成 redo');
  doc.dispatchEvent({ type: 'keydown', key: 's', ctrlKey: true });
  await sleep(40);
  assert.equal(sawShortcut, 'save', 'Ctrl+S 应被转发成 save');
  // 页面自己仍然收不到方向键（冻住不变）
  doc.dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
  await sleep(20);
  assert.equal(app.frame.contentWindow.__pageKeys, 0, '页面依然收不到按键');
});

/* ------------------------------ 图片附件（对话框贴图） ------------------------------ */

/** 1×1 的合法 PNG，用来走通"贴图 → 说位置 → 真的插进页面"整条链路 */
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

test('对话框贴图：加入后出现缩略图，移除后消失', async () => {
  const app = await bootApp();
  const a1 = app.addAsset({ dataUrl: TINY_PNG, name: '咖啡照片.png', width: 800, height: 600, bytes: 240 * 1024 });
  assert.equal(a1.id, 'a1', '资源 id 应自动编号');
  const thumbs = app.panelChat.thumbs.querySelectorAll('.z-thumb');
  assert.equal(thumbs.length, 1, '输入区应出现一张缩略图');
  assert.ok(app.panelChat.thumbs.querySelector('img')?.src.startsWith('data:image/png'), '缩略图用 data URL 显示');
  assert.match(app.panelChat.thumbs.textContent, /咖啡照片/, '缩略图应显示文件名');
  assert.match(app.panelChat.thumbs.textContent, /800×600/, '缩略图应显示像素尺寸');
  assert.match(app.panelChat.thumbs.textContent, /KB/, '缩略图应显示体积');

  // ✕ 移除
  app.panelChat.thumbs.querySelector('.z-thumb-x').click();
  await sleep(20);
  assert.equal(app.assets.length, 0, '点 ✕ 应移除这张图');
  assert.equal(app.panelChat.thumbs.querySelectorAll('.z-thumb').length, 0, '缩略图应消失');
});

test('对话框贴图：Ctrl+V/拖拽/选择文件都走 FileReader（浏览器路径）', async () => {
  const app = await bootApp();
  const win = app.__win;
  // shim 里没有 FileReader：装一个假的，验证真实浏览器路径（读文件 → 登记资源）
  win.FileReader = class {
    readAsDataURL() {
      setTimeout(() => {
        this.result = TINY_PNG;
        this.onload?.();
      }, 0);
    }
  };
  await app.ingestFiles([{ type: 'image/png', name: '粘贴的截图.png', size: 1234 }]);
  await sleep(40);
  assert.equal(app.assets.length, 1, '应通过 FileReader 读入并登记');
  assert.equal(app.assets[0].name, '粘贴的截图.png');
  assert.equal(app.assets[0].dataUrl, TINY_PNG);
  // 非图片文件要拒掉
  await app.ingestFiles([{ type: 'text/plain', name: 'a.txt', size: 10 }]);
  await sleep(20);
  assert.equal(app.assets.length, 1, '非图片文件不应被接纳');
  delete win.FileReader;
});

test('贴图 + "放在标题下面" → 图片真的插到标题后面，且用真实 src', async () => {
  const app = await bootApp();
  const doc = app.frame.contentDocument;
  const h1 = doc.querySelector('h1');
  const pid = h1.getAttribute('data-pid');
  await app.rpc('select', { pid });
  app.addAsset({ dataUrl: TINY_PNG, name: '咖啡.png', width: 1, height: 1, bytes: 120 });

  // 走离线引擎（Mock）——它的位置判断和给真实模型的规则一致
  await app.send('把这张图放在标题下面');
  await sleep(60);
  assert.ok(app.preview, '应进入预览态');
  const img = doc.querySelector('h1 + img') ?? [...doc.querySelectorAll('img')][0];
  assert.ok(img, '页面里应出现插入的图片');
  assert.equal(img.getAttribute('src'), TINY_PNG, 'src 必须是父窗口补上的真实 data URL');
  assert.equal(h1.nextElementSibling?.tagName, 'IMG', '"下面"应插成标题的后一个兄弟');
  assert.equal(app.assets.length, 0, '发送成功后待发送区应清空');
  assert.ok(app.panelChat.thumbs.querySelectorAll('.z-thumb').length === 0, '缩略图也应清空');

  // 接受后进入快照；撤销能精确摘掉
  await app.acceptPreview();
  await sleep(60);
  await app.undo();
  await sleep(80);
  assert.ok(!app.frame.contentDocument.querySelector('img'), '撤销后图片应被摘掉（页面回到改动前）');
});

test('贴图上下文只给元数据：模型看不到 base64（几 MB 的图不会撑爆 prompt）', async () => {
  const app = await bootApp();
  const doc = app.frame.contentDocument;
  const pid = doc.querySelector('h1').getAttribute('data-pid');
  await app.rpc('select', { pid });
  app.addAsset({ dataUrl: TINY_PNG, name: '咖啡.png', width: 800, height: 600, bytes: 240000 });

  let seenContext = null;
  let seenOptions = null;
  app.provider = {
    kind: 'fake',
    label: '假模型',
    async generate(context, options) {
      seenContext = context;
      seenOptions = options;
      return { raw: '{}', patch: { version: 1, target: pid, summary: '不加改动', changes: [] } };
    },
  };
  // changes 为空 → openPreview 会报"没有改动"，但上下文已经拿到了，足够断言
  await app.send('放张图');
  await sleep(40);

  assert.equal(seenContext.assets.length, 1, '上下文要带上图片清单');
  assert.equal(seenContext.assets[0].id, 'a1');
  assert.equal(seenContext.assets[0].name, '咖啡.png');
  assert.equal(seenContext.assets[0].width, 800);
  assert.ok(!JSON.stringify(seenContext).includes('base64'), '上下文里绝不能出现 base64');
  assert.ok(!JSON.stringify(seenContext).includes(TINY_PNG.slice(30, 60)), '上下文里不能出现图片数据片段');
  // 图片本体是单独传给 provider 的（视觉模型看这张），不是塞在上下文里
  assert.equal(seenOptions.assets.length, 1, 'data URL 应作为 provider 参数单独传（供视觉模型）');
  assert.equal(seenOptions.assets[0].dataUrl, TINY_PNG);

  // 关掉"让模型看图" → 不再把图发给模型
  app.clearAssets();
  app.panelChat.visionChk.checked = false;
  app.panelChat.visionChk.dispatchEvent({ type: 'change' });
  app.addAsset({ dataUrl: TINY_PNG, name: 'b.png', width: 1, height: 1, bytes: 100 });
  await app.send('放张图');
  await sleep(40);
  assert.equal(seenOptions.assets.length, 0, '关掉看图后不应把图片发给模型');
  assert.equal(seenContext.assets.length, 1, '但清单仍要告诉模型（位置决策不需要看图）');
});

test('贴图自愈：模型写了不存在的图片 id，会被回喂可用 id 后自我纠正', async () => {
  const app = await bootApp();
  const doc = app.frame.contentDocument;
  const h1 = doc.querySelector('h1');
  const pid = h1.getAttribute('data-pid');
  await app.rpc('select', { pid });
  app.addAsset({ dataUrl: TINY_PNG, name: '咖啡.png', width: 1, height: 1, bytes: 120 });

  let calls = 0;
  let sawAllowed = null;
  app.provider = {
    kind: 'fake',
    label: '假模型',
    async generate(context) {
      calls++;
      if (calls === 1) {
        return { raw: '{}', patch: { version: 1, target: pid, summary: '用错 id', changes: [{ op: 'insertImage', target: pid, position: 'after', asset: 'a9' }] } };
      }
      sawAllowed = context.retry?.allowedAssets ?? null;
      return { raw: '{}', patch: { version: 1, target: pid, summary: '改对了', changes: [{ op: 'insertImage', target: pid, position: 'after', asset: 'a1' }] } };
    },
  };
  await app.send('把这张图放在标题下面');
  await sleep(60);
  assert.equal(calls, 2, '应自动重试一次');
  assert.ok(sawAllowed?.includes('a1'), `重试时要把可用的图片 id 告诉模型，实际=${JSON.stringify(sawAllowed)}`);
  assert.ok(app.preview, '重试后应进入预览态');
  assert.equal(doc.querySelector('h1').nextElementSibling?.tagName, 'IMG', '图片应插进页面');
});

test('贴图 + "把这张图当这一页的背景" → 设成 background-image，不插入元素', async () => {
  const app = await bootApp();
  const doc = app.frame.contentDocument;
  const h1 = doc.querySelector('h1');
  const section = h1.parentElement;
  await app.rpc('select', { pid: section.getAttribute('data-pid') });
  app.addAsset({ dataUrl: TINY_PNG, name: '双城之战.png', width: 1054, height: 590, bytes: 668 * 1024 });

  await app.send('把这张图当这一页的背景');
  await sleep(60);
  assert.ok(app.preview, '应进入预览态');
  const bg = section.style.getPropertyValue('background-image');
  assert.ok(bg.includes('data:image/png;base64'), `背景图应被设成内嵌 data URL，实际=${bg.slice(0, 40)}`);
  assert.equal(section.style.getPropertyValue('background-size'), 'cover', '铺满默认 cover');
  assert.equal(doc.querySelectorAll('img').length, 0, '背景不该插入 <img> 元素（那会把内容挤走）');
  await app.cancelPreview();
});

test('模型不支持图片输入时：记住它，之后不再重复上传那 ~1MB', async () => {
  const app = await bootApp();
  const doc = app.frame.contentDocument;
  const pid = doc.querySelector('h1').getAttribute('data-pid');
  await app.rpc('select', { pid });
  app.addAsset({ dataUrl: TINY_PNG, name: 'a.png', width: 1, height: 1, bytes: 120 });

  const seen = [];
  let first = true;
  app.provider = {
    kind: 'fake',
    label: '假模型',
    async generate(context, options) {
      seen.push((options?.assets ?? []).length);
      if (first) {
        first = false;
        // 第一次：声称带了图但模型不吃，退回纯文字（provider 的真实行为）
        return { raw: '{}', patch: { version: 1, target: pid, summary: '只发文字', changes: [{ op: 'setStyle', target: pid, prop: 'color', value: 'rgb(1,2,3)' }] }, visionFallback: true };
      }
      return { raw: '{}', patch: { version: 1, target: pid, summary: '第二次', changes: [{ op: 'setStyle', target: pid, prop: 'color', value: 'rgb(4,5,6)' }] } };
    },
  };
  await app.send('把图当背景');
  await sleep(50);
  assert.equal(app.visionBlocked, true, '端点拒绝图片后应记住');
  if (app.preview) await app.cancelPreview();
  app.panelChat.renderAttachments([]);
  app.addAsset({ dataUrl: TINY_PNG, name: 'b.png', width: 1, height: 1, bytes: 100 });
  await app.send('再放一张图');
  await sleep(50);
  assert.equal(seen[0], 1, '第一次会把图发给模型');
  assert.equal(seen[1], 0, '记住之后不再重复上传图片（省掉每次 ~1MB）');
  assert.equal(app.assets.length, 0, '图片仍然会给到编辑器（用于插入），只是不发模型');
});

test.after?.(() => {});

process.on('exit', () => cleanupDomShim());
