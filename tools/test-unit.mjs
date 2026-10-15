/**
 * tools/test-unit.mjs — 纯逻辑单元测试（不需要浏览器）。
 * 只测"最怕出错"的那几层：锚点哈希、patch 校验、范围边界、模型输出解析、快照栈、diff。
 *
 * 运行：node tools/test-unit.mjs     （或 npm test）
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Windows 上动态 import 必须是 file:// URL，直接给盘符路径会 ERR_UNSUPPORTED_ESM_URL_SCHEME
const SRC = (f) => pathToFileURL(path.join(ROOT, 'src', f)).href;

const util = await import(SRC('util.mjs'));
const schema = await import(SRC('schema.mjs'));
const snapshot = await import(SRC('snapshot.mjs'));
const provider = await import(SRC('provider.mjs'));
const diff = await import(SRC('diff.mjs'));
const anchor = await import(SRC('anchor.mjs'));

/* ------------------------------ util ------------------------------ */

test('stableId 对同一输入永远一致（pid 跨会话稳定的前提）', () => {
  const a = util.stableId('html:0>body:0>main:0>h1:0');
  const b = util.stableId('html:0>body:0>main:0>h1:0');
  const c = util.stableId('html:0>body:0>main:0>h1:1');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^p-[0-9a-f]{8}$/);
});

test('extractJson 能剥掉 Markdown 围栏与前后废话', () => {
  const raw = '好的，这是结果：\n```json\n{"version":1,"changes":[{"op":"removeNode","target":"p-1"}]}\n```\n希望有帮助！';
  const parsed = util.extractJson(raw);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.changes[0].op, 'removeNode');
});

test('extractJson 处理嵌套对象与字符串里的花括号', () => {
  const raw = '前缀 {"a":{"b":"这里有 } 花括号"},"c":[1,2]} 后缀';
  assert.deepEqual(util.extractJson(raw), { a: { b: '这里有 } 花括号' }, c: [1, 2] });
});

test('extractJson 对非 JSON 抛错而不是静默返回垃圾', () => {
  assert.throws(() => util.extractJson('我改好了，请查看页面。<div>坏东西</div>'));
});

/* ------------------------------ schema ------------------------------ */

const pid = 'p-11111111';

test('validatePatch 接受合法的 Patch v1', () => {
  const patch = schema.validatePatch({
    version: 1,
    target: pid,
    summary: '标题变大变蓝',
    changes: [
      { op: 'setStyle', target: pid, prop: 'font-size', value: '48px' },
      { op: 'setStyle', target: pid, prop: 'color', value: '#2563eb' },
    ],
  });
  assert.equal(patch.changes.length, 2);
  assert.equal(patch.changes[0].prop, 'font-size');
});

test('validatePatch 拆出 !important 到 priority', () => {
  const patch = schema.validatePatch({ changes: [{ op: 'setStyle', target: pid, prop: 'color', value: 'red !important' }] });
  assert.equal(patch.changes[0].value, 'red');
  assert.equal(patch.changes[0].priority, 'important');
});

test('validatePatch 拒绝空 changes / 非数组 / 未知 op', () => {
  assert.throws(() => schema.validatePatch({ changes: [] }), /不能为空/);
  assert.throws(() => schema.validatePatch({ changes: 'nope' }), /必须是数组/);
  assert.throws(() => schema.validatePatch({ changes: [{ op: 'setInnerHTML', target: pid, html: 'x' }] }), /op 不支持/);
});

test('validatePatch 拒绝整页重写式的超量改动', () => {
  const changes = Array.from({ length: 51 }, () => ({ op: 'setText', target: pid, value: 'x' }));
  assert.throws(() => schema.validatePatch({ changes }), /上限 50/);
});

test('validatePatch 保护锚点与安全边界：pid / on* / style / class 属性一律拒绝', () => {
  for (const name of ['data-pid', 'onclick', 'ONMOUSEOVER', 'style', 'srcdoc']) {
    assert.throws(
      () => schema.validatePatch({ changes: [{ op: 'setAttr', target: pid, name, value: 'x' }] }),
      /被禁止/,
      `应拒绝属性 ${name}`,
    );
  }
  // class 允许改（不在黑名单）
  const ok = schema.validatePatch({ changes: [{ op: 'setAttr', target: pid, name: 'class', value: 'hero' }] });
  assert.equal(ok.changes[0].name, 'class');
});

