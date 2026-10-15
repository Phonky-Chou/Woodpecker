/**
 * tools/build.mjs — 生成"双击就能用"的单文件 HTML。
 *
 * 产物：out/zhidaiqi.html
 *   - 编辑器外壳（父窗口）+ 指代器/补丁执行器（会被注入进 iframe）全部内联；
 *   - 不依赖网络、不依赖构建工具，file:// 打开即可用（默认离线 Mock 模型）；
 *   - 想接真实模型时再 `node tools/serve.mjs`，在设置里切到"本地代理"。
 *
 * 开发态同一套源码走 index.html + tools/serve.mjs（带热改刷新）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'out');

/** 模块打包顺序 = 依赖顺序（每个文件只在顶层 import 前面的模块） */
const APP_MODULES = ['util.mjs', 'naming.mjs', 'schema.mjs', 'anchor.mjs', 'patch.mjs', 'selector.mjs', 'snapshot.mjs', 'systemprompt.mjs', 'provider.mjs', 'diff.mjs', 'picker.mjs', 'overlay.mjs', 'ui.mjs', 'bridge.mjs', 'app.mjs', 'selftest.mjs'];
/** 桥代码：与 app 分开打包，单独注入 iframe */
const BRIDGE_MODULES = ['util.mjs', 'naming.mjs', 'schema.mjs', 'anchor.mjs', 'patch.mjs', 'selector.mjs', 'picker.mjs', 'bridge.mjs'];

/**
 * 依赖闭合校验：每个模块 import 的目标必须出现**在它前面**。
 * 这一步是为了让"漏了一个模块"在构建时就报错，而不是打开页面白屏。
 */
function verifyDependencies(modules, label) {
  const seen = new Set();
  const problems = [];
  for (const file of modules) {
    const { deps } = readModule(file);
    for (const dep of deps) {
      if (!deps.size) continue;
      if (!modules.includes(dep)) problems.push(`${label}: ${file} 依赖 ${dep}，但它不在打包列表里`);
      else if (!seen.has(dep)) problems.push(`${label}: ${file} 依赖 ${dep}，但 ${dep} 排在它后面（顺序错误）`);
    }
    seen.add(file);
  }
  if (problems.length) {
    throw new Error(`模块依赖不闭合：\n  - ${problems.join('\n  - ')}`);
  }
}

const IMPORT_RE = /^\s*import\s+(?:\{([^}]*)\}|([A-Za-z_$][\w$]*))\s*from\s*['"]([^'"]+)['"];?\s*$/gm;
/** 再导出：export { a, b } from './x' —— 必须在普通 export 之前处理 */
const REEXPORT_RE = /^\s*export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]\s*;?\s*$/gm;
/** 声明式导出：export function f / export class C / export const x（不要求行首，前面可能有注释或代码） */
const EXPORT_DECL_RE = /(^|\n)[ \t]*export\s+(async\s+function|function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
/** 尾巴上的导出列表：export { a, b as c }; */
const EXPORT_LIST_RE = /^[ \t]*export\s*\{([^}]*)\}\s*;?[ \t]*$/gm;

