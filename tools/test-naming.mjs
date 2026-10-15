/**
 * tools/test-naming.mjs — 命名翻译引擎验收（需求文档 R1 的 5 条标准逐条对应）。
 *
 * 运行：node tools/test-naming.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = (f) => pathToFileURL(path.join(ROOT, 'src', f)).href;
const naming = await import(SRC('naming.mjs'));
const { describeFromFacts, roleOf, colorName, smartTruncate, cleanText, chipsFor, breadcrumbFromChain, parseColor, describeElement, KIND } = naming;

/** 造一个"事实"对象，模拟 describeElement 采集到的结果 */
const facts = (over = {}) => ({
  tag: 'div',
  classes: [],
  role: '一块区域',
  kind: KIND.CONTAINER,
  ownText: '',
  insideText: '',
  colorText: 'rgb(15, 23, 42)',
  bgColor: 'rgba(0, 0, 0, 0)',
  inHeader: false,
  inFooter: false,
  ...over,
});

/* ------------------------- R1.1 主标识是内容或角色 ------------------------- */

test('R1.1 段落带文本 → 角色 +「截断文本」（不再显示 p.lede）', () => {
  const r = roleOf('p', ['lede']);
  const out = describeFromFacts(facts({ tag: 'p', classes: ['lede'], role: r.role, kind: r.kind, ownText: '每周从 3 个产区空运到店，烘焙后 7 天内出杯' }));
  assert.match(out.name, /^简介文字「/, `实际：${out.name}`);
  assert.ok(out.name.includes('每周从 3 个产区'), `实际：${out.name}`);
  assert.ok(!out.name.includes('lede'), '主名里不许出现类名');
  assert.ok(!out.name.includes('p.'), '主名里不许出现 tag.class');
});

test('R1.1 主色按钮 → 「颜色 + 角色 + 文本」', () => {
  const r = roleOf('button', ['btn-primary']);
  const out = describeFromFacts(
    facts({ tag: 'button', classes: ['btn-primary'], role: r.role, kind: r.kind, ownText: '预约到店', bgColor: 'rgb(180, 83, 9)' }),
  );
  assert.match(out.name, /^橙色按钮「预约到店」$/, `实际：${out.name}`);
});

test('R1.1 class 关键词 hero/section → 首屏大区块，不显示 section.hero', () => {
  const r = roleOf('section', ['hero']);
  const out = describeFromFacts(facts({ tag: 'section', classes: ['hero'], role: r.role, kind: r.kind }));
  assert.match(out.name, /首屏/, `实际：${out.name}`);
  assert.match(out.name, /区块/, `实际：${out.name}`);
  assert.ok(!out.name.includes('hero'), '主名里不许出现类名');
});

test('R1.1 main / body / html 一律叫「整个页面」', () => {
  for (const tag of ['main', 'body', 'html']) {
    const r = roleOf(tag, []);
    const out = describeFromFacts(facts({ tag, role: r.role, kind: r.kind }));
    assert.equal(out.name, '整个页面', `${tag} → ${out.name}`);
  }
});

/* ------------------------- R1.2 文本截断 / 视觉特征 ------------------------- */

test('R1.2 文本截断在 8~12 字之间，且以省略号收尾', () => {
  const long = '每周从三个产区空运到店烘焙后七天内出杯不糊弄任何一位客人';
  const r = roleOf('p', []);
  const out = describeFromFacts(facts({ tag: 'p', role: r.role, kind: r.kind, ownText: long }));
  const inner = out.name.match(/「(.+)」/)?.[1] ?? '';
  assert.ok(inner.endsWith('…'), `应带省略号：${inner}`);
  assert.ok(Array.from(inner).length >= 9 && Array.from(inner).length <= 12, `长度应在 9~12：${Array.from(inner).length} / ${inner}`);
});

test('R1.2 无文本元素用角色 + 视觉特征描述', () => {
  const r = roleOf('div', ['card']);
  const out = describeFromFacts(facts({ tag: 'div', classes: ['card'], role: r.role, kind: r.kind, bgColor: 'rgb(37, 99, 235)' }));
  assert.match(out.name, /蓝色卡片/, `实际：${out.name}`);
});

test('R1.2 白底/透明底不硬写颜色（避免「白色卡片」这种噪音）', () => {
  const r = roleOf('div', ['card']);
  for (const bg of ['rgb(255,255,255)', 'rgba(0,0,0,0)', 'rgb(249,250,251)']) {
    const out = describeFromFacts(facts({ tag: 'div', classes: ['card'], role: r.role, kind: r.kind, bgColor: bg }));
    assert.equal(out.name, '卡片', `bg=${bg} → ${out.name}`);
  }
});

/* ------------------------- R1.3 技术信息降级但不删除 ------------------------- */

test('R1.3 技术信息保留在 tooltip 里（selectorPath + 尺寸）', () => {
  const el = makeStubElement({ tag: 'p', classes: ['lede'], text: '简介文字在这里', attrs: { 'data-pid': 'p-1' } });
  const info = describeElement(el, {
    win: makeStubWin({ color: 'rgb(15,23,42)', background: 'rgba(0,0,0,0)' }),
    box: { w: 130, h: 40 },
    selectorPath: 'body > main > section.hero > p.lede',
  });
  assert.match(info.tooltip, /body > main > section\.hero > p\.lede/);
  assert.match(info.tooltip, /130×40px/);
  assert.ok(!info.name.includes('section'), '主名里不能有技术信息');
});

/* ------------------------- R1.5 统一纯函数 ------------------------- */