test('validatePatch 的样式白名单拦住 position:fixed 之外的野属性', () => {
  assert.throws(() => schema.validatePatch({ changes: [{ op: 'setStyle', target: pid, prop: 'behavior', value: 'x' }] }), /不在白名单/);
  assert.throws(() => schema.validatePatch({ changes: [{ op: 'setStyle', target: pid, prop: 'font-size', value: '16px; color: red' }] }), /不允许包含/);
  assert.throws(() => schema.validatePatch({ changes: [{ op: 'setStyle', target: pid, prop: 'background-image', value: 'url(javascript:alert(1))' }] }), /危险/);
  // null = 删除该行内样式，允许
  const del = schema.validatePatch({ changes: [{ op: 'setStyle', target: pid, prop: 'color', value: null }] });
  assert.equal(del.changes[0].value, null);
});

test('validatePatchScope 拦住越界改动（AI 只许改选中范围）', () => {
  const patch = schema.validatePatch({ changes: [{ op: 'setText', target: 'p-outside', value: 'x' }] });
  assert.throws(() => schema.validatePatchScope(patch, (p) => p === pid), /越界/);
  assert.doesNotThrow(() => schema.validatePatchScope(patch, (p) => p === 'p-outside'));
});

test('insertHtml 的 position 白名单', () => {
  assert.throws(() => schema.validatePatch({ changes: [{ op: 'insertHtml', target: pid, html: '<b>x</b>', position: 'middle' }] }), /position/);
  const ok = schema.validatePatch({ changes: [{ op: 'insertHtml', target: pid, html: '<b>x</b>', position: 'append' }] });
  assert.equal(ok.changes[0].position, 'append');
});

/* ------------------------------ 模型输出解析 ------------------------------ */

test('coerceToPatch 容忍：裸数组、单条 op、operations 字段、缺 target', () => {
  const ctx = { target: { pid } };
  const fromArray = provider.coerceToPatch([{ op: 'setText', value: 'hi' }], ctx);
  assert.equal(fromArray.changes[0].target, pid);
  const fromSingle = provider.coerceToPatch({ op: 'setText', value: 'hi' }, ctx);
  assert.equal(fromSingle.changes.length, 1);
  const fromOps = provider.coerceToPatch({ operations: [{ op: 'setText', target: pid, value: 'hi' }] }, ctx);
  assert.equal(fromOps.changes.length, 1);
  const fromEdits = provider.coerceToPatch({ edits: [{ op: 'setText', target: pid, value: 'hi' }] }, ctx);
  assert.equal(fromEdits.changes.length, 1);
});

test('parseModelOutput 把自由文本变成合法 patch', () => {
  const ctx = { target: { pid } };
  const { patch } = provider.parseModelOutput('```json\n{"changes":[{"op":"setText","value":"新标题"}]}\n```', ctx);
  assert.equal(patch.changes[0].target, pid);
  assert.equal(patch.changes[0].value, '新标题');
});

test('parseModelOutput 对纯 HTML 回复直接报错（绝不当作可执行内容）', () => {
  const ctx = { target: { pid } };
  assert.throws(() => provider.parseModelOutput('<h1 style="font-size:48px">标题</h1>', ctx), /无法解析为合法 patch/);
});

test('validatePatch 拦住属性值里的 XSS（只校验属性名是不够的）', () => {
  // 回归：曾经 setAttr 只查名字，href="javascript:..." / src="data:text/html,..." 都能写进 DOM
  const bad = [
    { name: 'href', value: 'javascript:alert(1)' },
    { name: 'src', value: 'data:text/html,<script>alert(1)</script>' },
    { name: 'xlink:href', value: 'javascript:void(0)' },
    { name: 'formaction', value: 'javascript:alert(1)' },
    { name: 'poster', value: 'vbscript:msgbox(1)' },
  ];
  for (const b of bad) {
    assert.throws(
      () => schema.validatePatch({ changes: [{ op: 'setAttr', target: pid, name: b.name, value: b.value }] }),
      /被拒绝/,
      `${b.name}=${b.value} 必须被拒绝`,
    );
  }
  // 正常值必须放行
  for (const ok of [
    { name: 'href', value: 'https://example.com/doc' },
    { name: 'href', value: '/local/path' },
    { name: 'href', value: '#anchor' },
    { name: 'src', value: 'data:image/png;base64,AAA' },
    { name: 'title', value: '随便写 javascript: 文本' },
  ]) {
    assert.doesNotThrow(() => schema.validatePatch({ changes: [{ op: 'setAttr', target: pid, name: ok.name, value: ok.value }] }), `${ok.name}=${ok.value} 应该放行`);
  }
});

test('validatePatch 继续拒绝 data-z-* 属性（编辑器命名空间）', () => {
  assert.throws(
    () => schema.validatePatch({ changes: [{ op: 'setAttr', target: pid, name: 'data-z-chrome', value: '1' }] }),
    /被禁止/,
  );
});

