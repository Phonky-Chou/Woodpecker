/**
 * naming.mjs — 元素命名翻译引擎（需求文档 R1 / E1）。
 *
 * 目标：让零代码用户看得懂"我选中的是什么"。
 * 约束（来自需求文档）：
 *   - 必须是**无副作用、可复用**的纯函数层，不与 DOM 选中逻辑耦合；
 *   - 技术信息不删除，但降级（放进 tooltip / 面板次级区域），**绝不作为主名**；
 *   - 翻译失败必须降级为安全通用名（"这一块区域"），**不得回退展示原始选择器**；
 *   - 不得为"聪明"引入明显延迟（弹层弹出要保持流畅）。
 *
 * 结构上刻意分成两层：
 *   1) 纯函数层（roleOf / colorName / smartTruncate / composeName / describeFromFacts / chipsFor）
 *      —— 不碰 DOM，可以在 Node 里直接单测；
 *   2) DOM 适配层（describeElement）
 *      —— 只负责"取事实"（标签、类名、文本、计算样式、位置），判断逻辑全部交给纯函数层。
 */

/** 元素大类：用于图标、chips 动态化、以及"是否适合展示文本"的判断 */
export const KIND = {
  HEADING: 'heading',
  TEXT: 'text',
  LINK: 'link',
  BUTTON: 'button',
  IMAGE: 'image',
  ICON: 'icon',
  MEDIA: 'media',
  LIST: 'list',
  LIST_ITEM: 'list-item',
  TABLE: 'table',
  INPUT: 'input',
  NAV: 'nav',
  CONTAINER: 'container',
  PAGE: 'page',
  FORM: 'form',
  CODE: 'code',
  OTHER: 'other',
};

const TAG_ROLE = {
  h1: ['标题', KIND.HEADING], h2: ['标题', KIND.HEADING], h3: ['标题', KIND.HEADING],
  h4: ['小标题', KIND.HEADING], h5: ['小标题', KIND.HEADING], h6: ['小标题', KIND.HEADING],
  p: ['文字', KIND.TEXT], span: ['文字', KIND.TEXT], strong: ['文字', KIND.TEXT],
  em: ['文字', KIND.TEXT], b: ['文字', KIND.TEXT], i: ['文字', KIND.TEXT], label: ['说明文字', KIND.TEXT],
  small: ['说明文字', KIND.TEXT], figcaption: ['图片说明', KIND.TEXT], blockquote: ['引用', KIND.TEXT],
  a: ['链接', KIND.LINK],
  button: ['按钮', KIND.BUTTON],
  input: ['输入框', KIND.INPUT], textarea: ['输入框', KIND.INPUT], select: ['下拉框', KIND.INPUT],
  img: ['图片', KIND.IMAGE], picture: ['图片', KIND.IMAGE], figure: ['图片区', KIND.IMAGE],
  svg: ['图标', KIND.ICON], i2: ['图标', KIND.ICON],
  video: ['视频', KIND.MEDIA], audio: ['音频', KIND.MEDIA], iframe: ['嵌入内容', KIND.MEDIA],
  ul: ['列表', KIND.LIST], ol: ['列表', KIND.LIST], dl: ['列表', KIND.LIST],
  li: ['列表项', KIND.LIST_ITEM],
  table: ['表格', KIND.TABLE], thead: ['表头', KIND.TABLE], tbody: ['表格内容', KIND.TABLE],
  tr: ['表格行', KIND.TABLE], th: ['表头格', KIND.TABLE], td: ['表格格', KIND.TABLE],
  nav: ['导航栏', KIND.NAV], header: ['页头', KIND.NAV], footer: ['页脚', KIND.NAV],
  aside: ['侧栏', KIND.CONTAINER], main: ['整个页面', KIND.PAGE],
  section: ['区块', KIND.CONTAINER], article: ['内容块', KIND.CONTAINER], div: ['', KIND.CONTAINER],
  form: ['表单', KIND.FORM], body: ['整个页面', KIND.PAGE], html: ['整个页面', KIND.PAGE],
  hr: ['分隔线', KIND.OTHER], br: ['换行', KIND.OTHER],
};

/** 结构性角色：可以和 class 关键词组合成"首屏大区块"这种两段式名字 */
const STRUCTURAL_ROLES = new Set(['区块', '内容块', '主内容区', '侧栏', '导航栏', '页头', '页脚', '整个页面', '表单', '表格', '列表', '图片区']);

/**
 * 只有"位置/性质修饰型"的关键词才和结构角色拼接（首屏 + section = 首屏区块）。
 * 像"卡片""操作区"本身已经是完整名词，再拼"内容块"就成了"卡片内容块"这种啰嗦名字。
 */