function readModule(file) {
  let code = fs.readFileSync(path.join(SRC, file), 'utf8');
  const deps = new Set();
  const exportedNames = new Set();

  // 0) 先拒绝打包器不支持的写法。
  //    早期版本会把它们**静默转换错**，产出"构建成功、运行即坏"的单文件——
  //    比构建失败更危险，所以这里直接硬失败。
  if (/^\s*export\s+default\b/m.test(code)) {
    throw new Error(`${file}: 不支持 export default（打包器只支持命名导出）`);
  }

  // 1) 再导出：export { a, b } from './x'
  code = code.replace(REEXPORT_RE, (_m, list, spec) => {
    const target = spec.replace(/^\.\//, '');
    deps.add(target);
    const pairs = list
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        if (/\s+as\s+/.test(s)) {
          throw new Error(`${file}: 不支持 export { a as b } from './x' 这种重命名再导出`);
        }
        const [local, exported] = s.split(/\s+as\s+/).map((x) => x.trim());
        exportedNames.add(exported ?? local);
        return `${JSON.stringify(exported ?? local)}: __Z_REQ(${JSON.stringify(target)})[${JSON.stringify(local)}]`;
      });
    return `Object.assign(exports, {${pairs.join(', ')}});`;
  });

  // 2) import → require（只支持单行命名导入）
  code = code.replace(IMPORT_RE, (_m, named, def, spec) => {
    const target = spec.replace(/^\.\//, '');
    deps.add(target);
    if (def || !named || named.includes('*')) {
      throw new Error(`${file}: 只支持 import { a, b } from './x.mjs' 这一种写法，收到：${_m.trim()}`);
    }
    if (/\bas\b/.test(named)) {
      throw new Error(`${file}: 不支持 import { a as b }（打包器会生成非法代码），请改用原名导入`);
    }
    return `const {${named}} = __Z_REQ(${JSON.stringify(target)});`;
  });
  if (/^\s*import\s/m.test(code)) {
    const bad = code.match(/^\s*import\b.*$/m);
    throw new Error(`${file}: 有未被支持的 import 写法：${bad[0].trim()}（只支持单行命名导入）`);
  }

  // 3) 导出声明的名字先收起来（必须在改代码之前扫）
  for (const m of code.matchAll(EXPORT_DECL_RE)) {
    const local = m[3];
    exportedNames.add(local);
  }

  // 4) export function/class/const/let/var → 去掉 export（名字已在第 3 步收集）
  code = code.replace(EXPORT_DECL_RE, (_m, lead, _kw, _name) => `${lead}${_m.replace(/^(\s*)export\s+/, '$1')}`);

  // 5) 尾巴上的导出列表：export { a, b as c };
  code = code.replace(EXPORT_LIST_RE, (_m, list) => {
    const pairs = list
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const [local, exported] = s.split(/\s+as\s+/).map((x) => x.trim());
        exportedNames.add(exported ?? local);
        return `${JSON.stringify(exported ?? local)}: ${local}`;
      });
    return `Object.assign(exports, {${pairs.join(', ')}});`;
  });

  // 6) 兜底：任何还带 export 关键字的行都不许留到产物里
  if (/^\s*export\s/m.test(code)) {
    throw new Error(`${file} 里还有没转换的 export，请检查写法`);
  }

  // 7) 声明式导出统一在模块末尾挂到 exports。
  //    用 ??= 而不是直接赋值：patch.mjs 里有 `export {validatePatch} from './schema.mjs'`，
  //    如果这里用 undefined 覆盖，就会把已经正确的再导出顶掉。
  if (exportedNames.size) {
    const list = [...exportedNames].map(
      (n) => `exports[${JSON.stringify(n)}] = exports[${JSON.stringify(n)}] ?? (typeof ${n} !== 'undefined' ? ${n} : undefined)`,
    );
    code += `\n\n${list.join(';\n')};\n`;
  }

  return { code, deps };
}

/**
 * 把 JS 载荷转义成"可以安全放进 <script> 里"的文本。
 *
 * 这是内联脚本最经典的坑：载荷里任何裸的 `</script>` 都会让浏览器在那里**提前结束**脚本，
 * 后面的内容全部当纯文本渲染（打开页面只看到源码）。`<!--` 也会把解析器带进
 * "script data escaped" 状态，和后面的 `<script` 组合起来产生更诡异的行为。
 *
 * 转义方式对 JS 的三种上下文都成立：
 *   `<\/script`  —— 字符串/模板/正则里都等价于 `</script`
 *   `<\x21--`    —— 同理等价于 `<!--`（避免用 `\!--`，正则有 u 标志时会报错）
 */
function escapeForInlineScript(js) {
  return String(js)
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '<\\x21--');
}

/** JSON 块（<script type="application/json">）用 JSON 自己的转义：\/ 合法，\x21 不合法 */
function escapeForInlineJson(json) {
  const out = String(json).replace(/<\/(script)/gi, '<\\/$1');
  if (/<!--/.test(out)) {
    throw new Error('JSON 数据块里出现 "<!--"，会干扰 HTML 解析：请先替换掉');
  }
  return out;
}

/** 构建期兜底断言：进了 <script> 的载荷，绝不允许再出现裸的 </script 或 <!-- */
function assertSafePayload(payload, label) {
  if (/<\/script/i.test(payload)) {
    throw new Error(`${label}: 载荷里仍有裸的 </script>，会让浏览器提前结束脚本`);
  }
  if (/<!--/.test(payload)) {
    throw new Error(`${label}: 载荷里仍有 "<!--"，会干扰 HTML 脚本解析`);
  }
}

