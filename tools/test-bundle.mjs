/**
 * tools/test-bundle.mjs — 打包产物校验（不需要浏览器）。
 *
 * 为什么需要：源码用 ESM，引擎用"手写打包"塞进单文件。一旦某个模块的
 * import/export 没被正确转换，表现是"打开页面白屏"，而不是报错——所以必须
 * 在构建后立刻用 Node 把两段 bundle 都跑一遍。
 *
 * 校验内容：
 *   1) out/app.bundle.js 能在沙箱里执行，且关键模块与关键导出都在；
 *   2) 桥 bundle 能在沙箱里执行（用一个最小 DOM 桩），安装成功；
 *   3) 单文件 HTML 里没有残留的 import/export 语句。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out');

/* ------------------------------ 最小 DOM 桩 ------------------------------ */
/** 桥 bundle 会在 document.readyState 上做判断，并调用 injectAll/attach。这里给最小可用实现。 */
function makeDomStub() {
  const listeners = [];
  const makeEl = (tag = 'div') => {
    const el = {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      children: [],
      childNodes: [],
      attributes: [],
      style: { setProperty() {}, removeProperty() {} },
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      parentElement: null,
      isConnected: true,
      textContent: '',
      innerHTML: '',
      outerHTML: `<${tag}></${tag}>`,
      getAttribute: () => null,
      setAttribute() {},
      removeAttribute() {},
      hasAttribute: () => false,
      querySelector: () => null,
      querySelectorAll: () => [],
      contains: () => false,
      addEventListener() {},
      removeEventListener() {},
      getBoundingClientRect: () => ({ x: 0, y: 0, width: 10, height: 10, left: 0, top: 0, right: 10, bottom: 10 }),
      appendChild() {},
      remove() {},
      cloneNode: () => el,
    };
    return el;
  };
  const documentElement = makeEl('html');
  const body = makeEl('body');
  body.parentElement = documentElement;
  documentElement.children.push(body);
  return {
    readyState: 'complete',
    documentElement,
    body,
    head: makeEl('head'),
    title: 'stub',
    doctype: { name: 'html' },
    styleSheets: [],
    createElement: (t) => makeEl(t),
    createDocumentFragment: () => makeEl('fragment'),
    createTextNode: (t) => ({ nodeType: 3, textContent: t }),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (type, fn) => listeners.push({ type, fn }),
    removeEventListener() {},
    elementFromPoint: () => body,
    location: { href: 'about:blank' },
  };
}

