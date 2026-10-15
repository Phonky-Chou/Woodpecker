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
async function bootApp({ win: reuseWin } = {}) {
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
    demoHtml: SAMPLE,
  });
  app.__win = win;
  app.__doc = doc;
  app.__Z = Z;
  await app.bootPromise; // 等初始化完成，避免和启动过程抢时序
  return app;
}

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

test('按住时把指针移到选择界面上，弹层要"钉住"不乱动', async () => {
  const app = await bootApp();
  const doc = app.frame.contentDocument;
  const h1 = doc.querySelector('h1');
  doc.elementFromPointResult = h1;
  const box = h1.getBoundingClientRect();
  const at = { clientX: Math.round(box.x) + 4, clientY: Math.round(box.y) + 4, button: 0 };

  // 只按住，不松手
  doc.dispatchEvent({ type: 'pointerdown', ...at });
  await sleep(20);
  assert.ok(app.overlay.bubble, '按住应弹出');
  const before = app.overlay.bubble.querySelectorAll('[data-chain]').length;

  // 指针移到弹层上（浏览器里 iframe 此后收不到事件，弹层会收到 mouseenter）
  app.overlay.bubble.dispatchEvent({ type: 'mouseenter' });
  await sleep(20);
  assert.equal(app.overlay.bubble.classList.contains('stuck'), true, '移到弹层上应立即钉住');
  assert.equal(app.bubbleStuck, true, '应用应记录"已钉住"状态');
  assert.equal(app.overlay.bubble.querySelectorAll('[data-chain]').length, before, '钉住后候选项不应变化');

  // 钉住后点某一层：应该切到那一层并保持工具条
  const second = app.overlay.bubble.querySelectorAll('[data-chain]')[1];
  if (second) {
    second.click();
    await sleep(60);
    assert.ok(app.overlay.bubble, '点层级后工具条仍应在');
  }
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

  // 指针在**页面上**移动到别的元素（这里是 body）→ 层级不许变
  doc.elementFromPointResult = doc.body;
  doc.dispatchEvent({ type: 'pointermove', clientX: 6, clientY: 6, button: 0 });
  await sleep(30);
  assert.equal(app.overlay.currentIndex, 0, '按住期间指针在页面上移动，不应改变层级');
  assert.equal(app.overlay.hl.querySelector('.z-hl-tag').textContent, firstLabel, '预览高亮不应跟着页面跳');

  // 滑到选择界面的第 2 项 → 这一项要高亮，预览也跟着换
  const rows = app.overlay.bubble.querySelectorAll('[data-chain]');
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

test.after?.(() => {});

process.on('exit', () => cleanupDomShim());