const HINT_TAKES_STRUCTURAL = new Set(['首屏', '横幅']);

const ICON_BY_KIND = {
  [KIND.HEADING]: '🔤',
  [KIND.TEXT]: '📝',
  [KIND.LINK]: '🔗',
  [KIND.BUTTON]: '🔘',
  [KIND.IMAGE]: '🖼️',
  [KIND.ICON]: '⭐',
  [KIND.MEDIA]: '🎬',
  [KIND.LIST]: '📋',
  [KIND.LIST_ITEM]: '•',
  [KIND.TABLE]: '📊',
  [KIND.INPUT]: '⌨️',
  [KIND.NAV]: '🧭',
  [KIND.CONTAINER]: '⬜',
  [KIND.PAGE]: '🖥️',
  [KIND.FORM]: '📄',
  [KIND.CODE]: '💻',
  [KIND.OTHER]: '▫️',
};

/** class 关键词 → [叫什么, 大类, 是否高置信]；命中的关键词直接决定主名 */
const CLASS_HINTS = [
  [/(^|-)(hero|banner|jumbotron|masthead)($|-)/, '首屏', KIND.CONTAINER],
  [/(^|-)(lede|intro|subtitle|tagline|excerpt)($|-)/, '简介文字', KIND.TEXT],
  [/(^|-)(title|heading|headline)($|-)/, '标题', KIND.HEADING],
  [/(^|-)(btn|button|cta)($|-)/, '按钮', KIND.BUTTON],
  [/(^|-)(cards?|panels?|tiles?)($|-)/, '卡片', KIND.CONTAINER],
  [/(^|-)(price|amount|cost|fee)($|-)/, '价格', KIND.TEXT],
  [/(^|-)(badges?|tags?|chips?|pills?)($|-)/, '标签', KIND.TEXT],
  [/(^|-)(nav|navbar|menu|breadcrumb)($|-)/, '导航', KIND.NAV],
  [/(^|-)(lists?|items|feed)($|-)/, '列表', KIND.LIST],
  [/(^|-)(avatar|logo|thumb|icon)($|-)/, '图标', KIND.ICON],
  [/(^|-)(sidebar|aside|drawer)($|-)/, '侧栏', KIND.CONTAINER],
  [/(^|-)(stat|metric|number|num|count)($|-)/, '数据', KIND.TEXT],
  [/(^|-)(desc|description|summary|note|meta|hint)($|-)/, '说明文字', KIND.TEXT],
  [/(^|-)(footer)($|-)/, '页脚', KIND.NAV],
  [/(^|-)(header|topbar)($|-)/, '页头', KIND.NAV],
  [/(^|-)(search)($|-)/, '搜索框', KIND.INPUT],
  [/(^|-)(form|field|control)($|-)/, '表单', KIND.FORM],
  [/(^|-)(table|grid|rows)($|-)/, '表格', KIND.TABLE],
  [/(^|-)(hero-actions|actions|toolbar|buttons)($|-)/, '操作区', KIND.CONTAINER],
  [/(^|-)(eyebrow|kicker|overline)($|-)/, '小标签', KIND.TEXT],
  [/(^|-)(cover|hero-image|photo|poster)($|-)/, '图片', KIND.IMAGE],
  [/(^|-)(wrapper|container|inner|content|wrap)($|-)/, '', KIND.CONTAINER],
];

/** 取角色的兜底顺序：标签角色 + 类名关键词（关键词是"修饰"，不粗暴替换结构角色） */
export function roleOf(tag, classes = []) {
  const t = String(tag ?? '').toLowerCase();
  const cls = (Array.isArray(classes) ? classes : String(classes).split(/\s+/)).filter(Boolean);
  const hint = matchClassHint(cls);
  const base = TAG_ROLE[t];
  const baseRole = base?.[0] ?? '';
  const kind = hint?.[1] ?? base?.[1] ?? KIND.OTHER;

  if (hint?.[0]) {
    let role = hint[0];
    // 关键词 + 结构角色 → 组合名（hero + section = 首屏区块）；
    // 只对"修饰型"关键词拼接，避免"卡片内容块"这种啰嗦结果
    if (baseRole && STRUCTURAL_ROLES.has(baseRole) && HINT_TAKES_STRUCTURAL.has(role)) {
      if (baseRole === role || baseRole.includes(role)) role = baseRole;
      else if (!role.includes(baseRole)) role = role + baseRole;
    }
    return { role, hint: hint[0], kind, confidence: 0.9 };
  }
  if (baseRole) return { role: baseRole, hint: '', kind, confidence: 0.8 };
  if (base) return { role: safeGenericName(kind), hint: '', kind, confidence: 0.5 };
  return { role: '这一块区域', hint: '', kind: KIND.OTHER, confidence: 0.3 };
}