/* ------------------------------ Mock Provider ------------------------------ */

const mockCtx = (request, computed = {}) => ({
  target: { pid, computed, outerHtml: '<h1 data-pid="' + pid + '">标题</h1>', tag: 'h1' },
  request,
  history: [],
});

test('mockPatch：大字 → font-size 放大', () => {
  const patch = schema.validatePatch(provider.mockPatch(mockCtx('标题大一点', { 'font-size': '32px' })));
  const change = patch.changes.find((c) => c.prop === 'font-size');
  assert.ok(change, '应有 font-size 改动');
  assert.equal(change.value, '45px'); // 32 * 1.4 取整
});

test('mockPatch：小一点 → 缩小', () => {
  const patch = provider.mockPatch(mockCtx('字小一点', { 'font-size': '20px' }));
  assert.equal(patch.changes[0].value, '16px');
});

test('mockPatch：颜色与背景色区分开', () => {
  const blue = provider.mockPatch(mockCtx('文字换成蓝色'));
  assert.equal(blue.changes[0].prop, 'color');
  assert.equal(blue.changes[0].value, '#2563eb');
  const bg = provider.mockPatch(mockCtx('背景改成浅蓝'));
  assert.equal(bg.changes[0].prop, 'background-color');
  assert.equal(bg.changes[0].value, '#38bdf8');
});

test('mockPatch：删掉 → removeNode；加按钮 → insertHtml', () => {
  const del = provider.mockPatch(mockCtx('把这个删掉'));
  assert.equal(del.changes[0].op, 'removeNode');
  const add = provider.mockPatch(mockCtx('下面加一个按钮'));
  assert.equal(add.changes[0].op, 'insertHtml');
  assert.match(add.changes[0].html, /button/);
});

test('mockPatch：换文字', () => {
  const patch = provider.mockPatch(mockCtx('标题改成 你好世界'));
  const t = patch.changes.find((c) => c.op === 'setText');
  assert.ok(t);
  assert.equal(t.value, '你好世界');
});

test('mockPatch 的输出永远能过校验（离线演示不会翻车）', () => {
  const samples = ['大一点', '小一点', '变蓝', '加粗', '居中', '圆角大一点', '间距宽松一点', '行高一点', '加阴影', '删掉', '换文字改成测试', '随便说点什么'];
  for (const s of samples) {
    const raw = provider.mockPatch(mockCtx(s, { 'font-size': '18px', padding: '8px' }));
    assert.doesNotThrow(() => schema.validatePatch(raw), `mock 输出不合法：${s}`);
  }
});

/* ------------------------------ diff ------------------------------ */

test('describePatch 给出人话摘要', () => {
  const patch = schema.validatePatch({
    summary: '放大并变蓝',
    changes: [
      { op: 'setStyle', target: pid, prop: 'font-size', value: '48px' },
      { op: 'setText', target: pid, value: '标题' },
      { op: 'setAttr', target: pid, name: 'class', value: null },
    ],
  });
  const rows = diff.describePatch(patch);
  assert.equal(rows.length, 3);
  assert.match(rows[0].text, /font-size → 48px/);
  assert.match(rows[1].text, /文本 → “标题”/);
  assert.match(rows[2].text, /删除属性 class/);
  assert.match(diff.patchToText(patch), /摘要：放大并变蓝/);
});

test('structuralDelta 报出标签增减与字节差', () => {
  const before = '<div><p>a</p></div>';
  const after = '<div><p>a</p><p>b</p></div>';
  const d = diff.structuralDelta(before, after);
  assert.deepEqual(d.added, ['p +1']);
  assert.ok(d.bytes > 0);
  assert.equal(d.changed, true);
});

/* ------------------------------ 快照栈 ------------------------------ */

const htmlOf = (n) => `<!DOCTYPE html><html><body><h1>v${n}</h1></body></html>`;

test('快照栈：接受即入栈，撤销/重做按序回到各版本', () => {
  const store = new snapshot.SnapshotStore({ storage: snapshot.createMemoryStorage() });
  store.initWorkspace({ name: 't.html', html: htmlOf(0) });
  for (let i = 1; i <= 3; i++) {
    store.push({ html: htmlOf(i), label: `第 ${i} 次改动`, source: 'ai', patch: { version: 1, target: pid, summary: `改${i}`, changes: [] } });
  }
  assert.equal(store.current().html, htmlOf(3));
  assert.equal(store.undo().html, htmlOf(2));
  assert.equal(store.undo().html, htmlOf(1));
  assert.equal(store.undo().html, htmlOf(0));
  assert.equal(store.canUndo(), false, '到初始版本后不能再撤销');
  assert.equal(store.redo().html, htmlOf(1));
  assert.equal(store.redo().html, htmlOf(2));
  assert.equal(store.redo().html, htmlOf(3));
  assert.equal(store.canRedo(), false);
  // 逐级撤销回初始（验收标准 3）
  store.undo(); store.undo(); store.undo();
  assert.equal(store.current().html, htmlOf(0));
});