function makeWindowStub() {
  const doc = makeDomStub();
  const win = {
    document: doc,
    parent: { postMessage() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    addEventListener() {},
    removeEventListener() {},
    setTimeout: () => 0,
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
    requestAnimationFrame: () => 0,
  };
  win.window = win;
  return win;
}

function runInSandbox(code, win) {
  const sandbox = win ?? makeWindowStub();
  sandbox.globalThis = sandbox;
  sandbox.console = console;
  sandbox.CSS = undefined;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(code, ctx, { filename: 'bundle.js', timeout: 5000 });
  return sandbox;
}

/* ------------------------------ 测试 ------------------------------ */

/** 源码与产物的最新修改时间：产物旧了就别装成"测试通过" */
function bundleIsStale() {
  const appBundle = fs.statSync(path.join(OUT, 'app.bundle.js')).mtimeMs;
  const srcDir = path.join(ROOT, 'src');
  const newer = fs
    .readdirSync(srcDir)
    .map((f) => path.join(srcDir, f))
    .filter((f) => fs.statSync(f).isFile())
    .some((f) => fs.statSync(f).mtimeMs > appBundle + 500);
  const toolFile = path.join(ROOT, 'tools', 'build.mjs');
  const toolNewer = fs.statSync(toolFile).mtimeMs > appBundle + 500;
  return newer || toolNewer;
}

test('产物是最新的（改过 src/ 或 build.mjs 必须先重新构建）', () => {
  assert.ok(!bundleIsStale(), 'out/ 里的产物比源码旧：请先执行 node tools/build.mjs 再跑本测试');
});

/* --------------------------- 源码接线契约 --------------------------- */

const SRC_DIR = path.join(ROOT, 'src');
const readSrc = (f) => fs.readFileSync(path.join(SRC_DIR, f), 'utf8');

/** app.mjs 里所有 rpc('op') 的 op 名，排除测试钩子里的调用 */
function rpcOpsInApp() {
  const code = readSrc('app.mjs');
  const ops = new Set();
  for (const m of code.matchAll(/\brpc\(\s*'([a-zA-Z][\w]*)'/g)) ops.add(m[1]);
  return [...ops].sort();
}

/** bridge.mjs 的 api 能力表里注册的 op 名 */
function bridgeOps() {
  const code = readSrc('bridge.mjs');
  const table = code.slice(code.indexOf('const api = {'), code.indexOf('const header ='));
  const ops = new Set();
  for (const m of table.matchAll(/^\s{4}([a-zA-Z][\w]*)\s*:/gm)) ops.add(m[1]);
  return [...ops].sort();
}

test('契约：app.mjs 调用的每个 rpc op 都必须在 bridge 能力表里存在', () => {
  const ops = rpcOpsInApp();
  const available = new Set(bridgeOps());
  // 这些是桥故意不提供的（属于"能力表之外"），要显式列出来，避免悄悄漏接线
  const EXPECTED_MISSING = new Set([]);
  assert.ok(ops.length >= 6, `应解析出足够多的 rpc 调用，实际只找到 ${ops.length} 个：${ops.join(',')}`);
  const missing = ops.filter((op) => !available.has(op) && !EXPECTED_MISSING.has(op));
  assert.deepEqual(
    missing,
    [],
    `app.mjs 调用了桥里不存在的 op：${missing.join(', ')}\n` +
      `  桥现有能力：${[...available].join(', ')}\n` +
      `  ⚠ 这类错误在 Node 测试里不可见，但会让浏览器里的主流程直接断掉。`,
  );
});

test('契约：rpc 里用到的 op 名没有被拼错成近义词（extractHtml / revertPatch 之类）', () => {
  const ops = new Set(rpcOpsInApp());
  for (const wrong of ['extractHtml', 'extract', 'revertPatch', 'apply', 'patch', 'getHtml', 'inject', 'serializeClean']) {
    assert.ok(!ops.has(wrong), `app.mjs 里出现了不存在或被改名的 op：${wrong}`);
  }
});

test('契约：桥的能力表里没有从未被调用的"死能力"（防止重构后留下误导性接口）', () => {
  const ops = new Set(rpcOpsInApp());
  const available = bridgeOps();
  // 容许的例外：给测试/调试用的只读能力
  const ALLOWED_UNUSED = new Set(['ping', 'state', 'stats', 'evalRead', 'describe', 'outerHtmlOf', 'getNodeHtml', 'markPreview', 'highlight', 'setTextDirect', 'scrollTo']);
  const unused = available.filter((op) => !ops.has(op) && !ALLOWED_UNUSED.has(op));
  assert.deepEqual(unused, [], `桥里有从未被 app 调用的能力（要么删掉，要么加进白名单）：${unused.join(', ')}`);
});

test('out/ 产物存在（先跑 npm run build）', () => {
  for (const f of ['app.bundle.js', 'bridge.js', 'zhidaiqi.html']) {
    assert.ok(fs.existsSync(path.join(OUT, f)), `缺少产物 ${f}，请先执行 node tools/build.mjs`);
  }
});

test('app bundle 能在沙箱里注册全部模块与关键导出', () => {
  const code = fs.readFileSync(path.join(OUT, 'app.bundle.js'), 'utf8');
  const sandbox = runInSandbox(code);
  const Z = sandbox.__Z__;
  assert.ok(Z, '应挂载 window.__Z__');
  for (const m of ['util.mjs', 'schema.mjs', 'anchor.mjs', 'patch.mjs', 'selector.mjs', 'snapshot.mjs', 'provider.mjs', 'diff.mjs', 'picker.mjs', 'bridge.mjs', 'overlay.mjs', 'ui.mjs', 'app.mjs']) {
    assert.ok(Z.req(m), `模块未注册：${m}`);
  }
  assert.equal(typeof Z.req('app.mjs').EditorApp, 'function', 'app.mjs 应导出 EditorApp');
  assert.equal(typeof Z.req('patch.mjs').applyPatch, 'function');
  assert.equal(typeof Z.req('patch.mjs').undoPatch, 'function');
  assert.equal(typeof Z.req('patch.mjs').validatePatch, 'function', 'patch.mjs 的再导出应可用');
  assert.equal(typeof Z.req('snapshot.mjs').SnapshotStore, 'function');
  assert.equal(typeof Z.req('provider.mjs').createProvider, 'function');
  assert.equal(typeof Z.req('overlay.mjs').Overlay, 'function');
  assert.equal(typeof Z.req('ui.mjs').ChatPanel, 'function');
  assert.equal(typeof Z.req('bridge.mjs').installBridge, 'function');
  assert.ok(Z.bridgeSource.includes('installBridge'), 'bridgeSource 应包含桥安装逻辑');
});

test('桥 bundle 能在最小 DOM 桩上安装成功并暴露 API', () => {
  const code = fs.readFileSync(path.join(OUT, 'bridge.js'), 'utf8');
  const sandbox = runInSandbox(code);
  assert.ok(sandbox.__zBridge, '应挂载 window.__zBridge');
  const api = sandbox.__zBridge.api;
  for (const op of ['injectAnchors', 'setMode', 'select', 'getContext', 'applyPatch', 'undoPatch', 'extractCleanHtml', 'stats']) {
    assert.equal(typeof api[op], 'function', `桥能力缺失：${op}`);
  }
});

test('打包产物里没有残留的 import/export 语句', () => {
  for (const f of ['app.bundle.js', 'bridge.js']) {
    const code = fs.readFileSync(path.join(OUT, f), 'utf8');
    assert.doesNotMatch(code, /^\s*import\s+[\w{*]/m, `${f} 残留 import`);
    assert.doesNotMatch(code, /^\s*export\s+/m, `${f} 残留 export`);
  }
});

test('单文件 HTML 自包含：内联了样式、示例页与桥源码', () => {
  const html = fs.readFileSync(path.join(OUT, 'zhidaiqi.html'), 'utf8');
  assert.match(html, /<style>[\s\S]*z-topbar/);
  assert.match(html, /id="z-sample"/);
  assert.match(html, /installBridge/);
  assert.doesNotMatch(html, /<script[^>]+src=/i, '不应引用外部脚本');
  assert.doesNotMatch(html, /<link[^>]+stylesheet/i, '不应引用外部样式');
});

test('单文件 HTML 的脚本边界必须正确（否则浏览器把源码当文本显示）', () => {
  const html = fs.readFileSync(path.join(OUT, 'zhidaiqi.html'), 'utf8');
  // 真实发生过的事故：内联脚本的字符串里出现裸的 </script>，
  // 浏览器在那里提前结束脚本，后面的 JS 全部被当纯文本渲染 —— 打开页面只看到一堆源码。
  // 这里锁死"裸 </script 只能有 3 个"（JSON 数据块 + 应用脚本 + 启动脚本）。
  const closers = html.match(/<\/script/gi) ?? [];
  assert.equal(
    closers.length,
    3,
    `裸 </script 出现 ${closers.length} 次，应为 3 次。多出来的说明有载荷没转义，浏览器会提前截断脚本。`,
  );
  // 最后一个合法闭合之后，只允许是 </body></html>
  const last = html.toLowerCase().lastIndexOf('</script');
  const tail = html.slice(last + '</script>'.length);
  assert.match(tail, /^\s*<\/body>\s*<\/html>\s*$/i, `脚本闭合之后的残留内容异常：${JSON.stringify(tail.slice(0, 200))}`);
  // "<!--" 会把解析器带进 script-data escaped 状态，和后面的 "<script" 组合会出怪问题
  const starts = html.match(/<!--/g) ?? [];
  assert.equal(starts.length, 0, `出现了 ${starts.length} 处裸的 "<!--"，会干扰脚本解析`);
});

test('产物样式：应用根容器必须撑满视口（防"下面留白"回归）', () => {
  const html = fs.readFileSync(path.join(OUT, 'zhidaiqi.html'), 'utf8');
  const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  assert.ok(css.length > 1000, '样理应内联进产物');
  // 真实踩过：布局只写在 body.z-app 上，而挂载点是 <div id="app" class="z-app">，
  // 规则从未生效 → 高度由内容决定 → 预览区只占上半屏、下面大片白边。
  const appRule = css.match(/\.z-app\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(appRule, /height:\s*100(vh|dvh)/, '.z-app 必须撑满视口高度');
  assert.match(appRule, /display:\s*grid/, '.z-app 应是栅格容器（顶栏 + 主区两行）');
  assert.doesNotMatch(css, /body\.z-app\s*\{[^}]*(display:\s*grid|height:\s*100)/, '布局规则不能只挂在 body.z-app 上');
  // 主区必须能收缩，否则内部滚动条会把布局顶开
  assert.match(css, /\.z-main\s*\{[^}]*min-height:\s*0/, '.z-main 需要 min-height:0');
});

test('本地代理的请求体上限必须放得下图片（防 "Failed to fetch" 回归）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'serve.mjs'), 'utf8');
  const m = src.match(/const MAX_BODY = (\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)/);
  assert.ok(m, 'serve.mjs 里应有 MAX_BODY 常量（别把上限写死成一个小数字）');
  const bytes = Number(m[1]) * Number(m[2]) * Number(m[3]);
  // 真踩过：上限 512KB 时，用户一张 668KB 的图（base64 后 ~891KB）会让请求被掐断，
  // 浏览器只报一句 "Failed to fetch"，完全看不出原因。图片是 base64 内嵌进请求体的，必须留足余量。
  assert.ok(bytes >= 8 * 1024 * 1024, `MAX_BODY 太小：${Math.round(bytes / 1024)}KB（至少 8MB，图片是 base64 内嵌的）`);
  assert.match(src, /tooLarge/, '超限时要回 413 且带上可操作的提示，而不是把连接掐断');
});

test('单文件 HTML 的脚本块结构正确，脚本之外没有 JS 泄露', () => {
  const html = fs.readFileSync(path.join(OUT, 'zhidaiqi.html'), 'utf8');

  // ① 三个脚本块：JSON 数据块 + 应用 bundle + 启动脚本
  const blocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.equal(blocks.length, 3, `脚本块应为 3 个，实际 ${blocks.length} 个`);
  assert.match(blocks[0][1], /application\/json/, '第一个脚本块应是示例页 JSON');

  // ② JSON 数据块必须仍是合法 JSON（转义不能破坏它）
  const sample = JSON.parse(blocks[0][2]);
  assert.equal(typeof sample, 'string');
  assert.match(sample, /<html/);

  // ③ 应用块必须真的装着应用代码
  assert.match(blocks[1][2], /window\.__Z__/, '第二个脚本块应包含应用 bundle');
  assert.match(blocks[1][2], /EditorApp/);

  // ④ 最关键：脚本标签之外不允许出现任何 JS 片段。
  //    这正是"内联脚本被提前结束、后面的代码被当纯文本渲染"的故障形态。
  const outsideScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
  assert.doesNotMatch(
    outsideScripts,
    /(__Z_DEF|__Z_REQ|exports\[|window\.__Z__|runSelfTest|installBridge)/,
    '脚本之外出现了 JS 代码，说明脚本被提前截断（浏览器会把源码当文本显示）',
  );
});