function bundle(modules) {
  const parts = [];
  for (const file of modules) {
    const { code } = readModule(file);
    parts.push(`__Z_DEF(${JSON.stringify(file)}, function (exports, __Z_REQ) {\n${code}\n});`);
  }
  return parts.join('\n\n');
}

/** 打包前先校验依赖闭合（顺序 + 完整性） */
function verifyAll() {
  verifyDependencies(APP_MODULES, 'app');
  verifyDependencies(BRIDGE_MODULES, 'bridge');
}

const RUNTIME = `
var __Z_CACHE = {}, __Z_INSTALLED = {};
function __Z_DEF(id, factory) {
  if (__Z_INSTALLED[id]) return;
  __Z_INSTALLED[id] = true;
  var exports = {};
  __Z_CACHE[id] = exports;
  factory(exports, __Z_REQ);
}
function __Z_REQ(id) {
  if (!__Z_CACHE[id]) throw new Error('[zhidaiqi] 模块未注册: ' + id);
  return __Z_CACHE[id];
}
`.trim();

function bridgeSource() {
  return `(function () {\nvar window = globalThis;\n${RUNTIME}\n${bundle(BRIDGE_MODULES)}\nvar __zApi = __Z_REQ('bridge.mjs');\nvar __zInst = __zApi.installBridge({ win: window, doc: window.document, token: window.__zToken || 'standalone' });\nwindow.__zBridge = __zInst;\ntry { window.parent.postMessage({ __z: 'zhidaiqi', type: 'bridge-installed', token: window.__zToken || 'standalone' }, '*'); } catch (e) {}\nreturn __zInst;\n})();`;
}

function readCss() {
  return fs.readFileSync(path.join(SRC, 'app.css'), 'utf8');
}