test('快照栈：撤销后再改动会砍掉未来分支', () => {
  const store = new snapshot.SnapshotStore({ storage: null });
  store.initWorkspace({ name: 't', html: htmlOf(0) });
  store.push({ html: htmlOf(1), label: 'a' });
  store.push({ html: htmlOf(2), label: 'b' });
  store.undo();
  assert.equal(store.list().length, 3);
  assert.equal(store.list()[2].future, true);
  store.push({ html: 'X', label: 'c' });
  assert.equal(store.list().length, 3);
  assert.equal(store.list().at(-1).label, 'c');
  assert.equal(store.list().some((s) => s.future), false);
});

test('快照栈：可跳到任意版本（历史回看还原）', () => {
  const store = new snapshot.SnapshotStore({ storage: null });
  store.initWorkspace({ name: 't', html: htmlOf(0) });
  store.push({ html: htmlOf(1), label: '一' });
  store.push({ html: htmlOf(2), label: '二' });
  store.push({ html: htmlOf(3), label: '三' });
  assert.equal(store.jumpTo(1).html, htmlOf(1));
  assert.equal(store.current().label, '一');
  assert.equal(store.jumpTo(store.list()[3].id).html, htmlOf(3));
  assert.equal(store.jumpTo(99), null);
});

test('快照栈：超过上限丢最老的但保留初始版本', () => {
  const store = new snapshot.SnapshotStore({ storage: null, maxSnapshots: 5 });
  store.initWorkspace({ name: 't', html: htmlOf(0) });
  for (let i = 1; i <= 10; i++) store.push({ html: htmlOf(i), label: `v${i}` });
  assert.equal(store.list().length, 5);
  assert.equal(store.list()[0].label, '初始版本');
  assert.equal(store.current().html, htmlOf(10));
});

test('快照栈：持久化后可恢复（关掉浏览器再打开还在）', () => {
  const storage = snapshot.createMemoryStorage();
  const a = new snapshot.SnapshotStore({ storage });
  a.initWorkspace({ name: 'page.html', html: htmlOf(0) });
  a.push({ html: htmlOf(1), label: '改了标题', source: 'ai', prompt: '标题大一点' });
  const b = new snapshot.SnapshotStore({ storage });
  assert.equal(b.restore(), true);
  assert.equal(b.list().length, 2);
  assert.equal(b.current().html, htmlOf(1));
  assert.equal(b.current().prompt, '标题大一点');
  assert.equal(b.workspace.name, 'page.html');
});

test('快照栈：导出/导入工程可以跨设备继续改', () => {
  const store = new snapshot.SnapshotStore({ storage: null });
  store.initWorkspace({ name: 't', html: htmlOf(0) });
  store.push({ html: htmlOf(1), label: '一' });
  const project = store.exportProject();
  const other = new snapshot.SnapshotStore({ storage: null });
  assert.equal(other.importProject(project), true);
  assert.equal(other.list().length, 2);
  assert.equal(other.current().html, htmlOf(1));
  assert.equal(other.importProject({ kind: 'nope' }), false);
});

/* ------------------------------ anchor 纯函数 ------------------------------ */

test('pathKey 生成结构路径，同级同类元素序号递增', () => {
  // 用假元素测路径拼接（不需要真 DOM）
  const mk = (tag, parent, indexAmongSameTag) => {
    const el = {
      nodeType: 1,
      tagName: tag,
      parentElement: parent,
      getAttribute: () => null,
    };
    if (parent) {
      parent.children = parent.children ?? [];
      parent.children.push(el);
      el._index = indexAmongSameTag;
    }
    return el;
  };
  const html = mk('HTML', null);
  const body = mk('BODY', html);
  const main = mk('MAIN', body);
  const h1a = mk('H1', main);
  const p = mk('P', main);
  const h1b = mk('H1', main);
  assert.equal(anchor.pathKey(h1a), 'html:0>body:0>main:0>h1:0');
  assert.equal(anchor.pathKey(p), 'html:0>body:0>main:0>p:0');
  assert.equal(anchor.pathKey(h1b), 'html:0>body:0>main:0>h1:1');
});
