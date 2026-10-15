/**
 * tools/test-dom-smoke.mjs — 用最小 DOM 实现跑"真实链路"烟测。
 *
 * 覆盖：锚点全量注入 → 元素链 → 按 pid 取上下文 → 结构化 patch 应用
 *       → 取消精确回滚 → 越界拒绝 → 干净导出 → 撤销后 pid 依旧有效
 *
 * 说明：这不是浏览器，渲染与真实 CSS 级联不在这里证明（那由页面内自检负责）。
 * 它证明的是"没有浏览器时，逻辑链路依然是通的"，属于补强而不是替代。
 *
 * 运行：node tools/test-dom-smoke.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { loadDomShim, cleanupDomShim } from './dom-shim.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = (f) => pathToFileURL(path.join(ROOT, 'src', f)).href;

const { parseDocument } = loadDomShim();
const { AnchorManager, selectorPath } = await import(SRC('anchor.mjs'));
const { Picker } = await import(SRC('picker.mjs'));
const { applyPatch, undoPatch, sanitizeHtmlFragment, scrubEditorArtifacts } = await import(SRC('patch.mjs'));
const { buildContext } = await import(SRC('selector.mjs'));
const { mockPatch } = await import(SRC('provider.mjs'));
const { validatePatch } = await import(SRC('schema.mjs'));
const promptModule = await import(SRC('systemprompt.mjs'));

const SAMPLE = fs.readFileSync(path.join(ROOT, 'src', 'sample.html'), 'utf8');

function fresh() {
  const { window, document } = parseDocument(SAMPLE);
  const anchor = new AnchorManager(document);
  anchor.injectAll();
  return { window, document, anchor };
}

test('最小 DOM 能解析出示例页的主体结构', () => {
  const { document } = fresh();
  assert.equal(document.querySelector('h1').textContent.trim(), '一杯喝得出经纬度的咖啡');
  assert.equal(document.querySelectorAll('.card').length, 3);
  assert.equal(document.querySelectorAll('.hero h1').length, 1);
});

test('全量注入后所有元素都有唯一 data-pid', () => {
  const { document } = fresh();
  const all = document.querySelectorAll('*');
  const pids = new Set();
  let missing = 0;
  for (const el of all) {
    const pid = el.getAttribute('data-pid');
    if (!pid) missing++;
    else pids.add(pid);
  }
  assert.equal(missing, 0, '不应有元素缺 pid');
  assert.equal(pids.size, all.length, 'pid 必须唯一');
});

test('pid 可复现：同一份 HTML 两次解析得到同一套锚点', () => {
  const a = fresh();
  const b = fresh();
  const pa = a.document.querySelectorAll('[data-pid]').map((el) => [selectorPath(el), el.getAttribute('data-pid')]);
  const pb = b.document.querySelectorAll('[data-pid]').map((el) => [selectorPath(el), el.getAttribute('data-pid')]);
  assert.deepEqual(pa, pb);
});

test('pick → context → 结构化 patch → 预览 → 取消（逐字节还原）', () => {
  const { window, document, anchor } = fresh();
  const picker = new Picker({ doc: document, win: window, anchor, emit: () => {} });
  const h1 = document.querySelector('.hero h1');
  const pid = anchor.ensure(h1);

  // 1) 选中（等价于指代器点泡泡）
  const info = picker.select(pid);
  assert.equal(info.tag, 'h1');
  assert.ok(h1.classList.contains('picker-selected'), '选中应带 .picker-selected');

  // 2) 元素链：从 h1 往外
  document.elementFromPointResult = h1;
  const chain = picker.chainAt(10, 10).map((el) => el.tagName.toLowerCase());
  assert.equal(chain[0], 'h1');
  assert.ok(chain.includes('body') && chain.at(-1) === 'html', chain.join('>'));

  // 3) 上下文（这就是发给模型的东西）
  const ctx = buildContext({ win: window, doc: document, el: h1, pid, request: '标题大一点，换成深蓝' });
  assert.equal(ctx.target.pid, pid);
  assert.match(ctx.target.selectorPath, /h1/);
  assert.ok(ctx.target.computed['font-size'], '应带上计算样式');
  assert.ok(ctx.target.matchedCssRules.length >= 0);

  // 4) "模型"输出 → patch
  const raw = mockPatch(ctx);
  const patch = validatePatch(raw);
  assert.ok(patch.changes.length > 0);

  const before = h1.outerHTML;
  const result = applyPatch(document, picker.selectedPid ? anchor.resolve(picker.selectedPid) : h1, patch);
  assert.equal(result.applied.length, patch.changes.length);
  const after = h1.outerHTML;
  assert.notEqual(after, before, '预览应真的改了 DOM');
  assert.ok(h1.style.getPropertyValue('font-size'), '字号应被设置');

  // 5) 取消 → 精确回滚
  undoPatch(document, result.inverse);
  assert.equal(h1.outerHTML, before, '取消后应逐字节还原');
  assert.equal(h1.getAttribute('data-pid'), pid, '锚点必须还在');
});

test('越界改动被拒绝，且 DOM 一个字符都没动', () => {
  const { document, anchor } = fresh();
  const h1 = document.querySelector('.hero h1');
  const footer = document.querySelector('footer');
  const before = document.body.innerHTML;
  assert.throws(
    () =>
      applyPatch(document, h1, {
        version: 1,
        target: anchor.pidOf(h1),
        changes: [{ op: 'setStyle', target: anchor.pidOf(footer), prop: 'color', value: 'red' }],
      }),
    /越界/,
  );
  assert.equal(document.body.innerHTML, before, '被拒绝时不允许留下半成品改动');
});

test('锚点保护：patch 无法改写 data-pid', () => {
  const { document, anchor } = fresh();
  const h1 = document.querySelector('.hero h1');
  const pid = anchor.pidOf(h1);
  assert.throws(
    () => applyPatch(document, h1, { version: 1, target: pid, changes: [{ op: 'setAttr', target: pid, name: 'data-pid', value: 'hacked' }] }),
    /被禁止/,
  );
  assert.equal(h1.getAttribute('data-pid'), pid);
});

test('脚本注入被剥离，setHtml 之后新节点也拿到锚点', () => {
  const { document, anchor } = fresh();
  const h1 = document.querySelector('.hero h1');
  const pid = anchor.pidOf(h1);
  const result = applyPatch(document, h1, {
    version: 1,
    target: pid,
    changes: [{ op: 'setHtml', target: pid, html: '<b class="x">粗</b><script>window.pwned=1<\/script>' }],
  });
  assert.equal(h1.querySelectorAll('script').length, 0, '脚本节点应被剥离');
  const bold = h1.querySelector('b');
  assert.ok(bold, '正常标签应保留');
  assert.ok(bold.getAttribute('data-pid'), '新插入的节点必须补上 pid');
  undoPatch(document, result.inverse);
  assert.ok(h1.textContent.includes('经纬度'), '回滚后原文案应恢复');
});

test('insertHtml / removeNode 的撤销都能恢复原状', () => {
  const { document, anchor } = fresh();
  const card = document.querySelector('.card');
  const pid = anchor.pidOf(card);
  const before = card.parentElement.innerHTML;

  let result = applyPatch(document, card, {
    version: 1,
    target: pid,
    changes: [{ op: 'insertHtml', target: pid, position: 'after', html: '<p class="added">插进来的</p>' }],
  });
  assert.ok(card.parentElement.querySelector('.added'), '应插入成功');
  undoPatch(document, result.inverse);
  assert.equal(card.parentElement.innerHTML, before, '插入的撤销应恢复原状');

  // 撤销走的是"父节点快照还原"，旧引用会变悬空——这正是浏览器里的真实语义，
  // 所以这里必须重新取一次（应用里靠 pid 重新解析，不持有元素引用）。
  const card2 = document.querySelector('.card');
  const pid2 = anchor.pidOf(card2);
  result = applyPatch(document, card2, { version: 1, target: pid2, changes: [{ op: 'removeNode', target: pid2 }] });
  assert.equal(card2.parentElement, null, '应被移除');
  assert.equal(document.querySelectorAll('.card').length, 2, '应少一张卡片');
  undoPatch(document, result.inverse);
  assert.equal(document.querySelectorAll('.card').length, 3, '删除的撤销应把元素放回来');
  assert.ok(document.querySelector('.card').getAttribute('data-pid'), '放回来的元素应保留锚点');
});

test('事务性：改动中途出错时，前面已应用的改动必须被回滚', () => {
  const { document, anchor } = fresh();
  const card = document.querySelector('.card');
  const other = document.querySelector('footer');
  const pid = anchor.pidOf(card);
  const beforeBody = document.body.innerHTML;

  // 第一条合法（改标题文字），第二条越界（改 footer）→ 整单必须回滚
  assert.throws(
    () =>
      applyPatch(document, card, {
        version: 1,
        target: pid,
        changes: [
          { op: 'setText', target: pid, value: '被改坏的文字' },
          { op: 'setStyle', target: anchor.pidOf(other), prop: 'color', value: 'red' },
        ],
      }),
    /越界/,
  );
  assert.equal(document.body.innerHTML, beforeBody, '中途失败必须回滚，不能留下"改了一半"的页面');
  assert.ok(!document.body.innerHTML.includes('被改坏的文字'));
});

test('同一个 patch 里删掉选中元素后再改它，明确报越界而不是内部错误', () => {
  const { document, anchor } = fresh();
  const card = document.querySelector('.card');
  const pid = anchor.pidOf(card);
  const beforeBody = document.body.innerHTML;
  assert.throws(
    () =>
      applyPatch(document, card, {
        version: 1,
        target: pid,
        changes: [
          { op: 'removeNode', target: pid },
          { op: 'setText', target: pid, value: 'x' },
        ],
      }),
    /越界|找不到/,
  );
  assert.equal(document.body.innerHTML, beforeBody, '删除也必须回滚');
});

test('撤销后锚点不漂移：同一个元素的 pid 必须没变', () => {
  const { document, anchor } = fresh();
  const card = document.querySelector('.card');
  const pid = anchor.pidOf(card);
  const res = applyPatch(document, card, { version: 1, target: pid, changes: [{ op: 'removeNode', target: pid }] });
  assert.equal(document.querySelectorAll('.card').length, 2);
  undoPatch(document, res.inverse);
  const back = document.querySelector('.card');
  assert.equal(anchor.pidOf(back), pid, '撤销后 pid 不能变成 p-xxx-1 之类的漂移值');
  assert.equal(anchor.resolve(pid), back, 'resolve(pid) 必须命中同一个元素');
  assert.equal(document.querySelectorAll('[data-pid]').length, new Set(document.querySelectorAll('[data-pid]').map((el) => el.getAttribute('data-pid'))).size, 'DOM 里不允许出现重复 pid');
});

test('干净导出：剥掉 pid / 选中类 / 编辑器注入，改动保留', () => {
  const { document, anchor } = fresh();
  const h1 = document.querySelector('.hero h1');
  const pid = anchor.pidOf(h1);
  applyPatch(document, h1, { version: 1, target: pid, changes: [{ op: 'setStyle', target: pid, prop: 'font-size', value: '48px' }] });
  h1.classList.add('picker-selected');

  // 与 bridge 里 extractCleanHtml 相同的处理
  const clone = document.documentElement.cloneNode(true);
  clone.querySelectorAll('.picker-selected').forEach((el) => el.classList.remove('picker-selected'));
  for (const el of [clone, ...clone.querySelectorAll('*')]) if (el.hasAttribute?.('data-pid')) el.removeAttribute('data-pid');
  const html = '<!DOCTYPE html>\n' + clone.outerHTML;
  assert.doesNotMatch(html, /data-pid/);
  assert.doesNotMatch(html, /picker-selected/);
  assert.match(html, /font-size: 48px/, '改动应保留在导出里');
  assert.match(html, /一杯喝得出经纬度的咖啡/);
});

test('sanitizeHtmlFragment 拦掉危险标签与内联事件', () => {
  const { document } = fresh();
  const out = sanitizeHtmlFragment(document, '<div onclick="x()"><script>bad()<\/script><iframe src="x"></iframe><a href="javascript:alert(1)">a</a><a href="https://ok.com">b</a></div>');
  assert.doesNotMatch(out, /<script/);
  assert.doesNotMatch(out, /<iframe/);
  assert.doesNotMatch(out, /onclick/);
  assert.doesNotMatch(out, /javascript:/);
  assert.match(out, /https:\/\/ok\.com/);
});

test('交叉改动也能精确回滚：两次 setStyle 不同属性 / setStyle 后 setHtml', () => {
  // 场景 1：同一元素连续两次改不同属性
  {
    const { document, anchor } = fresh();
    const h1 = document.querySelector('.hero h1');
    const pid = anchor.pidOf(h1);
    const before = h1.outerHTML;
    const r1 = applyPatch(document, h1, { version: 1, target: pid, changes: [{ op: 'setStyle', target: pid, prop: 'font-size', value: '48px' }] });
    const r2 = applyPatch(document, h1, { version: 1, target: pid, changes: [{ op: 'setStyle', target: pid, prop: 'color', value: '#1e3a8a' }] });
    assert.equal(h1.style.getPropertyValue('font-size'), '48px');
    assert.equal(h1.style.getPropertyValue('color'), '#1e3a8a');
    undoPatch(document, r2.inverse);
    assert.equal(h1.style.getPropertyValue('font-size'), '48px', '撤销第二次不应把第一次也撤掉');
    assert.equal(h1.style.getPropertyValue('color'), '', '第二次的改动应被撤掉');
    undoPatch(document, r1.inverse);
    assert.equal(h1.outerHTML, before, '两次都撤销后应逐字节还原');
  }

  // 场景 2：先 setStyle 再 setHtml（后者会重建内部节点，属性快照与内容快照必须各自还原）
  {
    const { document, anchor } = fresh();
    const h1 = document.querySelector('.hero h1');
    const pid = anchor.pidOf(h1);
    const before = h1.outerHTML;
    const r1 = applyPatch(document, h1, {
      version: 1,
      target: pid,
      changes: [
        { op: 'setStyle', target: pid, prop: 'letter-spacing', value: '2px' },
        { op: 'setHtml', target: pid, html: '<b>换掉的内部</b>' },
      ],
    });
    assert.equal(h1.querySelector('b')?.textContent, '换掉的内部');
    assert.equal(h1.style.getPropertyValue('letter-spacing'), '2px');
    undoPatch(document, r1.inverse);
    assert.equal(h1.outerHTML, before, 'setStyle + setHtml 一起撤销后应逐字节还原');
    assert.equal(h1.getAttribute('data-pid'), pid, '锚点必须保留');
  }

  // 场景 3：insertHtml 的 before 位置 + 撤销
  {
    const { document, anchor } = fresh();
    const card = document.querySelector('.card');
    const pid = anchor.pidOf(card);
    const before = card.parentElement.innerHTML;
    const r = applyPatch(document, card, {
      version: 1,
      target: pid,
      changes: [{ op: 'insertHtml', target: pid, position: 'before', html: '<aside class="pre">前置块</aside>' }],
    });
    assert.ok(card.parentElement.querySelector('.pre'), 'before 位置应插入成功');
    undoPatch(document, r.inverse);
    assert.equal(card.parentElement.innerHTML, before, 'before 插入的撤销应恢复原状');
  }
});

test('insertHtml 插入纯文本时，撤销必须把文本也删干净', () => {
  // 回归：逆条目只收集"元素节点"，纯文本插入会永久残留 → "取消后逐字节还原"不成立
  const positions = ['append', 'prepend', 'before', 'after'];
  for (const position of positions) {
    const { document, anchor } = fresh();
    const card = document.querySelector('.card');
    const pid = anchor.pidOf(card);
    const parent = position === 'before' || position === 'after' ? card.parentElement : card;
    const before = parent.innerHTML;
    const r = applyPatch(document, card, {
      version: 1,
      target: pid,
      changes: [{ op: 'insertHtml', target: pid, position, html: '纯文本片段' }],
    });
    assert.ok(parent.innerHTML.includes('纯文本片段'), `${position}: 应该插入成功`);
    undoPatch(document, r.inverse);
    assert.equal(parent.innerHTML, before, `${position}: 纯文本插入的撤销必须逐字节还原`);
  }
});

test('insertHtml 插入"文字+元素+文字"混合内容，撤销也必须完整还原', () => {
  const { document, anchor } = fresh();
  const card = document.querySelector('.card');
  const pid = anchor.pidOf(card);
  const before = card.innerHTML;
  const r = applyPatch(document, card, {
    version: 1,
    target: pid,
    changes: [{ op: 'insertHtml', target: pid, position: 'append', html: '前<b>粗</b>后' }],
  });
  assert.ok(card.querySelector('b'), '元素部分应插入');
  assert.ok(card.textContent.includes('前'), '文本部分应插入');
  undoPatch(document, r.inverse);
  assert.equal(card.innerHTML, before, '混合内容撤销后应逐字节还原');
});

test('撤销不重算 pid：结构变更后（兄弟序号变了）也不能漂移', () => {
  // 回归：restoreElement 曾经 removeAttribute('data-pid') 后按**当前**结构重算，
  // 只要先前有过 insertHtml/removeNode 改动过兄弟序号，撤销后 pid 就会变野指针。
  {
    const { document, anchor } = fresh();
    const card = document.querySelector('.card');
    const s2 = document.querySelectorAll('.card')[1];
    const pidCard = anchor.pidOf(card);
    const pidS2 = anchor.pidOf(s2);

    // ① 在 card 前面插一个兄弟（会改变 card 与其后所有兄弟的序号）
    const r1 = applyPatch(document, card, {
      version: 1,
      target: pidCard,
      changes: [{ op: 'insertHtml', target: pidCard, position: 'before', html: '<article class="card">插入的卡</article>' }],
    });
    // ② 给 s2 换内部结构（此时 s2 的序号已经变了）
    const r2 = applyPatch(document, s2, {
      version: 1,
      target: pidS2,
      changes: [{ op: 'setHtml', target: pidS2, html: '<b>新的内部</b>' }],
    });

    undoPatch(document, r2.inverse);
    assert.ok(anchor.resolve(pidS2), `撤销 setHtml 后 ${pidS2} 必须仍然有效（pid 不许漂移）`);
    assert.equal(anchor.pidOf(s2), pidS2, '撤销必须恢复快照里记录的 pid，而不是按当前结构重算');

    undoPatch(document, r1.inverse);
    assert.ok(anchor.resolve(pidCard), '撤销插入后原 card 的 pid 仍应有效');
    assert.equal(anchor.pidOf(card), pidCard);
    const pids = document.querySelectorAll('[data-pid]').map((el) => el.getAttribute('data-pid'));
    assert.equal(new Set(pids).size, pids.length, 'DOM 里不允许出现重复 pid');
  }

  {
    // 先删掉前面的兄弟，再改 s2，再撤销
    const { document, anchor } = fresh();
    const first = document.querySelector('.card');
    const s2 = document.querySelectorAll('.card')[1];
    const pidS2 = anchor.pidOf(s2);
    const r1 = applyPatch(document, first, { version: 1, target: anchor.pidOf(first), changes: [{ op: 'removeNode', target: anchor.pidOf(first) }] });
    const r2 = applyPatch(document, s2, { version: 1, target: pidS2, changes: [{ op: 'setHtml', target: pidS2, html: '<b>x</b>' }] });
    undoPatch(document, r2.inverse);
    assert.ok(anchor.resolve(pidS2), '删除兄弟后撤销 setHtml，pid 也不许漂移');
    assert.equal(anchor.pidOf(s2), pidS2, '应恢复快照记录的 pid');
    undoPatch(document, r1.inverse);
    assert.ok(anchor.resolve(anchor.pidOf(first)), '撤销删除后第一个 card 应回来');
  }
});

test('insertHtml 的插入点边界：结构上留在选区内，不允许改到祖先层', () => {
  const { document, anchor } = fresh();

  // ① 选中 .cards 容器，往里面追加 → 选区内，允许
  const cards = document.querySelector('.cards');
  const pidCards = anchor.pidOf(cards);
  assert.doesNotThrow(() =>
    applyPatch(document, cards, {
      version: 1,
      target: pidCards,
      changes: [{ op: 'insertHtml', target: pidCards, position: 'append', html: '<p class="inside">区内追加</p>' }],
    }),
  );
  assert.ok(cards.querySelector('p.inside'), 'append 应落在选区内');

  // ② 选中卡片，插到它前面（成为 .cards 的子节点）→ 结构上仍在"这块"的位置，允许
  const firstCard = document.querySelector('.card');
  const pidCard = anchor.pidOf(firstCard);
  assert.doesNotThrow(() =>
    applyPatch(document, firstCard, {
      version: 1,
      target: pidCard,
      changes: [{ op: 'insertHtml', target: pidCard, position: 'before', html: '<aside class="sib">旁边的块</aside>' }],
    }),
  );

  // ③ 真正必须拒绝的形态：target 在选区之外（想改祖先层）
  const h3 = document.querySelector('.card h3');
  const pidH3 = anchor.pidOf(h3);
  const cardsHtmlBefore = document.querySelector('.cards').innerHTML;
  assert.throws(
    () =>
      applyPatch(document, h3, {
        version: 1,
        target: pidCards, // .cards 是 h3 的祖先，不在选中范围内
        changes: [{ op: 'insertHtml', target: pidCards, position: 'append', html: '<p class="escape">改祖先</p>' }],
      }),
    /越界/,
    '改到祖先层必须拒绝',
  );
  assert.equal(document.querySelector('.cards').innerHTML, cardsHtmlBefore, '被拒绝时不允许留下任何改动');

  // ④ 选中卡片里的 h3，往 h3 内部追加 → 选区内，允许
  assert.doesNotThrow(() =>
    applyPatch(document, h3, {
      version: 1,
      target: pidH3,
      changes: [{ op: 'insertHtml', target: pidH3, position: 'append', html: '<b>区内</b>' }],
    }),
  );
  assert.ok(h3.querySelector('b'), 'append 到选中元素内部应生效');
});

test('用户 HTML 自带的重复 data-pid 会被修复成唯一锚点', () => {
  const dup = '<!DOCTYPE html><html><body><h1 data-pid="p-dup">A</h1><h1 data-pid="p-dup">B</h1></body></html>';
  const { document } = parseDocument(dup);
  const anchor = new AnchorManager(document);
  anchor.injectAll();
  const pids = document.querySelectorAll('[data-pid]').map((el) => el.getAttribute('data-pid'));
  assert.equal(new Set(pids).size, pids.length, `pid 必须唯一，实际：${pids.join(', ')}`);
});

test('sanitize 必须拦掉 <style> 与编辑器命名空间属性（不许绕过"只改选中块"）', () => {
  const { document } = fresh();
  // <style> 一旦被放行，就等于给 AI 一个"给整页注入全局 CSS"的后门
  const out = sanitizeHtmlFragment(document, '<div><style>body{display:none}</style><p style="color:red">ok</p></div>');
  assert.doesNotMatch(out, /<style/i, '<style> 必须被剥离');
  assert.match(out, /color:\s*red/, '普通行内样式应保留');

  // data-z-* 是编辑器私有命名空间：必须剥属性，而不是留到导出时被整块删掉
  const out2 = sanitizeHtmlFragment(document, '<div data-z-chrome="1" data-z-inject="x"><b>内容</b></div>');
  assert.doesNotMatch(out2, /data-z-/, 'data-z-* 属性必须被剥离');
  assert.match(out2, /<b>内容<\/b>/, '内容本身必须保留（不能被整块删掉）');
  assert.match(out2, /<div>/, '元素本身必须保留');
});

test('不允许删除 <html>（没有可还原的父元素快照）', () => {
  const { document, anchor } = fresh();
  const htmlEl = document.documentElement;
  const pid = anchor.pidOf(htmlEl);
  const before = document.documentElement.outerHTML;
  assert.throws(
    () => applyPatch(document, htmlEl, { version: 1, target: pid, changes: [{ op: 'removeNode', target: pid }] }),
    /不允许删除文档根元素/,
  );
  assert.equal(document.documentElement.outerHTML, before, '被拒绝后页面必须完好');
});

test('撤销不会吃掉正文里形如 " data-pid=..." 的文字', () => {
  // 回归：早期用正则全局删除 " data-pid=…"，会把正文里的同样文字一并删掉
  const { document, anchor } = fresh();
  const h1 = document.querySelector('.hero h1');
  const pid = anchor.pidOf(h1);
  const tricky = '示例代码：<div data-pid="p-abc">，注意属性写法';
  const r = applyPatch(document, h1, { version: 1, target: pid, changes: [{ op: 'setText', target: pid, value: tricky }] });
  assert.equal(h1.textContent, tricky, '文本应原样写入');
  undoPatch(document, r.inverse);
  assert.ok(!h1.textContent.includes(tricky) || h1.textContent.includes('经纬度'), '撤销后应恢复原文案');
  assert.equal(h1.getAttribute('data-pid'), pid, '锚点必须保留');
});

test('上下文不再把"用不了的 pid"递给模型（越界的根因）', () => {
  const { window, document, anchor } = fresh();
  const h1 = document.querySelector('.hero h1');
  const pid = anchor.pidOf(h1);
  const ctx = buildContext({ win: window, doc: document, el: h1, pid, request: '给这段文字加个垫色块' });

  // ① 明确给出"可以改哪些 pid"的白名单
  assert.ok(Array.isArray(ctx.target.modifiablePids), '应给出 modifiablePids 白名单');
  assert.ok(ctx.target.modifiablePids.includes(pid), '白名单必须包含选中元素自身');
  // ② 祖先元素绝不能再带 pid（模型之前就是拿了祖先 pid 才越界的）
  for (const c of ctx.target.chain) {
    assert.equal(c.pid, undefined, `祖先 ${c.tag} 不该带 pid（会诱导模型越界）`);
    assert.equal(c.modifiable, false, '祖先必须标注为不可修改');
    assert.ok(typeof c.ref === 'string' && c.ref.length > 0, '祖先应以 ref 标识');
  }
  assert.ok(ctx.target.chain.some((c) => c.ref === 'target'), '链上应有 target 标记');
  // ③ 祖先的 pid 确实不在白名单里
  const ancestorPids = anchor.chainOf(h1, 6).slice(0, -1).map((el) => anchor.pidOf(el)).filter(Boolean);
  for (const ap of ancestorPids) {
    assert.ok(!ctx.target.modifiablePids.includes(ap), `祖先 pid ${ap} 不该出现在可改白名单里`);
  }
  // ④ 后代是可以改的（它们的 pid 在 outerHtml 里）
  const withDesc = document.querySelector('.hero');
  const pidHero = anchor.pidOf(withDesc);
  const ctx2 = buildContext({ win: window, doc: document, el: withDesc, pid: pidHero, request: 'x' });
  assert.ok(ctx2.target.modifiablePids.length > 1, '选中容器时，内部元素也该可改');
  assert.ok(ctx2.target.modifiablePids.includes(pid), '内部元素的 pid 应在白名单里');
});

test('重试上下文会把"可改 pid 白名单 + 被拒原因"带上（自愈所需）', () => {
  const { window, document, anchor } = fresh();
  const h1 = document.querySelector('.hero h1');
  const pid = anchor.pidOf(h1);
  const ctx = buildContext({
    win: window,
    doc: document,
    el: h1,
    pid,
    request: '给这段文字加个垫色块',
    retry: { error: '改动越界：setStyle 想改 p-xxx', allowedPids: [pid] },
  });
  assert.ok(ctx.retry, '上下文应带 retry 反馈');
  assert.equal(ctx.retry.allowedPids[0], pid);
  // 提示词里要把白名单讲清楚
  const text = promptModule.buildUserInstruction(ctx);
  assert.match(text, /只能.*使用这些 pid/s);
  assert.ok(text.includes(pid), '提示词里要出现可用 pid');
  assert.match(text, /改.*选中元素自身/s);
});

test('分词器：内联脚本里的 < 必须原样保留，不能当标签吃掉', () => {
  // 真踩过：shim 的标签正则遇到 JS 里的 `index < 0` 时整条匹配失败，
  // 于是那个 `<` 被静默丢弃 → 脚本变成 `if (index 0)` → SyntaxError → 页面监听全挂不上，
  // 而测试还以为"通过了"（页面根本没交互）。用户真实的类 PPT 页面就是这么被抓出来的。
  const src = '<html><body><script>if (a < b) { var s = "</div>"; }<\/script></body></html>';
  const { document } = parseDocument(src);
  const code = document.querySelector('script').textContent;
  assert.ok(code.includes('a < b'), `JS 里的 "<" 被吃掉了：${JSON.stringify(code)}`);
  assert.ok(code.includes('</div>'), '脚本里形如 </div> 的字符串也必须原样保留');
  assert.ok(!code.includes('&lt;'), '不能把脚本内容做 HTML 转义');
  // style/textarea 同理
  const { document: d2 } = parseDocument('<html><head><style>.a > .b { color: red }</style></head><body></body></html>');
  assert.ok(d2.querySelector('style').textContent.includes('.a > .b'), 'style 内容也要原样保留');
});

test('干净导出必须剥掉编辑器注入的 bootstrap 脚本', () => {
  // 模拟浏览器里的真实形态：文档末尾有 app 注入的 bootstrap <script data-z-inject>
  const withInject =
    '<!DOCTYPE html><html><head><title>t</title></head><body><h1>标题</h1>' +
    '<script data-z-inject="bootstrap">(function(){var TOKEN="zt-1";window.__zToken=TOKEN;parent.postMessage({__z:"zhidaiqi"}, "*")})();<\/script>' +
    '</body></html>';
  const { document } = parseDocument(withInject);
  const anchor = new AnchorManager(document);
  anchor.injectAll();
  const h1 = document.querySelector('h1');
  h1.classList.add('picker-selected');
  h1.setAttribute('data-z-test', 'x');

  // 直接跑 bridge 里用的那个纯函数（避免为了测试去起 bridge 的定时器）
  const clean = scrubEditorArtifacts(document.documentElement.cloneNode(true), 'html');

  assert.ok(!/data-z-inject/.test(clean), '注入脚本标签必须被移除');
  assert.ok(!/__zToken/.test(clean), '注入脚本内容必须被移除');
  assert.ok(!/data-pid/.test(clean), 'pid 必须被移除');
  assert.ok(!/picker-selected/.test(clean), '选中类必须被移除');
  assert.ok(!/data-z-test/.test(clean), '编辑器私有属性必须被移除');
  assert.match(clean, /<h1>标题<\/h1>/, '用户内容必须保留');
  assert.match(clean, /^<!DOCTYPE html>/, '必须带 doctype');
});

test('同一份文档：先注入锚点再清洁，结果与"从未注入"等价', () => {
  const { document } = fresh();
  const before = scrubEditorArtifacts(document.documentElement.cloneNode(true), 'html');
  // 再注入一轮（幂等），然后清洁，应与第一次一致
  const anchor = new AnchorManager(document);
  anchor.injectAll();
  const after = scrubEditorArtifacts(document.documentElement.cloneNode(true), 'html');
  assert.equal(after, before, '清洁后的 HTML 不应受锚点注入影响');
});

test.after?.(() => {});

process.on('exit', () => cleanupDomShim());