/** 大块元素加个"大"字（首屏区块 → 首屏大区块） */
function addSizeWord(role, wide) {
  if (!wide || !role || role.includes('大')) return role;
  for (const tail of ['区块', '内容块', '卡片', '表格', '列表', '表单', '图片区']) {
    if (role.endsWith(tail)) return role.slice(0, -tail.length) + '大' + tail;
  }
  return role;
}

function matchClassHint(classes) {
  for (const cls of classes) {
    const c = String(cls).toLowerCase();
    if (c.startsWith('z-')) continue; // 编辑器自己的类名不算
    for (const [re, name, kind] of CLASS_HINTS) {
      if (re.test(`-${c}-`)) return [name, kind];
    }
  }
  return null;
}

function safeGenericName(kind) {
  switch (kind) {
    case KIND.CONTAINER: return '一块区域';
    case KIND.TEXT: return '一段文字';
    case KIND.HEADING: return '一个标题';
    case KIND.IMAGE: return '一张图片';
    case KIND.NAV: return '一块导航';
    case KIND.LIST: return '一个列表';
    case KIND.INPUT: return '一个输入项';
    case KIND.TABLE: return '一张表格';
    default: return '这一块区域';
  }
}

export function iconFor(kind) {
  return ICON_BY_KIND[kind] ?? ICON_BY_KIND[KIND.OTHER];
}

/* ------------------------------- 颜色 ------------------------------- */

const COLOR_PALETTE = { white: [255, 255, 255], black: [17, 24, 39], gray: [107, 114, 128] };

/** 解析 rgb()/rgba()/#hex 成 {r,g,b,a}；解析不了返回 null */
export function parseColor(input) {
  const s = String(input ?? '').trim().toLowerCase();
  if (!s) return null;
  let m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.%]+))?\s*\)$/);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: +m[1], g: +m[2], b: +m[3], a: Number.isFinite(a) ? a : 1 };
  }
  m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (m) {
    const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
    return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: 1 };
  }
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  return null;
}