function buildHtml() {
  const css = readCss();
  const sample = fs.readFileSync(path.join(SRC, 'sample.html'), 'utf8');
  const rawAppCode = `
(function () {
var window = globalThis;
${RUNTIME}
${bundle(APP_MODULES)}
window.__Z__ = {
  modules: __Z_CACHE,
  req: __Z_REQ,
  bridgeSource: ${JSON.stringify(bridgeSource())},
};
})();
`.trim();

  // 关键：进 <script> 之前先转义，转义后再断言（两道保险）
  const appCode = escapeForInlineScript(rawAppCode);
  assertSafePayload(appCode, 'app 载荷');
  const sampleJson = escapeForInlineJson(JSON.stringify(sample));

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>指代器 · AI HTML 编辑器</title>
<meta name="description" content="指着元素说人话：AI 只改你选中的这一块，可预览、可撤销、可回看版本。">
<style>
${css}
</style>
</head>
<body>
<div id="app"></div>
<script type="application/json" id="z-sample">${sampleJson}</script>
<script>
${appCode}
</script>
<script>
(function () {
  var Z = window.__Z__;
  var app = new (Z.req('app.mjs').EditorApp)(document.getElementById('app'), {
    bridgeSource: Z.bridgeSource,
    demoHtml: JSON.parse(document.getElementById('z-sample').textContent)
  });
  window.__zApp = app;
  window.__zModules = Z.modules;

  // 验收/调试用的最小钩子（不参与产品逻辑）：端到端脚本与控制台都用它
  window.__ztest = {
    app: app,
    modules: Z.modules,
    get win() { return app.frame ? app.frame.contentWindow : window; },
    get doc() { return app.frame ? app.frame.contentDocument : document; },
    bridge: function () { return app.frame.contentWindow.__zBridge; },
    stats: function () { return app.rpc('stats'); },
    outerHtml: function (pid) { return app.rpc('outerHtmlOf', { pid: pid }); },
    selectCss: async function (css, request) {
      var el = this.doc.querySelector(css);
      if (!el) throw new Error('页面上找不到 ' + css);
      var pid = el.getAttribute('data-pid');
      await app.rpc('select', { pid: pid });
      return Object.assign({ hasMark: el.classList.contains('picker-selected') }, app.selection);
    },
    context: function (request) { return app.rpc('getContext', { request: request || '测试' }); },
    send: function (text) { return app.send(text); },
    accept: function () { return app.acceptPreview(); },
    cancel: function () { return app.cancelPreview(); },
    /** 应用一次 patch 再撤销，返回是否逐字节还原（自检的"取消精确性"用） */
    insertAndUndo: async function (pid, change) {
      var api = app.frame.contentWindow.__zBridge.api;
      var el = this.doc.querySelector('[data-pid="' + pid + '"]');
      if (!el) return false;
      var before = el.innerHTML;
      var res = await api.applyPatch({ patch: { version: 1, target: pid, changes: [change] } });
      await api.undoPatch({ inverse: res.inverse });
      return el.innerHTML === before;
    },
    /** 结构变化（插入/删除兄弟）后再改元素、再撤销，检查 pid 是否漂移 */
    pidStabilityCheck: async function () {
      var api = app.frame.contentWindow.__zBridge.api;
      var cards = [...this.doc.querySelectorAll('*')].filter(function (el) { return el.children.length > 0; });
      if (cards.length < 2) return { ok: false, detail: '页面上没有足够的容器元素做稳定性检查' };
      var host = cards[0];
      var kids = [...host.children];
      if (kids.length < 2) return { ok: false, detail: '第一个容器里子元素不足' };
      var kid = kids[1];
      var pidHost = host.getAttribute('data-pid');
      var pidKid = kid.getAttribute('data-pid');
      var r1 = await api.applyPatch({ patch: { version: 1, target: pidHost, changes: [{ op: 'insertHtml', target: pidHost, position: 'prepend', html: '<i>插入的</i>' }] } });
      var r2 = await api.applyPatch({ patch: { version: 1, target: pidKid, changes: [{ op: 'setHtml', target: pidKid, html: '<b>换内部</b>' }] } });
      await api.undoPatch({ inverse: r2.inverse });
      var resolved = this.doc.querySelector('[data-pid="' + pidKid + '"]');
      var sameNode = resolved === kid;
      await api.undoPatch({ inverse: r1.inverse });
      var backHost = this.doc.querySelector('[data-pid="' + pidHost + '"]');
      return {
        ok: sameNode && backHost === host,
        detail: '撤销后 pid=' + pidKid + ' 是否仍指向同一节点：' + sameNode + '；宿主锚点是否恢复：' + (backHost === host)
      };
    }
  };
})();
</script>
</body>
</html>
`;
}

function writeOut() {
  verifyAll();
  fs.mkdirSync(OUT, { recursive: true });
  const html = buildHtml();
  const file = path.join(OUT, 'zhidaiqi.html');
  fs.writeFileSync(file, html, 'utf8');
  // 桥源码单独放一份，服务端/开发页注入用
  fs.writeFileSync(path.join(OUT, 'bridge.js'), bridgeSource(), 'utf8');
  const appJs = `(function () {\nvar window = globalThis;\n${RUNTIME}\n${bundle(APP_MODULES)}\nwindow.__Z__ = { modules: __Z_CACHE, req: __Z_REQ, bridgeSource: window.__Z_BRIDGE_SRC__ || ${JSON.stringify(bridgeSource())} };\n})();\n`;
  fs.writeFileSync(path.join(OUT, 'app.bundle.js'), appJs, 'utf8');
  return { file, bytes: Buffer.byteLength(html, 'utf8') };
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain && !process.argv.includes('--export-only')) {
  const { file, bytes } = writeOut();
  console.log(`✔ 已生成单文件版本：${path.relative(ROOT, file)}（${(bytes / 1024).toFixed(1)} KB）`);
  console.log('  直接双击打开即可用（默认离线 Mock 模型）。要接真实模型：node tools/serve.mjs');
  if (process.argv.includes('--watch')) {
    console.log('  监听 src/ 变化中…');
    fs.watch(SRC, { recursive: false }, () => {
      try {
        writeOut();
        console.log(`  ↻ 重新生成 ${new Date().toLocaleTimeString()}`);
      } catch (err) {
        console.error('  构建失败：', err.message);
      }
    });
  }
}

export { buildHtml, bridgeSource, writeOut, APP_MODULES, BRIDGE_MODULES };