test('R1.5 自定义名优先级最高，且不被自动翻译覆盖', () => {
  const el = makeStubElement({ tag: 'button', classes: ['btn'], text: '预约到店', attrs: { 'data-pid': 'p-9' } });
  const win = makeStubWin({ color: 'rgb(255,255,255)', background: 'rgb(180,83,9)' });
  const auto = describeElement(el, { win, box: { w: 100, h: 36 }, selectorPath: 'body > button' });
  assert.match(auto.name, /按钮/);
  const renamed = describeElement(el, { win, names: { 'p-9': '预约按钮' }, box: { w: 100, h: 36 }, selectorPath: 'body > button' });
  assert.equal(renamed.name, '预约按钮');
  assert.equal(renamed.isCustom, true);
});

test('R1 降级安全：翻译不出来时给通用名，绝不回退选择器', () => {
  // 未知标签 + 无文本 + 无类名
  const out = describeFromFacts(facts({ tag: 'xyz', role: '', kind: KIND.OTHER }));
  assert.ok(!/[.#>]/.test(out.name), `不允许出现选择器字符：${out.name}`);
  assert.ok(out.name.length > 0);
  const el = makeStubElement({ tag: 'weird-tag', classes: [], text: '', attrs: {} });
  const info = describeElement(el, { win: makeStubWin({}), selectorPath: 'body > weird-tag' });
  assert.ok(!info.name.includes('weird-tag'), `主名不许回退成标签名：${info.name}`);
});

/* ------------------------- R1.4 面包屑 ------------------------- */

test('R1.4 面包屑不超过 3 级，中间折叠为「…」', () => {
  assert.equal(breadcrumbFromChain(['整个页面', '主内容区', '首屏', '标题']), '整个页面 › … › 标题');
  assert.equal(breadcrumbFromChain(['首屏', '标题']), '首屏 › 标题');
  assert.equal(breadcrumbFromChain([]), '');
});

/* ------------------------- 颜色 / 文本 工具 ------------------------- */

test('颜色归一：常见色值都能翻成人话色名', () => {
  assert.equal(colorName('rgb(180, 83, 9)'), '橙色');
  assert.equal(colorName('#2563eb'), '蓝色');
  assert.equal(colorName('rgb(22, 163, 74)'), '绿色');
  assert.equal(colorName('rgb(17,24,39)'), '黑色');
  assert.equal(colorName('rgb(220, 38, 38)'), '红色');
  assert.equal(colorName('#f8fafc'), null, '近白应返回 null');
  assert.equal(colorName('rgba(0,0,0,0)'), null, '全透明应返回 null');
});

test('parseColor 支持 rgb/rgba/hex/transparent', () => {
  assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.equal(parseColor('rgb(1,2,3)').b, 3);
  assert.equal(parseColor('rgba(1,2,3,0.5)').a, 0.5);
  assert.equal(parseColor('transparent').a, 0);
  assert.equal(parseColor('不是颜色'), null);
});

test('cleanText / smartTruncate 处理空白、标点与英文词边界', () => {
  assert.equal(cleanText('  你好   世界。 '), '你好 世界');
  assert.equal(smartTruncate('短文本'), '短文本');
  assert.equal(smartTruncate('这是一个非常长的中文句子需要被截断'), '这是一个非常长的中文…');
  const en = smartTruncate('Coffee tasting notes for this week', 14);
  assert.ok(en.endsWith('…') && !/\bnot…$/.test(en), `英文应在词边界截断：${en}`);
});

/* ------------------------- R3.3 chips 动态化 ------------------------- */

test('R3.3 chips 按元素类型变化，且每类不超过 6 个', () => {
  const heading = chipsFor(KIND.HEADING);
  const button = chipsFor(KIND.BUTTON);
  const image = chipsFor(KIND.IMAGE);
  assert.ok(heading.includes('加粗一点'), '标题应能加粗');
  assert.ok(button.includes('改文字'), '按钮应能改文字');
  assert.ok(image.includes('换图片') || image.includes('圆角大一点'), '图片应有图片相关操作');
  assert.notDeepEqual(heading, button, '不同类型应有不同 chips');
  for (const chips of [heading, button, image, chipsFor(KIND.PAGE)]) {
    assert.ok(chips.length <= 6, `chips 数量应 ≤ 6，实际 ${chips.length}`);
    assert.ok(chips.length >= 3, 'chips 太少也不好用');
  }
});

/* ------------------------- 图标 ------------------------- */

test('R2.2 每种类型都有图标，便于扫一眼识别', () => {
  for (const kind of [KIND.HEADING, KIND.TEXT, KIND.BUTTON, KIND.IMAGE, KIND.LINK, KIND.LIST, KIND.CONTAINER, KIND.PAGE]) {
    assert.ok(naming.iconFor(kind), `${kind} 缺图标`);
  }
});

/* ------------------------- 测试替身 ------------------------- */

function makeStubElement({ tag = 'div', classes = [], text = '', attrs = {}, children = [] } = {}) {
  const el = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    className: classes.join(' '),
    textContent: text,
    children,
    parentElement: null,
    _attrs: { ...attrs },
    getAttribute: (n) => (n in el._attrs ? el._attrs[n] : null),
    setAttribute: (n, v) => {
      el._attrs[n] = String(v);
    },
    querySelector: (sel) => children.find((c) => matches(c, sel)) ?? null,
    querySelectorAll: () => [],
  };
  return el;
}

function matches(el, sel) {
  const tag = String(el.tagName ?? '').toLowerCase();
  return sel.split(',').some((s) => s.trim().toLowerCase() === tag);
}

function makeStubWin({ color = 'rgb(15,23,42)', background = 'rgba(0,0,0,0)' } = {}) {
  return {
    getComputedStyle: () => ({
      getPropertyValue: (p) => (p === 'color' ? color : p === 'background-color' ? background : ''),
    }),
  };
}