function rgbToHsl({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return { h, s, l };
}

/**
 * 颜色 → 中文色名。返回 null 表示"这个颜色不值得写进名字"
 * （接近白/透明/灰的底色说明它没有视觉特征，硬写反而啰嗦）。
 */
export function colorName(input, { forBackground = false, forText = false } = {}) {
  const c = parseColor(input);
  if (!c || c.a < 0.2) return null;
  const hsl = rgbToHsl(c);
  // 近黑/近白：无论偏什么色相，人眼都叫它黑/白
  if (hsl.l < 0.14) return forText ? null : '黑色';
  if (hsl.l > 0.94) return null; // 纯白/近白
  if (hsl.s < 0.12) {
    if (forBackground || forText) return null; // 浅灰底/灰字不值得写进名字
    return hsl.l < 0.25 ? '黑色' : hsl.l > 0.7 ? '浅灰' : '灰色';
  }
  // 正文色大多偏深，写进名字是噪音；只有"明显上了色"的文字才值得提
  if (forText && hsl.l < 0.55 && hsl.s < 0.45) return null;
  let base;
  if (hsl.h < 15 || hsl.h >= 345) base = '红色';
  else if (hsl.h < 40) base = '橙色';
  else if (hsl.h < 65) base = '黄色';
  else if (hsl.h < 160) base = '绿色';
  else if (hsl.h < 200) base = '青色';
  else if (hsl.h < 250) base = '蓝色';
  else if (hsl.h < 295) base = '紫色';
  else base = '粉色';
  const tone = hsl.l < 0.3 && hsl.s < 0.9 ? '深' : hsl.l > 0.78 ? '浅' : '';
  return tone ? `${tone}${base}` : base;
}

/* ------------------------------- 文本 ------------------------------- */

/** 把文本压成一行，去掉多余空白与首尾标点 */
export function cleanText(input) {
  return String(input ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s·、,，。.!！?？:：;；"'“”‘’\-–—]+/, '')
    .replace(/[\s·、,，。.!！?？:：;；"'“”‘’\-–—]+$/, '')
    .trim();
}

/**
 * 智能截断：中文按字数，英文尽量按词边界切。
 * 需求建议 8~12 字，这里默认 10。
 */
export function smartTruncate(input, max = 10) {
  const s = cleanText(input);
  if (!s) return '';
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  const head = chars.slice(0, max).join('');
  // 英文单词被切断时回退到上一个空格
  if (/[A-Za-z0-9]$/.test(head) && /[A-Za-z0-9]/.test(chars[max] ?? '')) {
    const cut = head.lastIndexOf(' ');
    if (cut > max * 0.5) return head.slice(0, cut) + '…';
  }
  return head + '…';
}

/** 这些角色"自带文本"，可以直接用；容器/表格类要去内部找一句代表性的话 */
const TEXT_OWNING_KINDS = new Set([KIND.HEADING, KIND.TEXT, KIND.LINK, KIND.BUTTON, KIND.LIST_ITEM, KIND.INPUT]);

/* ------------------------------- 命名 ------------------------------- */

/**
 * 纯函数：把"事实"组装成人话名。
 * @param {object} facts {tag, classes, kind, role, ownText, insideText, colorText, bgColor, inHeader, inFooter, fallbackText}
 * @param {string} [customName] 用户自定义名（优先级最高）
 */
export function describeFromFacts(facts, customName = '') {
  const custom = cleanText(customName);
  if (custom) {
    return { name: custom, isCustom: true, role: facts.role ?? '', kind: facts.kind ?? KIND.OTHER };
  }
  const { kind } = facts;
  const parts = [];
  // 视觉特征：按钮/卡片这类"看底色"的元素用背景色；文字/链接只在"明显上了色"时才提颜色
  const useBg = kind === KIND.BUTTON || kind === KIND.CONTAINER || kind === KIND.NAV || kind === KIND.IMAGE || kind === KIND.FORM;
  const color = useBg
    ? colorName(facts.bgColor, { forBackground: true })
    : colorName(facts.colorText, { forText: true });
  if (color) parts.push(color);

  let text = cleanText(facts.ownText);
  if (!TEXT_OWNING_KINDS.has(kind)) {
    // 容器：优先用内部一句代表性的话，否则只在自身文本很短时才用
    text = cleanText(facts.insideText) || (Array.from(cleanText(facts.ownText)).length <= 24 ? cleanText(facts.ownText) : '');
  }
  const short = smartTruncate(text, 10);

  // 主角色名
  let roleName = addSizeWord(facts.role || safeGenericName(kind), facts.wide);
  if (kind === KIND.PAGE) roleName = '整个页面';
  else if (facts.inHeader && kind === KIND.NAV && !/顶部/.test(roleName)) roleName = `顶部${roleName}`;
  else if (facts.inFooter && !/页脚/.test(roleName)) roleName = `页脚${roleName}`;

  const head = parts.join('') + roleName;
  const name = short ? `${head}「${short}」` : head;
  return { name, isCustom: false, role: roleName, kind, text: short };
}

/** 技术信息：保留但降级（tooltip / 面板次级区） */
export function technicalInfo({ selectorPath, tag, classes = [], box }) {
  const cls = classes.length ? `.${classes.join('.')}` : '';
  const size = box ? ` · ${box.w}×${box.h}px` : '';
  return `${selectorPath ?? tag}${selectorPath ? '' : cls}${size}`;
}

/* ------------------------------- chips ------------------------------- */

const CHIPS_BY_KIND = {
  [KIND.HEADING]: ['字号大一点', '加粗一点', '换个颜色', '居中对齐', '加点字间距', '缩小一点'],
  [KIND.TEXT]: ['字号大一点', '行高一点', '换个颜色', '加粗一点', '居中对齐', '缩窄一点'],
  [KIND.LINK]: ['换个颜色', '加下划线', '去掉下划线', '加粗一点'],
  [KIND.BUTTON]: ['改文字', '换个颜色', '圆角大一点', '内边距大一点', '加个阴影', '缩小一点'],
  [KIND.IMAGE]: ['圆角大一点', '加个阴影', '放大一点', '缩小一点', '换成圆形', '灰度处理'],
  [KIND.ICON]: ['放大一点', '换个颜色', '加个背景', '旋转一下'],
  [KIND.MEDIA]: ['圆角大一点', '放大一点', '加个阴影', '缩小一点'],
  [KIND.LIST]: ['行间距大一点', '加个项目符号', '去掉项目符号', '缩进多一点'],
  [KIND.LIST_ITEM]: ['加粗一点', '行高一点', '加个项目符号', '去掉项目符号'],
  [KIND.TABLE]: ['加个边框', '行高一点', '字号小一点', '斑马纹', '加大内边距'],
  [KIND.INPUT]: ['圆角大一点', '加个边框', '内边距大一点', '换个背景色', '加个阴影'],
  [KIND.NAV]: ['间距大一点', '加个背景色', '加个下边框', '字号小一点', '居中一点'],
  [KIND.FORM]: ['间距大一点', '加个背景色', '圆角大一点', '加个阴影'],
  [KIND.CONTAINER]: ['加个阴影', '圆角大一点', '内边距大一点', '换个背景色', '收窄一点', '居中一点'],
  [KIND.PAGE]: ['换个背景色', '换个字体', '整体字号大一点', '加个内边距'],
  [KIND.OTHER]: ['换个颜色', '加个背景色', '圆角大一点'],
};

/** 按元素类型给出快捷指令（每类 ≤ 6 个，宁少勿多） */
export function chipsFor(kind, { max = 6 } = {}) {
  const list = CHIPS_BY_KIND[kind] ?? CHIPS_BY_KIND[KIND.OTHER];
  return list.slice(0, max);
}

/* ---------------------------- DOM 适配层 ---------------------------- */

/** 取元素"自己的文本"（不含大量子元素时的噪音） */
function ownTextOf(el) {
  if (!el) return '';
  const text = el.textContent ?? '';
  return text;
}

/** 容器类：找内部一句最有代表性的话（表格优先用表头，别把整张表的内容堆上来） */
function insideTextOf(el) {
  if (!el?.querySelector) return '';
  for (const sel of ['caption', 'h1', 'h2', 'h3', 'h4', 'th', 'button', 'a', 'strong', 'b', 'p', 'span', 'li', 'td']) {
    const found = el.querySelector(sel);
    const t = cleanText(found?.textContent);
    if (t) return t;
  }
  return '';
}

function isInsideTag(el, tags) {
  let cur = el?.parentElement ?? null;
  let guard = 0;
  while (cur && guard++ < 64) {
    const tag = String(cur.tagName ?? '').toLowerCase();
    if (tags.includes(tag)) return true;
    const cls = typeof cur.className === 'string' ? cur.className : '';
    if (tags.includes('header') && /(^|\s)(site-header|topbar|navbar|header)(\s|$)/.test(cls)) return true;
    if (tags.includes('footer') && /(^|\s)(site-footer|footer)(\s|$)/.test(cls)) return true;
    cur = cur.parentElement;
  }
  return false;
}

/**
 * 唯一的对外入口：element → 人话名。
 * 所有需要展示元素名的地方（弹层、面包屑、右侧面板、AI 上下文）都必须走这里，保证一致。
 *
 * @param {Element} el
 * @param {object} opts { win, names, box, selectorPath }
 * @returns {{name, icon, role, kind, text, isCustom, tooltip}}
 */
export function describeElement(el, opts = {}) {
  const { win, names, box, selectorPath } = opts;
  const tag = String(el?.tagName ?? '').toLowerCase();
  const classes = (typeof el?.className === 'string' ? el.className : '')
    .split(/\s+/)
    .filter((c) => c && c !== 'picker-selected' && !c.startsWith('z-'));

  let colorText = '';
  let bgColor = '';
  try {
    if (win?.getComputedStyle && el) {
      const cs = win.getComputedStyle(el);
      colorText = cs.getPropertyValue('color') || '';
      bgColor = cs.getPropertyValue('background-color') || '';
    }
  } catch {
    /* 取不到就算了，命名不能因为样式读失败而崩 */
  }

  const { role, kind } = roleOf(tag, classes);
  const pid = el?.getAttribute?.('data-pid') ?? null;
  const customName = pid && names ? names[pid] : '';
  // "大块"判断：宽度超过可视区的 70%（用于"首屏大区块"这类名字）
  let wide = false;
  try {
    const vw = win?.innerWidth || win?.document?.documentElement?.clientWidth || 0;
    if (box && vw) wide = box.w >= vw * 0.7;
  } catch {
    wide = false;
  }
  const facts = {
    tag,
    classes,
    role,
    kind,
    ownText: ownTextOf(el),
    insideText: insideTextOf(el),
    colorText,
    bgColor,
    wide,
    inHeader: isInsideTag(el, ['header', 'nav']),
    inFooter: isInsideTag(el, ['footer']),
  };
  const described = describeFromFacts(facts, customName);
  return {
    ...described,
    icon: iconFor(kind),
    kind,
    tooltip: technicalInfo({ selectorPath, tag, classes, box }),
    classes,
    tag,
  };
}

/**
 * 面包屑：把元素链翻成人话，最多 3 级，中间折叠为「…」。
 * （需求 R1.4：层级不超过 3 级）
 */
export function breadcrumbFromChain(chainNames = [], max = 3) {
  const list = chainNames.filter(Boolean);
  if (list.length <= max) return list.join(' › ');
  return [list[0], '…', ...list.slice(-(max - 2))].join(' › ');
}
