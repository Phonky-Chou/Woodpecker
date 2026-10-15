(function () {
var window = globalThis;
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
__Z_DEF("util.mjs", function (exports, __Z_REQ) {
/**
 * util.mjs — 无依赖小工具。必须保持"不碰 DOM、可被 Node 直接 import"。
 * 这些函数会被打包进单文件 HTML，也会被单元测试直接调用。
 */

/** 稳定的 32 位字符串哈希（FNV-1a 变体），同一输入永远同一输出。 */

function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** p-xxxxxxxx 形式的稳定 id。 */

function stableId(seed) {
  return 'p-' + hash32(String(seed)).toString(16).padStart(8, '0');
}

let __seq = 0;
/** 运行时唯一 id（消息配对、快照 id 用，不要求跨会话稳定）。 */

function uid(prefix = 'u') {
  __seq = (__seq + 1) % 0xffff;
  return `${prefix}-${Date.now().toString(36)}-${__seq.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}


function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}


function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 中文友好的"多少字符"计数 */

function charCount(str) {
  return Array.from(String(str ?? '')).length;
}


function truncate(str, max = 120) {
  const chars = Array.from(String(str ?? ''));
  if (chars.length <= max) return chars.join('');
  return chars.slice(0, max).join('') + '…';
}


function truncateBytes(str, maxBytes = 24 * 1024) {
  const s = String(str ?? '');
  if (s.length <= maxBytes) return { text: s, truncated: false };
  return { text: s.slice(0, maxBytes) + '\n<!-- …已截断… -->', truncated: true };
}


function formatBytes(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}


function formatTime(ts) {
  const d = new Date(Number(ts) || Date.now());
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}


function formatDateTime(ts) {
  const d = new Date(Number(ts) || Date.now());
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * 从模型回复里剥出 JSON。模型经常加 ```json 围栏或前后客套话。
 * 只做"剥离"，绝不把非 JSON 内容当结果用；剥不出来抛错。
 */

function extractJson(text) {
  if (text == null) throw new Error('模型返回为空');
  if (typeof text === 'object') return text;
  let s = String(text).trim();
  if (!s) throw new Error('模型返回为空');

  // 1) 优先剥 ```json ... ``` / ``` ... ``` 围栏
  const fence = s.match(/```(?:json|json5|javascript|js)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) s = fence[1].trim();

  // 2) 直接解析
  try {
    return JSON.parse(s);
  } catch {
    /* 继续尝试定位第一个平衡的 { } 或 [ ] */
  }

  const start = s.search(/[[{]/);
  if (start === -1) throw new Error('模型返回中找不到 JSON');
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let quote = '';
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      quote = ch;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        const candidate = s.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          // 有些模型用单引号，做一次温和修复
          const repaired = candidate
            .replace(/([{,]\s*)'([^']*?)'(\s*:)/g, '$1"$2"$3')
            .replace(/:\s*'([^']*?)'(\s*[,}])/g, ': "$1"$2');
          try {
            return JSON.parse(repaired);
          } catch {
            throw new Error('模型返回的 JSON 无法解析');
          }
        }
      }
    }
  }
  throw new Error('模型返回的 JSON 括号不闭合');
}

/** 深拷贝（用于快照与上下文，避免共享引用） */

function deepClone(value) {
  if (value == null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      /* fall through */
    }
  }
  return JSON.parse(JSON.stringify(value));
}


function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/** patch 摘要 → 人类可读的一行话（版本列表用） */

function describeChange(change) {
  if (!change || typeof change !== 'object') return '未知改动';
  switch (change.op) {
    case 'setStyle':
      return `样式 ${change.prop} → ${change.value}`;
    case 'setText':
      return `文本 → “${truncate(change.value, 24)}”`;
    case 'setAttr':
      return change.value === null || change.value === undefined
        ? `删除属性 ${change.name}`
        : `属性 ${change.name} → ${truncate(change.value, 24)}`;
    case 'setHtml':
      return `替换内部 HTML（${charCount(change.html)} 字符）`;
    case 'insertHtml':
      return `在 ${change.position ?? 'append'} 位置插入 ${charCount(change.html)} 字符`;
    case 'removeNode':
      return '删除该元素';
    default:
      return `未知操作 ${change.op}`;
  }
}

/** 结构化错误，便于 UI 区分"模型问题"和"系统问题" */

class ZError extends Error {
  constructor(message, code = 'E_UNKNOWN', detail = null) {
    super(message);
    this.name = 'ZError';
    this.code = code;
    this.detail = detail;
  }
}


function assert(cond, message, code = 'E_ASSERT') {
  if (!cond) throw new ZError(message, code);
}

/** 简单防抖 */

function debounce(fn, wait = 60) {
  let timer = null;
  const wrapped = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}


const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


exports["hash32"] = exports["hash32"] ?? (typeof hash32 !== 'undefined' ? hash32 : undefined);
exports["stableId"] = exports["stableId"] ?? (typeof stableId !== 'undefined' ? stableId : undefined);
exports["uid"] = exports["uid"] ?? (typeof uid !== 'undefined' ? uid : undefined);
exports["clamp"] = exports["clamp"] ?? (typeof clamp !== 'undefined' ? clamp : undefined);
exports["escapeHtml"] = exports["escapeHtml"] ?? (typeof escapeHtml !== 'undefined' ? escapeHtml : undefined);
exports["escapeRegExp"] = exports["escapeRegExp"] ?? (typeof escapeRegExp !== 'undefined' ? escapeRegExp : undefined);
exports["charCount"] = exports["charCount"] ?? (typeof charCount !== 'undefined' ? charCount : undefined);
exports["truncate"] = exports["truncate"] ?? (typeof truncate !== 'undefined' ? truncate : undefined);
exports["truncateBytes"] = exports["truncateBytes"] ?? (typeof truncateBytes !== 'undefined' ? truncateBytes : undefined);
exports["formatBytes"] = exports["formatBytes"] ?? (typeof formatBytes !== 'undefined' ? formatBytes : undefined);
exports["formatTime"] = exports["formatTime"] ?? (typeof formatTime !== 'undefined' ? formatTime : undefined);
exports["formatDateTime"] = exports["formatDateTime"] ?? (typeof formatDateTime !== 'undefined' ? formatDateTime : undefined);
exports["extractJson"] = exports["extractJson"] ?? (typeof extractJson !== 'undefined' ? extractJson : undefined);
exports["deepClone"] = exports["deepClone"] ?? (typeof deepClone !== 'undefined' ? deepClone : undefined);
exports["safeJsonParse"] = exports["safeJsonParse"] ?? (typeof safeJsonParse !== 'undefined' ? safeJsonParse : undefined);
exports["describeChange"] = exports["describeChange"] ?? (typeof describeChange !== 'undefined' ? describeChange : undefined);
exports["ZError"] = exports["ZError"] ?? (typeof ZError !== 'undefined' ? ZError : undefined);
exports["assert"] = exports["assert"] ?? (typeof assert !== 'undefined' ? assert : undefined);
exports["debounce"] = exports["debounce"] ?? (typeof debounce !== 'undefined' ? debounce : undefined);
exports["sleep"] = exports["sleep"] ?? (typeof sleep !== 'undefined' ? sleep : undefined);

});

__Z_DEF("naming.mjs", function (exports, __Z_REQ) {
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

const KIND = {
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

function roleOf(tag, classes = []) {
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


function iconFor(kind) {
  return ICON_BY_KIND[kind] ?? ICON_BY_KIND[KIND.OTHER];
}

/* ------------------------------- 颜色 ------------------------------- */

const COLOR_PALETTE = { white: [255, 255, 255], black: [17, 24, 39], gray: [107, 114, 128] };

/** 解析 rgb()/rgba()/#hex 成 {r,g,b,a}；解析不了返回 null */

function parseColor(input) {
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

function colorName(input, { forBackground = false, forText = false } = {}) {
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

function cleanText(input) {
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

function smartTruncate(input, max = 10) {
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

function describeFromFacts(facts, customName = '') {
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

function technicalInfo({ selectorPath, tag, classes = [], box }) {
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

function chipsFor(kind, { max = 6 } = {}) {
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

function describeElement(el, opts = {}) {
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

function breadcrumbFromChain(chainNames = [], max = 3) {
  const list = chainNames.filter(Boolean);
  if (list.length <= max) return list.join(' › ');
  return [list[0], '…', ...list.slice(-(max - 2))].join(' › ');
}


exports["KIND"] = exports["KIND"] ?? (typeof KIND !== 'undefined' ? KIND : undefined);
exports["roleOf"] = exports["roleOf"] ?? (typeof roleOf !== 'undefined' ? roleOf : undefined);
exports["iconFor"] = exports["iconFor"] ?? (typeof iconFor !== 'undefined' ? iconFor : undefined);
exports["parseColor"] = exports["parseColor"] ?? (typeof parseColor !== 'undefined' ? parseColor : undefined);
exports["colorName"] = exports["colorName"] ?? (typeof colorName !== 'undefined' ? colorName : undefined);
exports["cleanText"] = exports["cleanText"] ?? (typeof cleanText !== 'undefined' ? cleanText : undefined);
exports["smartTruncate"] = exports["smartTruncate"] ?? (typeof smartTruncate !== 'undefined' ? smartTruncate : undefined);
exports["describeFromFacts"] = exports["describeFromFacts"] ?? (typeof describeFromFacts !== 'undefined' ? describeFromFacts : undefined);
exports["technicalInfo"] = exports["technicalInfo"] ?? (typeof technicalInfo !== 'undefined' ? technicalInfo : undefined);
exports["chipsFor"] = exports["chipsFor"] ?? (typeof chipsFor !== 'undefined' ? chipsFor : undefined);
exports["describeElement"] = exports["describeElement"] ?? (typeof describeElement !== 'undefined' ? describeElement : undefined);
exports["breadcrumbFromChain"] = exports["breadcrumbFromChain"] ?? (typeof breadcrumbFromChain !== 'undefined' ? breadcrumbFromChain : undefined);

});

__Z_DEF("schema.mjs", function (exports, __Z_REQ) {
/**
 * schema.mjs — Patch v1 的纯校验层（不碰 DOM，可被 Node 直接单测）。
 *
 * 为什么把校验独立出来：模型输出的东西永远不能直接相信。
 * 校验通过才允许执行器靠近 DOM；校验失败整单拒绝，一个字符都不动。
 */
const { ZError, assert } = __Z_REQ("util.mjs");

const PATCH_VERSION = 1;

const MAX_CHANGES = 50;

const MAX_HTML_BYTES = 60 * 1024;


const OPS = ['setStyle', 'setText', 'setAttr', 'setHtml', 'insertHtml', 'removeNode'];

const INSERT_POSITIONS = ['before', 'after', 'append', 'prepend'];

/** can-edit 的 CSS 属性白名单：覆盖布局/排版/颜色/装饰/变换，杜绝 position:fixed 之类的越界破坏 */

const STYLE_WHITELIST = new Set([
  // 布局
  'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'float', 'clear', 'box-sizing',
  'flex', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'justify-content',
  'align-items', 'align-self', 'align-content', 'gap', 'row-gap', 'column-gap', 'order',
  'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row', 'grid-auto-flow', 'place-items',
  'overflow', 'overflow-x', 'overflow-y', 'object-fit', 'object-position', 'aspect-ratio',
  // 尺寸
  'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height',
  // 间距
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  // 排版
  'font', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'word-spacing', 'text-align', 'text-decoration', 'text-transform', 'text-indent', 'text-shadow',
  'white-space', 'word-break', 'overflow-wrap', 'vertical-align', 'writing-mode', 'text-overflow',
  'font-variant', 'font-feature-settings', 'text-wrap', 'hyphens',
  // 颜色与背景
  'color', 'background', 'background-color', 'background-image', 'background-size', 'background-position',
  'background-repeat', 'background-clip', 'opacity', 'mix-blend-mode', 'visibility',
  // 边框与装饰
  'border', 'border-width', 'border-style', 'border-color', 'border-radius', 'border-top', 'border-right',
  'border-bottom', 'border-left', 'border-top-width', 'border-right-width', 'border-bottom-width',
  'border-left-width', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'outline', 'outline-color', 'outline-offset', 'box-shadow', 'filter', 'backdrop-filter', 'cursor',
  'list-style', 'list-style-type', 'list-style-position', 'content',
  // 变换与动画
  'transform', 'transform-origin', 'transition', 'transition-duration', 'transition-property',
  'animation', 'animation-name', 'animation-duration', 'animation-delay', 'animation-iteration-count',
  'animation-timing-function', 'clip-path', 'rotate', 'scale', 'translate',
]);

/** 禁止 setAttr 的属性：改了就破坏锚点/可撤销性/安全边界 */

const ATTR_BLACKLIST = new Set(['data-pid', 'style', 'classname']);


function isForbiddenAttrName(name) {
  const n = String(name ?? '').trim().toLowerCase();
  if (!n) return true;
  if (ATTR_BLACKLIST.has(n)) return true;
  if (n.startsWith('on')) return true; // 事件处理器：AI 不许挂
  if (n.startsWith('data-z-')) return true; // 编辑器自身命名空间
  if (n === 'srcdoc' || n === 'sandbox') return true;
  return false;
}

/** 会被"导航/加载"用到的属性：值必须过 URL 白名单，否则等于给 AI 开了 XSS 后门 */
const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'poster', 'data', 'srcset']);
const SAFE_URL_VALUE = /^(?:https?:|mailto:|tel:|#|\/|\.\/|\.\.\/|data:image\/)/i;


function isForbiddenAttrValue(name, value) {
  const n = String(name ?? '').trim().toLowerCase();
  const v = String(value ?? '').trim();
  if (!URL_ATTRS.has(n)) return false;
  if (!v) return false;
  if (SAFE_URL_VALUE.test(v)) return false;
  // srcset 是逗号分隔的候选列表，逐项判断
  if (n === 'srcset') return v.split(',').some((part) => !SAFE_URL_VALUE.test(part.trim().split(/\s+/)[0] ?? ''));
  return true;
}

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function fail(message, code = 'E_PATCH_INVALID', detail = null) {
  throw new ZError(message, code, detail);
}

/**
 * 结构校验：只检查"形状"，不管 DOM 里有没有这个 pid。
 * @returns {{ok:true, patch:object}|never}
 */

function validatePatchShape(raw) {
  if (!isPlainObject(raw)) fail('patch 必须是 JSON 对象', 'E_PATCH_SHAPE');
  if (raw.version !== undefined && raw.version !== PATCH_VERSION) {
    fail(`patch.version 只支持 ${PATCH_VERSION}，收到 ${raw.version}`, 'E_PATCH_VERSION');
  }
  if (!isPlainObject(raw.changes) && !Array.isArray(raw.changes)) fail('patch.changes 必须是数组', 'E_PATCH_SHAPE');
  const changes = raw.changes;
  if (!Array.isArray(changes) || changes.length === 0) fail('patch.changes 不能为空', 'E_PATCH_EMPTY');
  if (changes.length > MAX_CHANGES) fail(`单次改动上限 ${MAX_CHANGES} 条，收到 ${changes.length} 条（疑似整页重写）`, 'E_PATCH_TOO_MANY');

  const normalized = { version: PATCH_VERSION, target: null, summary: '', changes: [] };
  if (raw.target !== undefined && raw.target !== null) {
    if (typeof raw.target !== 'string') fail('patch.target 必须是 pid 字符串', 'E_PATCH_SHAPE');
    normalized.target = raw.target;
  }
  normalized.summary = typeof raw.summary === 'string' ? raw.summary.slice(0, 300) : '';
  normalized.notes = typeof raw.notes === 'string' ? raw.notes.slice(0, 1000) : '';

  changes.forEach((change, i) => {
    const at = `changes[${i}]`;
    if (!isPlainObject(change)) fail(`${at} 必须是对象`, 'E_PATCH_SHAPE');
    const op = change.op;
    if (typeof op !== 'string' || !OPS.includes(op)) {
      fail(`${at}.op 不支持：${JSON.stringify(op)}（只允许 ${OPS.join(' / ')}）`, 'E_PATCH_OP');
    }
    const target = change.target;
    if (typeof target !== 'string' || !target.trim()) fail(`${at}.target 必须是非空 pid 字符串`, 'E_PATCH_TARGET');
    const out = { op, target: target.trim() };

    switch (op) {
      case 'setText': {
        if (typeof change.value !== 'string') fail(`${at}.value 必须是字符串`, 'E_PATCH_SHAPE');
        out.value = change.value;
        break;
      }
      case 'setAttr': {
        const name = change.name ?? change.attr;
        if (typeof name !== 'string' || !name.trim()) fail(`${at}.name 必须是非空字符串`, 'E_PATCH_SHAPE');
        if (isForbiddenAttrName(name)) {
          fail(`${at}.name 被禁止：${name}（pid / on* 事件 / style / class 之外的安全边界）`, 'E_PATCH_ATTR_FORBIDDEN');
        }
        out.name = name.trim();
        if (!('value' in change)) fail(`${at}.value 缺失（删除属性请显式写 null）`, 'E_PATCH_SHAPE');
        if (change.value !== null && typeof change.value !== 'string' && typeof change.value !== 'number' && typeof change.value !== 'boolean') {
          fail(`${at}.value 只能是字符串/数字/布尔/null`, 'E_PATCH_SHAPE');
        }
        out.value = change.value === null ? null : String(change.value);
        // 属性名合法不代表值合法：href="javascript:…" 这类必须在这里拦掉
        if (out.value !== null && isForbiddenAttrValue(out.name, out.value)) {
          fail(`${at}.value 被拒绝：${out.name} 不允许指向 ${String(out.value).slice(0, 60)}（URL 白名单外）`, 'E_PATCH_ATTR_VALUE');
        }
        break;
      }
      case 'setStyle': {
        const prop = String(change.prop ?? change.property ?? '').trim().toLowerCase();
        if (!prop) fail(`${at}.prop 必须是非空字符串`, 'E_PATCH_SHAPE');
        if (!STYLE_WHITELIST.has(prop)) fail(`${at}.prop 不在白名单：${prop}`, 'E_PATCH_STYLE_FORBIDDEN');
        if (change.value === null || change.value === undefined) {
          out.prop = prop;
          out.value = null; // 显式删除该行内样式
          break;
        }
        if (typeof change.value !== 'string' && typeof change.value !== 'number') {
          fail(`${at}.value 必须是字符串/数字（删除请写 null）`, 'E_PATCH_SHAPE');
        }
        const rawValue = String(change.value);
        if (/[;{}]/.test(rawValue)) fail(`${at}.value 不允许包含 ; { }（一次只改一个属性）`, 'E_PATCH_STYLE_VALUE');
        if (/url\s*\(\s*['"]?\s*javascript:/i.test(rawValue)) fail(`${at}.value 含危险 url()`, 'E_PATCH_STYLE_VALUE');
        const m = rawValue.match(/\s*!\s*important\s*$/i);
        out.prop = prop;
        out.value = m ? rawValue.slice(0, m.index).trim() : rawValue.trim();
        out.priority = m ? 'important' : '';
        if (!out.value) fail(`${at}.value 为空`, 'E_PATCH_SHAPE');
        break;
      }
      case 'setHtml': {
        if (typeof change.html !== 'string') fail(`${at}.html 必须是字符串`, 'E_PATCH_SHAPE');
        if (change.html.length > MAX_HTML_BYTES) fail(`${at}.html 超过 ${MAX_HTML_BYTES} 字符上限`, 'E_PATCH_TOO_BIG');
        out.html = change.html;
        break;
      }
      case 'insertHtml': {
        if (typeof change.html !== 'string' || !change.html.trim()) fail(`${at}.html 必须是非空字符串`, 'E_PATCH_SHAPE');
        if (change.html.length > MAX_HTML_BYTES) fail(`${at}.html 超过 ${MAX_HTML_BYTES} 字符上限`, 'E_PATCH_TOO_BIG');
        const pos = String(change.position ?? change.pos ?? 'after').toLowerCase();
        if (!INSERT_POSITIONS.includes(pos)) fail(`${at}.position 只能是 ${INSERT_POSITIONS.join(' / ')}`, 'E_PATCH_SHAPE');
        out.position = pos;
        out.html = change.html;
        break;
      }
      case 'removeNode':
        break;
      default:
        fail(`${at}.op 不支持`, 'E_PATCH_OP');
    }
    normalized.changes.push(out);
  });

  return { ok: true, patch: normalized };
}

/**
 * 范围校验：每条改动的 target 必须落在 scope 内（含 scope 自身）。
 * @param {object} patch 已通过 shape 校验
 * @param {(pid:string)=>boolean} isWithin 由调用方提供的锚点校验函数
 */

function validatePatchScope(patch, isWithin) {
  for (const c of patch.changes) {
    if (!isWithin(c.target)) {
      fail(
        `改动越界：${c.op} 想改 ${c.target}，但它不在当前选中元素范围内（AI 只被允许改选中的这一块）`,
        'E_PATCH_OUT_OF_SCOPE',
        c,
      );
    }
  }
  return true;
}

/** 一步到位：形状 + 范围。isWithin 可省略（省略时只校验形状）。 */

function validatePatch(raw, isWithin) {
  const { patch } = validatePatchShape(raw);
  if (typeof isWithin === 'function') validatePatchScope(patch, isWithin);
  return patch;
}

/** 供 UI 显示：把 patch 压成一行人话 */

function summarizePatch(patch) {
  if (!patch) return '';
  if (patch.summary) return patch.summary;
  const parts = (patch.changes ?? []).slice(0, 3).map((c) => {
    switch (c.op) {
      case 'setStyle':
        return `${c.prop}: ${c.value ?? '删除'}`;
      case 'setText':
        return `文本“${String(c.value).slice(0, 12)}”`;
      case 'setAttr':
        return `${c.name}=${c.value === null ? '删除' : String(c.value).slice(0, 12)}`;
      case 'setHtml':
        return '换内部 HTML';
      case 'insertHtml':
        return `${c.position} 插入`;
      case 'removeNode':
        return '删除元素';
      default:
        return c.op;
    }
  });
  const more = (patch.changes?.length ?? 0) - parts.length;
  return parts.join('、') + (more > 0 ? ` 等 ${patch.changes.length} 处` : '');
}

/** 统计本次改动"碰了什么"（版本列表与日志用） */

function patchStats(patch) {
  const stats = { total: 0, byOp: {}, targets: new Set() };
  for (const c of patch?.changes ?? []) {
    stats.total++;
    stats.byOp[c.op] = (stats.byOp[c.op] ?? 0) + 1;
    stats.targets.add(c.target);
  }
  return { ...stats, targets: [...stats.targets] };
}


exports["PATCH_VERSION"] = exports["PATCH_VERSION"] ?? (typeof PATCH_VERSION !== 'undefined' ? PATCH_VERSION : undefined);
exports["MAX_CHANGES"] = exports["MAX_CHANGES"] ?? (typeof MAX_CHANGES !== 'undefined' ? MAX_CHANGES : undefined);
exports["MAX_HTML_BYTES"] = exports["MAX_HTML_BYTES"] ?? (typeof MAX_HTML_BYTES !== 'undefined' ? MAX_HTML_BYTES : undefined);
exports["OPS"] = exports["OPS"] ?? (typeof OPS !== 'undefined' ? OPS : undefined);
exports["INSERT_POSITIONS"] = exports["INSERT_POSITIONS"] ?? (typeof INSERT_POSITIONS !== 'undefined' ? INSERT_POSITIONS : undefined);
exports["STYLE_WHITELIST"] = exports["STYLE_WHITELIST"] ?? (typeof STYLE_WHITELIST !== 'undefined' ? STYLE_WHITELIST : undefined);
exports["ATTR_BLACKLIST"] = exports["ATTR_BLACKLIST"] ?? (typeof ATTR_BLACKLIST !== 'undefined' ? ATTR_BLACKLIST : undefined);
exports["isForbiddenAttrName"] = exports["isForbiddenAttrName"] ?? (typeof isForbiddenAttrName !== 'undefined' ? isForbiddenAttrName : undefined);
exports["isForbiddenAttrValue"] = exports["isForbiddenAttrValue"] ?? (typeof isForbiddenAttrValue !== 'undefined' ? isForbiddenAttrValue : undefined);
exports["validatePatchShape"] = exports["validatePatchShape"] ?? (typeof validatePatchShape !== 'undefined' ? validatePatchShape : undefined);
exports["validatePatchScope"] = exports["validatePatchScope"] ?? (typeof validatePatchScope !== 'undefined' ? validatePatchScope : undefined);
exports["validatePatch"] = exports["validatePatch"] ?? (typeof validatePatch !== 'undefined' ? validatePatch : undefined);
exports["summarizePatch"] = exports["summarizePatch"] ?? (typeof summarizePatch !== 'undefined' ? summarizePatch : undefined);
exports["patchStats"] = exports["patchStats"] ?? (typeof patchStats !== 'undefined' ? patchStats : undefined);

});

__Z_DEF("anchor.mjs", function (exports, __Z_REQ) {
/**
 * anchor.mjs — data-pid 稳定锚点。
 *
 * 设计要点（见 CONTRACT.md §2）：
 *  - pid 由"祖先路径 + 同级序号"哈希而来，因此**同一份 HTML 每次得到同一套 pid**。
 *    这一点很关键：模型说"把 p-1a2b3c4d 变大"，下次打开还能指同一个元素。
 *  - 只在确实需要时写 DOM：injectAll 一次性注入，ensure 兜底。
 *  - pid 只能由本模块产生；patch 执行器禁止任何人改写/删除 data-pid。
 */
const { stableId } = __Z_REQ("util.mjs");
const PID_ATTR = 'data-pid';

/** 元素在父节点中的"同类元素"序号，保证路径唯一。 */
function siblingIndexOf(el) {
  if (!el || !el.parentElement) return 0;
  const tag = el.tagName;
  let index = 0;
  for (const child of el.parentElement.children) {
    if (child === el) break;
    if (child.tagName === tag) index++;
  }
  return index;
}

/** 通往 root 的结构化路径：div:0>main:0>h1:1 */

function pathKey(el) {
  const parts = [];
  let cur = el;
  let guard = 0;
  while (cur && cur.nodeType === 1 && guard++ < 256) {
    parts.unshift(`${cur.tagName.toLowerCase()}:${siblingIndexOf(cur)}`);
    cur = cur.parentElement;
  }
  return parts.join('>');
}

/** 给单个元素算 pid（不写 DOM）。 */

function computePid(el) {
  return stableId(pathKey(el));
}


class AnchorManager {
  constructor(doc) {
    this.doc = doc;
    this.seen = new Set();
    this.collisions = 0;
  }

  /** 重新扫描已有 pid（回填 seen，防止重复注入）。 */
  rescan() {
    this.seen = new Set();
    for (const el of this.doc.querySelectorAll(`[${PID_ATTR}]`)) {
      const pid = el.getAttribute(PID_ATTR);
      if (pid) this.seen.add(pid);
    }
    return this.seen.size;
  }

  /**
   * 确保一个元素有 pid，返回 pid。
   *
   * 冲突判定的要点：只有"确实还活在文档里的元素"才算冲突。
   * 撤销会把整棵子树从 DOM 里换掉，那些已消失元素的 pid 不能继续占用名额，
   * 否则同一个元素还原后会拿到 p-xxx-1 这种漂移 pid——锚点一漂，"还在说同一个元素"就不成立了。
   */
  ensure(el) {
    if (!el || el.nodeType !== 1) return null;
    const existing = el.getAttribute?.(PID_ATTR);
    if (existing) {
      this.seen.add(existing);
      return existing;
    }
    const isLiveConflict = (pid) => {
      if (!this.seen.has(pid)) return false;
      const holder = this.doc.querySelector(`[${PID_ATTR}="${pid}"]`);
      return !!holder && holder !== el;
    };
    let pid = computePid(el);
    if (this.doc.querySelector(`[${PID_ATTR}="${pid}"]`)) {
      let n = 1;
      let candidate = `${pid}-${n}`;
      while (this.doc.querySelector(`[${PID_ATTR}="${candidate}"]`)) {
        n++;
        candidate = `${pid}-${n}`;
      }
      pid = candidate;
      this.collisions++;
    } else if (isLiveConflict(pid)) {
      let n = 1;
      let candidate = `${pid}-${n}`;
      while (isLiveConflict(candidate) || this.doc.querySelector(`[${PID_ATTR}="${candidate}"]`)) {
        n++;
        candidate = `${pid}-${n}`;
      }
      pid = candidate;
      this.collisions++;
    }
    el.setAttribute(PID_ATTR, pid);
    this.seen.add(pid);
    return pid;
  }

  /** 全量注入：从 documentElement 起的所有元素都拿到 pid。 */
  injectAll(root = this.doc.documentElement) {
    if (!root) return { injected: 0, total: 0 };
    const all = [root, ...root.querySelectorAll('*')].filter((el) => el.nodeType === 1);
    let injected = 0;
    for (const el of all) {
      if (!el.getAttribute(PID_ATTR)) injected++;
      this.ensure(el);
    }
    // 用户 HTML 自己可能就带着重复的 data-pid（复制粘贴、模板残留）。
    // 不修的话 resolve() 永远命中第一个，另一个元素永远改不到 —— 这里统一修成唯一。
    const fixed = this.ensureUniquePids(root);
    this.rescan();
    return { injected, total: this.seen.size, duplicatesFixed: fixed };
  }

  /**
   * 把子树里所有重复的 pid 重新分配成唯一值。返回修复个数。
   * 以"文档顺序里第一个持有者"为合法所有者，后面的重发新号。
   */
  ensureUniquePids(root = this.doc.documentElement) {
    if (!root) return 0;
    const seen = new Set();
    let fixed = 0;
    const all = root.nodeType === 1 ? [root, ...root.querySelectorAll(`[${PID_ATTR}]`)] : [];
    for (const el of all) {
      const pid = el.getAttribute?.(PID_ATTR);
      if (!pid) continue;
      if (!seen.has(pid)) {
        seen.add(pid);
        this.seen.add(pid);
        continue;
      }
      // 重复：按当前结构重算，直到拿到一个没被占用的
      let candidate = computePid(el);
      let n = 1;
      while (seen.has(candidate) || this.doc.querySelector(`[${PID_ATTR}="${cssEscape(candidate)}"]`)) {
        candidate = `${computePid(el)}-${n++}`;
      }
      el.setAttribute(PID_ATTR, candidate);
      seen.add(candidate);
      this.seen.add(candidate);
      this.collisions++;
      fixed++;
    }
    return fixed;
  }

  /** pid → 元素；找不到返回 null（模型引用了不存在的 pid 时用它报错）。 */
  resolve(pid) {
    if (!pid) return null;
    return this.doc.querySelector(`[${PID_ATTR}="${cssEscape(String(pid))}"]`);
  }

  pidOf(el) {
    return el?.getAttribute?.(PID_ATTR) ?? null;
  }

  /** 从元素到根的祖先链（含自身，从外到内）。 */
  chainOf(el, limit = 12) {
    const chain = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && chain.length < limit) {
      chain.push(cur);
      cur = cur.parentElement;
    }
    return chain.reverse();
  }

  /** pid 是否在 scope 之内（含 scope 自身）。patch 范围硬校验用。 */
  isWithin(pid, scopeEl) {
    const el = this.resolve(pid);
    if (!el || !scopeEl) return false;
    return el === scopeEl || scopeEl.contains(el);
  }

  /** 给 scope 子树里所有元素补 pid（setHtml / insertHtml 之后必须调用）。 */
  injectSubtree(scopeEl) {
    if (!scopeEl) return 0;
    let injected = 0;
    const list = [scopeEl, ...scopeEl.querySelectorAll('*')];
    for (const el of list) {
      if (!el.getAttribute(PID_ATTR)) {
        this.ensure(el);
        injected++;
      } else {
        this.seen.add(el.getAttribute(PID_ATTR));
      }
    }
    return injected;
  }

  /** 剥掉所有 pid（导出干净 HTML 用）。 */
  stripAll(root = this.doc.documentElement) {
    if (!root) return 0;
    let stripped = 0;
    const list = root.nodeType === 1 ? [root, ...root.querySelectorAll(`[${PID_ATTR}]`)] : [];
    for (const el of list) {
      if (el.hasAttribute?.(PID_ATTR)) {
        el.removeAttribute(PID_ATTR);
        stripped++;
      }
    }
    return stripped;
  }
}

/** CSS 属性选择器里转义值（pid 只含 [a-z0-9-]，但防御性写全） */

function cssEscape(value) {
  if (typeof CSS !== 'undefined' && CSS?.escape) return CSS.escape(value);
  return String(value).replace(/["\\\]]/g, '\\$&');
}

/** 人类可读的祖先链：body > main > section.hero > h1#title */

function selectorPath(el) {
  const parts = [];
  let cur = el;
  let guard = 0;
  while (cur && cur.nodeType === 1 && guard++ < 64) {
    let part = cur.tagName.toLowerCase();
    if (cur.id) part += `#${cur.id}`;
    else if (typeof cur.className === 'string' && cur.className.trim()) {
      const cls = cur.className.trim().split(/\s+/).filter((c) => c && c !== 'picker-selected').slice(0, 2);
      if (cls.length) part += `.${cls.join('.')}`;
    }
    parts.unshift(part);
    cur = cur.parentElement;
  }
  return parts.join(' > ');
}

Object.assign(exports, {"PID_ATTR": PID_ATTR});


exports["pathKey"] = exports["pathKey"] ?? (typeof pathKey !== 'undefined' ? pathKey : undefined);
exports["computePid"] = exports["computePid"] ?? (typeof computePid !== 'undefined' ? computePid : undefined);
exports["AnchorManager"] = exports["AnchorManager"] ?? (typeof AnchorManager !== 'undefined' ? AnchorManager : undefined);
exports["cssEscape"] = exports["cssEscape"] ?? (typeof cssEscape !== 'undefined' ? cssEscape : undefined);
exports["selectorPath"] = exports["selectorPath"] ?? (typeof selectorPath !== 'undefined' ? selectorPath : undefined);
exports["PID_ATTR"] = exports["PID_ATTR"] ?? (typeof PID_ATTR !== 'undefined' ? PID_ATTR : undefined);

});

__Z_DEF("patch.mjs", function (exports, __Z_REQ) {
/**
 * patch.mjs — 结构化 patch 的 DOM 执行器（唯一允许改用户 DOM 的地方）。
 *
 * 三条铁律：
 *  1. 先全量校验，再动手。任一条不合法 → 抛错，DOM 零改动。
 *  2. 只改 scope（选中元素及其子树）内部，pid 一律不改写、不删除。
 *  3. 每个操作都产出可精确回滚的"逆条目"；undo 逆序执行，回到改动前。
 *
 * 逆条目用"受影响子树快照"实现，而不是零碎地记旧值——因为一个 setText
 * 可能被另一个 setHtml 覆盖，零碎回滚顺序一错就还原不干净。
 */
const { AnchorManager, PID_ATTR } = __Z_REQ("anchor.mjs");
const { validatePatchShape, validatePatchScope } = __Z_REQ("schema.mjs");
const { ZError, uid } = __Z_REQ("util.mjs");
const DANGEROUS_TAGS = new Set(['SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE', 'FORM', 'STYLE']);
const SAFE_URL = /^(?:https?:|mailto:|tel:|#|\/|\.\/|\.\.\/|data:image\/)/i;

/** 判断某个属性名是否属于"编辑器自身"（高亮/预览标记），导出与快照前会剥掉。 */

function isEditorArtifactAttr(name) {
  const n = String(name ?? '').toLowerCase();
  return n.startsWith('data-z-') || n === 'data-pid' || n === 'contenteditable';
}

/**
 * 清洗模型给的 HTML 片段：去掉脚本、内联事件、危险 URL。
 * 这是"AI 不许乱塞东西"的最后一道闸。
 */

function sanitizeHtmlFragment(doc, html) {
  const tpl = doc.createElement('template');
  tpl.innerHTML = String(html ?? '');
  const walk = (node) => {
    for (const child of [...node.children]) {
      if (DANGEROUS_TAGS.has(child.tagName)) {
        child.remove();
        continue;
      }
      for (const attr of [...child.attributes]) {
        const name = attr.name.toLowerCase();
        const value = String(attr.value ?? '');
        if (name.startsWith('on') || name === 'srcdoc' || name === 'sandbox') {
          child.removeAttribute(attr.name);
          continue;
        }
        // 编辑器私有命名空间：剥离属性即可。
        // 不能留着 —— 导出时的 scrubEditorArtifacts 会把带 data-z-* 的元素**整块删掉**，
        // 那样用户明明看到并"接受"的内容会在快照里凭空消失。
        if (name.startsWith('data-z-')) {
          child.removeAttribute(attr.name);
          continue;
        }
        if ((name === 'href' || name === 'src' || name === 'xlink:href' || name === 'action' || name === 'formaction' || name === 'poster') && !SAFE_URL.test(value.trim())) {
          child.removeAttribute(attr.name);
          continue;
        }
        if (name === 'style' && /javascript\s*:|expression\s*\(/i.test(value)) child.removeAttribute(attr.name);
        if (name === PID_ATTR) child.removeAttribute(attr.name); // 由锚点管理器重新分配
      }
      walk(child);
    }
  };
  walk(tpl.content);
  return tpl.innerHTML;
}

function findByPid(doc, anchor, pid) {
  const el = anchor.resolve(pid) ?? doc.querySelector(`[${PID_ATTR}="${pid}"]`);
  if (!el) throw new ZError(`找不到 pid=${pid} 对应的元素（可能已被删除）`, 'E_PATCH_TARGET_MISSING', { pid });
  return el;
}

/**
 * 子树快照。
 * 关键：快照里**必须剥掉 data-pid**。否则撤销时把快照写回去，
 * 同一棵子树就会出现两个相同 pid 的元素（新生成的 + 快照里带回来的），
 * 之后 resolve(pid) 可能命中错的那个——锚点唯一的保证就此破功。
 * 剥掉之后由 injectSubtree 重新分配，因为 pid 是按结构哈希的，重算结果与原来一致。
 */
function snapshotTree(anchor, el) {
  const attrs = {};
  for (const a of [...el.attributes]) {
    if (a.name === PID_ATTR) continue;
    attrs[a.name] = a.value;
  }
  return {
    pid: anchor.pidOf(el),
    html: el.innerHTML,
    outer: el.outerHTML,
    attrs,
    style: el.hasAttribute('style') ? el.getAttribute('style') : null,
  };
}

/**
 * 注意：这里**不再用正则**去"删除 HTML 文本里的 data-pid"。
 * 早期版本用 / data-pid=…/ 全局替换，会连正文里出现的 " data-pid=…" 一起吃掉，
 * 造成撤销时永久丢字。pid 的清理一律走 DOM 遍历（见 restoreElement），只动属性不动文本。
 */

/**
 * 从一棵 documentElement 克隆里剥掉"编辑器留下的痕迹"，得到可以交付/入快照的干净 HTML。
 *
 * 抽成纯函数是为了能被单测：这里出错的后果很隐蔽——
 * 编辑器注入的 bootstrap <script> 会被写进每一个快照和导出文件里，
 * 页面上看不出来，但用户拿到的"成品"里全是编辑器代码。
 */

function scrubEditorArtifacts(clone, doctypeName = 'html') {
  const all = [clone, ...clone.querySelectorAll('*')];
  for (const el of all) {
    if (el.nodeType !== 1) continue;
    // 1) 编辑器注入的节点：bootstrap 脚本、未来的 chrome 节点
    if (el.hasAttribute('data-z-inject') || el.hasAttribute('data-z-chrome')) {
      el.remove();
      continue;
    }
    // 2) 任何带编辑器特征的 <script> 都不能进导出
    if (el.tagName === 'SCRIPT') {
      const body = el.textContent ?? '';
      if (el.hasAttribute('data-z-inject') || /__zToken|__zBridge|zhidaiqi/i.test(body)) {
        el.remove();
        continue;
      }
    }
    // 3) 锚点、编辑器私有属性、预览/选中类
    if (el.hasAttribute('data-pid')) el.removeAttribute('data-pid');
    for (const attr of [...(el.attributes ?? [])]) {
      if (attr.name.startsWith('data-z-')) el.removeAttribute(attr.name);
    }
    if (typeof el.className === 'string') el.classList.remove('picker-selected', 'z-preview-flash', 'z-ai-touched');
  }
  const doctype = doctypeName ? `<!DOCTYPE ${doctypeName}>\n` : '<!DOCTYPE html>\n';
  return doctype + clone.outerHTML;
}

function record(anchor, el, op, extra = {}) {
  return { op, snapshots: [snapshotTree(anchor, el)], pids: [anchor.pidOf(el)], ...extra };
}

/**
 * 把一棵子树还原成快照的样子：**属性 + 内容**都还原。
 * 只回填 innerHTML 是不够的——setStyle 改的是元素自身的 style 属性，
 * 用 innerHTML 还原根本碰不到它，撤销后样式会残留在页面上。
 */
function restoreElement(anchor, el, snap) {
  if (!snap) return;
  // 还原内容，然后把子树里残留的 pid 属性摘掉（DOM 遍历，不碰文本），再按快照恢复属性
  el.innerHTML = snap.html ?? '';
  for (const stale of el.querySelectorAll(`[${PID_ATTR}]`)) stale.removeAttribute(PID_ATTR);
  if (el.hasAttribute(PID_ATTR)) el.removeAttribute(PID_ATTR);
  if (snap.attrs) {
    for (const name of [...el.attributes].map((a) => a.name)) {
      if (name !== PID_ATTR && !(name in snap.attrs)) el.removeAttribute(name);
    }
    for (const [name, value] of Object.entries(snap.attrs)) {
      if (name === PID_ATTR) continue;
      el.setAttribute(name, value);
    }
    if (snap.style != null) el.setAttribute('style', snap.style);
    else el.removeAttribute('style');
  }
  // 锚点用**快照里记录的 pid 原样恢复**，不能靠 ensure() 按当前结构重算。
  // 原因：撤销前可能发生过 insertHtml/removeNode 改动过兄弟序号，
  // 此时当前结构算出来的 hash 与元素原本的 pid 不同 —— 重算就等于锚点漂移，
  // 模型与历史里持有的 pid 会变成野指针。快照里的 pid 就是权威值。
  if (snap.pid) el.setAttribute(PID_ATTR, snap.pid);
  anchor.seen.add(snap.pid ?? '');
  anchor.injectSubtree(el); // 只给新出现的、还没有 pid 的后代补号
  anchor.ensureUniquePids(el);
}

/** 撤销一堆条目后做一次体检：任何重复 pid 都要重新分配，保证 resolve 不歧义 */
function sanitizeAnchors(anchor, scopeEl = null) {
  const target = scopeEl ?? anchor.doc.documentElement;
  if (target) anchor.ensureUniquePids(target);
}

function restoreSnapshots(anchor, entry) {
  for (const snap of entry.snapshots) {
    const el = anchor.resolve(snap.pid);
    if (!el) continue;
    restoreElement(anchor, el, snap);
  }
}

/**
 * 撤销 insertHtml：把当初插入的那几个节点**精确摘掉**（含文本节点）。
 *
 * 为什么不重写父节点 innerHTML 兜底：那会把父节点下所有兄弟都重新解析一遍，
 * 兄弟的锚点会被重建（可能漂移），而"取消一次插入"本不该影响任何兄弟。
 */
function removeInsertedNodes(entry) {
  const nodes = Array.isArray(entry.nodes) ? entry.nodes : [];
  const parent = nodes[0]?.parentNode ?? null;
  if (!parent) return; // 已经被别的操作连带删掉了，无需处理

  let removedAll = true;
  for (const node of nodes) {
    if (node.parentNode === parent) {
      try {
        parent.removeChild(node);
      } catch {
        removedAll = false;
      }
    } else {
      removedAll = false;
    }
  }
  if (removedAll) return;

  // 有节点被挪走了：按当初记录的连续区段再摘一次
  const kids = [...parent.childNodes];
  const start = typeof entry.startIndex === 'number' ? entry.startIndex : kids.indexOf(nodes[0]);
  if (start >= 0) {
    const slice = kids.slice(start, start + nodes.length);
    if (slice.length === nodes.length && slice.every((n, i) => n === nodes[i])) {
      for (const n of slice) parent.removeChild(n);
    }
  }
}

/**
 * 应用 patch。
 * @param {Document} doc
 * @param {Element} scopeEl 选中的元素（范围边界）
 * @param {object} rawPatch 模型输出
 * @returns {{applied:Array, inverse:Array, anchor:AnchorManager, patch:object}}
 */

function applyPatch(doc, scopeEl, rawPatch) {
  if (!scopeEl) throw new ZError('没有选中元素，无法应用改动', 'E_NO_SELECTION');
  const anchor = new AnchorManager(doc);
  anchor.rescan();
  anchor.ensure(scopeEl);
  // 关键：不要在整轮操作里信任外部传入的元素引用。
  // 撤销/还原会让旧引用变成悬空节点（DOM 里已经是另一个对象了），
  // 一旦引用悬空，范围判断就会误判。所以先把 scope 固化成 pid，之后一律按 pid 解析。
  const scopePid = anchor.pidOf(scopeEl);
  if (!scopePid) throw new ZError('选中元素缺少 data-pid 锚点，请重新选中', 'E_NO_ANCHOR');
  const resolveScope = () => anchor.resolve(scopePid) ?? (scopeEl.isConnected === false ? null : scopeEl);

  const { patch } = validatePatchShape(rawPatch);
  validatePatchScope(patch, (pid) => {
    const scope = resolveScope();
    return !!scope && (pid === scopePid || anchor.isWithin(pid, scope));
  });

  const applied = [];
  const inverse = [];

  // 事务性保证：任何一条改动不合法，DOM 必须回到**本次调用之前**。
  // 前半段（形状/范围校验）在动手前就抛，天然零改动；
  // 但 apply 过程中仍可能出错（例如前面的 removeNode 删掉了后续要改的节点），
  // 这时必须逆序回滚已应用的改动，否则会留下"改了一半"的页面。
  try {
    for (const change of patch.changes) {
      const el = findByPid(doc, anchor, change.target);
      const scope = resolveScope();
      // scope 为 null ⇒ 本 patch 已经把选中元素自己删掉了（removeNode target=scope）。
      // 此时剩下能解析到的节点都不再属于选区，明确报"越界"而不是抛内部错误。
      if (!scope) {
        throw new ZError(
          `改动越界：选中元素在本次改动中已被删除，无法继续改 ${change.target}`,
          'E_PATCH_OUT_OF_SCOPE',
          change,
        );
      }
      if (el !== scope && !scope.contains(el)) {
        throw new ZError(`改动越界：${change.target} 不在 ${scopePid} 之内`, 'E_PATCH_OUT_OF_SCOPE', change);
      }
      switch (change.op) {
        case 'setText':
        inverse.push(record(anchor, el, 'setText'));
        el.textContent = change.value;
        applied.push(change);
        break;
      case 'setAttr':
        inverse.push(record(anchor, el, 'setAttr'));
        if (change.value === null) el.removeAttribute(change.name);
        else el.setAttribute(change.name, change.value);
        applied.push(change);
        break;
      case 'setStyle':
        inverse.push(record(anchor, el, 'setStyle'));
        if (change.value === null) el.style.removeProperty(change.prop);
        else el.style.setProperty(change.prop, change.value, change.priority ?? '');
        applied.push(change);
        break;
      case 'setHtml':
        inverse.push(record(anchor, el, 'setHtml'));
        el.innerHTML = sanitizeHtmlFragment(doc, change.html);
        anchor.injectSubtree(el);
        applied.push(change);
        break;
      case 'insertHtml': {
        const clean = sanitizeHtmlFragment(doc, change.html);
        const holder = doc.createElement('div');
        holder.innerHTML = clean;
        const newNodes = [...holder.childNodes];
        if (!newNodes.length) break; // 清洗之后什么都不剩，不必改动 DOM
        const parent = change.position === 'before' || change.position === 'after' ? el.parentNode : el;
        if (!parent) throw new ZError('插入位置不存在（元素没有父节点）', 'E_PATCH_INSERT_TARGET');

        // 范围硬约束：插入**结果**必须落在选区里，只留一个合情理的例外。
        //   - append/prepend：插到 target 内部，target 已被范围校验覆盖，天然在选区内；
        //   - before/after：插成 target 的兄弟。允许的条件是二者之一：
        //       a) 插入点的父节点在 scope 内（scope 自身或其后代）——插进选区内部；
        //       b) target 就是选中元素本身，且插入点父节点 = 该元素的父节点——"在这块旁边加东西"（用户诉求）。
        //     其余情况（例如选中卡片里的 <h3> 却把节点插到卡片外层）都是插到选区之外 → 整单拒绝。
        if (change.position === 'before' || change.position === 'after') {
          const scope = resolveScope();
          const insertParent = el.parentNode;
          // 落点在选区内 ⇔ 插入点的父节点就是 scope，或它是 scope 的祖先（ancestor.contains(scope)）。
          const insideScope =
            !!scope &&
            insertParent != null &&
            (insertParent === scope || (typeof insertParent.contains === 'function' && insertParent.contains(scope)));
          const besideSelection = !!scope && el === scope && insertParent != null && insertParent === scope.parentNode;
          if (!insideScope && !besideSelection) {
            throw new ZError(
              `改动越界：insertHtml(${change.position}) 会把内容插到选中元素之外（插入点 ${anchor.pidOf(insertParent) ?? '未知'}）`,
              'E_PATCH_OUT_OF_SCOPE',
              change,
            );
          }
        }

        const ref =
          change.position === 'before' ? el
            : change.position === 'after' ? el.nextSibling
              : change.position === 'prepend' ? el.firstChild
                : null;
        const startIndex = ref ? [...parent.childNodes].indexOf(ref) : parent.childNodes.length;
        // 记录插入前紧邻的锚点：撤销时用它把插入的节点精确摘掉，
        // 而**不是**重写父节点 innerHTML —— 重写会连带重建兄弟节点、丢锚点。
        const nextNode = ref ?? null;

        const frag = doc.createDocumentFragment();
        for (const n of newNodes) frag.appendChild(n);
        parent.insertBefore(frag, ref);

        const insertedElements = newNodes.filter((n) => n.nodeType === 1);
        for (const n of insertedElements) anchor.injectSubtree(n);
        if (parent.nodeType === 1) anchor.ensure(parent);

        inverse.push({
          op: 'insertHtml',
          // 关键：text 节点也要一起记录并使用，否则"插入纯文本"撤销后文字会永久残留
          nodes: newNodes,
          pids: insertedElements.map((n) => anchor.pidOf(n)).filter(Boolean),
          startIndex,
          nextNode,
          parentPid: anchor.pidOf(parent.nodeType === 1 ? parent : parent.parentElement ?? doc.documentElement),
          beforeSnapshot: parent.nodeType === 1 ? snapshotTree(anchor, parent) : null,
        });
        applied.push(change);
        break;
      }
      case 'removeNode': {
        const parent = el.parentNode;
        if (!parent) throw new ZError('元素没有父节点，无法删除', 'E_PATCH_REMOVE_TARGET');
        // 不允许删 <html>：它的父节点是 Document，没有可供撤销的"父元素快照"，
        // 删掉之后页面结构报废且无法还原。直接拒绝，别留一个静默失效的撤销。
        if (parent.nodeType !== 1) {
          throw new ZError('不允许删除文档根元素 <html>（无法安全撤销）', 'E_PATCH_REMOVE_ROOT');
        }
        // 允许删除"选中元素本身"（用户说"这块删掉"是很自然的诉求）；
        // 撤销靠父节点快照精确还原，不会丢锚点。
        inverse.push({
          op: 'removeNode',
          snapshots: [{ pid: anchor.pidOf(parent), html: parent.innerHTML, outer: '' }],
          pids: [anchor.pidOf(el)],
          removedOuter: el.outerHTML,
          parentPid: anchor.pidOf(parent),
          index: [...parent.childNodes].indexOf(el),
        });
        el.remove();
        applied.push(change);
        break;
      }
      default:
        throw new ZError(`未实现的操作 ${change.op}`, 'E_PATCH_OP');
      }
    }
  } catch (err) {
    // 回滚已应用的改动，保证"要么全改，要么一点都不改"
    if (inverse.length) {
      try {
        undoPatch(doc, inverse);
      } catch (rollbackErr) {
        console.error('[zhidaiqi] 回滚失败，页面可能处于中间状态：', rollbackErr);
        if (err instanceof ZError) err.rollbackFailed = rollbackErr?.message ?? String(rollbackErr);
      }
    }
    throw err;
  }

  anchor.rescan();
  return { applied, inverse, anchor, patch, scopePid };
}

/** 逆序执行逆条目 = 回到 patch 之前。 */

function undoPatch(doc, inverse) {
  const anchor = new AnchorManager(doc);
  anchor.rescan();
  const undone = [];
  for (const entry of [...inverse].reverse()) {
    switch (entry.op) {
      case 'setText':
      case 'setAttr':
      case 'setStyle':
      case 'setHtml':
        restoreSnapshots(anchor, entry);
        break;
      case 'insertHtml': {
        // 优先用当初记录的节点对象精确摘除（含**文本节点**，纯文本插入也能撤干净）。
        // 注意：这里绝不用"重写父节点 innerHTML"来兜底——那样会连带重建兄弟节点、丢锚点。
        removeInsertedNodes(entry);
        break;
      }
      case 'removeNode': {
        const snap = entry.snapshots[0];
        const parent = anchor.resolve(snap.pid);
        if (parent) restoreElement(anchor, parent, snap);
        break;
      }
      default:
        break;
    }
    undone.push(entry.op);
  }
  anchor.rescan();
  sanitizeAnchors(anchor);
  return undone;
}

/**
 * 预览会话：把"改动 → 预览 → 接受/取消"封成一个对象，UI 只跟它打交道。
 */

class PreviewSession {
  constructor(doc, scopeEl, patch) {
    this.doc = doc;
    this.scopeEl = scopeEl;
    this.scopePid = scopeEl ? new AnchorManager(doc).pidOf(scopeEl) : null;
    const result = applyPatch(doc, scopeEl, patch);
    this.patch = result.patch;
    this.applied = result.applied;
    this.inverse = result.inverse;
    this.anchor = result.anchor;
    this.id = uid('preview');
    this.settled = false;
    this.touchedPids = [...new Set(this.applied.map((c) => c.target))];
    this.markTouched();
  }

  /** 把改动处标出来（视觉上"这几处是 AI 刚动的"）。 */
  markTouched(className = 'z-preview-flash') {
    for (const pid of this.touchedPids) {
      const el = this.anchor.resolve(pid);
      if (el) el.classList.add(className);
    }
  }

  clearMarks(className = 'z-preview-flash') {
    for (const pid of this.touchedPids) {
      const el = this.anchor.resolve(pid);
      if (el) el.classList.remove(className);
    }
  }

  /** 取消：精确回滚。返回 true 表示已回滚。 */
  cancel() {
    if (this.settled) return false;
    this.clearMarks();
    undoPatch(this.doc, this.inverse);
    this.settled = true;
    this.cancelled = true;
    return true;
  }

  /** 接受：清掉预览标记，DOM 保持改动后的样子。 */
  accept() {
    if (this.settled) return false;
    this.clearMarks();
    this.settled = true;
    this.accepted = true;
    return true;
  }
}

/** 便捷函数：一次性 apply + 立刻回滚（测试与 dry-run 用）。 */

function dryRunPatch(doc, scopeEl, patch) {
  const session = new PreviewSession(doc, scopeEl, patch);
  const ok = session.cancel();
  return { rolledBack: ok, applied: session.applied.length };
}
Object.assign(exports, {"validatePatch": __Z_REQ("schema.mjs")["validatePatch"], "summarizePatch": __Z_REQ("schema.mjs")["summarizePatch"], "patchStats": __Z_REQ("schema.mjs")["patchStats"]});

exports["validatePatch"] = exports["validatePatch"] ?? (typeof validatePatch !== 'undefined' ? validatePatch : undefined);
exports["summarizePatch"] = exports["summarizePatch"] ?? (typeof summarizePatch !== 'undefined' ? summarizePatch : undefined);
exports["patchStats"] = exports["patchStats"] ?? (typeof patchStats !== 'undefined' ? patchStats : undefined);
exports["isEditorArtifactAttr"] = exports["isEditorArtifactAttr"] ?? (typeof isEditorArtifactAttr !== 'undefined' ? isEditorArtifactAttr : undefined);
exports["sanitizeHtmlFragment"] = exports["sanitizeHtmlFragment"] ?? (typeof sanitizeHtmlFragment !== 'undefined' ? sanitizeHtmlFragment : undefined);
exports["scrubEditorArtifacts"] = exports["scrubEditorArtifacts"] ?? (typeof scrubEditorArtifacts !== 'undefined' ? scrubEditorArtifacts : undefined);
exports["applyPatch"] = exports["applyPatch"] ?? (typeof applyPatch !== 'undefined' ? applyPatch : undefined);
exports["undoPatch"] = exports["undoPatch"] ?? (typeof undoPatch !== 'undefined' ? undoPatch : undefined);
exports["PreviewSession"] = exports["PreviewSession"] ?? (typeof PreviewSession !== 'undefined' ? PreviewSession : undefined);
exports["dryRunPatch"] = exports["dryRunPatch"] ?? (typeof dryRunPatch !== 'undefined' ? dryRunPatch : undefined);

});

__Z_DEF("selector.mjs", function (exports, __Z_REQ) {
/**
 * selector.mjs — 生成"发给模型的上下文"。见 CONTRACT.md §3。
 *
 * 关键取舍：不整页丢给模型。
 *  选中元素 outerHTML（截断） + 关键计算样式 + 命中的 CSS 规则 + 用户原话
 * 这样 token 小、指向明确，模型也很难"顺手改别处"。
 */
const { truncateBytes } = __Z_REQ("util.mjs");
const { describeElement } = __Z_REQ("naming.mjs");
const { selectorPath } = __Z_REQ("anchor.mjs");
/** 计算样式里真正影响"看起来怎样"的属性子集。 */

const COMPUTED_KEYS = [
  'display', 'position', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'text-align', 'text-decoration-line', 'text-transform', 'white-space', 'word-break', 'overflow-wrap',
  'color', 'background-color', 'background-image', 'border-radius', 'border-width', 'border-style',
  'border-color', 'box-shadow', 'opacity', 'overflow', 'flex-direction', 'justify-content', 'align-items',
  'gap', 'grid-template-columns', 'transform', 'z-index', 'visibility', 'cursor',
];

/** 命中规则里允许出现的属性（避免把整页 design token 灌给模型）。 */
const RULE_PROP_WHITELIST = new Set([
  ...COMPUTED_KEYS,
  'font', 'background', 'border', 'margin', 'padding', 'text-shadow', 'transition', 'flex', 'grid', 'content',
]);


function computedSubset(win, el) {
  const cs = win.getComputedStyle(el);
  const out = {};
  for (const key of COMPUTED_KEYS) {
    const v = cs.getPropertyValue(key);
    if (v && v !== 'normal' && v !== 'none' && v !== 'auto' && v !== '0px') out[key] = v;
    else if (v && ['display', 'position', 'color', 'font-size', 'font-weight'].includes(key)) out[key] = v;
  }
  return out;
}


function rectOf(el) {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
}

/** 反查：哪些样式表规则命中了这个元素。让模型知道"现在为什么长这样"。 */

function matchedCssRules(win, doc, el, limit = 24) {
  const found = [];
  let sheets;
  try {
    sheets = [...doc.styleSheets];
  } catch {
    return found;
  }
  const visit = (rules, origin) => {
    if (!rules || found.length >= limit) return;
    for (const rule of rules) {
      if (found.length >= limit) break;
      if (rule.selectorText) {
        let hit = false;
        try {
          hit = el.matches(rule.selectorText);
        } catch {
          hit = false; // 有些选择器（:has 等）在旧引擎里会抛错，跳过即可
        }
        if (hit) {
          const props = [];
          for (const prop of rule.style ?? []) {
            if (RULE_PROP_WHITELIST.has(prop)) props.push(`${prop}: ${rule.style.getPropertyValue(prop)}${rule.style.getPropertyPriority(prop) ? ' !important' : ''}`);
          }
          if (props.length) {
            found.push({
              selector: rule.selectorText.slice(0, 160),
              cssText: props.join('; '),
              origin: origin || rule.parentStyleSheet?.href || 'inline <style>',
            });
          }
        }
      } else if (rule.cssRules) {
        visit(rule.cssRules, rule.conditionText ? `@media ${rule.conditionText}` : origin);
      }
    }
  };
  for (const sheet of sheets) {
    try {
      visit(sheet.cssRules, sheet.href || 'inline <style>');
    } catch {
      /* 跨域样式表：忽略 */
    }
  }
  return found;
}

/**
 * 构建 ContextEnvelope v1。
 * @param {object} p
 * @param {Window} p.win iframe 的 window
 * @param {Document} p.doc iframe 的 document
 * @param {Element} p.el 选中的元素
 * @param {string} p.pid
 * @param {string} p.request 用户原话
 * @param {Array} p.history 之前几轮对话（role/text）
 */

function buildContext({ win, doc, el, pid, request, history = [], names = null, retry = null, maxHtmlBytes = 24 * 1024 }) {
  const chain = [];
  let cur = el;
  while (cur && cur.nodeType === 1 && chain.length < 12) {
    let human = null;
    try {
      human = describeElement(cur, { win, names, selectorPath: selectorPath(cur) });
    } catch {
      human = null; // 命名失败不能影响发给模型的上下文
    }
    const isTarget = cur === el;
    chain.push({
      // 关键：祖先元素**不给 pid**。
      // 之前这里给的是 pid，模型会拿它去 setStyle，然后必然撞"越界"——
      // 等于我们主动递了一把用不了的钥匙。祖先只作只读上下文，用 ref 标识。
      ref: isTarget ? 'target' : `ancestor-${chain.length}`,
      modifiable: false,
      tag: cur.tagName.toLowerCase(),
      humanName: human?.name ?? null,
      id: cur.id || null,
      classes: (typeof cur.className === 'string' ? cur.className : '')
        .split(/\s+/)
        .filter((c) => c && c !== 'picker-selected' && !c.startsWith('z-')),
      text: cur.children.length === 0 ? (cur.textContent || '').trim().slice(0, 40) : null,
    });
    cur = cur.parentElement;
  }
  chain.reverse();

  const outer = truncateBytes(el.outerHTML, maxHtmlBytes);
  const attrs = {};
  for (const a of el.attributes) {
    if (a.name === 'data-pid' || a.name.startsWith('data-z-')) continue;
    attrs[a.name] = a.value.length > 300 ? a.value.slice(0, 300) + '…' : a.value;
  }

  let human = null;
  try {
    human = describeElement(el, { win, names, box: rectOf(el), selectorPath: chain.map((c) => c.tag).join(' > ') });
  } catch {
    human = null;
  }

  // 允许出现在 changes[].target 里的 pid：只有选中元素本身，以及它内部元素
  // （内部元素的 pid 就在 outerHtml 里，模型可以直接看到）
  const modifiablePids = [pid, ...[...el.querySelectorAll('[data-pid]')].map((n) => n.getAttribute('data-pid'))].filter(Boolean);

  return {
    kind: 'zhidaiqi.context',
    version: 1,
    target: {
      pid,
      // 明确列出"可以改哪些 pid"，避免模型去猜（它猜过祖先，必然越界）
      modifiablePids,
      humanName: human?.name ?? null,
      elementKind: human?.kind ?? null,
      tag: el.tagName.toLowerCase(),
      selectorPath: chain
        .map((c) => c.tag.toLowerCase() + (c.id ? `#${c.id}` : c.classes.length ? `.${c.classes.slice(0, 2).join('.')}` : ''))
        .join(' > '),
      chain,
      outerHtml: outer.text,
      htmlTruncated: outer.truncated,
      innerText: (el.textContent || '').trim().slice(0, 500),
      attrs,
      rect: rectOf(el),
      computed: computedSubset(win, el),
      matchedCssRules: matchedCssRules(win, doc, el),
      childCount: el.children.length,
      descendantCount: el.querySelectorAll('*').length,
    },
    request: String(request ?? ''),
    // 上一次被拒绝时的反馈（父窗口在"越界"后自动补上，让模型知道该怎么改）
    retry: retry && typeof retry === 'object' ? retry : null,
    history: (history ?? []).slice(-6),
  };
}


exports["COMPUTED_KEYS"] = exports["COMPUTED_KEYS"] ?? (typeof COMPUTED_KEYS !== 'undefined' ? COMPUTED_KEYS : undefined);
exports["computedSubset"] = exports["computedSubset"] ?? (typeof computedSubset !== 'undefined' ? computedSubset : undefined);
exports["rectOf"] = exports["rectOf"] ?? (typeof rectOf !== 'undefined' ? rectOf : undefined);
exports["matchedCssRules"] = exports["matchedCssRules"] ?? (typeof matchedCssRules !== 'undefined' ? matchedCssRules : undefined);
exports["buildContext"] = exports["buildContext"] ?? (typeof buildContext !== 'undefined' ? buildContext : undefined);

});

__Z_DEF("snapshot.mjs", function (exports, __Z_REQ) {
/**
 * snapshot.mjs — 版本快照 + 撤销/重做栈。见 CONTRACT.md §6。
 *
 * 设计取舍：快照存"干净整页 HTML 字符串"，而不是存 patch 的叠加。
 * 理由：局部 patch 叠三层之后就很难保证"回滚到第 N 版"是精确的；
 * 存整页虽然占点空间，但**跳转任意版本都是确定性的**，而且实现简单到不会错。
 *
 * 纯逻辑 + 一个可注入的 storage，所以能在 Node 里直接单测。
 */
const { deepClone, safeJsonParse, uid } = __Z_REQ("util.mjs");

const MAX_SNAPSHOTS = 40;

const STORAGE_LIMIT_BYTES = 4 * 1024 * 1024;


class SnapshotStore {
  /**
   * @param {object} opts
   * @param {string} opts.keyPrefix localStorage 前缀
   * @param {Storage|null} opts.storage 传 null = 纯内存（测试用）
   * @param {number} opts.maxSnapshots
   */
  constructor({ keyPrefix = 'zhidaiqi/v1', storage = null, maxSnapshots = MAX_SNAPSHOTS } = {}) {
    this.keyPrefix = keyPrefix;
    this.storage = storage;
    this.maxSnapshots = maxSnapshots;
    this.snapshots = [];
    this.cursor = -1;
    this.workspace = null; // { name, original }
    this.listeners = new Set();
    this.persistWarning = null;
  }

  get key() {
    return `${this.keyPrefix}/snapshots`;
  }

  get workspaceKey() {
    return `${this.keyPrefix}/workspace`;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(reason) {
    const payload = { reason, count: this.snapshots.length, cursor: this.cursor, current: this.current() };
    for (const fn of this.listeners) {
      try {
        fn(payload);
      } catch (err) {
        console.warn('[snapshot] listener error', err);
      }
    }
  }

  /* ----------------------------- 基础操作 ----------------------------- */

  current() {
    return this.snapshots[this.cursor] ?? null;
  }

  canUndo() {
    return this.cursor > 0;
  }

  canRedo() {
    return this.cursor >= 0 && this.cursor < this.snapshots.length - 1;
  }

  /** 初始化工作区（导入 HTML 时调用），产生 version 0 快照。 */
  initWorkspace({ name, html, source = 'initial' }) {
    this.workspace = { name, original: html, createdAt: Date.now() };
    this.snapshots = [];
    this.cursor = -1;
    this.push({ html, label: '初始版本', source, prompt: '', patch: null, targetPid: null });
    this.persist();
    this.emit('init');
    return this.current();
  }

  /**
   * 压入新版本。若 cursor 不在末尾（撤销后又改了），先砍掉"未来"分支——这是标准编辑器语义。
   */
  push({ html, label = '', source = 'ai', prompt = '', patch = null, targetPid = null, createdAt = Date.now() }) {
    if (this.cursor < this.snapshots.length - 1) {
      this.snapshots = this.snapshots.slice(0, this.cursor + 1);
    }
    const parent = this.current();
    const snap = {
      id: uid('s'),
      version: 1,
      createdAt,
      label: label || (source === 'initial' ? '初始版本' : '未命名改动'),
      prompt,
      source,
      patch: patch ? deepClone(patch) : null,
      targetPid,
      html,
      bytes: (html ?? '').length,
      parentId: parent?.id ?? null,
    };
    this.snapshots.push(snap);
    this.trim();
    this.cursor = this.snapshots.length - 1;
    this.persist();
    this.emit('push');
    return snap;
  }

  /** 撤销：cursor 左移，返回目标快照（调用方负责把 html 还原进 iframe）。 */
  undo() {
    if (!this.canUndo()) return null;
    this.cursor--;
    this.persist();
    this.emit('undo');
    return this.current();
  }

  redo() {
    if (!this.canRedo()) return null;
    this.cursor++;
    this.persist();
    this.emit('redo');
    return this.current();
  }

  /** 直接跳到某个版本（历史面板"回看/还原"） */
  jumpTo(indexOrId) {
    const index = typeof indexOrId === 'number' ? indexOrId : this.snapshots.findIndex((s) => s.id === indexOrId);
    if (index < 0 || index >= this.snapshots.length) return null;
    this.cursor = index;
    this.persist();
    this.emit('jump');
    return this.current();
  }

  /** 回看（不动 cursor，只取内容） */
  peek(indexOrId) {
    const index = typeof indexOrId === 'number' ? indexOrId : this.snapshots.findIndex((s) => s.id === indexOrId);
    return this.snapshots[index] ?? null;
  }

  remove(indexOrId) {
    const index = typeof indexOrId === 'number' ? indexOrId : this.snapshots.findIndex((s) => s.id === indexOrId);
    if (index <= 0 || index >= this.snapshots.length) return false; // 初始版本不允许删
    this.snapshots.splice(index, 1);
    if (this.cursor >= index) this.cursor = Math.max(0, this.cursor - 1);
    this.persist();
    this.emit('remove');
    return true;
  }

  list() {
    return this.snapshots.map((s, index) => ({
      index,
      id: s.id,
      label: s.label,
      createdAt: s.createdAt,
      source: s.source,
      bytes: s.bytes,
      current: index === this.cursor,
      future: index > this.cursor,
      changes: s.patch?.changes?.length ?? 0,
      summary: s.patch?.summary ?? '',
    }));
  }

  /** 超出上限时丢最老的（但初始版本永远保留） */
  trim() {
    if (this.snapshots.length <= this.maxSnapshots) return 0;
    const initial = this.snapshots[0];
    const rest = this.snapshots.slice(1);
    const keep = rest.slice(rest.length - (this.maxSnapshots - 1));
    const dropped = rest.length - keep.length;
    this.snapshots = [initial, ...keep];
    return dropped;
  }

  /* ------------------------------ 持久化 ------------------------------ */

  persist() {
    if (!this.storage) return { ok: true, bytes: 0 };
    const payload = JSON.stringify({ version: 1, cursor: this.cursor, snapshots: this.snapshots });
    const bytes = payload.length;
    try {
      if (bytes > STORAGE_LIMIT_BYTES) {
        // 太胖了：先丢最老的再试
        while (this.snapshots.length > 2 && JSON.stringify({ version: 1, cursor: this.cursor, snapshots: this.snapshots }).length > STORAGE_LIMIT_BYTES) {
          this.snapshots.splice(1, 1);
          if (this.cursor > 0) this.cursor--;
        }
        this.persistWarning = '版本过多，已自动丢弃最老的版本以适配浏览器存储上限';
        const retry = JSON.stringify({ version: 1, cursor: this.cursor, snapshots: this.snapshots });
        this.storage.setItem(this.key, retry);
        if (this.workspace) this.storage.setItem(this.workspaceKey, JSON.stringify(this.workspace));
        return { ok: true, bytes: retry.length, trimmed: true };
      }
      this.storage.setItem(this.key, payload);
      if (this.workspace) this.storage.setItem(this.workspaceKey, JSON.stringify(this.workspace));
      this.persistWarning = null;
      return { ok: true, bytes };
    } catch (err) {
      this.persistWarning = `本地存储写入失败（${err?.name ?? 'Error'}）：请及时导出备份`;
      return { ok: false, error: err, bytes };
    }
  }

  restore() {
    if (!this.storage) return false;
    const raw = safeJsonParse(this.storage.getItem(this.key) ?? '', null);
    const ws = safeJsonParse(this.storage.getItem(this.workspaceKey) ?? '', null);
    if (!raw || !Array.isArray(raw.snapshots) || !raw.snapshots.length) return false;
    this.snapshots = raw.snapshots.map((s) => ({ ...s, version: 1 }));
    this.cursor = Math.min(Math.max(0, raw.cursor ?? raw.snapshots.length - 1), this.snapshots.length - 1);
    if (ws) this.workspace = ws;
    this.emit('restore');
    return true;
  }

  clear() {
    this.snapshots = [];
    this.cursor = -1;
    this.workspace = null;
    if (this.storage) {
      this.storage.removeItem(this.key);
      this.storage.removeItem(this.workspaceKey);
    }
    this.emit('clear');
  }

  /* ------------------------------ 导入导出 ------------------------------ */

  /** 导出完整工程（可再导入继续改） */
  exportProject() {
    return {
      kind: 'zhidaiqi.project',
      version: 1,
      exportedAt: Date.now(),
      workspace: this.workspace,
      cursor: this.cursor,
      snapshots: this.snapshots,
    };
  }

  importProject(obj) {
    if (!obj || obj.kind !== 'zhidaiqi.project' || !Array.isArray(obj.snapshots) || !obj.snapshots.length) {
      return false;
    }
    this.snapshots = obj.snapshots;
    this.cursor = Math.min(Math.max(0, obj.cursor ?? this.snapshots.length - 1), this.snapshots.length - 1);
    this.workspace = obj.workspace ?? { name: '导入的工程', original: this.snapshots[0].html, createdAt: Date.now() };
    this.persist();
    this.emit('import');
    return true;
  }

  stats() {
    const bytes = this.snapshots.reduce((sum, s) => sum + (s.bytes ?? 0), 0);
    return {
      count: this.snapshots.length,
      cursor: this.cursor,
      bytes,
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      warning: this.persistWarning,
    };
  }
}

/** Node 测试用的内存 storage */

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}


exports["MAX_SNAPSHOTS"] = exports["MAX_SNAPSHOTS"] ?? (typeof MAX_SNAPSHOTS !== 'undefined' ? MAX_SNAPSHOTS : undefined);
exports["STORAGE_LIMIT_BYTES"] = exports["STORAGE_LIMIT_BYTES"] ?? (typeof STORAGE_LIMIT_BYTES !== 'undefined' ? STORAGE_LIMIT_BYTES : undefined);
exports["SnapshotStore"] = exports["SnapshotStore"] ?? (typeof SnapshotStore !== 'undefined' ? SnapshotStore : undefined);
exports["createMemoryStorage"] = exports["createMemoryStorage"] ?? (typeof createMemoryStorage !== 'undefined' ? createMemoryStorage : undefined);

});

__Z_DEF("systemprompt.mjs", function (exports, __Z_REQ) {
/**
 * systemprompt.mjs — 给模型的系统提示词。这里是最容易踩坑的一环，所以单独放。
 *
 * 三个必须做到的事：
 *  1. 只输出 JSON，不要 HTML 字符串，不要 Markdown。
 *  2. 只改 target pid 及其子树，越界即错。
 *  3. 用 setStyle/setText 这类"语义操作"，不要 setHtml 整块重写（除非真的需要）。
 */


const SYSTEM_PROMPT = `你是"指代器"HTML 编辑器里的局部改样式助手。用户指着页面上某个元素说话，你只改那个元素及其子树。

# 绝对规则
1) 只输出一个 JSON 对象，不要 Markdown 代码围栏，不要任何解释文字、前后缀、注释。
2) 你只能改 context.target.pid 指示的元素及其后代。禁止触碰范围外的任何元素。
   可以用的 target 只有 target.modifiablePids 里列出的 pid，以及 target.outerHtml 里出现的 data-pid。
   target.chain 里的祖先元素是**只读上下文**（它们只有 ref，没有 pid），**绝不要**把它们当作 target —— 写了必然被系统拒绝。
3) 禁止产生或修改 data-pid 属性；禁止添加 on* 事件属性；禁止 <script>/<iframe>/<style> 标签。
4) 优先用 setStyle / setText / setAttr 这类精确操作。只有在必须改动内部结构时才用 setHtml，
   且 setHtml 的 html 只能包含 target 内部的片段，不能包含 <html>/<body>/<script>。
5) 单次改动不超过 20 条；不要重写整块 DOM，不要复制粘贴原有内容再全量替换。
6) 不要臆造新的颜色/字体体系：优先沿用 target.computed 与 target.matchedCssRules 里已有的视觉风格。
7) 数值变化要给出明确单位（px / rem / % / em）。字号、颜色的改动要能一眼看出差别。
8) **用户的需求超出选中范围时怎么办**：不要报错、不要越界，而是**用选中元素自身能实现的方式满足它**，并在 summary 里说清楚。
   例：用户选中标题说"这段文字下面加个垫色块" → 给标题本身设 background-color + padding + 对比色 color（这正是他想要的效果），
   而不是去改外层容器。用户说"整页背景变黑" → 只改选中元素自身的背景，并在 summary 里说明只改了选中的这一块。

# 可用改动操作（op）
- {"op":"setText","target":"<pid>","value":"新文本"}
- {"op":"setAttr","target":"<pid>","name":"属性名","value":"属性值"}   // value 写 null = 删除该属性
- {"op":"setStyle","target":"<pid>","prop":"css属性","value":"css值"}  // value 写 null = 删除该行内样式
- {"op":"setHtml","target":"<pid>","html":"<只含内部片段的 HTML>"}
- {"op":"insertHtml","target":"<pid>","position":"before|after|append|prepend","html":"<片段>"}
- {"op":"removeNode","target":"<pid>"}

# 输出格式（严格照抄这个形状）
{"version":1,"target":"<选中元素的 pid>","summary":"用一句中文说明你改了什么","changes":[ ...操作... ]}

# 注意
- context.target.humanName 是**用户在界面上看到的这块东西的名字**（例如"橙色按钮「预约到店」"）。用户很可能就用这个名字称呼它，请据此对应。
- setStyle 的 prop 必须是常见 CSS 属性（font-size、color、background-color、padding、margin、border-radius、display、gap、line-height、font-weight、letter-spacing、text-align、box-shadow、width、height、max-width 等）。
- setStyle 的 value 里不能出现分号或大括号，一次只改一个属性。
- 想改字号就改 font-size；想改颜色就改 color；想改间距就改 padding/margin；想改圆角就改 border-radius。
- 用户说"大一点/小一点"就按当前值做 ±20%~50% 的可见变化，并给出绝对数值。
- 如果用户的要求本质上是"整页换风格"（比如换主题色、换整套字体），也只在 target 子树内完成，不要动别的元素。
- 只输出 JSON，第一个字符必须是 {，最后一个字符必须是 }。`;

/** 用户侧的简短指令模板（拼在 context JSON 之后） */

function buildUserInstruction(context) {
  const lines = [
    '这是当前选中的元素上下文（JSON）：',
    JSON.stringify(context, null, 2),
    '',
    `用户的要求：${context.request}`,
  ];
  // 上一次因为"越界"被拒绝时，把可用的 pid 明确再讲一遍，让模型自己纠正
  if (context.retry?.error) {
    lines.push(
      '',
      '⚠ 你上一次的输出被系统拒绝了：',
      String(context.retry.error).slice(0, 300),
      `你**只能**使用这些 pid：${(context.retry.allowedPids ?? []).join(', ') || '（仅 target.pid）'}`,
      '祖先元素的 pid 不在允许列表里。请改用选中元素自身能实现的方式满足用户需求（例如给它自己加背景色/内边距/对比色），然后重新输出完整的 Patch v1 JSON。',
    );
  }
  lines.push('', '请输出 Patch v1 JSON。');
  return lines.join('\n');
}

/** 让模型"修复自己的输出"时的提示词 */

function buildRepairPrompt(badOutput, error) {
  return [
    '你上一次的输出不符合要求，解析/校验失败了。',
    `失败原因：${error}`,
    '你上一次的输出（已截断）：',
    String(badOutput ?? '').slice(0, 2000),
    '',
    '请重新输出一个**只包含 JSON 对象**的结果，不要任何解释文字或代码围栏。',
  ].join('\n');
}


exports["SYSTEM_PROMPT"] = exports["SYSTEM_PROMPT"] ?? (typeof SYSTEM_PROMPT !== 'undefined' ? SYSTEM_PROMPT : undefined);
exports["buildUserInstruction"] = exports["buildUserInstruction"] ?? (typeof buildUserInstruction !== 'undefined' ? buildUserInstruction : undefined);
exports["buildRepairPrompt"] = exports["buildRepairPrompt"] ?? (typeof buildRepairPrompt !== 'undefined' ? buildRepairPrompt : undefined);

});

__Z_DEF("provider.mjs", function (exports, __Z_REQ) {
/**
 * provider.mjs — 模型接入抽象层。
 *
 * 契约（CONTRACT.md §7）：
 *   provider.generate(context, {signal, onDelta}) → { raw, patch, provider, ms, mode }
 *   - patch 一定是**已经过 validatePatch 的合法 Patch v1**，上层拿到就能直接执行。
 *   - provider 绝不返回"要直接 innerHTML 的 HTML 字符串"。
 *
 * 三种 provider：
 *   mock   —— 离线规则引擎。默认，用来演示 + 回归测试，不联网、不要 key。
 *   server —— 本地 tools/serve.mjs 转发到 OpenAI 兼容端点（DeepSeek 官方 / 任意兼容服务）。
 *   ollama —— 本地 Ollama，无需 key。
 */
const { extractJson, ZError, uid } = __Z_REQ("util.mjs");
const { validatePatch } = __Z_REQ("schema.mjs");
const { SYSTEM_PROMPT, buildUserInstruction, buildRepairPrompt } = __Z_REQ("systemprompt.mjs");

const PROVIDERS = {
  MOCK: 'mock',
  SERVER: 'server',
  OLLAMA: 'ollama',
};

/* ============================== 通用 ============================== */

/** 把模型的自由输出规整成 Patch 形状（补 target、容错单条改动） */

function coerceToPatch(raw, ctx) {
  const pid = ctx?.target?.pid ?? null;
  let obj = raw;
  if (typeof obj === 'string') obj = extractJson(obj);
  if (Array.isArray(obj)) obj = { changes: obj };
  if (obj && typeof obj === 'object' && !obj.changes && obj.op) obj = { changes: [obj] };
  if (obj && typeof obj === 'object' && !obj.changes && obj.operations) obj = { ...obj, changes: obj.operations };
  if (obj && typeof obj === 'object' && !obj.changes && obj.edits) obj = { ...obj, changes: obj.edits };
  if (!obj || typeof obj !== 'object') throw new ZError('模型输出不是 JSON 对象', 'E_MODEL_JSON');

  const out = { version: 1, target: obj.target ?? pid, summary: obj.summary ?? obj.note ?? obj.explanation ?? '', changes: obj.changes };
  if (Array.isArray(out.changes)) {
    out.changes = out.changes.map((c) => {
      if (!c || typeof c !== 'object') return c;
      const next = { ...c };
      if (!next.target) next.target = pid;
      // 容错：有些模型写 property 而不是 prop
      if (next.op === 'setStyle' && next.prop === undefined && next.property !== undefined) next.prop = next.property;
      // 容错：有些模型把删除属性写成 op=removeAttr
      if (next.op === 'removeAttr') {
        next.op = 'setAttr';
        next.value = null;
      }
      return next;
    });
  }
  return out;
}

/** 完整解析流程：自由文本 → 合法 patch（含一次自动修复机会） */

function parseModelOutput(rawText, ctx) {
  try {
    const coerced = coerceToPatch(rawText, ctx);
    const patch = validatePatch(coerced);
    return { patch, repaired: false };
  } catch (firstError) {
    throw new ZError(`模型返回无法解析为合法 patch：${firstError.message}`, 'E_MODEL_PARSE', {
      raw: String(rawText ?? '').slice(0, 2000),
      cause: firstError.code ?? 'E_MODEL_PARSE',
    });
  }
}

/* ============================== Mock ============================== */

const CN_COLORS = [
  ['朱红', '#dc2626'], ['浅蓝', '#38bdf8'], ['深蓝', '#1e3a8a'], ['天蓝', '#0ea5e9'],
  ['金黄', '#d97706'], ['墨绿', '#065f46'], ['浅绿', '#4ade80'], ['深绿', '#15803d'],
  ['浅灰', '#d1d5db'], ['深灰', '#374151'], ['透明', null],
  ['红', '#dc2626'], ['橙', '#ea580c'], ['黄', '#eab308'], ['绿', '#16a34a'], ['青', '#0891b2'],
  ['蓝', '#2563eb'], ['紫', '#7c3aed'], ['粉', '#ec4899'], ['棕', '#78350f'], ['灰', '#6b7280'],
  ['黑', '#111827'], ['白', '#ffffff'],
];

function pickColor(text) {
  const hex = text.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/i);
  if (hex) return hex[0];
  const rgb = text.match(/rgba?\([^)]+\)/i);
  if (rgb) return rgb[0];
  // 按"名称长度降序"匹配：先看"浅蓝"，别让"蓝"把"浅蓝"截胡
  const sorted = [...CN_COLORS].sort((a, b) => b[0].length - a[0].length);
  for (const [cn, value] of sorted) {
    if (value && text.includes(cn)) return value;
  }
  return null;
}

function scalePx(value, ratio) {
  const n = parseFloat(String(value ?? ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * ratio) + (String(value).includes('rem') ? 'rem' : 'px');
}

function extractNumbers(text) {
  const out = [];
  const re = /(\d+(?:\.\d+)?)\s*(px|rem|em|%|倍|vw|vh|pt)?/g;
  let m;
  while ((m = re.exec(text))) out.push({ num: parseFloat(m[1]), unit: m[2] ?? null });
  return out;
}

/**
 * 离线规则引擎：把中文口语映射成合法 patch。
 * 覆盖"大一点/小一点、颜色、间距、圆角、加粗、居中、换文字、加/删元素"这些高频操作。
 */

function mockPatch(context) {
  const target = context?.target ?? {};
  const pid = target.pid;
  const req = String(context?.request ?? '');
  const text = req.toLowerCase();
  const computed = target.computed ?? {};
  const changes = [];
  const notes = [];

  const wantBigger = /(大一点|更大|放大|大一些|变大|大点|加大|醒目|突出|bold|bigger|larger)/i.test(req);
  const wantSmaller = /(小一点|更小|缩小|小一些|变小|小点|less|smaller)/i.test(req);
  const curatedColor = pickColor(req);

  // 1) 字号
  if (/(字号|字体大小|font-?size|文字大|文字小|标题大|标题小)/i.test(req) || (wantBigger && /(标题|字|文本|文字)/i.test(req)) || wantSmaller) {
    const cur = parseFloat(computed['font-size'] ?? '16') || 16;
    const ratio = wantSmaller ? 0.8 : wantBigger ? 1.4 : null;
    const nums = extractNumbers(req).filter((n) => n.unit === 'px' || n.unit === 'rem');
    if (nums.length) changes.push({ op: 'setStyle', target: pid, prop: 'font-size', value: `${nums[0].num}${nums[0].unit ?? 'px'}` });
    else if (ratio) changes.push({ op: 'setStyle', target: pid, prop: 'font-size', value: scalePx(`${cur}px`, ratio) });
    else if (cur) changes.push({ op: 'setStyle', target: pid, prop: 'font-size', value: scalePx(`${cur}px`, 1.25) });
    notes.push('字号');
  }

  // 2) 颜色 / 背景
  if (curatedColor) {
    const wantsBackground = /(背景|底色|background)/i.test(req);
    if (wantsBackground) {
      changes.push({ op: 'setStyle', target: pid, prop: 'background-color', value: curatedColor });
      notes.push('背景色');
    } else {
      changes.push({ op: 'setStyle', target: pid, prop: 'color', value: curatedColor });
      notes.push('文字颜色');
    }
  }

  // 3) 间距
  if (/(间距|留白|内边距|内距|padding|外边距|外距|margin|宽松|紧凑|空一点)/i.test(req)) {
    const isMargin = /margin|外边距|外距/i.test(req);
    const prop = isMargin ? 'margin' : 'padding';
    const cur = parseFloat(computed[`${prop}-top`] ?? computed[prop] ?? '0') || 0;
    const nums = extractNumbers(req);
    if (nums.length) changes.push({ op: 'setStyle', target: pid, prop, value: `${nums[0].num}${nums[0].unit ?? 'px'}` });
    else {
      const ratio = /(紧凑|小|收|narrow|tight)/i.test(req) ? 0.6 : 1.6;
      changes.push({ op: 'setStyle', target: pid, prop, value: scalePx(`${cur}px`, ratio) ?? '16px' });
    }
    notes.push('间距');
  }

  // 4) 圆角
  if (/(圆角|圆一点|rounded|border-radius)/i.test(req)) {
    const nums = extractNumbers(req);
    changes.push({ op: 'setStyle', target: pid, prop: 'border-radius', value: nums.length ? `${nums[0].num}${nums[0].unit ?? 'px'}` : /(不|去|取消)/.test(req) ? '0px' : '12px' });
    notes.push('圆角');
  }

  // 5) 加粗 / 斜体 / 下划线
  if (/(加粗|粗体|bold|加黑|更粗)/i.test(req)) {
    changes.push({ op: 'setStyle', target: pid, prop: 'font-weight', value: '700' });
    notes.push('加粗');
  }
  if (/(变细|细体|不要粗)/i.test(req)) {
    changes.push({ op: 'setStyle', target: pid, prop: 'font-weight', value: '400' });
    notes.push('变细');
  }
  if (/(斜体|italic)/i.test(req)) {
    changes.push({ op: 'setStyle', target: pid, prop: 'font-style', value: 'italic' });
    notes.push('斜体');
  }
  if (/(下划线|underline)/i.test(req)) {
    changes.push({ op: 'setStyle', target: pid, prop: 'text-decoration', value: 'underline' });
    notes.push('下划线');
  }

  // 6) 对齐
  if (/(居中|center)/i.test(req)) {
    changes.push({ op: 'setStyle', target: pid, prop: 'text-align', value: 'center' });
    notes.push('居中');
  }
  if (/(左对齐)/i.test(req)) changes.push({ op: 'setStyle', target: pid, prop: 'text-align', value: 'left' });
  if (/(右对齐)/i.test(req)) changes.push({ op: 'setStyle', target: pid, prop: 'text-align', value: 'right' });

  // 7) 行高 / 字距 / 阴影 / 透明度
  if (/(行高|行间距|line-height)/i.test(req)) {
    const nums = extractNumbers(req);
    changes.push({ op: 'setStyle', target: pid, prop: 'line-height', value: nums.length ? String(nums[0].num) : '1.8' });
    notes.push('行高');
  }
  if (/(阴影|立体|shadow)/i.test(req)) {
    changes.push({ op: 'setStyle', target: pid, prop: 'box-shadow', value: '0 10px 30px rgba(15, 23, 42, 0.15)' });
    notes.push('阴影');
  }
  if (/(透明|淡一点|fade)/i.test(req)) {
    changes.push({ op: 'setStyle', target: pid, prop: 'opacity', value: '0.7' });
    notes.push('透明度');
  }

  // 8) 换文字：把"改成 xxx / 换成 xxx / 写 xxx"
  const textChange = req.match(/(?:改成|换成|改为|换为|变成|写成|文本(?:改成|改为)|内容(?:改成|改为))\s*[“"'「]?(.+?)[”"'」]?\s*$/);
  if (textChange && textChange[1] && !/(颜色|大小|字号|背景)/.test(textChange[1])) {
    changes.push({ op: 'setText', target: pid, value: textChange[1].trim() });
    notes.push('文本');
  }

  // 9) 删除 / 增加
  if (/(删掉|删除|去掉|移除|不要这个|remove)/i.test(req)) {
    changes.push({ op: 'removeNode', target: pid });
    notes.push('删除');
  } else if (/((加|增加|添加|插入)(一个|一段|一条)?)(按钮|button)/i.test(req)) {
    changes.push({ op: 'insertHtml', target: pid, position: 'after', html: '<button class="z-added" type="button">新按钮</button>' });
    notes.push('插入按钮');
  } else if (/((加|增加|添加|插入)(一个|一段|一条)?)(段落|文字|文本|标题)/i.test(req)) {
    const value = req.match(/[“"'「](.+?)[”"'」]/)?.[1] ?? '新增一行说明文字';
    changes.push({ op: 'insertHtml', target: pid, position: 'after', html: `<p class="z-added">${value}</p>` });
    notes.push('插入段落');
  }

  // 兜底：什么都不匹配时，给一个"看得见但不乱来"的改动，并诚实说明
  if (!changes.length) {
    const cur = computed['font-size'] ?? '16px';
    changes.push({ op: 'setStyle', target: pid, prop: 'font-size', value: scalePx(cur, 1.2) ?? '19px' });
    notes.push('离线 Mock 只能理解常见指令（大一点/小一点/颜色/间距/圆角/加粗/居中/改文字/删除）；已演示一次字号微调');
  }

  const deduped = [];
  const seenProps = new Set();
  for (const c of changes) {
    const key = c.op === 'setStyle' ? `s:${c.prop}` : `${c.op}:${c.target}`;
    if (c.op === 'setStyle' && seenProps.has(key)) continue;
    if (c.op === 'setStyle') seenProps.add(key);
    deduped.push(c);
  }

  return {
    version: 1,
    target: pid,
    summary: notes.length ? `离线 Mock：${notes.join('、')}` : '离线 Mock 改动',
    changes: deduped.slice(0, 20),
  };
}

/* ============================== HTTP Provider ============================== */

async function callOpenAiCompatible({ endpoint, apiKey, model, messages, signal, temperature = 0.2, jsonMode = true }) {
  const url = endpoint.replace(/\/+$/, '') + '/chat/completions';
  const body = {
    model,
    messages,
    temperature,
    max_tokens: 2000,
    stream: false,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const send = async (payload) =>
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(payload),
      signal,
    });

  let res = await send(body);
  let text = await res.text();

  // 不是所有 OpenAI 兼容端点/模型都支持 response_format。
  // 明确因此报错时，去掉它重试一次——不然用户换个模型就直接失败。
  if (!res.ok && jsonMode && res.status === 400 && /response_format|json_object|not support/i.test(text)) {
    delete body.response_format;
    res = await send(body);
    text = await res.text();
  }

  if (!res.ok) {
    throw new ZError(`模型接口 ${res.status}：${text.slice(0, 300)}`, 'E_MODEL_HTTP', { status: res.status });
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ZError('模型接口返回的不是 JSON', 'E_MODEL_HTTP', { body: text.slice(0, 300) });
  }
  const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? '';
  if (!content) throw new ZError('模型没有返回内容', 'E_MODEL_EMPTY', data);
  return { content, usage: data.usage ?? null, endpoint: url };
}

/** 通用"问模型 → 校验 → 失败自动重试一次"的流程 */
async function generateViaChat({ context, callChat, onDelta }) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserInstruction(context) },
  ];
  onDelta?.('正在请求模型…');
  const first = await callChat(messages);
  try {
    const { patch } = parseModelOutput(first.content, context);
    return { raw: first.content, patch, usage: first.usage, attempts: 1, repaired: false };
  } catch (err) {
    onDelta?.('模型输出不合规，正在要求它自我修复…');
    const repair = [
      ...messages,
      { role: 'assistant', content: String(first.content).slice(0, 2000) },
      { role: 'user', content: buildRepairPrompt(first.content, err.message) },
    ];
    const second = await callChat(repair);
    const { patch } = parseModelOutput(second.content, context);
    return { raw: second.content, patch, usage: second.usage, attempts: 2, repaired: true };
  }
}

/* ============================== 工厂 ============================== */


function createProvider({ kind = PROVIDERS.MOCK, endpoint, apiKey, model } = {}) {
  if (kind === PROVIDERS.MOCK) {
    return {
      kind,
      label: '离线 Mock（无需联网）',
      async generate(context) {
        const started = Date.now();
        await new Promise((r) => setTimeout(r, 220)); // 模拟一点延迟，让"思考中"状态可见
        const raw = JSON.stringify(mockPatch(context), null, 2);
        const patch = validatePatch(coerceToPatch(raw, context));
        return { raw, patch, provider: kind, ms: Date.now() - started, mode: 'mock' };
      },
    };
  }

  if (kind === PROVIDERS.OLLAMA) {
    const url = endpoint || 'http://localhost:11434/v1';
    return {
      kind,
      label: `Ollama (${model || 'qwen2.5:7b'})`,
      async generate(context, { signal, onDelta } = {}) {
        const started = Date.now();
        const res = await generateViaChat({
          context,
          onDelta,
          callChat: (messages) => callOpenAiCompatible({ endpoint: url, model: model || 'qwen2.5:7b', messages, signal, jsonMode: true }),
        });
        return { ...res, provider: kind, ms: Date.now() - started };
      },
    };
  }

  // server（默认走本地代理，key 不出本机）
  const url = endpoint || '/api/chat';
  return {
    kind: PROVIDERS.SERVER,
    label: `服务端模型 (${model || 'deepseek-chat'})`,
    async generate(context, { signal, onDelta } = {}) {
      const started = Date.now();
      if (url.startsWith('/api/')) {
        onDelta?.('正在请求本地模型代理…');
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ context, model }),
          signal,
        });
        const text = await res.text();
        if (!res.ok) throw new ZError(`本地代理 ${res.status}：${text.slice(0, 300)}`, 'E_PROXY_HTTP', { status: res.status });
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          throw new ZError('本地代理返回的不是 JSON', 'E_PROXY_HTTP', { body: text.slice(0, 200) });
        }
        // 代理用 200 + {error} 报告"模型输出不合规"这类失败，必须显式检查，
        // 否则真实失败原因会被吞掉（前端只会看到"没有改动"这种含糊结果）。
        if (data.error && !data.patch) {
          throw new ZError(`本地代理报告失败：${data.error}`, 'E_PROXY_MODEL', data);
        }
        const patch = data.patch ? validatePatch(data.patch) : parseModelOutput(data.raw ?? data.content, context).patch;
        return { raw: data.raw ?? JSON.stringify(data.patch), patch, usage: data.usage ?? null, provider: kind, ms: Date.now() - started, mode: data.mode ?? 'server' };
      }
      const res = await generateViaChat({
        context,
        onDelta,
        callChat: (messages) => callOpenAiCompatible({ endpoint: url, apiKey, model: model || 'deepseek-chat', messages, signal }),
      });
      return { ...res, provider: kind, ms: Date.now() - started };
    },
  };
}

Object.assign(exports, {"SYSTEM_PROMPT": SYSTEM_PROMPT, "buildUserInstruction": buildUserInstruction, "uid": uid});


exports["PROVIDERS"] = exports["PROVIDERS"] ?? (typeof PROVIDERS !== 'undefined' ? PROVIDERS : undefined);
exports["coerceToPatch"] = exports["coerceToPatch"] ?? (typeof coerceToPatch !== 'undefined' ? coerceToPatch : undefined);
exports["parseModelOutput"] = exports["parseModelOutput"] ?? (typeof parseModelOutput !== 'undefined' ? parseModelOutput : undefined);
exports["mockPatch"] = exports["mockPatch"] ?? (typeof mockPatch !== 'undefined' ? mockPatch : undefined);
exports["createProvider"] = exports["createProvider"] ?? (typeof createProvider !== 'undefined' ? createProvider : undefined);
exports["SYSTEM_PROMPT"] = exports["SYSTEM_PROMPT"] ?? (typeof SYSTEM_PROMPT !== 'undefined' ? SYSTEM_PROMPT : undefined);
exports["buildUserInstruction"] = exports["buildUserInstruction"] ?? (typeof buildUserInstruction !== 'undefined' ? buildUserInstruction : undefined);
exports["uid"] = exports["uid"] ?? (typeof uid !== 'undefined' ? uid : undefined);

});

__Z_DEF("diff.mjs", function (exports, __Z_REQ) {
/**
 * diff.mjs — 把一次 patch 变成"人能看懂、能验收"的说明。
 * 预览面板、版本列表、日志都用它。
 */
const { describeChange, escapeHtml } = __Z_REQ("util.mjs");
const { summarizePatch, patchStats } = __Z_REQ("schema.mjs");

const OP_LABELS = {
  setStyle: '样式',
  setText: '文本',
  setAttr: '属性',
  setHtml: '内部结构',
  insertHtml: '插入节点',
  removeNode: '删除元素',
};

/** 结构化：一行一条改动，供列表渲染 */

function describePatch(patch) {
  return (patch?.changes ?? []).map((c, i) => ({
    index: i,
    op: c.op,
    opLabel: OP_LABELS[c.op] ?? c.op,
    target: c.target,
    text: describeChange(c),
    raw: c,
  }));
}

/** 纯文本摘要（日志、版本标题） */

function patchToText(patch) {
  const lines = [];
  if (patch?.summary) lines.push(`摘要：${patch.summary}`);
  const rows = describePatch(patch);
  rows.forEach((r) => lines.push(`${r.index + 1}. [${r.opLabel}] ${r.text}`));
  return lines.join('\n');
}

/** HTML 摘要（预览卡片） */

function patchToHtml(patch) {
  const stats = patchStats(patch);
  const rows = describePatch(patch)
    .map(
      (r) =>
        `<li class="z-diff-row"><span class="z-op z-op-${escapeHtml(r.op)}">${escapeHtml(r.opLabel)}</span>` +
        `<span class="z-diff-text">${escapeHtml(r.text)}</span>` +
        `<code class="z-diff-target">${escapeHtml(r.target)}</code></li>`,
    )
    .join('');
  return (
    `<div class="z-diff"><div class="z-diff-head">${escapeHtml(summarizePatch(patch))}` +
    `<span class="z-diff-count">${stats.total} 处改动 / ${stats.targets.length} 个元素</span></div>` +
    `<ul class="z-diff-list">${rows}</ul></div>`
  );
}

/** 结构对比：选择器的"前后"是否有变化（版本面板显示 +/-） */

function structuralDelta(beforeHtml, afterHtml) {
  const before = countTags(beforeHtml);
  const after = countTags(afterHtml);
  const added = [];
  const removed = [];
  for (const [tag, n] of Object.entries(after)) {
    const prev = before[tag] ?? 0;
    if (n > prev) added.push(`${tag} +${n - prev}`);
    if (n < prev) removed.push(`${tag} ${n - prev}`);
  }
  for (const [tag, n] of Object.entries(before)) {
    if (!(tag in after)) removed.push(`${tag} -${n}`);
  }
  return {
    added,
    removed,
    bytes: (afterHtml?.length ?? 0) - (beforeHtml?.length ?? 0),
    changed: (beforeHtml ?? '') !== (afterHtml ?? ''),
  };
}

function countTags(html) {
  const out = {};
  const re = /<([a-z][a-z0-9-]*)\b/gi;
  let m;
  while ((m = re.exec(String(html ?? '')))) {
    const tag = m[1].toLowerCase();
    out[tag] = (out[tag] ?? 0) + 1;
  }
  return out;
}

/** 只保留改动元素的可读定位（"hero 里的 h1"这一类） */

function shortTargetLabel(desc, pid) {
  if (!desc) return pid;
  const parts = [];
  if (desc.tag) parts.push(desc.tag);
  if (desc.id) parts.push(`#${desc.id}`);
  const text = (desc.text ?? '').trim();
  if (text) parts.push(`“${text.slice(0, 16)}”`);
  return parts.join(' ') || pid;
}


exports["OP_LABELS"] = exports["OP_LABELS"] ?? (typeof OP_LABELS !== 'undefined' ? OP_LABELS : undefined);
exports["describePatch"] = exports["describePatch"] ?? (typeof describePatch !== 'undefined' ? describePatch : undefined);
exports["patchToText"] = exports["patchToText"] ?? (typeof patchToText !== 'undefined' ? patchToText : undefined);
exports["patchToHtml"] = exports["patchToHtml"] ?? (typeof patchToHtml !== 'undefined' ? patchToHtml : undefined);
exports["structuralDelta"] = exports["structuralDelta"] ?? (typeof structuralDelta !== 'undefined' ? structuralDelta : undefined);
exports["shortTargetLabel"] = exports["shortTargetLabel"] ?? (typeof shortTargetLabel !== 'undefined' ? shortTargetLabel : undefined);

});

__Z_DEF("picker.mjs", function (exports, __Z_REQ) {
/**
 * picker.mjs — 指代器核心：鼠标变准星，悬停识别元素链，按住左键列出候选，松开确认选中。
 *
 * 只上报事实（指向哪个 pid、矩形在哪、链有哪几段），不做任何 UI 决策。
 * 界面（高亮框、环绕泡泡）画在父窗口的覆盖层上，因此绝不往用户页面注入样式。
 */
const { PID_ATTR, selectorPath } = __Z_REQ("anchor.mjs");

const MODES = { BROWSE: 'browse', PICK: 'pick' };

function isEditorNode(el) {
  if (!el || el.nodeType !== 1) return true;
  if (el.hasAttribute('data-z-chrome')) return true;
  const tag = el.tagName;
  return tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE' || tag === 'NOSCRIPT';
}

/**
 * 命中测试。
 * 指代器开启时会铺一层全屏隔离层，`elementFromPoint` 会返回它 —— 那样就选不中任何东西了。
 * 所以优先用 `elementsFromPoint` 拿到整条命中栈，跳过编辑器自己的节点（隔离层/注入的样式）。
 */
function hitAt(doc, x, y) {
  if (typeof doc.elementsFromPoint === 'function') {
    const stack = doc.elementsFromPoint(x, y) || [];
    for (const el of stack) {
      if (el && el.nodeType === 1 && !isEditorNode(el)) return el;
    }
    return null;
  }
  const single = doc.elementFromPoint(x, y);
  return single && !isEditorNode(single) ? single : null;
}


class Picker {
  /**
   * @param {object} deps
   * @param {Document} deps.doc
   * @param {Window} deps.win
   * @param {{ensure:(el:Element)=>string, pidOf:(el:Element)=>string, resolve:(pid:string)=>Element|null}} deps.anchor
   * @param {(evt:object)=>void} deps.emit 上报给桥/父窗口
   * @param {(el:Element, box:object) => {name:string, icon:string, kind:string, tooltip:string}} [deps.nameOf]
   *        人话命名（naming.mjs）。不传也能工作，只是退回技术名。
   */
  constructor({ doc, win, anchor, emit, nameOf }) {
    this.doc = doc;
    this.win = win;
    this.anchor = anchor;
    this.emit = emit;
    this.nameOf = nameOf;
    this.mode = MODES.PICK;
    this.enabled = false;
    this.hoverPid = null;
    this.selectedPid = null;
    this.bubble = null; // {x,y,chain,index}
    this.bound = false;
    this.lastMoveTs = 0;
    this.onDown = this.onPointerDown.bind(this);
    this.onMove = this.onPointerMove.bind(this);
    this.onUp = this.onPointerUp.bind(this);
    this.onKey = this.onKeyDown.bind(this);
    this.onLeave = this.onMouseLeave.bind(this);
    this.onScroll = this.onScrollOrResize.bind(this);
    this.onContext = (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.closeBubble('cancel');
    };
  }

  attach() {
    if (this.bound) return;
    this.bound = true;
    // 监听挂在 **window 的捕获阶段**，而不是 document：
    // 拦截守卫也是在 window 捕获阶段（注册得更晚），事件路径 window → document → … → 目标，
    // 这样指代器永远是第一个拿到事件的人，守卫再把事件掐断，
    // 页面绑在元素/容器/document/window 上的监听就全都收不到（否则守卫会把指代器自己也冻住）。
    const w = this.win;
    w.addEventListener('pointermove', this.onMove, true);
    w.addEventListener('pointerdown', this.onDown, true);
    w.addEventListener('pointerup', this.onUp, true);
    w.addEventListener('keydown', this.onKey, true);
    w.addEventListener('mouseleave', this.onLeave, true);
    w.addEventListener('contextmenu', this.onContext, true);
    w.addEventListener('scroll', this.onScroll, true);
    w.addEventListener('resize', this.onScroll, true);
  }

  detach() {
    if (!this.bound) return;
    this.bound = false;
    const w = this.win;
    w.removeEventListener('pointermove', this.onMove);
    w.removeEventListener('pointerdown', this.onDown);
    w.removeEventListener('pointerup', this.onUp);
    w.removeEventListener('keydown', this.onKey);
    w.removeEventListener('mouseleave', this.onLeave);
    w.removeEventListener('contextmenu', this.onContext);
    w.removeEventListener('scroll', this.onScroll);
    w.removeEventListener('resize', this.onScroll);
  }

  setMode(mode) {
    this.mode = mode === MODES.PICK ? MODES.PICK : MODES.BROWSE;
    this.enabled = this.mode === MODES.PICK;
    this.applyCursorClass();
    if (!this.enabled) this.closeBubble('cancel');
    this.emit({ type: 'mode', mode: this.mode });
    return this.mode;
  }

  applyCursorClass() {
    const root = this.doc.documentElement;
    if (!root) return;
    root.classList.toggle('z-picking', this.enabled);
  }

  /** 从最外层到元素自身的祖先链（用于面包屑/面板，人话名由 describe 负责） */
  chainOf(el, limit = 8) {
    const chain = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && chain.length < limit) {
      chain.push(cur);
      cur = cur.parentElement;
    }
    return chain.reverse();
  }

  /** 在某个坐标下，从最深层往外给出候选元素（用于"按住左键选层级"）。 */
  chainAt(x, y) {
    const hit = hitAt(this.doc, x, y);
    if (!hit) return [];
    const chain = [];
    let cur = hit;
    while (cur && cur.nodeType === 1) {
      if (!isEditorNode(cur)) chain.push(cur);
      cur = cur.parentElement;
    }
    return chain; // 最内层在前
  }

  describe(el, index) {
    if (!el) return null;
    const pid = this.anchor.ensure(el);
    const rect = el.getBoundingClientRect();
    let label = el.tagName.toLowerCase();
    if (el.id) label += `#${el.id}`;
    else if (typeof el.className === 'string' && el.className.trim()) {
      const cls = el.className.trim().split(/\s+/).filter((c) => c !== 'picker-selected' && !c.startsWith('z-'));
      if (cls.length) label += `.${cls.slice(0, 2).join('.')}`;
    }
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    const box = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    };
    const path = selectorPath(el);
    // 人话名（需求 R1）：弹层、面包屑、右侧面板、AI 上下文都复用这一个结果
    let named = null;
    try {
      named = this.nameOf ? this.nameOf(el, box) : null;
    } catch {
      named = null; // 命名失败绝不能影响指代器本身
    }
    return {
      pid,
      index,
      label, // 技术名：只用于 tooltip / 面板次级区
      name: named?.name ?? label,
      icon: named?.icon ?? '',
      kind: named?.kind ?? 'other',
      tooltip: named?.tooltip ?? path,
      isCustomName: !!named?.isCustom,
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: (typeof el.className === 'string' ? el.className : '')
        .split(/\s+/)
        .filter((c) => c && c !== 'picker-selected' && !c.startsWith('z-')),
      text: text.slice(0, 48),
      descendantCount: el.querySelectorAll('*').length,
      box,
      selectorPath: path,
    };
  }

  onPointerMove(e) {
    if (!this.enabled) return;
    // 按住期间（候选界面已打开）：**不用页面命中测试改层级**，但要把指针坐标继续回报。
    // 为什么还要回报坐标：在 iframe 里按下后拖到外面时，Chrome 会把指针事件继续投递给 iframe
    // （跨 frame 拖拽的捕获行为），父窗口收不到自己的 pointerover。
    // 所以父窗口需要用这份坐标自己做"是否落在某个选项行上"的命中测试。
    if (this.bubble) {
      const now = e.timeStamp || Date.now();
      if (now - this.lastMoveTs < 16) return;
      this.lastMoveTs = now;
      this.emit({ type: 'bubble-pointer', point: { x: e.clientX, y: e.clientY } });
      return;
    }
    const now = e.timeStamp || Date.now();
    if (now - this.lastMoveTs < 16) return; // 约 60fps，别把 iframe 打满
    this.lastMoveTs = now;
    const hit = hitAt(this.doc, e.clientX, e.clientY);
    if (!hit || isEditorNode(hit)) return;
    const pid = this.anchor.ensure(hit);
    this.hoverPid = pid;
    const chain = this.chainAt(e.clientX, e.clientY).slice(0, 6).map((el, i) => this.describe(el, i));
    this.emit({
      type: 'hover',
      pid,
      target: this.describe(hit, 0),
      chain,
      point: { x: e.clientX, y: e.clientY },
    });
  }

  onPointerDown(e) {
    if (!this.enabled) return;
    if (e.button !== 0) return;
    const chain = this.chainAt(e.clientX, e.clientY);
    if (!chain.length) return;
    const described = chain.slice(0, 8).map((el, i) => this.describe(el, i));
    this.bubble = { chain: described, index: 0, point: { x: e.clientX, y: e.clientY } };
    e.preventDefault();
    e.stopPropagation();
    this.emit({
      type: 'bubble-open',
      point: { x: e.clientX, y: e.clientY },
      chain: described,
      index: 0,
    });
  }

  onPointerUp(e) {
    if (!this.enabled) return;
    if (!this.bubble) return;
    e.preventDefault();
    e.stopPropagation();
    const index = this.bubble.index ?? 0;
    const chain = this.bubble.chain;
    const chosen = chain[index] ?? chain[0];
    // 清掉内部气泡状态：松开之后鼠标再移动不应该继续改层级
    this.bubble = null;
    if (!chosen) return;
    // 通知父窗口"已选这一层"，并把候选链一起带上 ——
    // 父窗口据此把弹层**留在页面上**变成选中工具条（否则按钮根本点不到）。
    this.emit({
      type: 'bubble-pick',
      pid: chosen.pid,
      index,
      chain,
      point: { x: e.clientX, y: e.clientY },
    });
    this.select(chosen.pid, { source: 'bubble' });
  }

  onKeyDown(e) {
    if (!this.enabled) return;
    if (e.key === 'Escape') {
      if (this.bubble) this.closeBubble('cancel');
      else this.emit({ type: 'escape' });
      return;
    }
    if (this.bubble && (e.key === 'ArrowUp' || e.key === 'ArrowLeft')) {
      this.bubble.index = Math.max(0, this.bubble.index - 1);
      this.emit({ type: 'bubble-move', bubble: { index: this.bubble.index }, point: this.bubble.point });
      e.preventDefault();
    }
    if (this.bubble && (e.key === 'ArrowDown' || e.key === 'ArrowRight')) {
      this.bubble.index = Math.min(this.bubble.chain.length - 1, this.bubble.index + 1);
      this.emit({ type: 'bubble-move', bubble: { index: this.bubble.index }, point: this.bubble.point });
      e.preventDefault();
    }
    if (this.bubble && e.key === 'Enter') {
      const chosen = this.bubble.chain[this.bubble.index];
      this.bubble = null;
      this.emit({ type: 'bubble-close', reason: 'pick' });
      if (chosen) this.select(chosen.pid, { source: 'keyboard' });
    }
  }

  onMouseLeave() {
    if (!this.bubble) this.emit({ type: 'hover-end' });
  }

  onScrollOrResize() {
    const pid = this.selectedPid ?? this.hoverPid;
    if (!pid) return;
    const el = this.anchor.resolve(pid);
    if (!el) return;
    this.emit({ type: 'geometry', pid, target: this.describe(el, 0) });
  }

  closeBubble(reason = 'cancel') {
    if (!this.bubble) return;
    this.bubble = null;
    this.emit({ type: 'bubble-close', reason });
  }

  /** 选中（幂等）：加 .picker-selected，回报元素信息。 */
  select(pid, meta = {}) {
    const el = this.anchor.resolve(pid);
    if (!el) {
      this.emit({ type: 'error', code: 'E_SELECT_MISSING', message: `找不到 pid=${pid}` });
      return null;
    }
    this.clearSelection();
    el.classList.add('picker-selected');
    this.selectedPid = pid;
    const desc = this.describe(el, 0);
    const info = {
      ...desc,
      html: el.outerHTML.slice(0, 4000),
      htmlTruncated: el.outerHTML.length > 4000,
      childCount: el.children.length,
      // 祖先链（人话名）：父窗口用它渲染面包屑，保证与弹层一致
      chain: this.chainOf(el)
        .slice(-6)
        .map((node, i) => this.describe(node, i)),
    };
    this.emit({ type: 'select', pid, target: info, source: meta.source ?? 'api' });
    return info;
  }

  clearSelection() {
    for (const el of this.doc.querySelectorAll('.picker-selected')) el.classList.remove('picker-selected');
    if (this.selectedPid) {
      const pid = this.selectedPid;
      this.selectedPid = null;
      this.emit({ type: 'deselect', pid });
    }
  }

  /** 滚动到选中元素（历史回看/定位用） */
  scrollTo(pid, { block = 'center' } = {}) {
    const el = this.anchor.resolve(pid);
    if (!el) return false;
    try {
      el.scrollIntoView({ block, behavior: 'smooth' });
    } catch {
      el.scrollIntoView();
    }
    return true;
  }

  /** 选中元素是否还在（patch 后 UI 校验用） */
  hasSelection() {
    return !!(this.selectedPid && this.anchor.resolve(this.selectedPid));
  }

  state() {
    return { mode: this.mode, hoverPid: this.hoverPid, selectedPid: this.selectedPid, bubble: !!this.bubble };
  }
}

Object.assign(exports, {"PID_ATTR": PID_ATTR});


exports["MODES"] = exports["MODES"] ?? (typeof MODES !== 'undefined' ? MODES : undefined);
exports["Picker"] = exports["Picker"] ?? (typeof Picker !== 'undefined' ? Picker : undefined);
exports["PID_ATTR"] = exports["PID_ATTR"] ?? (typeof PID_ATTR !== 'undefined' ? PID_ATTR : undefined);

});

__Z_DEF("overlay.mjs", function (exports, __Z_REQ) {
/**
 * overlay.mjs — 父窗口里的"指代器视觉层"。
 *
 * 全部画在 iframe **外面**（覆盖层），所以：
 *  - 绝不往用户页面注入任何样式，导出 HTML 永远干净；
 *  - 高亮框/泡泡是 DOM，能做得比 iframe 内画更精细。
 *
 * 坐标系：iframe 内部 clientX/clientY → 加 iframe 在舞台中的偏移 = 覆盖层坐标。
 * iframe 内部若发生滚动，picker 会重发 geometry，这里跟着更新。
 */
const { escapeHtml } = __Z_REQ("util.mjs");

class Overlay {
  constructor({ container, frameEl, onAction }) {
    this.container = container;
    this.frameEl = frameEl;
    this.onAction = onAction;
    this.hl = document.createElement('div');
    this.hl.className = 'z-hl z-hidden';
    this.hl.innerHTML = '<div class="z-hl-tag"></div>';
    this.container.appendChild(this.hl);
    // 跟随光标的气泡（R2.5）：按住鼠标之前就能看到"将要选中什么"
    this.tip = document.createElement('div');
    this.tip.className = 'z-cursor-tip z-hidden';
    this.container.appendChild(this.tip);
    // 瞄准模式暗角（R4.3）
    this.vignette = document.createElement('div');
    this.vignette.className = 'z-vignette z-hidden';
    this.container.appendChild(this.vignette);
    this.bubble = null;
    this.hoverPid = null;
    this.selectedPid = null;
  }

  setAiming(on) {
    this.vignette.classList.toggle('z-hidden', !on);
    if (!on) this.hideTip();
  }

  /** 跟随光标显示"人话名"（R2.5） */
  showTip(point, text) {
    if (!point || !text) return this.hideTip();
    const o = this.offset();
    this.tip.textContent = text;
    this.tip.classList.remove('z-hidden');
    const w = this.tip.offsetWidth || 120;
    const h = this.tip.offsetHeight || 22;
    const cw = this.container.clientWidth;
    const ch = this.container.clientHeight;
    let x = o.x + point.x + 14;
    let y = o.y + point.y + 18;
    if (x + w > cw - 6) x = Math.max(6, o.x + point.x - w - 14); // 贴右边就翻到左侧
    if (y + h > ch - 6) y = Math.max(6, o.y + point.y - h - 10); // 贴底就翻到上方
    this.tip.style.left = `${x}px`;
    this.tip.style.top = `${y}px`;
  }

  hideTip() {
    this.tip.classList.add('z-hidden');
  }

  /** iframe 元素左上角相对覆盖层的偏移 */
  offset() {
    const c = this.container.getBoundingClientRect();
    const f = this.frameEl.getBoundingClientRect();
    return { x: f.left - c.left, y: f.top - c.top };
  }

  toOverlayRect(box) {
    const o = this.offset();
    return { x: o.x + box.x, y: o.y + box.y, w: box.w, h: box.h };
  }

  showHighlight(target, { selected = false, label } = {}) {
    if (!target?.box) return;
    const r = this.toOverlayRect(target.box);
    if (r.w <= 0 || r.h <= 0) {
      this.hideHighlight();
      return;
    }
    this.hl.classList.remove('z-hidden');
    this.hl.classList.toggle('selected', selected);
    Object.assign(this.hl.style, {
      left: `${r.x}px`,
      top: `${r.y}px`,
      width: `${r.w}px`,
      height: `${r.h}px`,
    });
    const tag = this.hl.querySelector('.z-hl-tag');
    const text = label ?? `${target.icon ?? ''} ${target.name ?? target.tag ?? ''}`.trim();
    tag.textContent = text;
    // 顶部空间不足时把标签放到框内
    tag.style.top = r.y < 22 ? `${r.h}px` : '0px';
    tag.style.transform = r.y < 22 ? 'none' : 'translateY(-100%)';
  }

  updateSelected(target) {
    this.selectedPid = target?.pid ?? null;
    if (target) {
      this.showHighlight(target, {
        selected: true,
        label: `${target.icon ?? ''} ${target.name ?? ''} · 已选中`,
      });
    }
  }

  hideHighlight() {
    this.hl.classList.add('z-hidden');
  }

  clear() {
    this.hideHighlight();
    this.closeBubble();
    this.hideTip();
  }

  /* ------------------------------ 环绕泡泡 ------------------------------ */

  openBubble({ point, chain, index = 0, actions }) {
    this.closeBubble();
    this.hideTip();
    const pts = this.offset();
    const el = document.createElement('div');
    el.className = 'z-bubble';
    // R1.1/R1.3：主标识是人话名，技术名只放进 tooltip；R2.2 每项带类型图标
    const chainHtml = chain
      .map(
        (c, i) =>
          `<button data-chain="${i}" class="${i === index ? 'on' : ''}" title="${escapeHtml(c.tooltip ?? c.selectorPath ?? '')}">` +
          `<span class="z-chain-icon">${escapeHtml(c.icon ?? '')}</span>` +
          `<span class="z-chain-name">${escapeHtml(c.name ?? c.label ?? '')}</span></button>`,
      )
      .join('');
    const actHtml = (actions ?? [])
      .map((a) => `<button class="z-bubble-btn ${a.primary ? 'primary' : ''}" data-action="${escapeHtml(a.id)}">${escapeHtml(a.label)}</button>`)
      .join('');
    el.innerHTML =
      `<div class="z-bubble-chain z-scroll">${chainHtml}</div>` +
      `<div class="z-bubble-hint">滑到某项即高亮<br>↑↓ 换层级<br>松开确定<br>双击可改名</div>` +
      `<div style="width:1px;height:52px;background:var(--z-border)"></div>` +
      `<div class="z-bubble-actions" style="display:flex;gap:4px;align-items:center">${actHtml}</div>`;
    this.container.appendChild(el);
    this.bubble = el;

    el.addEventListener('click', (e) => {
      const chainBtn = e.target.closest('[data-chain]');
      if (chainBtn) {
        const i = Number(chainBtn.dataset.chain);
        this.setBubbleIndex(i);
        this.onAction?.({ type: 'bubble-chain', index: i, chain });
        return;
      }
      const actBtn = e.target.closest('[data-action]');
      if (actBtn) {
        this.onAction?.({ type: 'bubble-action', action: actBtn.dataset.action, chain, index: this.currentIndex });
      }
    });

    // 按住期间把指针移到弹层上：**保持原位、什么都不做**。
    // 之前这里会"钉住"并顺带把弹层挪到元素右下角 —— 结果用户刚碰到它就被弹走，
    // 根本没法在选项上滑动。现在按住期间弹层不动，指针滑到哪一项就高亮哪一项。
    el.addEventListener('pointerenter', () => {
      this.hintState = this.hintState ?? 'holding';
    });

    /**
     * 滑到某项 → 高亮该项 + 预览区对应元素。
     *
     * 两条通道必须都接上：
     *  ① 父窗口自己的 pointerover/mouseover —— 指针没被 iframe 捕获时走这条；
     *  ② iframe 回传的指针坐标（hoverAtPoint）—— 在 iframe 里按下后拖到外面时，
     *     Chrome 会把指针事件继续投递给 iframe，父窗口收不到自己的 hover 事件；
     *     而且指代器在 pointerdown 里 preventDefault() 后，兼容鼠标事件（mouseover）
     *     在该指针序列里被抑制 —— 只靠 mouseover 会出现"按住时滑选项完全没反应"。
     */
    this.applyRowIndex = (i) => {
      const c = (this.chain ?? chain)[i];
      if (!c) return;
      this.setBubbleIndex(i);
      this.showHighlight(c, { label: `${c.icon ?? ''} ${c.name ?? ''} · ${c.box?.w ?? 0}×${c.box?.h ?? 0}` });
      if (this.currentIndex !== this.lastSyncedIndex) {
        this.lastSyncedIndex = this.currentIndex;
        this.onAction?.({ type: 'bubble-index', index: this.currentIndex });
      }
    };
    const onRowHover = (e) => {
      const chainBtn = e.target?.closest?.('[data-chain]');
      if (!chainBtn) return;
      this.applyRowIndex(Number(chainBtn.dataset.chain));
    };
    el.addEventListener('pointerover', onRowHover);
    el.addEventListener('mouseover', onRowHover);

    // 在弹层上松开鼠标：iframe 收不到这个事件，由父窗口自己确认选中 + 变工具条。
    // 同样优先用 pointerup（不受 pointerdown 取消的影响）。
    const onRelease = () => {
      if (this.releaseHandled) return;
      this.releaseHandled = true;
      this.markReleased();
      this.onAction?.({ type: 'bubble-commit', chain: this.chain ?? chain, index: this.currentIndex ?? index });
    };
    el.addEventListener('pointerup', onRelease);
    el.addEventListener('mouseup', onRelease);

    // R5：双击弹层项即可重命名
    el.addEventListener('dblclick', (e) => {
      const chainBtn = e.target.closest('[data-chain]');
      if (!chainBtn) return;
      e.preventDefault();
      e.stopPropagation();
      const i = Number(chainBtn.dataset.chain);
      const c = chain[i];
      if (c) this.onAction?.({ type: 'rename', pid: c.pid, name: c.name, chain, index: i });
    });

    this.currentIndex = index;
    this.lastSyncedIndex = -1;
    this.releaseHandled = false;
    this.chain = chain;
    this.positionBubble(point, pts);
    return el;
  }

  positionBubble(point, pts = this.offset()) {
    if (!this.bubble) return;
    const cw = this.container.clientWidth;
    const ch = this.container.clientHeight;
    const bw = this.bubble.offsetWidth || 320;
    const bh = this.bubble.offsetHeight || 120;
    let x = pts.x + (point?.x ?? 0) + 16;
    let y = pts.y + (point?.y ?? 0) - 14;
    if (x + bw > cw - 6) x = Math.max(6, cw - bw - 6);
    if (y + bh > ch - 6) y = Math.max(6, ch - bh - 6);
    if (y < 6) y = 6;
    this.bubble.style.left = `${x}px`;
    this.bubble.style.top = `${y}px`;
    this.bubble.style.pointerEvents = 'auto';
  }

  setBubbleIndex(index) {
    this.currentIndex = index;
    if (!this.bubble) return;
    this.bubble.querySelectorAll('[data-chain]').forEach((b, i) => b.classList.toggle('on', i === index));
    const c = this.chain?.[index];
    if (c) {
      this.showHighlight(c, {
        label: `${c.icon ?? ''} ${c.name ?? ''} · ${c.box?.w ?? 0}×${c.box?.h ?? 0}`,
      });
    }
  }

  closeBubble() {
    if (this.bubble) {
      this.bubble.remove();
      this.bubble = null;
      this.currentIndex = 0;
      this.lastSyncedIndex = -1; // 新弹层要重新同步，别沿用上一个的
      this.releaseHandled = false;
    }
  }

  /**
   * 松开鼠标后把弹层**留在页面上**，变成"已选中"工具条。
   *
   * 为什么必须这么做：原来一松手就整体消失，用户根本来不及点到「让 AI 改这块」，
   * 主功能等于不可用。现在松开 = 选中 + 工具条常驻，用户可以从容点按钮。
   * 位置锚定到选中元素的下方（贴边时 positionBubble 会自动翻转）。
   */
  stickBubble({ chain, index = 0, released = true }) {
    if (!this.bubble) return false;
    this.bubble.classList.add('stuck');
    this.chain = chain ?? this.chain;
    this.setBubbleIndex(index);
    const c = this.chain?.[index];
    this.setHint(released ? 'released' : 'holding');
    // 加一个显眼的关闭按钮（工具条状态下的出口）
    const actions = this.bubble.querySelector('.z-bubble-actions');
    if (actions && !actions.querySelector('[data-action="close"]')) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'z-bubble-btn';
      closeBtn.setAttribute('data-action', 'close'); // 用 setAttribute，不依赖 dataset 行为
      closeBtn.title = '关闭';
      closeBtn.textContent = '✕';
      actions.appendChild(closeBtn);
    }
    // 锚到元素下方；如果元素在视口下方，positionBubble 会翻到上方
    if (c?.box) {
      const o = this.offset();
      const anchorPoint = { x: o.x + c.box.x + c.box.w - 40, y: o.y + c.box.y + c.box.h + 4 };
      this.positionBubbleAt(anchorPoint);
    }
    return true;
  }

  /** 提示文案随状态变化：还在按住 ≠ 已选中 */
  setHint(state) {
    const hint = this.bubble?.querySelector('.z-bubble-hint');
    if (!hint) return;
    this.hintState = state;
    hint.innerHTML =
      state === 'released'
        ? '已选中<br>↑↓ 换层级<br>Esc 关闭'
        : '滑到某项即高亮<br>↑↓ 换层级<br>松开确定';
  }

  /** 鼠标在弹层上松开：还没标记过"已选中"就补上（浏览器不会把 iframe 外的事件传给 iframe） */
  markReleased() {
    if (this.bubble && this.hintState === 'holding') this.setHint('released');
  }

  /**
   * 用 iframe 回传的指针坐标（iframe 视口坐标系）做命中测试：
   * 指针落在哪个候选项上就切到哪一项。
   * 这条通道专治"在 iframe 里按下后拖到外面、事件仍被 iframe 捕获"的情况。
   */
  hoverAtPoint(iframePoint) {
    if (!this.bubble || !iframePoint) return false;
    const rows = [...this.bubble.querySelectorAll('[data-chain]')];
    if (!rows.length) return false;
    const o = this.offset();
    const cRect = this.container.getBoundingClientRect();
    const x = o.x + iframePoint.x;
    const y = o.y + iframePoint.y;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      const left = r.left - cRect.left;
      const top = r.top - cRect.top;
      if (x >= left && x <= left + r.width && y >= top && y <= top + r.height) {
        if (i !== this.currentIndex) this.applyRowIndex?.(i);
        return true;
      }
    }
    return false;
  }

  /** 按"覆盖层坐标"摆弹层（stickBubble 用，point 已经是最终坐标） */
  positionBubbleAt(absPoint) {
    if (!this.bubble) return;
    const bw = this.bubble.offsetWidth || 320;
    const bh = this.bubble.offsetHeight || 120;
    const cw = this.container.clientWidth;
    const ch = this.container.clientHeight;
    let x = absPoint.x;
    let y = absPoint.y;
    if (x + bw > cw - 6) x = Math.max(6, cw - bw - 6);
    if (x < 6) x = 6;
    if (y + bh > ch - 6) y = Math.max(6, absPoint.y - bh - 26);
    if (y < 6) y = 6;
    this.bubble.style.left = `${x}px`;
    this.bubble.style.top = `${y}px`;
  }

  /* ------------------------------ 提示条 ------------------------------ */

  toast(message, kind = '', ms = 2600) {
    let wrap = this.container.querySelector('.z-toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'z-toast-wrap';
      this.container.appendChild(wrap);
    }
    const el = document.createElement('div');
    el.className = `z-toast ${kind}`;
    el.textContent = message;
    wrap.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .2s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 220);
    }, ms);
    return el;
  }
}


exports["Overlay"] = exports["Overlay"] ?? (typeof Overlay !== 'undefined' ? Overlay : undefined);

});

__Z_DEF("ui.mjs", function (exports, __Z_REQ) {
/**
 * ui.mjs — 编辑器外壳的 DOM：单选卡片、AI 对话框、patch 预览卡、版本历史、设置抽屉。
 * 这里只管"怎么显示"，所有状态与决策在 app.mjs。
 */
const { escapeHtml, formatBytes, formatDateTime, formatTime, truncate } = __Z_REQ("util.mjs");
const { patchToHtml } = __Z_REQ("diff.mjs");
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};


class ChatPanel {
  constructor(root, handlers = {}) {
    this.root = root;
    this.handlers = handlers;
    this.messages = [];
    this.build();
  }

  build() {
    this.root.innerHTML = '';
    this.root.classList.add('z-panel', 'on');
    this.root.dataset.panel = 'chat';

    // 选区卡片
    this.selCard = el('div', 'z-sel empty', '还没选中元素<br><span style="font-size:11px">在左边页面上按住左键，松开即选中</span>');
    this.root.appendChild(this.selCard);

    // 对话滚动区
    this.scroll = el('div', 'z-chat-scroll z-scroll');
    this.root.appendChild(this.scroll);

    this.emptyHint = el(
      'div',
      'z-msg sys',
      `<div class="z-msg-body">选中一个元素 → 在下面用大白话描述想怎么改。<br>` +
        `例如：<b>标题再大一点，换成深蓝</b>；<b>这个卡片圆角大一点，加个阴影</b>。<br>` +
        `AI 只会改你选中的这一块，改完先预览，你点"接受"才会存成新版本。</div>`,
    );
    this.scroll.appendChild(this.emptyHint);

    // 输入区
    this.composer = el('div', 'z-composer disabled');
    this.ta = el('textarea', 'z-ta');
    this.ta.placeholder = '先用指代器选中一个元素，然后在这里说你想怎么改…';
    this.ta.disabled = true;
    this.row = el('div', 'z-composer-row');
    this.sendBtn = el('button', 'z-btn primary', '生成改动');
    this.sendBtn.disabled = true;
    this.settingsBtn = el('button', 'z-btn', '⚙ 模型设置');
    this.kbd = el('span', 'z-kbd', 'Ctrl+Enter 发送');
    this.row.append(this.sendBtn, this.settingsBtn, this.kbd);
    this.chips = el('div', 'z-chips');
    this.chips.dataset.el = 'chips';
    this.composer.append(this.ta, this.row, this.chips);
    this.root.appendChild(this.composer);
    this.renderChips(['大一点', '小一点', '换个颜色', '加个阴影']); // 未选中时的通用兜底

    this.sendBtn.addEventListener('click', () => this.handlers.onSend?.(this.ta.value));
    this.settingsBtn.addEventListener('click', () => this.handlers.onSettings?.());
    this.ta.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        this.handlers.onSend?.(this.ta.value);
      }
    });
  }

  /* ------------------------------ 选区卡片 ------------------------------ */

  /**
   * R3：主视觉是"人话名"，技术信息（选择器/尺寸/HTML）折叠到次级区。
   * R1.3：技术信息不删除，只是默认不出现。
   */
  renderSelection(target) {
    this.selected = target;
    if (this.renameBox) {
      this.renameBox.remove();
      this.renameBox = null;
    }
    if (!target) {
      this.selCard.className = 'z-sel empty';
      this.selCard.innerHTML = '还没选中元素<br><span style="font-size:11px">在左边页面上按住左键，松开即选中</span>';
      this.setEnabled(false);
      this.renderChips(['大一点', '小一点', '换个颜色', '加个阴影']);
      return;
    }
    this.selCard.className = 'z-sel';
    const name = target.name ?? target.label ?? '';
    // 「…」里是元素文本，单独上色，扫一眼就能确认选的是哪一块
    const m = name.match(/^(.*?)「(.+)」$/);
    const nameHtml = m
      ? `${escapeHtml(m[1])}<span class="z-quote">「${escapeHtml(m[2])}」</span>`
      : escapeHtml(name);
    const icon = target.icon ?? '';
    const isCustom = target.isCustomName;
    this.selCard.innerHTML =
      `<div class="z-sel-head">` +
      `<span class="z-sel-icon">${escapeHtml(icon)}</span>` +
      `<span class="z-sel-name" data-el="selname">${nameHtml}</span>` +
      `<span class="z-sel-actions">` +
      `<button class="z-btn sm ghost" data-act="rename" title="给这块起个你自己的名字（双击弹层也能改）">✎ 改名</button>` +
      `<button class="z-btn sm ghost" data-act="clear" title="取消选中">✕</button>` +
      `</span></div>` +
      `<details class="z-disclosure"><summary>技术细节（选择器 / 尺寸 / HTML）</summary>` +
      `<div class="z-tech">` +
      `<div class="z-tech-row"><b>选择器</b><code data-el="selpath">${escapeHtml(target.selectorPath ?? '')}</code></div>` +
      `<div class="z-tech-row"><b>尺寸</b><span>${target.box?.w ?? 0}×${target.box?.h ?? 0}px · 子元素 ${target.childCount ?? 0} · 后代 ${target.descendantCount ?? 0}</span></div>` +
      (target.html ? `<div class="z-tech-row"><b>HTML</b><code>${escapeHtml(truncate(target.html, 260))}</code></div>` : '') +
      `<div style="display:flex;gap:6px"><button class="z-btn sm" data-act="copy">复制选择器</button>` +
      `<button class="z-btn sm ghost" data-act="clear2">取消选中</button></div>` +
      `</div></details>` +
      (isCustom ? `<div class="z-sel-meta" style="margin-top:6px">已使用你的命名 · 自动识别：${escapeHtml(target.autoName ?? '')}</div>` : '');
    this.selCard.querySelector('[data-act="clear"]')?.addEventListener('click', () => this.handlers.onClearSelection?.());
    this.selCard.querySelector('[data-act="clear2"]')?.addEventListener('click', () => this.handlers.onClearSelection?.());
    this.selCard.querySelector('[data-act="copy"]')?.addEventListener('click', () => this.handlers.onCopySelector?.(target.selectorPath ?? ''));
    this.selCard.querySelector('[data-act="rename"]')?.addEventListener('click', () => this.handlers.onRename?.(target));
    this.setEnabled(true);
    // R3.3：快捷指令按元素类型动态变化
    this.renderChips(this.handlers.chipsFor?.(target) ?? ['大一点', '小一点', '换个颜色']);
  }

  /** 按类型渲染快捷指令（R3.3） */
  renderChips(list = []) {
    if (!this.chips) return;
    this.chips.innerHTML = '';
    for (const text of list.slice(0, 6)) {
      const chip = el('button', 'z-chip', escapeHtml(text));
      chip.addEventListener('click', () => {
        this.ta.value = this.ta.value ? `${this.ta.value}，${text}` : text;
        this.ta.focus();
      });
      this.chips.appendChild(chip);
    }
  }

  /** 内联重命名（R5）：不弹系统对话框，就地输入 */
  promptRename(current, onSave) {
    if (this.renameBox) {
      this.renameBox.remove();
      this.renameBox = null;
    }
    const box = el('div', 'z-rename');
    const input = el('input');
    input.type = 'text';
    input.value = current ?? '';
    input.placeholder = '给这块起个你自己的名字…';
    input.maxLength = 40;
    const ok = el('button', 'z-btn sm primary', '保存');
    const cancel = el('button', 'z-btn sm ghost', '取消');
    box.append(input, ok, cancel);
    this.selCard.appendChild(box);
    this.renameBox = box;
    try {
      input.focus();
      input.select();
    } catch {
      /* ignore */
    }
    const done = () => {
      box.remove();
      this.renameBox = null;
    };
    ok.addEventListener('click', () => {
      const v = input.value.trim();
      done();
      onSave?.(v);
    });
    cancel.addEventListener('click', done);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const v = input.value.trim();
        done();
        onSave?.(v);
      } else if (e.key === 'Escape') {
        done();
      }
      e.stopPropagation();
    });
  }

  setEnabled(on) {
    this.ta.disabled = !on;
    this.sendBtn.disabled = !on;
    this.composer.classList.toggle('disabled', !on);
    this.ta.placeholder = on ? '说人话就行，比如：标题再大一点，换成深蓝' : '先用指代器选中一个元素，然后在这里说你想怎么改…';
  }

  setBusy(on, hint) {
    this.busy = !!on;
    this.sendBtn.disabled = on || this.ta.disabled;
    this.sendBtn.textContent = on ? '思考中…' : '生成改动';
    if (on) {
      this.typing = this.addMessage('assistant', hint || '正在让模型给出改动方案', { typing: true });
    } else if (this.typing) {
      this.typing.remove();
      this.typing = null;
    }
  }

  getPrompt() {
    return this.ta.value.trim();
  }

  clearPrompt() {
    this.ta.value = '';
  }

  /* ------------------------------ 消息 ------------------------------ */

  addMessage(role, text, { detail, typing = false, cls = '' } = {}) {
    this.emptyHint?.classList.add('z-hidden');
    const node = el('div', `z-msg ${role} ${cls}`);
    const roleName = { user: '你', assistant: 'AI', sys: '系统', err: '出错', ok: '完成' }[role] ?? role;
    const label = { user: '你', assistant: 'AI' }[role] ?? { sys: '系统', err: '出错', ok: '完成' }[role];
    node.appendChild(el('div', 'z-msg-role', `<span>${escapeHtml(label)}</span>`));
    const body = el('div', 'z-msg-body');
    if (typing) {
      body.innerHTML = `${escapeHtml(text)} <span class="z-typing"><span></span><span></span><span></span></span>`;
    } else {
      body.textContent = text;
    }
    node.appendChild(body);
    if (detail) {
      const raw = el('div', 'z-raw');
      raw.textContent = typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2);
      node.appendChild(raw);
    }
    this.scroll.appendChild(node);
    this.scroll.scrollTop = this.scroll.scrollHeight;
    return node;
  }

  /** patch 预览卡：列出每条改动 + 接受/取消/重试 */
  addPatchCard({ patch, providerLabel, ms, attempts, repaired }) {
    const card = el('div', 'z-card');
    card.innerHTML =
      `<div class="z-card-title"><b>改动预览</b>` +
      `<span style="font-size:10.5px;color:var(--z-dim-2)">${escapeHtml(providerLabel ?? '')}` +
      `${ms ? ` · ${ms}ms` : ''}${attempts > 1 ? ` · 第 ${attempts} 次尝试` : ''}${repaired ? ' · 已自动修复格式' : ''}</span></div>` +
      patchToHtml(patch) +
      `<div class="z-card-actions">` +
      `<button class="z-btn primary" data-act="accept">接受并保存版本</button>` +
      `<button class="z-btn" data-act="cancel">取消（回滚）</button>` +
      `<button class="z-btn ghost" data-act="retry">重试</button>` +
      `<span class="z-hint">快捷键 Ctrl+Enter 接受 / Esc 取消</span></div>`;
    this.scroll.appendChild(card);
    this.scroll.scrollTop = this.scroll.scrollHeight;
    return card;
  }

  setCardState(card, state, note) {
    if (!card) return;
    card.classList.remove('accepted', 'rejected');
    if (state === 'accepted') card.classList.add('accepted');
    if (state === 'rejected') card.classList.add('rejected');
    const actions = card.querySelector('.z-card-actions');
    if (actions) {
      actions.innerHTML = `<span class="z-hint" style="margin:0">${escapeHtml(note ?? '')}</span>`;
    }
  }

  /** 需要用户做选择的卡片（例如"AI 想改外层容器，要不要改选外层重试"） */
  addActionCard({ title, body, actions = [] }) {
    this.emptyHint?.classList.add('z-hidden');
    const card = el('div', 'z-card z-action-card');
    card.innerHTML =
      `<div class="z-card-title"><b>${escapeHtml(title)}</b></div>` +
      `<div style="font-size:12px;color:var(--z-dim);line-height:1.6;white-space:pre-wrap">${escapeHtml(body)}</div>` +
      `<div class="z-card-actions"></div>`;
    const row = card.querySelector('.z-card-actions');
    for (const a of actions) {
      const btn = el('button', `z-btn ${a.primary ? 'primary' : ''}`, escapeHtml(a.label));
      btn.addEventListener('click', () => {
        row.innerHTML = `<span class="z-hint" style="margin:0">已处理</span>`;
        a.run?.();
      });
      row.appendChild(btn);
    }
    this.scroll.appendChild(card);
    this.scroll.scrollTop = this.scroll.scrollHeight;
    return card;
  }

  scrollToBottom() {
    this.scroll.scrollTop = this.scroll.scrollHeight;
  }
}

/* ================================ 版本历史 ================================ */


class VersionsPanel {
  constructor(root, handlers = {}) {
    this.root = root;
    this.handlers = handlers;
    this.root.classList.add('z-panel');
    this.root.dataset.panel = 'versions';
    this.build();
  }

  build() {
    this.root.innerHTML = '';
    this.summary = el('div', 'z-sel', '还没有版本。接受一次 AI 改动就会生成一个版本。');
    this.list = el('div', 'z-versions z-scroll');
    this.root.append(this.summary, this.list);
  }

  render({ items, stats, workspaceName }) {
    this.summary.className = 'z-sel';
    this.summary.innerHTML =
      `<div class="z-sel-head"><span class="z-sel-tag">${items.length} 个版本</span>` +
      `<span style="font-size:11px;color:var(--z-dim)">当前第 ${stats.cursor + 1} 版</span></div>` +
      `<div class="z-sel-meta"><span>文件：${escapeHtml(workspaceName ?? '未命名')}</span>` +
      `<span>快照合计 ${formatBytes(stats.bytes)}</span>` +
      `<span>撤销 ${stats.canUndo ? '可用' : '到头'}</span><span>重做 ${stats.canRedo ? '可用' : '到头'}</span></div>` +
      (stats.warning ? `<div class="z-sel-meta" style="color:var(--z-warn)">⚠ ${escapeHtml(stats.warning)}</div>` : '');

    this.list.innerHTML = '';
    for (const item of [...items].reverse()) {
      const node = el('div', `z-ver ${item.current ? 'current' : ''} ${item.future ? 'future' : ''}`);
      const srcLabel = { initial: '初始', ai: 'AI 改动', 'manual-edit': '手改', rollback: '回滚' }[item.source] ?? item.source;
      node.innerHTML =
        `<div class="z-ver-title"><span class="n">v${item.index}</span><span>${escapeHtml(truncate(item.label, 40))}</span></div>` +
        `<div class="z-ver-sub"><span class="z-src ${escapeHtml(item.source)}">${escapeHtml(srcLabel)}</span>` +
        `<span>${formatTime(item.createdAt)}</span><span>${item.changes} 处改动</span>` +
        `<span>${escapeHtml(formatBytes(item.bytes))}</span></div>` +
        (item.summary ? `<div class="z-ver-prompt">${escapeHtml(truncate(item.summary, 60))}</div>` : '') +
        `<div class="z-ver-actions">` +
        `<button class="z-btn sm" data-act="jump">${item.current ? '当前版本' : '回看并还原'}</button>` +
        `<button class="z-btn sm ghost" data-act="view">只看差异</button>` +
        (item.index === 0 ? '' : `<button class="z-btn sm danger" data-act="del">删除</button>`) +
        `</div>`;
      node.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (!act) return;
        e.stopPropagation();
        if (act === 'jump') this.handlers.onJump?.(item.id);
        if (act === 'view') this.handlers.onView?.(item.id);
        if (act === 'del') this.handlers.onDelete?.(item.id);
      });
      this.list.appendChild(node);
    }
    this.list.scrollTop = 0;
  }
}

/* ================================ 设置抽屉 ================================ */


class SettingsModal {
  constructor({ onSave, onClose, onTest }) {
    this.onSave = onSave;
    this.onClose = onClose;
    this.onTest = onTest;
    this.node = null;
  }

  open(current) {
    this.close();
    const mask = el('div', 'z-modal-mask');
    const modal = el('div', 'z-modal');
    modal.innerHTML =
      `<div class="z-modal-head"><b>模型设置</b><span style="font-size:11px;color:var(--z-dim-2)">key 只存在你自己的浏览器/本机服务里</span></div>` +
      `<div class="z-modal-body">` +
      `<div class="z-field"><label>Provider</label><select data-f="kind">` +
      `<option value="mock">离线 Mock（默认，不联网，演示用）</option>` +
      `<option value="server">本地代理 → 真实模型（推荐）</option>` +
      `<option value="ollama">本地 Ollama</option>` +
      `</select><div class="help">Mock 用规则引擎把"大一点/变蓝/加阴影"翻译成合法 patch，方便你先把交互跑通。<br>` +
      `真实模型需要在项目目录执行 <code>node tools/serve.mjs</code>，并把 API key 放在环境变量里。</div></div>` +
      `<div class="z-row2"><div class="z-field"><label>接口地址</label><input data-f="endpoint" placeholder="https://api.siliconflow.cn/v1"></div>` +
      `<div class="z-field"><label>模型名</label><input data-f="model" placeholder="deepseek-ai/DeepSeek-V4-Flash"></div></div>` +
      `<div class="z-field"><label>API Key（用本地代理模式时**不用填**；直接连端点才需要）</label>` +
      `<input data-f="apiKey" type="password" placeholder="sk-..."></div>` +
      `<div class="z-code" data-test-result>点"测试连接"可以先确认配置是否可用。<br>` +
      `推荐：把 key 放在 <b>tools/serve.mjs</b> 的环境变量里（见 README），浏览器侧完全不接触 key。<br>` +
      `注意：直接在此处填的 key 只留在本页内存里，不会写入浏览器存储。</div>` +
      `</div>` +
      `<div class="z-modal-foot"><button class="z-btn" data-act="test">测试连接</button>` +
      `<button class="z-btn ghost" data-act="cancel">取消</button>` +
      `<button class="z-btn primary" data-act="save">保存</button></div>`;
    mask.appendChild(modal);
    document.body.appendChild(mask);
    this.node = mask;

    const field = (f) => modal.querySelector(`[data-f="${f}"]`);
    field('kind').value = current.kind ?? 'mock';
    field('endpoint').value = current.endpoint ?? '';
    field('model').value = current.model ?? '';
    field('apiKey').value = current.apiKey ?? '';

    const close = () => this.close();
    mask.addEventListener('click', (e) => {
      if (e.target === mask) close();
    });
    modal.querySelector('[data-act="cancel"]').addEventListener('click', () => {
      close();
      this.onClose?.();
    });
    modal.querySelector('[data-act="save"]').addEventListener('click', () => {
      const next = {
        kind: field('kind').value,
        endpoint: field('endpoint').value.trim(),
        model: field('model').value.trim(),
        apiKey: field('apiKey').value.trim(),
      };
      this.onSave?.(next);
      close();
    });
    modal.querySelector('[data-act="test"]').addEventListener('click', async () => {
      const out = modal.querySelector('[data-test-result]');
      out.textContent = '正在测试…';
      try {
        const res = await this.onTest?.({
          kind: field('kind').value,
          endpoint: field('endpoint').value.trim(),
          model: field('model').value.trim(),
          apiKey: field('apiKey').value.trim(),
        });
        out.textContent = res?.message ?? '测试完成';
      } catch (err) {
        out.textContent = `测试失败：${err?.message ?? err}`;
      }
    });
    return mask;
  }

  close() {
    this.node?.remove();
    this.node = null;
  }
}


exports["ChatPanel"] = exports["ChatPanel"] ?? (typeof ChatPanel !== 'undefined' ? ChatPanel : undefined);
exports["VersionsPanel"] = exports["VersionsPanel"] ?? (typeof VersionsPanel !== 'undefined' ? VersionsPanel : undefined);
exports["SettingsModal"] = exports["SettingsModal"] ?? (typeof SettingsModal !== 'undefined' ? SettingsModal : undefined);

});

__Z_DEF("bridge.mjs", function (exports, __Z_REQ) {
/**
 * bridge.mjs — iframe 内的 RPC 桥。
 *
 * 父窗口把所有"改 DOM"的动作都通过这里下发；iframe 只回报事实。
 * 这样模型、UI、快照全都在父窗口，iframe 里没有一行"业务决策"。
 *
 * 消息形状：{ __z: 'req'|'res'|'evt', id, op?, args?, ok?, result?, error? }
 */
const { AnchorManager, selectorPath } = __Z_REQ("anchor.mjs");
const { Picker, MODES } = __Z_REQ("picker.mjs");
const { applyPatch, undoPatch, sanitizeHtmlFragment, scrubEditorArtifacts } = __Z_REQ("patch.mjs");
const { validatePatch } = __Z_REQ("schema.mjs");
const { buildContext } = __Z_REQ("selector.mjs");
const { describeElement } = __Z_REQ("naming.mjs");
const { ZError, truncateBytes } = __Z_REQ("util.mjs");
const NS = 'zhidaiqi';

/* ======================================================================
 * 指代器开启时"冻住"页面自身的交互
 *
 * 需求：导入的 HTML 在指代器**关闭**时功能完全正常；**开启**后鼠标只属于指代器，
 * 页面自身收不到输入（例如按左键不该触发页面里"左键翻页"的逻辑）。
 *
 * 只靠一种手段挡不住全部情况，这里用两层：
 *   ① 全屏透明隔离层：事件目标直接落在它身上，页面元素既收不到事件、也不会进入 :hover；
 *   ② document/window 捕获阶段的守卫：掐断冒泡，页面绑在容器或 window 上的监听也拿不到。
 * 两层都只在 picker.enabled 时才生效。
 * ==================================================================== */

const SHIELD_ATTR = 'data-z-shield';

/** 铺一层透明隔离层（指代器开启时） */

function ensureShield(doc) {
  if (doc.querySelector(`[${SHIELD_ATTR}]`)) return;
  const shield = doc.createElement('div');
  shield.setAttribute(SHIELD_ATTR, '');
  shield.setAttribute('data-z-chrome', 'shield');
  shield.style.cssText = ['position:fixed', 'inset:0', 'z-index:2147483646', 'background:transparent', 'cursor:crosshair'].join(';');
  // 滚轮仍要能滚动页面，否则指代器一开就滚不动
  shield.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const root = doc.scrollingElement || doc.documentElement;
      if (!root) return;
      root.scrollTop += e.deltaY || 0;
      root.scrollLeft += e.deltaX || 0;
    },
    { passive: false },
  );
  (doc.body || doc.documentElement)?.appendChild(shield);
}


function removeShield(doc) {
  doc.querySelectorAll(`[${SHIELD_ATTR}]`).forEach((el) => el.remove());
}

/** 指代器开启时要拦掉的事件类型 */
const BLOCKED_EVENTS = [
  'pointerdown', 'pointerup', 'pointermove', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave',
  'mousedown', 'mouseup', 'mousemove', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave',
  'click', 'dblclick', 'auxclick', 'contextmenu',
  'keydown', 'keyup', 'keypress',
  'touchstart', 'touchmove', 'touchend', 'touchcancel',
  'dragstart', 'drag', 'dragend', 'drop', 'selectstart',
];

/** 应用级快捷键：键盘被冻住后这些仍要可用（转发给父窗口处理） */
function shortcutOf(e) {
  if (!(e.ctrlKey || e.metaKey)) return null;
  const k = String(e.key || '').toLowerCase();
  if (k === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (k === 's') return 'save';
  if (k === 'enter') return 'accept';
  return null;
}

/**
 * 安装交互守卫。
 *
 * 必须在 picker.attach() **之后**调用，而且两者都要挂在同一个对象（window）的捕获阶段：
 * 事件路径是 window → document → … → 目标，同节点同阶段按注册顺序执行，
 * 于是顺序变成「指代器先处理 → 守卫再掐断」，页面（含绑在 document/window 上的监听）全都收不到。
 *
 * 注意别把守卫挂在 document 上而把指代器留在 document 上就以为没事：
 * window 捕获比 document 捕获更早，守卫会把指代器自己一起冻住。
 */

function installInteractionGuard({ win, picker, post }) {
  const guard = (e) => {
    if (!picker.enabled) return; // 指代器关闭 → 完全不拦，页面功能原样可用
    const sc = shortcutOf(e);
    if (sc) post('evt', { type: 'shortcut', action: sc }); // 应用快捷键转发给父窗口
    e.preventDefault();
    e.stopPropagation();
  };
  for (const type of BLOCKED_EVENTS) win.addEventListener(type, guard, { capture: true, passive: false });
}

/** 指代器激活时的光标反馈（R4.3）：注入到 iframe，但带 data-z-chrome，导出时会被剥掉 */
const PICKER_STYLE_ID = 'data-z-picker-style';
function ensurePickerStyle(doc) {
  if (doc.querySelector(`style[${PICKER_STYLE_ID}]`)) return;
  const style = doc.createElement('style');
  style.setAttribute(PICKER_STYLE_ID, '');
  style.setAttribute('data-z-chrome', 'picker');
  style.textContent = [
    'html.z-picking, html.z-picking * { cursor: crosshair !important; }',
    // 既然我们在 pointerdown 里 preventDefault 了（防拖拽选中），顺手也禁掉文本选择
    'html.z-picking { user-select: none !important; -webkit-user-select: none !important; }',
    '.picker-selected { outline: 2px solid rgba(76,141,255,.9) !important; outline-offset: 1px !important; }',
    '.z-preview-flash { animation: zflash 1.1s ease-out 1; }',
    '@keyframes zflash { 0% { background-color: rgba(52,211,153,.28); } 100% { background-color: transparent; } }',
  ].join('\n');
  (doc.head || doc.documentElement)?.appendChild(style);
}


function installBridge({ win, doc, token }) {
  const anchor = new AnchorManager(doc);
  const pending = new Map();
  let ready = false;
  // 用户自定义命名（R5）：pid → 名字，由父窗口下发并持久化
  let customNames = {};

  /** 人话命名入口：弹层/面包屑/面板/AI 上下文统一走这里（R1.5）。
   *  带缓存：hover 时每帧要对最多 6 个元素取名，读 computed style 是开销大头。
   *  任何改动 DOM 或改名字的操作都会清缓存（见 invalidateNames）。 */
  const nameCache = new Map();
  const invalidateNames = () => nameCache.clear();
  const nameOf = (el, box) => {
    const pid = anchor.pidOf(el);
    if (pid && nameCache.has(pid) && !box) return nameCache.get(pid);
    const named = describeElement(el, {
      win,
      names: customNames,
      box,
      selectorPath: selectorPath(el),
    });
    if (pid) nameCache.set(pid, named);
    return named;
  };

  const picker = new Picker({
    doc,
    win,
    anchor,
    nameOf,
    emit: (evt) => post('evt', { type: evt.type, ...evt }),
  });

  function post(type, payload) {
    try {
      win.parent.postMessage({ __z: NS, type, token, payload }, '*');
    } catch {
      /* 父窗口已卸载 */
    }
  }

  function reply(id, ok, result, error) {
    try {
      win.parent.postMessage({ __z: NS, type: 'res', token, id, ok, result, error }, '*');
    } catch {
      /* ignore */
    }
  }

  function normalizeError(err) {
    if (err instanceof ZError) return { code: err.code, message: err.message, detail: err.detail ?? null };
    return { code: 'E_BRIDGE', message: err?.message ?? String(err) };
  }

  /* ------------------------------- 能力表 -------------------------------
   * 契约：**每个 op 都只接收一个对象参数**（args）。
   * 这条契约必须严格统一：曾经 `select: (pid)` 收字符串、而调用方发 `{pid}`，
   * 结果 `resolve('[object Object]')` 永远失败——选中链路整条是坏的，但模块测试全绿。
   * ------------------------------------------------------------------- */

  const api = {
    ping: () => ({ ready, href: doc.location.href, title: doc.title }),

    injectAnchors: () => {
      const res = anchor.injectAll();
      return { ...res, pids: anchor.seen.size };
    },

    setMode: ({ mode } = {}) => {
      const m = picker.setMode(mode);
      syncShield();
      return { mode: m };
    },

    /**
     * 同步"当前高亮的层级"。
     * 按住期间层级由父窗口的选择界面驱动，而真正在松手时执行选中动作的是 iframe 里的 picker，
     * 所以父窗口每次切换高亮都要把 index 回传给 picker —— 否则松手选中的还是最初那一层。
     */
    setBubbleIndex: ({ index } = {}) => {
      if (!picker.bubble) return { index: null };
      const max = picker.bubble.chain.length - 1;
      picker.bubble.index = Math.max(0, Math.min(Number(index) || 0, max));
      return { index: picker.bubble.index };
    },

    /** 下发用户自定义命名（R5）：覆盖弹层 / 面包屑 / 面板 / AI 上下文 */
    setNames: ({ names } = {}) => {
      customNames = names && typeof names === 'object' ? { ...names } : {};
      invalidateNames();
      return { count: Object.keys(customNames).length };
    },

    select: ({ pid } = {}) => {
      header.mode = MODES.PICK;
      const info = picker.select(pid, { source: 'api' });
      return info;
    },

    clearSelection: () => {
      picker.clearSelection();
      return true;
    },

    scrollTo: ({ pid } = {}) => ({ ok: picker.scrollTo(pid) }),

    state: () => picker.state(),

    /** 选中元素的完整上下文（给模型用的 ContextEnvelope v1） */
    getContext: ({ request = '', history = [], retry = null } = {}) => {
      const el = picker.selectedPid ? anchor.resolve(picker.selectedPid) : null;
      if (!el) throw new ZError('当前没有选中元素', 'E_NO_SELECTION');
      const ctx = buildContext({
        win,
        doc,
        el,
        pid: picker.selectedPid,
        request,
        history,
        names: customNames,
        retry,
      });
      invalidateNames();
      return ctx;
    },

    getNodeHtml: ({ pid } = {}) => {
      const el = anchor.resolve(pid);
      if (!el) throw new ZError(`找不到 pid=${pid}`, 'E_TARGET_MISSING');
      return truncateBytes(el.outerHTML, 40 * 1024);
    },

    /** 预览：应用 patch，DOM 上立刻可见。同时把 inverse 交给父窗口以便精确回滚 */
    applyPatch: ({ patch } = {}) => {
      const scopeEl = picker.selectedPid ? anchor.resolve(picker.selectedPid) : null;
      if (!scopeEl) throw new ZError('当前没有选中元素，无法应用改动', 'E_NO_SELECTION');
      const result = applyPatch(doc, scopeEl, patch);
      invalidateNames(); // DOM 变了，缓存的人话名可能过期
      return {
        applied: result.applied,
        count: result.applied.length,
        scopePid: result.scopePid,
        inverse: result.inverse,
        touched: [...new Set(result.applied.map((c) => c.target))],
      };
    },

    /** 取消：用当初那次 applyPatch 返回的 inverse 精确回滚（像素级回到改动前） */
    undoPatch: ({ inverse } = {}) => {
      if (!Array.isArray(inverse) || !inverse.length) return { rolledBack: 0 };
      const undone = undoPatch(doc, inverse);
      invalidateNames();
      return { rolledBack: undone.length, ops: undone };
    },

    /** 干净 HTML：剥掉 pid / 选中类 / 编辑器注入，用于导出与快照 */
    extractCleanHtml: () => {
      const clone = doc.documentElement.cloneNode(true);
      const html = scrubEditorArtifacts(clone, doc.doctype?.name ?? 'html');
      return { html, bytes: html.length };
    },

    /** 选区/预览高亮（视觉标记由父窗口画，这里只打 class） */
    markPreview: ({ pids = [], on = true } = {}) => {
      let n = 0;
      for (const pid of pids) {
        const el = anchor.resolve(pid);
        if (!el) continue;
        el.classList.toggle('z-preview-flash', !!on);
        n++;
      }
      return { marked: n };
    },

    highlight: ({ pids = [], on = true } = {}) => {
      for (const pid of pids) {
        const el = anchor.resolve(pid);
        if (el) el.classList.toggle('z-ai-touched', !!on);
      }
      return true;
    },

    /** 手动改文字：用户直接编辑（作为 source=manual-edit 的版本来源） */
    setTextDirect: ({ pid, value }) => {
      const el = anchor.resolve(pid);
      if (!el) throw new ZError(`找不到 pid=${pid}`, 'E_TARGET_MISSING');
      el.textContent = String(value ?? '');
      return { ok: true };
    },

    /** 元素统计（验收脚本用）。编辑器自己注入的节点（data-z-*）不计入页面元素。 */
    stats: () => {
      const page = [...doc.querySelectorAll('*')].filter((el) => !el.hasAttribute('data-z-chrome'));
      return {
        elements: page.length,
        anchored: page.filter((el) => el.hasAttribute('data-pid')).length,
        editorNodes: doc.querySelectorAll('[data-z-chrome]').length,
        selected: picker.selectedPid,
        mode: picker.mode,
        bodyHtmlLength: (doc.body?.innerHTML ?? '').length,
      };
    },

    /** 页面内任意只读求值（验收脚本用；不暴露写能力） */
    evalRead: ({ expr } = {}) => {
      // eslint-disable-next-line no-new-func
      const fn = new Function(`"use strict";return (${expr});`);
      return fn.call(win);
    },

    describe: ({ pid } = {}) => {
      const el = anchor.resolve(pid);
      if (!el) return null;
      return {
        pid,
        label: selectorPath(el),
        text: (el.textContent || '').trim().slice(0, 80),
        box: (() => {
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        })(),
      };
    },

    /** 验收：选中元素的 outerHTML（用于比对"取消后是否逐字节还原"） */
    outerHtmlOf: ({ pid } = {}) => {
      const el = anchor.resolve(pid);
      return el ? el.outerHTML : null;
    },
  };

  const header = { mode: picker.mode };

  /* ------------------------------ 消息处理 ------------------------------ */

  win.addEventListener('message', async (e) => {
    const msg = e.data;
    if (!msg || msg.__z !== NS) return;
    if (msg.token && token && msg.token !== token) return;
    if (msg.type === 'inject') {
      // 父窗口下发桥代码（单文件版直接调用；开发版由父窗口 push 脚本）
      return;
    }
    if (msg.type !== 'req') return;
    const { id, op, args } = msg;
    const fn = api[op];
    if (typeof fn !== 'function') {
      reply(id, false, null, { code: 'E_NO_OP', message: `未知操作 ${op}` });
      return;
    }
    try {
      const result = await fn(args ?? {});
      reply(id, true, result ?? null, null);
    } catch (err) {
      reply(id, false, null, normalizeError(err));
    }
  });

  function boot() {
    anchor.injectAll();
    ensurePickerStyle(doc); // R4.3：指代器激活时的瞄准光标/选中描边
    picker.attach();
    // 守卫必须在 picker.attach() 之后注册：同节点同阶段按注册顺序执行，
    // 先让指代器处理事件，再把事件掐断，页面自身才拿不到输入。
    installInteractionGuard({ win, picker, post });
    picker.setMode(MODES.PICK);
    syncShield();
    ready = true;
    post('ready', { pids: anchor.seen.size, elements: doc.querySelectorAll('*').length });
  }

  /** 隔离层跟随"指代器开关"：开着才铺，关掉必须撤掉，页面才能正常交互 */
  function syncShield() {
    if (picker.enabled) ensureShield(doc);
    else removeShield(doc);
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();

  // 页面尺寸变化 → 通知父窗口重算高亮
  win.addEventListener('resize', () => post('evt', { type: 'resize' }));
  // 巡检选中元素是否还在（节点被移除时清掉选中态）。定时器要能被清理，
  // 否则 iframe 重载后旧定时器还会继续跑、对着作废的 DOM 报警。
  const patrol = setInterval(() => {
    const sel = picker.selectedPid ? anchor.resolve(picker.selectedPid) : null;
    if (sel && !sel.isConnected) {
      picker.clearSelection();
      post('evt', { type: 'selection-lost', reason: 'node-detached' });
    }
  }, 500);
  win.addEventListener('pagehide', () => clearInterval(patrol), { once: true });

  return { api, anchor, picker, post };
}

Object.assign(exports, {"NS": NS});


exports["ensureShield"] = exports["ensureShield"] ?? (typeof ensureShield !== 'undefined' ? ensureShield : undefined);
exports["removeShield"] = exports["removeShield"] ?? (typeof removeShield !== 'undefined' ? removeShield : undefined);
exports["installInteractionGuard"] = exports["installInteractionGuard"] ?? (typeof installInteractionGuard !== 'undefined' ? installInteractionGuard : undefined);
exports["installBridge"] = exports["installBridge"] ?? (typeof installBridge !== 'undefined' ? installBridge : undefined);
exports["NS"] = exports["NS"] ?? (typeof NS !== 'undefined' ? NS : undefined);

});

__Z_DEF("app.mjs", function (exports, __Z_REQ) {
/**
 * app.mjs — 编辑器主控。所有"业务决策"都在这里：
 *   装载用户 HTML → 桥接指代器事件 → 调模型拿 JSON patch → iframe 内预览
 *   → 接受则存快照 → 撤销/重做/回看
 *
 * iframe 只负责"事实"（选中的 pid、矩形、DOM 操作），一行决策都没有。
 */
const { SnapshotStore } = __Z_REQ("snapshot.mjs");
const { createProvider, PROVIDERS } = __Z_REQ("provider.mjs");
const { ChatPanel, VersionsPanel, SettingsModal } = __Z_REQ("ui.mjs");
const { Overlay } = __Z_REQ("overlay.mjs");
const { validatePatch, summarizePatch } = __Z_REQ("schema.mjs");
const { deepClone, escapeHtml, formatDateTime, safeJsonParse, truncate, uid } = __Z_REQ("util.mjs");
const { describePatch } = __Z_REQ("diff.mjs");
const { chipsFor, breadcrumbFromChain } = __Z_REQ("naming.mjs");
const NS = 'zhidaiqi';
const BUBBLE_ACTIONS = [
  { id: 'ai', label: '✦ 让 AI 改这块', primary: true },
  { id: 'rename', label: '✎ 改名' },
  { id: 'copy', label: '复制选择器' },
  { id: 'cancel', label: '取消' },
];


class EditorApp {
  constructor(root, { bridgeSource, demoHtml } = {}) {
    this.root = root;
    this.bridgeSource = bridgeSource;
    this.demoHtml = demoHtml;
    this.token = uid('zt');
    this.pending = new Map();
    this.history = [];
    this.preview = null; // { patch, card, scopePid, beforeHtml }
    this.busy = false;
    this.toastSeq = 0;

    this.store = new SnapshotStore({
      storage: this.safeStorage(),
      keyPrefix: 'zhidaiqi/v1',
      maxSnapshots: 40,
    });
    this.settings = this.loadSettings();
    this.provider = createProvider(this.settings);
    this.selection = null;
    // 瞄准态：桥在 boot() 时默认就进 pick 模式，这里只记录期望状态与视觉，
    // 不重复下发 setMode —— 否则会和用户在启动瞬间的操作抢时序。
    this.aiming = true;
    // 用户自定义命名（R5）：pid → 名字，持久化在本地，并下发给 iframe 的命名引擎
    this.names = this.loadNames();

    this.buildShell();
    this.wireStore();
    this.wireKeys();
    // 全局 message 监听必须在这里注册：onWindowMessage 负责接收 iframe 的 ready / res / evt。
    // （之前只定义了方法却没注册 → iframeReady 永不 resolve → 整个编辑器挂起。）
    window.addEventListener('message', (e) => this.onWindowMessage(e));
    // 暴露启动 Promise：测试/自检可以等初始化真正完成，避免和启动过程抢时序
    this.bootPromise = this.boot();
  }

  /* ================================ 基础设施 ================================ */

  safeStorage() {
    try {
      const probe = '__zhidaiqi_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return window.localStorage;
    } catch {
      return null; // 无痕模式/被禁用：退化为内存，功能不消失
    }
  }

  loadSettings() {
    const saved = safeJsonParse(this.safeStorage()?.getItem('zhidaiqi/v1/settings') ?? '', null);
    return { kind: PROVIDERS.MOCK, endpoint: '', model: '', apiKey: '', ...(saved ?? {}) };
  }

  /* --------------------------- 自定义命名（R5） --------------------------- */

  loadNames() {
    const saved = safeJsonParse(this.safeStorage()?.getItem('zhidaiqi/v1/names') ?? '', null);
    return saved && typeof saved === 'object' ? saved : {};
  }

  saveNames() {
    try {
      this.safeStorage()?.setItem('zhidaiqi/v1/names', JSON.stringify(this.names));
    } catch {
      /* 存不下就算了，内存里仍然生效 */
    }
  }

  /** 把命名下发进 iframe：弹层 / 面包屑 / 面板 / AI 上下文都用它 */
  async pushNames() {
    try {
      await this.rpc('setNames', { names: this.names });
    } catch {
      /* 桥没起来时忽略，选中时会再推一次 */
    }
  }

  /** 重命名入口（R5）：弹层双击、或面板上的"改名" */
  startRename(target) {
    if (!target?.pid) return;
    this.panelChat.promptRename(target.name ?? '', async (value) => {
      const pid = target.pid;
      if (value) this.names[pid] = value;
      else delete this.names[pid];
      this.saveNames();
      await this.pushNames();
      // 重新选中一次，让各处拿到新名字（命名引擎在 iframe 里，需要它自己重算）
      const fresh = await this.rpc('select', { pid }).catch(() => null);
      if (fresh) this.onSelect({ pid, target: fresh });
      this.panelChat.addMessage(
        'sys',
        value
          ? `已把这块命名为「${value}」。之后弹层、面包屑、右侧面板以及发给 AI 的描述都会用这个名字。`
          : '已恢复为自动识别的名字。',
      );
      this.toast(value ? `已命名为「${value}」` : '已恢复自动命名', 'ok');
    });
  }

  saveSettings(next) {
    this.settings = { ...this.settings, ...next };
    try {
      // 只持久化"非敏感"部分：API key 只留在内存里。
      // 用户页面的脚本与编辑器同源（iframe 里），把 key 写进 localStorage 等于把它交给被编辑的页面。
      const { apiKey, ...safe } = this.settings;
      void apiKey;
      this.safeStorage()?.setItem('zhidaiqi/v1/settings', JSON.stringify(safe));
    } catch {
      /* ignore */
    }
    this.provider = createProvider(this.settings);
    this.renderProviderBadge();
    this.toast(`已切换模型：${this.provider.label}`, 'ok');
  }

  /* ================================ 外壳 ================================ */

  buildShell() {
    this.root.innerHTML = '';
    this.root.className = 'z-app';

    // 顶栏（R4.1）：主栏只留核心操作，文件级/工程级/辅助功能收进两个菜单
    const top = document.createElement('div');
    top.className = 'z-topbar';
    top.innerHTML =
      `<div class="z-logo"><span class="z-logo-mark"></span>指代器 <small>AI HTML 编辑器</small></div>` +
      `<div class="z-sep"></div>` +
      `<span data-el="menu-file"></span>` +
      `<button class="z-btn" data-act="undo" title="Ctrl+Z">↶ 撤销</button>` +
      `<button class="z-btn" data-act="redo" title="Ctrl+Shift+Z">↷ 重做</button>` +
      `<button class="z-btn ghost" data-act="reset" title="回到初始版本">⟲ 重置</button>` +
      `<span data-el="menu-more"></span>` +
      `<div class="z-spacer"></div>` +
      `<span class="z-badge" data-el="provider"><span class="z-dot mock"></span>加载中</span>` +
      `<span class="z-badge" data-el="version">v0 · 0 个版本</span>` +
      `<span data-el="menu-help"></span>`;
    this.root.appendChild(top);
    this.top = top;

    top.querySelector('[data-el="menu-file"]').appendChild(
      this.buildMenu({
        label: '文件 ▾',
        items: [
          { label: '导入 HTML', hint: 'HTML', run: () => this.pickHtmlFile() },
          { label: '导出 HTML', hint: '干净成品', run: () => this.exportHtml() },
          { sep: true },
          { label: '导入工程…', hint: '.json', run: () => this.pickProjectFile() },
          { label: '导出工程…', hint: '含全部版本', run: () => this.exportProject() },
        ],
      }),
    );
    top.querySelector('[data-el="menu-more"]').appendChild(
      this.buildMenu({
        label: '更多 ▾',
        items: [
          { label: '🧪 页面内自检', hint: '19 项', run: () => this.runSelfTest() },
          { label: '⌨ 键盘快捷键', run: () => this.showShortcuts() },
          { sep: true },
          { label: '⇥ 收起 / 展开侧栏', run: () => this.toggleSide() },
          { label: '⚙ 模型设置', run: () => this.openSettings() },
          { sep: true },
          { label: '🧹 清除自定义命名', run: () => this.clearNames() },
        ],
      }),
    );
    top.querySelector('[data-el="menu-help"]').appendChild(
      this.buildMenu({
        label: '?',
        items: [
          { label: '三步上手', run: () => this.showHelp() },
          { label: '🧪 页面内自检', run: () => this.runSelfTest() },
          { label: '⌨ 键盘快捷键', run: () => this.showShortcuts() },
        ],
      }),
    );

    // 主区
    const main = document.createElement('div');
    main.className = 'z-main';
    main.innerHTML =
      `<div class="z-stage" data-el="stage">` +
      `<div class="z-stage-bar">` +
      `<label class="z-aim on" data-el="pick-pill" title="开关指代器（快捷键 P）。开启时页面暂时不可交互（不会误触发页面自己的点击/按键），只用于选取元素；关闭后页面功能照常。">` +
      `<span class="z-aim-dot"></span><input type="checkbox" checked data-el="pick-toggle" class="z-hidden">` +
      `<span data-el="aim-text">指代器已开启</span></label>` +
      `<span class="z-crumb" data-el="crumb"></span>` +
      `<span class="z-spacer" style="flex:1"></span>` +
      `<span data-el="stage-hint">指代器中：页面暂时不可交互 · 按住左键选一块</span>` +
      `</div>` +
      `<div class="z-frame-wrap" data-el="frame-wrap">` +
      `<div class="z-frame-shell" data-el="frame-shell"><iframe data-el="frame" title="被编辑的页面"></iframe></div>` +
      `<div class="z-overlay" data-el="overlay"></div>` +
      `</div>` +
      `</div>` +
      `<div class="z-side" data-el="side">` +
      `<div class="z-side-tabs">` +
      `<button class="z-tab on" data-tab="chat">AI 对话</button>` +
      `<button class="z-tab" data-tab="versions">版本历史</button>` +
      `</div>` +
      `<div data-el="panel-chat"></div>` +
      `<div data-el="panel-versions"></div>` +
      `</div>`;
    this.root.appendChild(main);

    this.frame = main.querySelector('[data-el="frame"]');
    this.frameWrap = main.querySelector('[data-el="frame-wrap"]');
    this.crumb = main.querySelector('[data-el="crumb"]');
    this.overlay = new Overlay({
      container: this.frameWrap,
      frameEl: this.frame,
      onAction: (evt) => this.onBubbleAction(evt),
    });

    this.panelChat = new ChatPanel(main.querySelector('[data-el="panel-chat"]'), {
      onSend: (text) => this.send(text),
      onSettings: () => this.openSettings(),
      onClearSelection: () => this.clearSelection(),
      onRename: (target) => this.startRename(target),
      onCopySelector: (path) => this.copySelector(path),
      // R3.3：chips 跟着选中元素的类型走
      chipsFor: (target) => chipsFor(target?.kind ?? 'other'),
    });
    this.panelVersions = new VersionsPanel(main.querySelector('[data-el="panel-versions"]'), {
      onJump: (id) => this.jumpTo(id),
      onView: (id) => this.viewVersion(id),
      onDelete: (id) => {
        if (this.store.remove(id)) {
          this.toast('已删除该版本', 'warn');
          this.renderVersions();
        }
      },
    });
    this.settingsModal = new SettingsModal({
      onSave: (next) => this.saveSettings(next),
      onTest: (cfg) => this.testProvider(cfg),
    });

    top.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      this.onTopbar(act);
    });
    main.querySelectorAll('[data-tab]').forEach((tab) =>
      tab.addEventListener('click', () => this.switchTab(tab.dataset.tab)),
    );
    main.querySelector('[data-el="pick-toggle"]').addEventListener('change', (e) => {
      this.setAiming(e.target.checked);
    });
    // 点击空白处收起菜单
    this.__onDocClick = () => this.closeMenus();
    document.addEventListener('click', this.__onDocClick);

    this.renderProviderBadge();
  }

  /** 下拉菜单（R4.1 工具栏收敛）：点击展开，点外面收起 */
  buildMenu({ label, items, wide = false }) {
    const wrap = document.createElement('div');
    wrap.className = 'z-menu-wrap';
    const btn = document.createElement('button');
    btn.className = 'z-btn ghost';
    btn.textContent = label;
    const menu = document.createElement('div');
    menu.className = `z-menu z-hidden${wide ? ' wide' : ''}`;
    for (const it of items) {
      if (it.sep) {
        const sep = document.createElement('div');
        sep.className = 'z-menu-sep';
        menu.appendChild(sep);
        continue;
      }
      const b = document.createElement('button');
      b.innerHTML = `<span>${escapeHtml(it.label)}</span>${it.hint ? `<small>${escapeHtml(it.hint)}</small>` : ''}`;
      b.addEventListener('click', () => {
        this.closeMenus();
        it.run?.();
      });
      menu.appendChild(b);
    }
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasHidden = menu.classList.contains('z-hidden');
      this.closeMenus();
      if (wasHidden) menu.classList.remove('z-hidden');
    });
    wrap.append(btn, menu);
    return wrap;
  }

  closeMenus() {
    this.root.querySelectorAll('.z-menu').forEach((m) => m.classList.add('z-hidden'));
  }

  /**
   * 瞄准态（R4.2/R4.3）。
   * 注意 fromBridge：桥在 setMode 之后会回发 mode 事件，如果这里再调 setMode 就是死循环。
   * 所以只在"状态真的变了"时才下发，并且来自桥的事件只更新界面。
   */
  setAiming(on, { fromBridge = false } = {}) {
    const next = !!on;
    const pill = this.root.querySelector('[data-el="pick-pill"]');
    pill.classList.toggle('on', next);
    this.root.querySelector('[data-el="aim-text"]').textContent = next ? '指代器已开启' : '指代器已关闭';
    const toggle = this.root.querySelector('[data-el="pick-toggle"]');
    if (toggle && toggle.checked !== next) toggle.checked = next;
    this.overlay.setAiming(next);
    if (fromBridge) {
      this.aiming = next;
      return;
    }
    if (this.aiming === next) return undefined; // 没有变化就不下发，避免回环
    this.aiming = next;
    // 返回 Promise：调用方（含测试）可以等待模式真正切过去
    return this.rpc('setMode', { mode: next ? 'pick' : 'browse' }).catch(() => {});
  }

  /** 面包屑（R1.4）：人话名，最多 3 级，中间折叠 */
  renderBreadcrumb(chain) {
    if (!chain || !chain.length) {
      this.crumb.innerHTML = '';
      return;
    }
    const names = chain.map((c) => c.name ?? c.label ?? '');
    const last = names[names.length - 1];
    const text = breadcrumbFromChain(names, 3);
    const parts = text.split(' › ').map((part) =>
      part === last ? `<b>${escapeHtml(part)}</b>` : escapeHtml(part),
    );
    this.crumb.innerHTML = parts.join('<span class="z-crumb-sep"> › </span>');
    this.crumb.title = chain.map((c) => c.tooltip ?? '').filter(Boolean).join('\n');
  }

  copySelector(path) {
    navigator.clipboard?.writeText(path ?? '').then(
      () => this.toast('选择器已复制', 'ok'),
      () => this.toast('复制失败（浏览器限制）', 'warn'),
    );
  }

  showShortcuts() {
    this.switchTab('chat');
    this.panelChat.addMessage(
      'sys',
      '快捷键：\n' +
        '  按住左键 → 松开：选中元素\n' +
        '  ↑ / ↓：在候选层级间切换\n' +
        '  Enter：确认当前层级\n' +
        '  Esc：取消\n' +
        '  P：开关指代器\n' +
        '  Ctrl+Enter：发送需求 / 接受当前改动\n' +
        '  Ctrl+Z / Ctrl+Shift+Z：撤销 / 重做\n' +
        '  Ctrl+S：手动存一个版本\n' +
        '  弹层里双击某一项：给它起你自己的名字',
    );
  }

  showHelp() {
    this.switchTab('chat');
    this.panelChat.addMessage(
      'sys',
      '三步上手：\n' +
        '  1. 在左边页面上按住左键，松手选中你要改的那一块（弹层里可以用 ↑↓ 换层级）\n' +
        '  2. 在下面用大白话说想怎么改，比如"大一点，换成深蓝"（也可以点下面的快捷词）\n' +
        '  3. 看到预览满意就点"接受并保存版本"；不满意点"取消"，页面立刻回到原样\n' +
        '改错了随时 Ctrl+Z 撤销，右侧"版本历史"里能回到任何一个版本。',
    );
  }

  clearNames() {
    const count = Object.keys(this.names).length;
    if (!count) {
      this.toast('还没有自定义命名', 'warn');
      return;
    }
    this.names = {};
    this.saveNames();
    this.pushNames();
    this.toast(`已清除 ${count} 个自定义命名`, 'ok');
  }

  switchTab(name) {
    this.root.querySelectorAll('[data-tab]').forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
    this.panelChat.root.classList.toggle('on', name === 'chat');
    this.panelVersions.root.classList.toggle('on', name === 'versions');
    if (name === 'versions') this.renderVersions();
  }

  renderProviderBadge() {
    const badge = this.root.querySelector('[data-el="provider"]');
    const dot = badge.querySelector('.z-dot');
    const kind = this.provider.kind;
    dot.className = `z-dot ${kind === 'mock' ? 'mock' : 'ok'}`;
    badge.innerHTML = `<span class="z-dot ${kind === 'mock' ? 'mock' : 'ok'}"></span>${escapeHtml(this.provider.label)}`;
  }

  onTopbar(act) {
    // 文件/工程/辅助操作已收进菜单，这里只处理主栏按钮
    switch (act) {
      case 'undo':
        this.undo();
        break;
      case 'redo':
        this.redo();
        break;
      case 'reset':
        this.reset();
        break;
      default:
        break;
    }
  }

  /** 顶栏"自检"：在真实浏览器里跑一遍验收清单 */
  async runSelfTest() {
    if (this.preview) await this.cancelPreview({ silent: true });
    const toast = this.toast('正在自检（会临时改动页面，结束时自动还原）…', '', 8000);
    const snapBefore = this.store.current();
    try {
      const mod = window.__Z__?.req('selftest.mjs');
      if (!mod) throw new Error('自检模块未打包');
      const result = await mod.runSelfTest(this);
      mod.showSelfTestPanel(result);
      console.log('[zhidaiqi] 自检结果：', result);
      // 自检会改动页面与版本栈，结束后把工作区还原到自检前的版本
      if (snapBefore) {
        this.store.jumpTo(snapBefore.id);
        await this.restoreHtml(snapBefore.html, { keepSelectionPid: snapBefore.targetPid });
      }
      this.renderVersions();
      this.toast(result.failed === 0 ? `自检全部通过（${result.total} 项）` : `自检有 ${result.failed} 项失败，看弹窗详情`, result.failed === 0 ? 'ok' : 'err');
    } catch (err) {
      this.toast(`自检失败：${err.message}`, 'err');
      console.error('[zhidaiqi] 自检异常', err);
    } finally {
      toast?.remove?.();
    }
  }

  toggleSide() {
    const main = this.root.querySelector('.z-main');
    const hidden = main.classList.toggle('side-hidden');
    this.root.querySelector('[data-act="side"]').textContent = hidden ? '⇤' : '⇥';
  }

  toast(message, kind = '', ms) {
    return this.overlay.toast(message, kind, ms);
  }

  /* ================================ iframe 装载 ================================ */

  bootstrapSource() {
    return `(function(){
  var TOKEN=${JSON.stringify(this.token)};
  window.__zToken=TOKEN;
  function post(type,payload){try{parent.postMessage(Object.assign({__z:'${NS}',type:type,token:TOKEN},payload||{}),'*')}catch(e){}}
  function boot(){
    // 干掉可能挡住指代器的 CSP / 自动滚动脚本，避免用户页面的脚本干扰选中
    try{document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').forEach(function(m){m.remove()});}catch(e){}
    post('ready',{title:document.title||''});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();`;
  }

  /** 往文档里注入 bootstrap（若有 </body> 就插在它前面） */
  injectBootstrap(html) {
    const script = `<script data-z-inject="bootstrap">${this.bootstrapSource()}<\/script>`;
    const s = String(html ?? '');
    if (/<\/body\s*>/i.test(s)) return s.replace(/<\/body\s*>/i, `${script}\n</body>`);
    if (/<\/html\s*>/i.test(s)) return s.replace(/<\/html\s*>/i, `${script}\n</html>`);
    return `${s}\n${script}`;
  }

  /**
   * 给 iframe 定沙箱策略。
   *
   * 这里有个容易致命的细节：在 file:// 下，带 sandbox 的 srcdoc iframe 会被当成**不透明源**，
   * 父窗口拿不到 contentDocument，指代器会整体失效（"双击打开"就不能用了）。
   * 所以：
   *   - http(s)（tools/serve.mjs 起的开发页）→ 走 sandbox，隔离用户脚本，最安全；
   *   - file://（双击单文件版）→ 不加 sandbox（srcdoc 本身就是同源沙箱，用户页也拿不到父窗口），
   *     保证指代器可用。
   */
  frameSandboxAttr() {
    const isFile = window.location?.protocol === 'file:';
    return isFile ? null : 'allow-scripts allow-same-origin allow-modals allow-popups';
  }

  loadHtml(html) {
    // iframe 重新赋值 srcdoc 会整体重载：旧 window 上的桥随之作废，必须清掉标记
    this.bridgeInstalled = false;
    this.bridgePromise = null;
    this.iframeReady = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
    const sandbox = this.frameSandboxAttr();
    if (sandbox) this.frame.setAttribute('sandbox', sandbox);
    else this.frame.removeAttribute('sandbox');
    this.frame.srcdoc = this.injectBootstrap(html);
  }

  /** 装载 HTML 并装配桥。注意：桥必须装进 **iframe 自己的 realm**。 */
  async ensureBridge() {
    // 并发 rpc 会同时走到这里：用"进行中的 Promise"去重，
    // 否则可能装两次桥（同一请求被执行两遍，或旧桥/新桥互相打架）。
    if (this.bridgeInstalled) {
      if (this.bridgeAlive()) return true;
      this.bridgeInstalled = false; // iframe 自己导航/重载过，旧桥已作废
      this.bridgePromise = null;
    }
    if (this.bridgePromise) return this.bridgePromise;
    this.bridgePromise = this.installBridge().finally(() => {
      this.bridgePromise = null;
    });
    return this.bridgePromise;
  }

  /** 桥是否还活着：iframe 可能自己跳转导致旧桥失效 */
  bridgeAlive() {
    try {
      return !!this.frame.contentWindow?.__zBridge;
    } catch {
      return false; // 跨域了（用户页面跳到了别的源）
    }
  }

  async installBridge() {
    // 等 iframe 报 ready，但必须带超时——否则一旦桥没起来，rpc 会永久悬挂（连错误都看不到）
    const ready = await Promise.race([
      this.iframeReady,
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 8000)),
    ]);
    if (ready === 'timeout') {
      throw new Error('被编辑页面的桥没有就绪（8s 超时）。请刷新页面重试。');
    }

    const installed = await new Promise((resolve) => {
      const settle = (ok, err) => {
        window.removeEventListener('message', onMsg);
        clearTimeout(timer);
        resolve(ok ? true : err ?? false);
      };
      const timer = setTimeout(() => settle(false, 'installed-timeout'), 6000);
      const onMsg = (e) => {
        const d = e.data;
        if (!d || d.__z !== NS || d.type !== 'bridge-installed' || d.token !== this.token) return;
        settle(true);
      };
      window.addEventListener('message', onMsg);
      try {
        // 关键：桥的运行环境必须是 iframe，不是父窗口。
        // 之前用 (0,eval) 在父窗口执行 → `globalThis` 是父窗口，桥会作用在编辑器 UI 上，
        // 指代器/补丁全部走错对象。这里改成"把脚本注入进 iframe 文档"，保证在 iframe 的 realm 里求值。
        const cdoc = this.frame.contentDocument;
        const cwin = this.frame.contentWindow;
        if (cdoc && cdoc.createElement) {
          const script = cdoc.createElement('script');
          script.textContent = this.bridgeSource;
          (cdoc.head || cdoc.documentElement).appendChild(script);
          script.remove?.();
        } else if (cwin && typeof cwin.eval === 'function') {
          cwin.eval(this.bridgeSource); // 在 iframe 的 realm 里求值
        } else {
          settle(false, 'no-iframe-access');
        }
      } catch (err) {
        settle(false, err);
      }
    });

    if (installed !== true) {
      console.warn('[zhidaiqi] bridge 装载异常：', installed);
      throw new Error(`无法在被编辑页面的 iframe 内装载桥：${installed?.message ?? installed}`);
    }
    this.bridgeInstalled = true;
    await this.rpc('injectAnchors');
    return true;
  }

  /* ================================ RPC ================================ */

  async rpc(op, args = {}, { timeout = 12000 } = {}) {
    await this.ensureBridge();
    const id = uid('r');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`与页面通讯超时（${op}）`));
      }, timeout);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      const frameWin = this.frame.contentWindow;
      try {
        frameWin.postMessage({ __z: NS, type: 'req', token: this.token, id, op, args }, '*');
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  onWindowMessage(e) {
    const d = e.data;
    if (!d || d.__z !== NS || d.token !== this.token) return;
    if (d.type === 'ready') {
      this.resolveReady?.(true);
      return;
    }
    if (d.type === 'res') {
      const p = this.pending.get(d.id);
      if (!p) return;
      this.pending.delete(d.id);
      if (d.ok) p.resolve(d.result);
      else {
        const err = new Error(d.error?.message ?? '页面操作失败');
        err.code = d.error?.code;
        err.detail = d.error?.detail;
        p.reject(err);
      }
      return;
    }
    if (d.type === 'evt') this.onBridgeEvent(d.payload);
  }

  onBridgeEvent(payload) {
    if (!payload) return;
    switch (payload.type) {
      case 'hover': {
        // 工具条（松开后留下的选择界面）打开时，不再跟随光标乱闪
        if (this.bubbleStuck) break;
        const box = payload.target?.box;
        this.overlay.showHighlight(payload.target, {
          label: `${payload.target?.icon ?? ''} ${payload.target?.name ?? ''}`.trim(),
        });
        // R2.5：光标旁跟随气泡，实时显示"将要选中什么"
        this.overlay.showTip(payload.point, payload.target?.name ?? '');
        // R1.4：面包屑用人话名，最多 3 级
        this.renderBreadcrumb(payload.chain);
        this.root.querySelector('[data-el="stage-hint"]').textContent = box
          ? `${box.w}×${box.h}px · 按住左键选这一块`
          : '指代器中：页面暂时不可交互 · 按住左键选一块';
        break;
      }
      case 'bubble-open':
        this.bubbleStuck = false;
        this.overlay.openBubble({ point: payload.point, chain: payload.chain, index: payload.index, actions: BUBBLE_ACTIONS });
        this.overlay.showHighlight(payload.chain?.[0], {
          label: `${payload.chain?.[0]?.icon ?? ''} ${payload.chain?.[0]?.name ?? ''} · 松开选中`,
        });
        this.renderBreadcrumb(payload.chain);
        break;
      case 'bubble-move':
        if (payload.bubble) this.overlay.setBubbleIndex(payload.bubble.index);
        break;
      case 'bubble-pointer':
        // 按住时 iframe 仍在上报指针坐标：由父窗口自己判断落在哪个选项上。
        // （跨 frame 拖拽时事件会被 iframe 捕获、且兼容鼠标事件被 preventDefault 抑制，
        //   所以这条通道是"按住后滑选项没反应"的正解。）
        this.overlay.hoverAtPoint(payload.point);
        break;
      case 'bubble-pick':
        // 松开 = 选中 + 把弹层留在页面上当工具条（否则「让 AI 改这块」点不到）
        this.bubbleStuck = true;
        this.overlay.stickBubble({ chain: payload.chain, index: payload.index });
        break;
      case 'bubble-close':
        this.bubbleStuck = false;
        this.overlay.closeBubble();
        if (payload.reason === 'cancel') {
          if (this.selection) this.overlay.showHighlight(this.selection, { selected: true });
          else this.overlay.hideHighlight();
          this.renderBreadcrumb(this.selection?.chain);
        }
        break;
      case 'escape':
        if (this.bubbleStuck) {
          this.bubbleStuck = false;
          this.overlay.closeBubble();
        }
        break;
      case 'mode':
        this.setAiming(payload.mode === 'pick', { fromBridge: true });
        break;
      case 'shortcut':
        // 指代器开着时页面被冻住，键盘到不了父窗口 → iframe 把应用快捷键转发上来
        this.onShortcut(payload.action);
        break;
      case 'select':
        this.onSelect(payload);
        break;
      case 'deselect':
        // 注意：select() 内部会先 clearSelection() 发出 deselect，
        // 这里**不能**关掉工具条，否则"第二次按住选中"会把自己的工具条关掉。
        // 用户主动取消选中走的是 app.clearSelection()，那里才负责收工具条。
        this.selection = null;
        this.panelChat.renderSelection(null);
        this.overlay.hideHighlight();
        this.renderBreadcrumb(null);
        break;
      case 'selection-lost':
        this.toast('页面被还原，原选中元素已不存在，请重新选中', 'warn');
        this.bubbleStuck = false;
        this.overlay.closeBubble();
        this.renderBreadcrumb(null);
        break;
      case 'geometry':
        if (this.selection && payload.pid === this.selection.pid) {
          this.overlay.showHighlight(payload.target, { selected: true, label: `${payload.target.icon ?? ''} ${payload.target.name ?? ''} · 已选中` });
        }
        break;
      case 'hover-end':
        this.overlay.hideTip();
        // 候选界面开着（尤其按住时把指针移到了选择界面上）：
        // 高亮由选项驱动，这里绝不能重画"旧选中"把选项高亮盖掉。
        if (this.overlay.bubble) break;
        if (!this.selection) this.overlay.hideHighlight();
        else this.overlay.showHighlight(this.selection, { selected: true, label: `${this.selection.icon ?? ''} ${this.selection.name ?? ''} · 已选中` });
        break;
      case 'error':
        this.toast(payload.message ?? '指代器出错', 'err');
        break;
      default:
        break;
    }
  }

  onSelect(payload) {
    this.selection = payload.target;
    this.panelChat.renderSelection(this.selection);
    this.overlay.showHighlight(this.selection, {
      selected: true,
      label: `${this.selection.icon ?? ''} ${this.selection.name ?? ''} · 已选中`,
    });
    this.renderBreadcrumb(payload.target?.chain ?? [payload.target]);
    this.switchTab('chat');
    this.panelChat.ta?.focus();
  }

  onBubbleAction(evt) {
    if (evt.type === 'bubble-chain') {
      const chosen = evt.chain[evt.index];
      if (chosen) this.rpc('select', { pid: chosen.pid }).catch((e) => this.toast(e.message, 'err'));
      return;
    }
    // R5：弹层里双击改名
    if (evt.type === 'rename') {
      this.overlay.closeBubble();
      this.bubbleStuck = false;
      this.startRename({ pid: evt.pid, name: evt.name });
      return;
    }
    // 选择界面里切换高亮 → 让 iframe 里的 picker 也记住，松手时才会选中这一层
    if (evt.type === 'bubble-index') {
      this.rpc('setBubbleIndex', { index: evt.index }).catch(() => {});
      return;
    }
    // 在弹层上直接松手（iframe 收不到这个事件）→ 在这里确认选中并变成工具条
    if (evt.type === 'bubble-commit') {
      const chosen = evt.chain?.[evt.index] ?? evt.chain?.[0];
      this.bubbleStuck = true;
      if (chosen?.pid) {
        this.rpc('select', { pid: chosen.pid })
          .then((fresh) => {
            if (fresh) this.onSelect({ pid: chosen.pid, target: fresh });
          })
          .catch(() => {});
      }
      this.overlay.stickBubble({ chain: evt.chain, index: evt.index, released: true });
      return;
    }
    const { action, chain, index } = evt;
    const chosen = chain[index] ?? chain[0];
    if (action === 'ai') {
      this.bubbleStuck = false;
      this.overlay.closeBubble();
      this.overlay.showHighlight(this.selection ?? chosen, { selected: true });
      this.rpc('select', { pid: chosen.pid })
        .then(() => {
          this.switchTab('chat');
          this.panelChat.ta?.focus();
        })
        .catch((e) => this.toast(e.message, 'err'));
    } else if (action === 'copy') {
      this.copySelector(chosen.selectorPath);
      this.overlay.closeBubble();
      this.bubbleStuck = false;
    } else if (action === 'rename') {
      this.overlay.closeBubble();
      this.bubbleStuck = false;
      this.startRename(chosen);
    } else if (action === 'close') {
      this.overlay.closeBubble();
      this.bubbleStuck = false;
      if (this.selection) this.overlay.showHighlight(this.selection, { selected: true });
    } else {
      this.overlay.closeBubble();
      this.bubbleStuck = false;
      this.overlay.hideHighlight();
    }
  }

  async clearSelection() {
    // 用户主动"取消选中"：这里才是收工具条的入口
    this.bubbleStuck = false;
    this.overlay.closeBubble();
    try {
      await this.rpc('clearSelection');
    } catch {
      /* ignore */
    }
    this.selection = null;
    this.panelChat.renderSelection(null);
    this.overlay.hideHighlight();
    this.renderBreadcrumb(null);
  }

  /* ================================ 模型交互 ================================ */

  async send(textInput) {
    const request = String(textInput ?? '').trim();
    if (!request) {
      this.toast('先在输入框里说一句你想怎么改', 'warn');
      return;
    }
    if (!this.selection) {
      this.toast('先用指代器选中一个元素', 'warn');
      return;
    }
    if (this.busy) return;
    this.busy = true;
    this.panelChat.clearPrompt();
    this.panelChat.addMessage('user', request);
    this.history.push({ role: 'user', text: request });
    this.panelChat.setBusy(true, `正在读取 ${this.selection.label} 的样式与结构…`);

    try {
      let context = await this.rpc('getContext', { request, history: this.history.slice(-6) });
      this.panelChat.setBusy(true, `正在读取 ${this.selection.name ?? this.selection.label} 的样式与结构…`);
      let result = await this.provider.generate(context, {
        onDelta: (hint) => this.panelChat.setBusy(true, hint),
      });
      this.panelChat.setBusy(false);
      // 第 1 步的验收要求：先能在控制台看到结构化输出
      console.log('[zhidaiqi] 模型返回原文：\n', result.raw);
      console.log('[zhidaiqi] 解析后的 Patch v1：', result.patch);

      // 越界自愈：模型偶尔会引用选中范围外的元素（尤其"给这块加个底"这类需求）。
      // 不把它变成用户的死路 —— 把"可用的 pid"回喂给模型，让它改用自己的方式实现一次。
      let retried = false;
      for (;;) {
        try {
          await this.openPreview(result);
          break;
        } catch (err) {
          const scopeError = err?.code === 'E_PATCH_OUT_OF_SCOPE' || err?.code === 'E_PATCH_TARGET_MISSING';
          if (!scopeError || retried) {
            this.lastScopeError = scopeError ? { error: err.message, request } : null;
            throw err;
          }
          retried = true;
          const allowedPids = context.target?.modifiablePids ?? [context.target?.pid].filter(Boolean);
          this.panelChat.addMessage(
            'sys',
            `AI 想改的那块不在你选中的范围内（${err.message.slice(0, 60)}…）。\n` +
              `我已把"只能改这 ${allowedPids.length} 个元素"告诉它，让它改用选中元素自身能实现的方式重新生成…`,
          );
          this.panelChat.setBusy(true, '正在按范围约束重新生成…');
          context = await this.rpc('getContext', {
            request,
            history: this.history.slice(-6),
            retry: { error: err.message, allowedPids },
          });
          result = await this.provider.generate(context, { onDelta: (hint) => this.panelChat.setBusy(true, hint) });
          this.panelChat.setBusy(false);
          console.log('[zhidaiqi] 越界后重试返回：', result.patch);
        }
      }
      this.lastScopeError = null;
    } catch (err) {
      this.panelChat.setBusy(false);
      const detail = err?.detail?.raw ? `\n模型原文片段：\n${String(err.detail.raw).slice(0, 600)}` : '';
      const scopeError = err?.code === 'E_PATCH_OUT_OF_SCOPE' || err?.code === 'E_PATCH_TARGET_MISSING';
      const parent = this.parentOfSelection();
      if (scopeError && parent) {
        // 第三层：给用户一条出路 —— 一键改选外层容器重试
        this.panelChat.addActionCard({
          title: `AI 想改的是外层容器「${parent.name ?? '外层'}」`,
          body:
            `它想改的元素不在「${this.selection?.name ?? '你选中的这块'}」里面，所以被范围约束拦住了。\n` +
            `你可以：① 一键改选外层容器，用同样的需求再试；② 或者把需求说得更具体（例如"给这个标题加背景色"）。`,
          actions: [
            { label: `改选「${parent.name ?? '外层'}」并重试`, primary: true, run: () => this.escalateToParent(request) },
            { label: '知道了' },
          ],
        });
        this.panelChat.addMessage('err', err.message);
      } else {
        this.panelChat.addMessage('err', `${err.message}${detail}`);
      }
      this.history.push({ role: 'assistant', text: `失败：${err.message}` });
      this.toast('这次没改成，看右侧提示', 'err');
    } finally {
      this.busy = false;
    }
  }

  /** 选中链上的上一层（用于"改选外层容器重试"） */
  parentOfSelection() {
    const chain = this.selection?.chain ?? [];
    if (!chain.length) return null;
    const idx = chain.findIndex((c) => c.pid === this.selection?.pid);
    if (idx > 0) return chain[idx - 1];
    return chain.length >= 2 ? chain[chain.length - 2] : null;
  }

  /** 越界后的出路：改选外层容器，用同样的需求再试一次 */
  async escalateToParent(request) {
    const parent = this.parentOfSelection();
    if (!parent?.pid) {
      this.toast('找不到外层容器', 'warn');
      return;
    }
    const fresh = await this.rpc('select', { pid: parent.pid }).catch(() => null);
    if (fresh) this.onSelect({ pid: parent.pid, target: fresh });
    this.panelChat.addMessage('sys', `已改选外层「${parent.name ?? parent.label}」，用同样的需求重试。`);
    await this.send(request);
  }

  /** 预演：把 patch 应用到 iframe（用户能看到效果），等用户接受/取消 */
  async openPreview(result) {
    // 上一个预览还没定论就换了新的：先撤销旧的
    if (this.preview) await this.cancelPreview({ silent: true });

    const patch = validatePatch(result.patch);
    const before = await this.rpc('extractCleanHtml');
    const applied = await this.rpc('applyPatch', { patch });
    this.preview = {
      patch,
      beforeHtml: before.html,
      scopePid: applied.scopePid,
      inverse: applied.inverse,
      result,
    };

    const card = this.panelChat.addPatchCard({
      patch,
      providerLabel: this.provider.label,
      ms: result.ms,
      attempts: result.attempts,
      repaired: result.repaired,
    });
    this.preview.card = card;
    card.querySelector('[data-act="accept"]')?.addEventListener('click', () => this.acceptPreview());
    card.querySelector('[data-act="cancel"]')?.addEventListener('click', () => this.cancelPreview());
    card.querySelector('[data-act="retry"]')?.addEventListener('click', () => this.retry());
    this.panelChat.addMessage('assistant', `我按你的说法改了 ${patch.changes.length} 处，页面已按新样子显示。满意就点"接受并保存版本"，不满意点"取消"。`);
    this.toast('已在页面上预览改动（还没保存）', 'ok');
  }

  async acceptPreview() {
    if (!this.preview) return;
    const { patch, card, beforeHtml, result } = this.preview;
    this.preview = null;
    const clean = await this.rpc('extractCleanHtml');
    const snapshot = this.store.push({
      html: clean.html,
      label: patch.summary || summarizePatch(patch),
      source: 'ai',
      prompt: this.history.filter((h) => h.role === 'user').at(-1)?.text ?? '',
      patch,
      targetPid: patch.target ?? this.selection?.pid ?? null,
    });
    this.panelChat.setCardState(card, 'accepted', `已保存为 v${this.store.cursor}`);
    this.history.push({ role: 'assistant', text: `已应用并保存：${patch.summary || summarizePatch(patch)}` });
    const delta = clean.html.length - (beforeHtml?.length ?? 0);
    this.toast(`已保存为版本 v${this.store.cursor}（HTML ${delta >= 0 ? '+' : ''}${delta} 字符）`, 'ok');
    this.renderVersions();
    this.renderVersionBadge();
    if (result?.usage) console.log('[zhidaiqi] token 用量：', result.usage);
  }

  /**
   * 取消预览：优先用当初 applyPatch 返回的 inverse 做**精确回滚**（不动 iframe 整体）；
   * 只有在 inverse 失效（DOM 已被别的改动覆盖）时才退化为"整页还原 + 重注锚点"。
   */
  async cancelPreview({ silent = false } = {}) {
    if (!this.preview) return false;
    const { card, beforeHtml, scopePid, inverse } = this.preview;
    this.preview = null;
    let precise = false;
    try {
      if (Array.isArray(inverse) && inverse.length) {
        await this.rpc('undoPatch', { inverse });
        precise = true;
        if (scopePid) {
          const back = await this.rpc('select', { pid: scopePid }).catch(() => null);
          if (back) this.onSelect({ target: back });
        }
      }
    } catch (err) {
      console.warn('[zhidaiqi] 精确回滚失败，改用整页还原：', err);
    }
    if (!precise) await this.restoreHtml(beforeHtml, { keepSelectionPid: scopePid });
    this.panelChat.setCardState(card, 'rejected', precise ? '已取消，改动已精确回滚' : '已取消，页面已回到改动前');
    if (!silent) this.toast('已取消，页面回到改动前', 'warn');
    return true;
  }

  async retry() {
    const lastUser = [...this.history].reverse().find((h) => h.role === 'user');
    if (!lastUser) return;
    if (this.preview) await this.cancelPreview({ silent: true });
    this.history.push({ role: 'assistant', text: '（重试）' });
    await this.send(lastUser.text);
  }

  /* ================================ 版本与还原 ================================ */

  async restoreHtml(html, { keepSelectionPid = null, label = '' } = {}) {
    this.overlay.clear();
    this.bridgeInstalled = false;
    this.loadHtml(html);
    await this.rpc('injectAnchors');
    if (keepSelectionPid) {
      const back = await this.rpc('select', { pid: keepSelectionPid }).catch(() => null);
      if (back) this.onSelect({ target: back });
      else {
        this.selection = null;
        this.panelChat.renderSelection(null);
      }
    }
    if (label) console.log('[zhidaiqi]', label);
  }

  async undo() {
    if (this.preview) await this.cancelPreview({ silent: true });
    const snap = this.store.undo();
    if (!snap) {
      this.toast('已经是最初版本了', 'warn');
      return;
    }
    await this.restoreHtml(snap.html, { keepSelectionPid: snap.targetPid });
    this.toast(`已撤销到 v${this.store.cursor}：${snap.label}`, '');
    this.renderVersions();
    this.renderVersionBadge();
  }

  async redo() {
    if (this.preview) await this.cancelPreview({ silent: true });
    const snap = this.store.redo();
    if (!snap) {
      this.toast('没有可重做的版本了', 'warn');
      return;
    }
    await this.restoreHtml(snap.html, { keepSelectionPid: snap.targetPid });
    this.toast(`已重做到 v${this.store.cursor}：${snap.label}`, '');
    this.renderVersions();
    this.renderVersionBadge();
  }

  async jumpTo(id) {
    if (this.preview) await this.cancelPreview({ silent: true });
    const snap = this.store.peek(id);
    if (!snap) return;
    this.store.jumpTo(id);
    await this.restoreHtml(snap.html, { keepSelectionPid: snap.targetPid });
    this.toast(`已还原到 v${this.store.cursor}：${snap.label}`, 'ok');
    this.renderVersions();
    this.renderVersionBadge();
  }

  viewVersion(id) {
    const snap = this.store.peek(id);
    if (!snap) return;
    const rows = describePatch(snap.patch ?? { changes: [] });
    const body =
      `版本 v${this.store.snapshots.indexOf(snap)}\n` +
      `时间：${formatDateTime(snap.createdAt)}\n` +
      `来源：${snap.source}\n` +
      `标题：${snap.label}\n` +
      (snap.prompt ? `你的原话：${snap.prompt}\n` : '') +
      `HTML 体积：${snap.bytes} 字符\n` +
      (rows.length ? `改动明细：\n${rows.map((r) => `  · [${r.opLabel}] ${r.text}`).join('\n')}` : '（无结构化改动记录）');
    this.switchTab('versions');
    this.panelChat.addMessage('sys', body);
    this.toast('差异明细已输出到左侧对话区', '');
  }

  async reset() {
    const initial = this.store.snapshots[0];
    if (!initial) return;
    if (!window.confirm('回到最初的版本？当前之后的版本记录会保留在历史里，但页面会先还原到初始状态。')) return;
    if (this.preview) await this.cancelPreview({ silent: true });
    this.store.jumpTo(0);
    await this.restoreHtml(initial.html);
    this.toast('已回到初始版本', 'ok');
    this.renderVersions();
    this.renderVersionBadge();
  }

  renderVersions() {
    this.panelVersions.render({
      items: this.store.list(),
      stats: this.store.stats(),
      workspaceName: this.store.workspace?.name,
    });
  }

  renderVersionBadge() {
    const badge = this.root.querySelector('[data-el="version"]');
    badge.textContent = `v${Math.max(0, this.store.cursor)} · ${this.store.snapshots.length} 个版本`;
  }

  wireStore() {
    this.store.onChange(() => {
      this.renderVersionBadge();
      if (this.root.querySelector('[data-tab="versions"]')?.classList.contains('on')) this.renderVersions();
    });
  }

  /* ================================ 文件进出 ================================ */

  pickHtmlFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.html,.htm,text/html';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      await this.loadWorkspace({ name: file.name, html: text, source: 'initial' });
      this.toast(`已导入 ${file.name}（${text.length} 字符）`, 'ok');
    });
    input.click();
  }

  pickProjectFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const obj = safeJsonParse(await file.text(), null);
      if (!this.store.importProject(obj)) {
        this.toast('这不是有效的工程文件（.zhidaiqi.json）', 'err');
        return;
      }
      const snap = this.store.current();
      await this.restoreHtml(snap.html, { keepSelectionPid: snap.targetPid });
      this.renderVersions();
      this.toast(`已导入工程：${this.store.snapshots.length} 个版本`, 'ok');
    });
    input.click();
  }

  download(filename, content, mime = 'text/html') {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async exportHtml() {
    const clean = await this.rpc('extractCleanHtml');
    const name = (this.store.workspace?.name ?? 'page.html').replace(/\.html?$/i, '') + '.edited.html';
    this.download(name, clean.html);
    this.toast(`已导出 ${name}`, 'ok');
  }

  exportProject() {
    const project = this.store.exportProject();
    const base = (this.store.workspace?.name ?? 'page').replace(/\.html?$/i, '');
    this.download(`${base}.zhidaiqi.json`, JSON.stringify(project, null, 2), 'application/json');
    this.toast(`已导出工程（${project.snapshots.length} 个版本）`, 'ok');
  }

  /* ================================ 设置与测试 ================================ */

  openSettings() {
    this.settingsModal.open(this.settings);
  }

  async testProvider(cfg) {
    const provider = createProvider(cfg);
    const context = {
      target: {
        pid: 'p-test0001',
        tag: 'h1',
        selectorPath: 'body > h1',
        outerHtml: '<h1 data-pid="p-test0001">连接测试</h1>',
        innerText: '连接测试',
        computed: { 'font-size': '32px', color: 'rgb(17,24,39)' },
        matchedCssRules: [],
        rect: { x: 0, y: 0, w: 320, h: 48 },
        childCount: 0,
        chain: [],
      },
      request: '把标题改大一点',
      history: [],
    };
    const res = await provider.generate(context, {});
    const count = res.patch?.changes?.length ?? 0;
    return {
      message: `连接成功（${provider.label}）。\n返回了 ${count} 条改动：\n${summarizePatch(res.patch)}\n耗时 ${res.ms}ms`,
    };
  }

  /* ================================ 键盘 ================================ */

  wireKeys() {
    window.addEventListener('keydown', (e) => {
      const inField = ['TEXTAREA', 'INPUT'].includes(document.activeElement?.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? this.redo() : this.undo();
        return;
      }
      if (e.key === 'Escape') {
        if (this.bubbleStuck) {
          e.preventDefault();
          this.bubbleStuck = false;
          this.overlay.closeBubble();
          return;
        }
        if (this.preview) {
          e.preventDefault();
          this.cancelPreview();
          return;
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && this.preview) {
        e.preventDefault();
        this.acceptPreview();
      }
      if (!inField && (e.key === 'p' || e.key === 'P')) {
        // 快捷开关指代器
        const toggle = this.root.querySelector('[data-el="pick-toggle"]');
        this.setAiming(!toggle.checked);
      }
    });
    // Ctrl+S 保存为一个"手动"版本（防止浏览器保存对话框）
    window.addEventListener('keydown', async (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        await this.saveManualVersion();
      }
    });
  }

  /** 手动存一个版本（Ctrl+S，或指代器里转发过来的快捷键） */
  async saveManualVersion() {
    try {
      const clean = await this.rpc('extractCleanHtml');
      this.store.push({ html: clean.html, label: '手动保存', source: 'manual-edit' });
      this.toast(`已手动保存为 v${this.store.cursor}`, 'ok');
      this.renderVersions();
    } catch (err) {
      this.toast(`保存失败：${err.message}`, 'err');
    }
  }

  /**
   * 指代器开启时页面被"冻住"，键盘事件到不了父窗口，所以 iframe 会把
   * 应用级快捷键转发上来（见 bridge 的 installInteractionGuard）。
   */
  onShortcut(action) {
    switch (action) {
      case 'undo':
        this.undo();
        break;
      case 'redo':
        this.redo();
        break;
      case 'save':
        this.saveManualVersion();
        break;
      case 'accept':
        if (this.preview) this.acceptPreview();
        break;
      default:
        break;
    }
  }

  /* ================================ 启动 ================================ */

  async boot() {
    const restored = this.store.restore();
    let html;
    let name;
    if (restored) {
      const snap = this.store.current();
      html = snap.html;
      name = this.store.workspace?.name ?? '未命名.html';
      this.toast(`已恢复上次的工作区（${this.store.snapshots.length} 个版本）`, 'ok');
    } else {
      html = this.demoHtml;
      name = '示例页面.html';
      this.store.initWorkspace({ name, html, source: 'initial' });
    }
    await this.loadWorkspace({ name, html, keepHistory: restored });
  }

  async loadWorkspace({ name, html, keepHistory = false, source = 'initial' }) {
    if (!keepHistory) this.store.initWorkspace({ name, html, source });
    this.store.workspace = this.store.workspace ?? { name };
    this.history = [];
    this.bridgeInstalled = false;
    this.preview = null;
    this.loadHtml(html);
    await this.rpc('injectAnchors');
    await this.pushNames(); // R5：把用户命名下发给 iframe 的命名引擎
    this.setAiming(true, { fromBridge: true }); // R4.3：只同步视觉，桥本来就默认 pick 模式
    this.renderVersions();
    this.renderVersionBadge();
    this.panelChat.renderSelection(null);
    this.renderBreadcrumb(null);
    this.root.querySelector('[data-el="frame-shell"]')?.classList.remove('busy');
  }
}


exports["EditorApp"] = exports["EditorApp"] ?? (typeof EditorApp !== 'undefined' ? EditorApp : undefined);

});

__Z_DEF("selftest.mjs", function (exports, __Z_REQ) {
/**
 * selftest.mjs — 页面内自检套件。
 *
 * 为什么放在这里而不是只在 Node 里测：
 *  锚点注入、悬停命中、预览、回滚、撤销这些事的最终判据是**真实浏览器里的 DOM**。
 *  Node 单测覆盖不了它，而受限环境里又未必能起无头浏览器。
 *  所以把验收脚本放进页面：在真浏览器里跑，结果直接显示给你看（/ 顶栏"自检"按钮）。
 *
 * 调用方式：
 *   __Z__.req('selftest.mjs').runSelfTest(window.__zApp)
 *   —— 返回 { passed, failed, results:[{name, ok, detail}] }
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


async function runSelfTest(app, { log = () => {} } = {}) {
  const results = [];
  const t = () => window.__ztest;

  const check = (name, ok, detail = '') => {
    results.push({ name, ok: !!ok, detail: detail ? String(detail).slice(0, 300) : '' });
    log(`${ok ? '✔' : '✖'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  };

  const want = (name, fn) => ({ name, fn });

  /** 在任意页面上找一个"确定存在、有文字"的候选元素，避免自检写死示例页的选择器 */
  const probeEl = () => {
    const doc = t().doc;
    return (
      doc.querySelector('h1') ||
      doc.querySelector('h2') ||
      doc.querySelector('h3') ||
      doc.querySelector('p') ||
      doc.querySelector('main *') ||
      doc.body?.firstElementChild ||
      null
    );
  };
  const SELECTOR = (() => {
    const el = probeEl();
    if (!el) return null;
    if (el.id) return `#${el.id}`;
    const cls = (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean)[0];
    return cls ? `${el.tagName.toLowerCase()}.${cls}` : el.tagName.toLowerCase();
  })();

  /* ------------------------------------------------------------------ */
  const steps = [
    want('页面所有元素都注入了唯一 data-pid', async () => {
      const stats = await app.rpc('stats');
      check('页面所有元素都注入了唯一 data-pid', stats.anchored === stats.elements && stats.elements > 5, `${stats.anchored}/${stats.elements}`);
    }),

    want('初始工作区自动建立版本 0', async () => {
      check('初始工作区自动建立版本 0', app.store.snapshots.length >= 1 && app.store.snapshots[0].source === 'initial', `versions=${app.store.snapshots.length}`);
    }),

    want('指代器选中元素并打上 .picker-selected', async () => {
      const sel = await t().selectCss(SELECTOR);
      const tag = t().doc.querySelector(SELECTOR).tagName.toLowerCase();
      check('指代器选中元素并打上 .picker-selected', !!sel?.pid && sel.hasMark === true && sel.tag === tag, JSON.stringify({ pid: sel?.pid, mark: sel?.hasMark }));
    }),

    want('元素链能反映从内到外的层级', async () => {
      const el = t().doc.querySelector(SELECTOR);
      const chain = await t().doc.defaultView.__zBridge.picker.chainAt(
        ...(() => {
          const r = el.getBoundingClientRect();
          return [r.x + Math.max(1, r.width / 2), r.y + Math.max(1, r.height / 2)];
        })(),
      );
      const tags = chain.map((x) => x.tagName.toLowerCase());
      check('元素链能反映从内到外的层级', tags[0] === el.tagName.toLowerCase() && tags.includes('body') && tags.at(-1) === 'html', tags.join('›'));
    }),

    want('选中元素的上下文包含计算样式与命中规则', async () => {
      const ctx = await t().context('再大一点');
      const hasComputed = !!ctx?.target?.computed?.['font-size'];
      check('选中元素的上下文包含计算样式与命中规则', hasComputed && ctx.target.pid === app.selection.pid, JSON.stringify(Object.keys(ctx?.target?.computed ?? {}).slice(0, 6)));
    }),

    want('模型返回结构化 JSON patch（不是 HTML 字符串）', async () => {
      await t().selectCss(SELECTOR);
      await t().send('再大一点，换成深蓝');
      const p = app.preview;
      const okPatch = !!p?.patch?.changes?.length && p.patch.changes.every((c) => typeof c.op === 'string' && typeof c.target === 'string');
      check('模型返回结构化 JSON patch（不是 HTML 字符串）', okPatch, JSON.stringify(p?.patch?.changes ?? null));
    }),

    want('预览态改动已经画在页面上', async () => {
      const el = t().doc.querySelector(SELECTOR);
      const changed = el.style.fontSize || el.style.color || el.style.fontWeight;
      check('预览态改动已经画在页面上', !!changed && app.preview != null, `fontSize=${el.style.fontSize} color=${el.style.color}`);
    }),

    want('取消后元素 outerHTML 逐字节还原', async () => {
      const pid = app.selection.pid;
      const before = await t().outerHtml(pid);
      await t().send('加粗');
      const mid = await t().outerHtml(pid);
      await app.cancelPreview();
      const after = await t().outerHtml(pid);
      check('取消后元素 outerHTML 逐字节还原', mid !== before && after === before, `midChanged=${mid !== before} restored=${after === before}`);
    }),

    want('取消"插入内容"（含纯文本）后也能逐字节还原', async () => {
      // 回归：逆操作曾经只收集元素节点，纯文本插入撤销后文字会永久残留
      await t().selectCss(SELECTOR);
      const pid = app.selection.pid;
      const samples = ['纯文本片段', '前<b>粗</b>后', '<span>纯元素</span>'];
      const failed = [];
      for (const html of samples) {
        const restored = await window.__ztest.insertAndUndo(pid, { op: 'insertHtml', target: pid, position: 'append', html });
        if (!restored) failed.push(html);
      }
      check('取消"插入内容"（含纯文本）后也能逐字节还原', failed.length === 0, failed.length ? `未还原：${failed.join(' / ')}` : `${samples.length} 种插入均已还原`);
    }),

    want('结构变化后锚点不漂移（撤销后仍指向同一元素）', async () => {
      const stable = await window.__ztest.pidStabilityCheck();
      check('结构变化后锚点不漂移（撤销后仍指向同一元素）', stable.ok, stable.detail);
    }),

    want('接受后写入版本快照', async () => {
      const before = app.store.snapshots.length;
      await t().selectCss(SELECTOR);
      await t().send('再大一点，换成深蓝');
      await t().accept();
      const s = app.store.current();
      check('接受后写入版本快照', app.store.snapshots.length === before + 1 && s.source === 'ai' && s.prompt.length > 0, `v=${app.store.cursor} label=${s.label}`);
    }),

    want('快照里的 HTML 是干净的（无 pid / 无编辑器注入）', async () => {
      const html = app.store.current().html;
      check('快照里的 HTML 是干净的（无 pid / 无编辑器注入）', !html.includes('data-pid') && !html.includes('picker-selected') && !html.includes('data-z-inject'), `含 pid=${html.includes('data-pid')}`);
    }),

    want('连续三次改动 → 逐级撤销 → 逐级重做', async () => {
      // 找三个互不相同的、确实存在的元素来连续改三次
      const doc = t().doc;
      const candidates = [SELECTOR, 'p', 'li', 'td', 'span', 'div'].map((sel) => ({ sel, el: doc.querySelector(sel) })).filter((x) => x.el);
      const picks = [];
      const seen = new Set();
      for (const c of candidates) {
        if (picks.length >= 3) break;
        if (seen.has(c.el)) continue;
        seen.add(c.el);
        picks.push(c);
      }
      while (picks.length < 3 && candidates.length) picks.push(candidates[picks.length % candidates.length]);
      for (const [i, pick] of picks.entries()) {
        await t().selectCss(pick.sel);
        await t().send(['再大一点', '加粗', '加个阴影'][i % 3]);
        await t().accept();
      }
      const top = app.store.cursor;
      while (app.store.canUndo()) await app.undo();
      const atZero = app.store.cursor === 0 && !app.store.canUndo();
      while (app.store.canRedo()) await app.redo();
      const back = app.store.cursor === top;
      check('连续三次改动 → 逐级撤销 → 逐级重做', atZero && back, `top=${top} 撤销到底=${atZero} 重做回顶=${back}`);
    }),

    want('跳回历史版本后，该版本的 pid 仍然能选中同一元素', async () => {
      const target = app.store.snapshots.find((s) => s.targetPid && s.source === 'ai');
      if (!target) {
        check('跳回历史版本后，该版本的 pid 仍然能选中同一元素', false, '没有带 pid 的版本可测');
        return;
      }
      await app.jumpTo(target.id);
      const info = await window.__ztest.bridge().api.select({ pid: target.targetPid });
      check('跳回历史版本后，该版本的 pid 仍然能选中同一元素', !!info?.pid, `pid=${target.targetPid} → ${info?.label ?? '未找到'}`);
    }),

    want('AI 改范围外的元素会被硬拒绝', async () => {
      await t().selectCss(SELECTOR);
      // 找一个确定不在选中范围里的元素（选中元素本身、或其祖先/后代都不算）
      const scope = t().doc.querySelector(SELECTOR);
      const outsideEl = [...t().doc.querySelectorAll('[data-pid]')].find(
        (el) => el !== scope && !scope.contains(el) && !el.contains(scope),
      );
      const outside = outsideEl?.getAttribute('data-pid');
      let rejected = false;
      let message = '';
      try {
        await window.__ztest.bridge().api.applyPatch({
          patch: {
            version: 1,
            target: app.selection.pid,
            changes: [{ op: 'setStyle', target: outside, prop: 'color', value: 'red' }],
          },
        });
      } catch (err) {
        rejected = true;
        message = err.message;
      }
      check('AI 改范围外的元素会被硬拒绝', rejected && /越界|范围/.test(message), message);
    }),

    want('AI 不能篡改 pid、不能注入脚本、不能整页重写', async () => {
      const api = window.__ztest.bridge().api;
      const pid = app.selection.pid;
      let pidRejected = false;
      let tooManyRejected = false;
      try {
        await api.applyPatch({ patch: { version: 1, target: pid, changes: [{ op: 'setAttr', target: pid, name: 'data-pid', value: 'hacked' }] } });
      } catch {
        pidRejected = true;
      }
      const stillPid = t().doc.querySelector(SELECTOR).getAttribute('data-pid') === pid;
      // 注意：这里的 </script> 必须写成 <\/script>。
      // 内联到单文件 HTML 时，任何裸的 </script> 都会让浏览器**提前结束**外层脚本，
      // 后面的全部内容会当纯文本渲染（曾因此打开页面只看到一堆源码）。
      await api.applyPatch({ patch: { version: 1, target: pid, changes: [{ op: 'setHtml', target: pid, html: '<b>ok</b><script>window.__pwned=1<\/script>' }] } });
      const hasScript = !!t().doc.querySelector(`${SELECTOR} script`);
      const pwned = !!t().win.__pwned;
      try {
        await api.applyPatch({ patch: { version: 1, target: pid, changes: Array.from({ length: 60 }, () => ({ op: 'setText', target: pid, value: 'x' })) } });
      } catch {
        tooManyRejected = true;
      }
      check('AI 不能篡改 pid、不能注入脚本、不能整页重写', pidRejected && stillPid && !hasScript && !pwned && tooManyRejected, JSON.stringify({ pidRejected, stillPid, hasScript, pwned, tooManyRejected }));
    }),

    want('导出 HTML 干净且保留改动', async () => {
      await app.jumpTo(app.store.snapshots.length - 1);
      const clean = await window.__ztest.bridge().api.extractCleanHtml();
      const html = clean.html;
      const leaked = ['data-pid', 'picker-selected', 'data-z-inject', '__zToken', '__zBridge', 'zhidaiqi'].filter((t) => html.includes(t));
      check(
        '导出 HTML 干净且保留改动',
        html.startsWith('<!DOCTYPE') && leaked.length === 0,
        leaked.length ? `残留：${leaked.join(', ')}` : `bytes=${clean.bytes}`,
      );
    }),

    want('快照 HTML 也不含编辑器注入', async () => {
      const html = app.store.current().html;
      const leaked = ['data-pid', 'picker-selected', 'data-z-inject', '__zToken', '__zBridge'].filter((t) => html.includes(t));
      check('快照 HTML 也不含编辑器注入', leaked.length === 0, leaked.length ? `残留：${leaked.join(', ')}` : '干净');
    }),

    want('R1 选中信息是"人话名"（界面里不再出现代码名）', async () => {
      await t().selectCss(SELECTOR);
      const sel = app.selection;
      const hasCode = /[.#>]/.test(sel?.name ?? '');
      const crumbText = app.crumb?.textContent ?? '';
      check(
        'R1 选中信息是"人话名"（界面里不再出现代码名）',
        !!sel?.name && !hasCode && !!sel.icon && !/[.#>]/.test(crumbText),
        `name=${sel?.name} icon=${sel?.icon} 面包屑=${crumbText}`,
      );
    }),

    want('R1.3 技术信息被降级保留（tooltip / 折叠区里还在）', async () => {
      const sel = app.selection;
      const tech = app.panelChat.selCard.querySelector('[data-el="selpath"]')?.textContent ?? '';
      check(
        'R1.3 技术信息被降级保留（tooltip / 折叠区里还在）',
        !!(sel?.tooltip && sel.tooltip.length > 0) && tech.length > 0,
        `tooltip=${(sel?.tooltip ?? '').slice(0, 40)} 折叠区选择器=${tech.slice(0, 40)}`,
      );
    }),

    want('R3.3 快捷词跟随元素类型变化', async () => {
      const doc = t().doc;
      const chipsOf = () => [...app.panelChat.chips.querySelectorAll('.z-chip')].map((b) => b.textContent);
      const heading = doc.querySelector('h1, h2, h3');
      const button = doc.querySelector('button');
      let a = [];
      let b = [];
      if (heading) {
        await t().selectCss(heading.tagName.toLowerCase());
        a = chipsOf();
      }
      if (button) {
        await t().selectCss('button');
        b = chipsOf();
      }
      check(
        'R3.3 快捷词跟随元素类型变化',
        a.length > 0 && b.length > 0 && a.join() !== b.join(),
        `标题=[${a.join('/')}] 按钮=[${b.join('/')}]`,
      );
    }),

    want('R5 重命名后弹层/面板/AI 上下文用同一个名字', async () => {
      await t().selectCss(SELECTOR);
      const pid = app.selection.pid;
      const custom = '自检改名测试';
      app.names[pid] = custom;
      app.saveNames();
      await app.pushNames();
      const fresh = await app.rpc('select', { pid });
      const ctx = await t().context('换个颜色');
      const panelName = app.panelChat.selCard.querySelector('[data-el="selname"]')?.textContent ?? '';
      const ok = fresh?.name === custom && ctx?.target?.humanName === custom && panelName.includes(custom);
      // 清理，避免污染后续用例与用户的命名
      delete app.names[pid];
      app.saveNames();
      await app.pushNames();
      await app.rpc('select', { pid }).catch(() => null);
      check('R5 重命名后弹层/面板/AI 上下文用同一个名字', ok, `选中=${fresh?.name} AI上下文=${ctx?.target?.humanName} 面板=${panelName}`);
    }),

    want('按住弹出 → 松开后选择界面留下，能点到「让 AI 改这块」', async () => {
      const doc = t().doc;
      const win = t().win;
      const el = doc.querySelector(SELECTOR);
      if (!el) {
        check('按住弹出 → 松开后选择界面留下，能点到「让 AI 改这块」', false, '找不到可测元素');
        return;
      }
      const r = el.getBoundingClientRect();
      const at = {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: Math.round(r.x) + Math.max(2, Math.min(6, r.width / 4)),
        clientY: Math.round(r.y) + Math.max(2, Math.min(6, r.height / 4)),
      };
      const fire = (type, extra = {}) => doc.dispatchEvent(new win.PointerEvent(type, { ...at, ...extra }));
      fire('pointerdown');
      await sleep(30);
      const popped = !!app.overlay.bubble;
      fire('pointerup');
      await sleep(60);
      const stuck = !!app.overlay.bubble && app.overlay.bubble.classList.contains('stuck');
      const hasAiBtn = !!app.overlay.bubble?.querySelector('[data-action="ai"]');
      // 清理：关掉工具条，别影响后面的用例
      app.bubbleStuck = false;
      app.overlay.closeBubble();
      check(
        '按住弹出 → 松开后选择界面留下，能点到「让 AI 改这块」',
        popped && stuck && hasAiBtn,
        `按住弹出=${popped} 松手后留下=${stuck} 有AI按钮=${hasAiBtn}`,
      );
    }),

    want('越界时会自动纠正，而不是让用户撞墙', async () => {
      await t().selectCss(SELECTOR);
      const doc = t().doc;
      const scope = doc.querySelector(SELECTOR);
      const pid = app.selection.pid;
      const outside = [...doc.querySelectorAll('[data-pid]')].find(
        (el) => el !== scope && !scope.contains(el) && !el.contains(scope),
      );
      if (!outside) {
        check('越界时会自动纠正，而不是让用户撞墙', false, '找不到范围外元素做测试');
        return;
      }
      const outsidePid = outside.getAttribute('data-pid');
      const original = app.provider;
      let calls = 0;
      app.provider = {
        kind: 'selftest',
        label: '自检用假模型',
        async generate() {
          calls++;
          if (calls === 1) {
            return {
              raw: '{}',
              patch: { version: 1, target: pid, summary: '越界示例', changes: [{ op: 'setStyle', target: outsidePid, prop: 'color', value: 'red' }] },
            };
          }
          return {
            raw: '{}',
            patch: { version: 1, target: pid, summary: '改为改选中元素自身', changes: [{ op: 'setStyle', target: pid, prop: 'background-color', value: 'rgb(240, 240, 240)' }] },
          };
        },
      };
      try {
        await t().send('给这段文字加个垫色块');
        const recovered = !!app.preview && calls === 2;
        if (app.preview) await app.cancelPreview();
        check('越界时会自动纠正，而不是让用户撞墙', recovered, `模型被调用 ${calls} 次，进入预览=${!!app.preview}`);
      } finally {
        app.provider = original;
      }
    }),

    want('按住时滑到选项上就高亮（走真实浏览器路径）', async () => {
      const doc = t().doc;
      const win = t().win;
      const el = doc.querySelector(SELECTOR);
      if (!el) {
        check('按住时滑到选项上就高亮（走真实浏览器路径）', false, '找不到可测元素');
        return;
      }
      const r = el.getBoundingClientRect();
      const at = {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: Math.round(r.x) + Math.max(2, Math.min(6, r.width / 4)),
        clientY: Math.round(r.y) + Math.max(2, Math.min(6, r.height / 4)),
      };
      doc.dispatchEvent(new win.PointerEvent('pointerdown', at));
      await sleep(40);
      const bubble = app.overlay.bubble;
      if (!bubble) {
        check('按住时滑到选项上就高亮（走真实浏览器路径）', false, '候选界面没弹出来');
        return;
      }
      const rows = bubble.querySelectorAll('[data-chain]');
      if (rows.length < 2) {
        check('按住时滑到选项上就高亮（走真实浏览器路径）', false, '候选只有一个层级');
        doc.dispatchEvent(new win.PointerEvent('pointerup', at));
        return;
      }
      const frameRect = app.frame.getBoundingClientRect();
      const initial = app.overlay.currentIndex;
      const results = [];
      // 模拟"在 iframe 里按住后把指针移到选项上"：
      // 浏览器此时可能把事件继续投递给 iframe（跨 frame 捕获），父窗口收不到自己的 hover，
      // 所以这里**只派发 iframe 上的 pointermove** —— 走的正是坐标回传通道。
      for (const i of [1, 0]) {
        const rr = rows[i].getBoundingClientRect();
        doc.dispatchEvent(
          new win.PointerEvent('pointermove', {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX: Math.round(rr.left - frameRect.left + Math.min(12, rr.width / 3)),
            clientY: Math.round(rr.top - frameRect.top + Math.min(8, rr.height / 2)),
          }),
        );
        await sleep(60);
        results.push({
          i,
          index: app.overlay.currentIndex,
          on: rows[i].classList.contains('on'),
        });
      }
      const ok = results.every((x) => x.index === x.i && x.on);
      // 清理：结束这次按住
      doc.dispatchEvent(new win.PointerEvent('pointerup', at));
      await sleep(40);
      app.bubbleStuck = false;
      app.overlay.closeBubble();
      check(
        '按住时滑到选项上就高亮（走真实浏览器路径）',
        ok,
        `初始层级=${initial}；滑到第1项→层级${results[0]?.index}(高亮=${results[0]?.on})、第0项→层级${results[1]?.index}(高亮=${results[1]?.on})`,
      );
    }),

    want('指代器开启时页面被冻住，关闭后页面功能恢复', async () => {
      const doc = t().doc;
      const win = t().win;
      const el = doc.querySelector(SELECTOR) ?? doc.body;
      // 现场给页面挂一个"自己的交互"，模拟导入的 HTML 自带的点击逻辑
      let pageHits = 0;
      const pageHandler = () => {
        pageHits++;
      };
      doc.body.addEventListener('click', pageHandler);
      const r = el.getBoundingClientRect();
      const at = { bubbles: true, cancelable: true, button: 0, clientX: Math.round(r.x) + 4, clientY: Math.round(r.y) + 4 };

      // ① 指代器开启（默认）：隔离层在，页面的点击逻辑收不到
      const shieldOn = !!doc.querySelector('[data-z-shield]');
      doc.dispatchEvent(new win.MouseEvent('click', at));
      await sleep(30);
      const blocked = pageHits === 0;

      // ② 关掉指代器：隔离层撤掉，页面逻辑恢复正常
      await app.setAiming(false);
      await sleep(60);
      const shieldOff = !doc.querySelector('[data-z-shield]');
      doc.dispatchEvent(new win.MouseEvent('click', at));
      await sleep(30);
      const restored = pageHits > 0;

      // ③ 收尾：开回指代器并摘掉临时监听
      await app.setAiming(true);
      await sleep(40);
      const shieldBack = !!doc.querySelector('[data-z-shield]');
      doc.body.removeEventListener('click', pageHandler);
      check(
        '指代器开启时页面被冻住，关闭后页面功能恢复',
        shieldOn && blocked && shieldOff && restored && shieldBack,
        `开启时有隔离层=${shieldOn} 页面点击被挡=${blocked} 关闭后隔离层撤掉=${shieldOff} 页面点击恢复=${restored} 再开启隔离层回来=${shieldBack}`,
      );
    }),

    want('版本历史与预览卡渲染正常', async () => {
      app.switchTab('versions');
      const rows = document.querySelectorAll('.z-ver').length;
      const cards = document.querySelectorAll('.z-card').length;
      check('版本历史与预览卡渲染正常', rows >= app.store.snapshots.length && cards >= 1, `rows=${rows} cards=${cards}`);
      app.switchTab('chat');
    }),
  ];

  for (const step of steps) {
    try {
      await step.fn();
    } catch (err) {
      check(step.name, false, `抛错：${err?.message ?? err}`);
    }
    await sleep(30);
  }

  const failed = results.filter((r) => !r.ok).length;
  return { passed: results.length - failed, failed, total: results.length, results };
}

/** 把自检结果渲染成一个浮层（顶栏"自检"按钮调用） */

function showSelfTestPanel(result) {
  const existing = document.querySelector('.z-selftest-mask');
  existing?.remove();
  const mask = document.createElement('div');
  mask.className = 'z-modal-mask z-selftest-mask';
  const ok = result.failed === 0;
  mask.innerHTML =
    `<div class="z-modal" style="width:min(680px,100%)">` +
    `<div class="z-modal-head"><b>页面内自检</b>` +
    `<span style="font-size:11.5px;color:${ok ? 'var(--z-ok)' : 'var(--z-danger)'}">` +
    `${result.passed}/${result.total} 通过${ok ? ' ✔' : ` · ${result.failed} 项失败`}</span></div>` +
    `<div class="z-modal-body z-scroll" style="gap:6px">` +
    result.results
      .map(
        (r) =>
          `<div style="display:flex;gap:8px;align-items:flex-start;font-size:12px">` +
          `<span style="color:${r.ok ? 'var(--z-ok)' : 'var(--z-danger)'};font-weight:600">${r.ok ? '✔' : '✖'}</span>` +
          `<div><div>${r.name}</div>${r.detail ? `<div style="color:var(--z-dim-2);font-size:11px;font-family:var(--z-mono);word-break:break-all">${r.detail}</div>` : ''}</div></div>`,
      )
      .join('') +
    `</div>` +
    `<div class="z-modal-foot"><button class="z-btn primary" data-act="close">知道了</button></div></div>`;
  document.body.appendChild(mask);
  mask.addEventListener('click', (e) => {
    if (e.target === mask || e.target.closest('[data-act="close"]')) mask.remove();
  });
  return mask;
}


exports["runSelfTest"] = exports["runSelfTest"] ?? (typeof runSelfTest !== 'undefined' ? runSelfTest : undefined);
exports["showSelfTestPanel"] = exports["showSelfTestPanel"] ?? (typeof showSelfTestPanel !== 'undefined' ? showSelfTestPanel : undefined);

});
window.__Z__ = { modules: __Z_CACHE, req: __Z_REQ, bridgeSource: window.__Z_BRIDGE_SRC__ || "(function () {\nvar window = globalThis;\nvar __Z_CACHE = {}, __Z_INSTALLED = {};\nfunction __Z_DEF(id, factory) {\n  if (__Z_INSTALLED[id]) return;\n  __Z_INSTALLED[id] = true;\n  var exports = {};\n  __Z_CACHE[id] = exports;\n  factory(exports, __Z_REQ);\n}\nfunction __Z_REQ(id) {\n  if (!__Z_CACHE[id]) throw new Error('[zhidaiqi] 模块未注册: ' + id);\n  return __Z_CACHE[id];\n}\n__Z_DEF(\"util.mjs\", function (exports, __Z_REQ) {\n/**\n * util.mjs — 无依赖小工具。必须保持\"不碰 DOM、可被 Node 直接 import\"。\n * 这些函数会被打包进单文件 HTML，也会被单元测试直接调用。\n */\n\n/** 稳定的 32 位字符串哈希（FNV-1a 变体），同一输入永远同一输出。 */\n\nfunction hash32(str) {\n  let h = 0x811c9dc5;\n  for (let i = 0; i < str.length; i++) {\n    h ^= str.charCodeAt(i);\n    h = Math.imul(h, 0x01000193) >>> 0;\n  }\n  return h >>> 0;\n}\n\n/** p-xxxxxxxx 形式的稳定 id。 */\n\nfunction stableId(seed) {\n  return 'p-' + hash32(String(seed)).toString(16).padStart(8, '0');\n}\n\nlet __seq = 0;\n/** 运行时唯一 id（消息配对、快照 id 用，不要求跨会话稳定）。 */\n\nfunction uid(prefix = 'u') {\n  __seq = (__seq + 1) % 0xffff;\n  return `${prefix}-${Date.now().toString(36)}-${__seq.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;\n}\n\n\nfunction clamp(n, min, max) {\n  return Math.min(max, Math.max(min, n));\n}\n\n\nfunction escapeHtml(str) {\n  return String(str)\n    .replace(/&/g, '&amp;')\n    .replace(/</g, '&lt;')\n    .replace(/>/g, '&gt;')\n    .replace(/\"/g, '&quot;')\n    .replace(/'/g, '&#39;');\n}\n\n\nfunction escapeRegExp(str) {\n  return String(str).replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');\n}\n\n/** 中文友好的\"多少字符\"计数 */\n\nfunction charCount(str) {\n  return Array.from(String(str ?? '')).length;\n}\n\n\nfunction truncate(str, max = 120) {\n  const chars = Array.from(String(str ?? ''));\n  if (chars.length <= max) return chars.join('');\n  return chars.slice(0, max).join('') + '…';\n}\n\n\nfunction truncateBytes(str, maxBytes = 24 * 1024) {\n  const s = String(str ?? '');\n  if (s.length <= maxBytes) return { text: s, truncated: false };\n  return { text: s.slice(0, maxBytes) + '\\n<!-- …已截断… -->', truncated: true };\n}\n\n\nfunction formatBytes(bytes) {\n  const b = Number(bytes) || 0;\n  if (b < 1024) return `${b} B`;\n  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;\n  return `${(b / 1024 / 1024).toFixed(2)} MB`;\n}\n\n\nfunction formatTime(ts) {\n  const d = new Date(Number(ts) || Date.now());\n  const p = (n) => String(n).padStart(2, '0');\n  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;\n}\n\n\nfunction formatDateTime(ts) {\n  const d = new Date(Number(ts) || Date.now());\n  const p = (n) => String(n).padStart(2, '0');\n  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;\n}\n\n/**\n * 从模型回复里剥出 JSON。模型经常加 ```json 围栏或前后客套话。\n * 只做\"剥离\"，绝不把非 JSON 内容当结果用；剥不出来抛错。\n */\n\nfunction extractJson(text) {\n  if (text == null) throw new Error('模型返回为空');\n  if (typeof text === 'object') return text;\n  let s = String(text).trim();\n  if (!s) throw new Error('模型返回为空');\n\n  // 1) 优先剥 ```json ... ``` / ``` ... ``` 围栏\n  const fence = s.match(/```(?:json|json5|javascript|js)?\\s*([\\s\\S]*?)```/i);\n  if (fence && fence[1]) s = fence[1].trim();\n\n  // 2) 直接解析\n  try {\n    return JSON.parse(s);\n  } catch {\n    /* 继续尝试定位第一个平衡的 { } 或 [ ] */\n  }\n\n  const start = s.search(/[[{]/);\n  if (start === -1) throw new Error('模型返回中找不到 JSON');\n  const open = s[start];\n  const close = open === '{' ? '}' : ']';\n  let depth = 0;\n  let inStr = false;\n  let quote = '';\n  let escaped = false;\n  for (let i = start; i < s.length; i++) {\n    const ch = s[i];\n    if (inStr) {\n      if (escaped) escaped = false;\n      else if (ch === '\\\\') escaped = true;\n      else if (ch === quote) inStr = false;\n      continue;\n    }\n    if (ch === '\"' || ch === \"'\") {\n      inStr = true;\n      quote = ch;\n      continue;\n    }\n    if (ch === open) depth++;\n    else if (ch === close) {\n      depth--;\n      if (depth === 0) {\n        const candidate = s.slice(start, i + 1);\n        try {\n          return JSON.parse(candidate);\n        } catch {\n          // 有些模型用单引号，做一次温和修复\n          const repaired = candidate\n            .replace(/([{,]\\s*)'([^']*?)'(\\s*:)/g, '$1\"$2\"$3')\n            .replace(/:\\s*'([^']*?)'(\\s*[,}])/g, ': \"$1\"$2');\n          try {\n            return JSON.parse(repaired);\n          } catch {\n            throw new Error('模型返回的 JSON 无法解析');\n          }\n        }\n      }\n    }\n  }\n  throw new Error('模型返回的 JSON 括号不闭合');\n}\n\n/** 深拷贝（用于快照与上下文，避免共享引用） */\n\nfunction deepClone(value) {\n  if (value == null || typeof value !== 'object') return value;\n  if (typeof structuredClone === 'function') {\n    try {\n      return structuredClone(value);\n    } catch {\n      /* fall through */\n    }\n  }\n  return JSON.parse(JSON.stringify(value));\n}\n\n\nfunction safeJsonParse(text, fallback = null) {\n  try {\n    return JSON.parse(text);\n  } catch {\n    return fallback;\n  }\n}\n\n/** patch 摘要 → 人类可读的一行话（版本列表用） */\n\nfunction describeChange(change) {\n  if (!change || typeof change !== 'object') return '未知改动';\n  switch (change.op) {\n    case 'setStyle':\n      return `样式 ${change.prop} → ${change.value}`;\n    case 'setText':\n      return `文本 → “${truncate(change.value, 24)}”`;\n    case 'setAttr':\n      return change.value === null || change.value === undefined\n        ? `删除属性 ${change.name}`\n        : `属性 ${change.name} → ${truncate(change.value, 24)}`;\n    case 'setHtml':\n      return `替换内部 HTML（${charCount(change.html)} 字符）`;\n    case 'insertHtml':\n      return `在 ${change.position ?? 'append'} 位置插入 ${charCount(change.html)} 字符`;\n    case 'removeNode':\n      return '删除该元素';\n    default:\n      return `未知操作 ${change.op}`;\n  }\n}\n\n/** 结构化错误，便于 UI 区分\"模型问题\"和\"系统问题\" */\n\nclass ZError extends Error {\n  constructor(message, code = 'E_UNKNOWN', detail = null) {\n    super(message);\n    this.name = 'ZError';\n    this.code = code;\n    this.detail = detail;\n  }\n}\n\n\nfunction assert(cond, message, code = 'E_ASSERT') {\n  if (!cond) throw new ZError(message, code);\n}\n\n/** 简单防抖 */\n\nfunction debounce(fn, wait = 60) {\n  let timer = null;\n  const wrapped = (...args) => {\n    if (timer) clearTimeout(timer);\n    timer = setTimeout(() => {\n      timer = null;\n      fn(...args);\n    }, wait);\n  };\n  wrapped.cancel = () => {\n    if (timer) clearTimeout(timer);\n    timer = null;\n  };\n  return wrapped;\n}\n\n\nconst sleep = (ms) => new Promise((r) => setTimeout(r, ms));\n\n\nexports[\"hash32\"] = exports[\"hash32\"] ?? (typeof hash32 !== 'undefined' ? hash32 : undefined);\nexports[\"stableId\"] = exports[\"stableId\"] ?? (typeof stableId !== 'undefined' ? stableId : undefined);\nexports[\"uid\"] = exports[\"uid\"] ?? (typeof uid !== 'undefined' ? uid : undefined);\nexports[\"clamp\"] = exports[\"clamp\"] ?? (typeof clamp !== 'undefined' ? clamp : undefined);\nexports[\"escapeHtml\"] = exports[\"escapeHtml\"] ?? (typeof escapeHtml !== 'undefined' ? escapeHtml : undefined);\nexports[\"escapeRegExp\"] = exports[\"escapeRegExp\"] ?? (typeof escapeRegExp !== 'undefined' ? escapeRegExp : undefined);\nexports[\"charCount\"] = exports[\"charCount\"] ?? (typeof charCount !== 'undefined' ? charCount : undefined);\nexports[\"truncate\"] = exports[\"truncate\"] ?? (typeof truncate !== 'undefined' ? truncate : undefined);\nexports[\"truncateBytes\"] = exports[\"truncateBytes\"] ?? (typeof truncateBytes !== 'undefined' ? truncateBytes : undefined);\nexports[\"formatBytes\"] = exports[\"formatBytes\"] ?? (typeof formatBytes !== 'undefined' ? formatBytes : undefined);\nexports[\"formatTime\"] = exports[\"formatTime\"] ?? (typeof formatTime !== 'undefined' ? formatTime : undefined);\nexports[\"formatDateTime\"] = exports[\"formatDateTime\"] ?? (typeof formatDateTime !== 'undefined' ? formatDateTime : undefined);\nexports[\"extractJson\"] = exports[\"extractJson\"] ?? (typeof extractJson !== 'undefined' ? extractJson : undefined);\nexports[\"deepClone\"] = exports[\"deepClone\"] ?? (typeof deepClone !== 'undefined' ? deepClone : undefined);\nexports[\"safeJsonParse\"] = exports[\"safeJsonParse\"] ?? (typeof safeJsonParse !== 'undefined' ? safeJsonParse : undefined);\nexports[\"describeChange\"] = exports[\"describeChange\"] ?? (typeof describeChange !== 'undefined' ? describeChange : undefined);\nexports[\"ZError\"] = exports[\"ZError\"] ?? (typeof ZError !== 'undefined' ? ZError : undefined);\nexports[\"assert\"] = exports[\"assert\"] ?? (typeof assert !== 'undefined' ? assert : undefined);\nexports[\"debounce\"] = exports[\"debounce\"] ?? (typeof debounce !== 'undefined' ? debounce : undefined);\nexports[\"sleep\"] = exports[\"sleep\"] ?? (typeof sleep !== 'undefined' ? sleep : undefined);\n\n});\n\n__Z_DEF(\"naming.mjs\", function (exports, __Z_REQ) {\n/**\n * naming.mjs — 元素命名翻译引擎（需求文档 R1 / E1）。\n *\n * 目标：让零代码用户看得懂\"我选中的是什么\"。\n * 约束（来自需求文档）：\n *   - 必须是**无副作用、可复用**的纯函数层，不与 DOM 选中逻辑耦合；\n *   - 技术信息不删除，但降级（放进 tooltip / 面板次级区域），**绝不作为主名**；\n *   - 翻译失败必须降级为安全通用名（\"这一块区域\"），**不得回退展示原始选择器**；\n *   - 不得为\"聪明\"引入明显延迟（弹层弹出要保持流畅）。\n *\n * 结构上刻意分成两层：\n *   1) 纯函数层（roleOf / colorName / smartTruncate / composeName / describeFromFacts / chipsFor）\n *      —— 不碰 DOM，可以在 Node 里直接单测；\n *   2) DOM 适配层（describeElement）\n *      —— 只负责\"取事实\"（标签、类名、文本、计算样式、位置），判断逻辑全部交给纯函数层。\n */\n\n/** 元素大类：用于图标、chips 动态化、以及\"是否适合展示文本\"的判断 */\n\nconst KIND = {\n  HEADING: 'heading',\n  TEXT: 'text',\n  LINK: 'link',\n  BUTTON: 'button',\n  IMAGE: 'image',\n  ICON: 'icon',\n  MEDIA: 'media',\n  LIST: 'list',\n  LIST_ITEM: 'list-item',\n  TABLE: 'table',\n  INPUT: 'input',\n  NAV: 'nav',\n  CONTAINER: 'container',\n  PAGE: 'page',\n  FORM: 'form',\n  CODE: 'code',\n  OTHER: 'other',\n};\n\nconst TAG_ROLE = {\n  h1: ['标题', KIND.HEADING], h2: ['标题', KIND.HEADING], h3: ['标题', KIND.HEADING],\n  h4: ['小标题', KIND.HEADING], h5: ['小标题', KIND.HEADING], h6: ['小标题', KIND.HEADING],\n  p: ['文字', KIND.TEXT], span: ['文字', KIND.TEXT], strong: ['文字', KIND.TEXT],\n  em: ['文字', KIND.TEXT], b: ['文字', KIND.TEXT], i: ['文字', KIND.TEXT], label: ['说明文字', KIND.TEXT],\n  small: ['说明文字', KIND.TEXT], figcaption: ['图片说明', KIND.TEXT], blockquote: ['引用', KIND.TEXT],\n  a: ['链接', KIND.LINK],\n  button: ['按钮', KIND.BUTTON],\n  input: ['输入框', KIND.INPUT], textarea: ['输入框', KIND.INPUT], select: ['下拉框', KIND.INPUT],\n  img: ['图片', KIND.IMAGE], picture: ['图片', KIND.IMAGE], figure: ['图片区', KIND.IMAGE],\n  svg: ['图标', KIND.ICON], i2: ['图标', KIND.ICON],\n  video: ['视频', KIND.MEDIA], audio: ['音频', KIND.MEDIA], iframe: ['嵌入内容', KIND.MEDIA],\n  ul: ['列表', KIND.LIST], ol: ['列表', KIND.LIST], dl: ['列表', KIND.LIST],\n  li: ['列表项', KIND.LIST_ITEM],\n  table: ['表格', KIND.TABLE], thead: ['表头', KIND.TABLE], tbody: ['表格内容', KIND.TABLE],\n  tr: ['表格行', KIND.TABLE], th: ['表头格', KIND.TABLE], td: ['表格格', KIND.TABLE],\n  nav: ['导航栏', KIND.NAV], header: ['页头', KIND.NAV], footer: ['页脚', KIND.NAV],\n  aside: ['侧栏', KIND.CONTAINER], main: ['整个页面', KIND.PAGE],\n  section: ['区块', KIND.CONTAINER], article: ['内容块', KIND.CONTAINER], div: ['', KIND.CONTAINER],\n  form: ['表单', KIND.FORM], body: ['整个页面', KIND.PAGE], html: ['整个页面', KIND.PAGE],\n  hr: ['分隔线', KIND.OTHER], br: ['换行', KIND.OTHER],\n};\n\n/** 结构性角色：可以和 class 关键词组合成\"首屏大区块\"这种两段式名字 */\nconst STRUCTURAL_ROLES = new Set(['区块', '内容块', '主内容区', '侧栏', '导航栏', '页头', '页脚', '整个页面', '表单', '表格', '列表', '图片区']);\n\n/**\n * 只有\"位置/性质修饰型\"的关键词才和结构角色拼接（首屏 + section = 首屏区块）。\n * 像\"卡片\"\"操作区\"本身已经是完整名词，再拼\"内容块\"就成了\"卡片内容块\"这种啰嗦名字。\n */\nconst HINT_TAKES_STRUCTURAL = new Set(['首屏', '横幅']);\n\nconst ICON_BY_KIND = {\n  [KIND.HEADING]: '🔤',\n  [KIND.TEXT]: '📝',\n  [KIND.LINK]: '🔗',\n  [KIND.BUTTON]: '🔘',\n  [KIND.IMAGE]: '🖼️',\n  [KIND.ICON]: '⭐',\n  [KIND.MEDIA]: '🎬',\n  [KIND.LIST]: '📋',\n  [KIND.LIST_ITEM]: '•',\n  [KIND.TABLE]: '📊',\n  [KIND.INPUT]: '⌨️',\n  [KIND.NAV]: '🧭',\n  [KIND.CONTAINER]: '⬜',\n  [KIND.PAGE]: '🖥️',\n  [KIND.FORM]: '📄',\n  [KIND.CODE]: '💻',\n  [KIND.OTHER]: '▫️',\n};\n\n/** class 关键词 → [叫什么, 大类, 是否高置信]；命中的关键词直接决定主名 */\nconst CLASS_HINTS = [\n  [/(^|-)(hero|banner|jumbotron|masthead)($|-)/, '首屏', KIND.CONTAINER],\n  [/(^|-)(lede|intro|subtitle|tagline|excerpt)($|-)/, '简介文字', KIND.TEXT],\n  [/(^|-)(title|heading|headline)($|-)/, '标题', KIND.HEADING],\n  [/(^|-)(btn|button|cta)($|-)/, '按钮', KIND.BUTTON],\n  [/(^|-)(cards?|panels?|tiles?)($|-)/, '卡片', KIND.CONTAINER],\n  [/(^|-)(price|amount|cost|fee)($|-)/, '价格', KIND.TEXT],\n  [/(^|-)(badges?|tags?|chips?|pills?)($|-)/, '标签', KIND.TEXT],\n  [/(^|-)(nav|navbar|menu|breadcrumb)($|-)/, '导航', KIND.NAV],\n  [/(^|-)(lists?|items|feed)($|-)/, '列表', KIND.LIST],\n  [/(^|-)(avatar|logo|thumb|icon)($|-)/, '图标', KIND.ICON],\n  [/(^|-)(sidebar|aside|drawer)($|-)/, '侧栏', KIND.CONTAINER],\n  [/(^|-)(stat|metric|number|num|count)($|-)/, '数据', KIND.TEXT],\n  [/(^|-)(desc|description|summary|note|meta|hint)($|-)/, '说明文字', KIND.TEXT],\n  [/(^|-)(footer)($|-)/, '页脚', KIND.NAV],\n  [/(^|-)(header|topbar)($|-)/, '页头', KIND.NAV],\n  [/(^|-)(search)($|-)/, '搜索框', KIND.INPUT],\n  [/(^|-)(form|field|control)($|-)/, '表单', KIND.FORM],\n  [/(^|-)(table|grid|rows)($|-)/, '表格', KIND.TABLE],\n  [/(^|-)(hero-actions|actions|toolbar|buttons)($|-)/, '操作区', KIND.CONTAINER],\n  [/(^|-)(eyebrow|kicker|overline)($|-)/, '小标签', KIND.TEXT],\n  [/(^|-)(cover|hero-image|photo|poster)($|-)/, '图片', KIND.IMAGE],\n  [/(^|-)(wrapper|container|inner|content|wrap)($|-)/, '', KIND.CONTAINER],\n];\n\n/** 取角色的兜底顺序：标签角色 + 类名关键词（关键词是\"修饰\"，不粗暴替换结构角色） */\n\nfunction roleOf(tag, classes = []) {\n  const t = String(tag ?? '').toLowerCase();\n  const cls = (Array.isArray(classes) ? classes : String(classes).split(/\\s+/)).filter(Boolean);\n  const hint = matchClassHint(cls);\n  const base = TAG_ROLE[t];\n  const baseRole = base?.[0] ?? '';\n  const kind = hint?.[1] ?? base?.[1] ?? KIND.OTHER;\n\n  if (hint?.[0]) {\n    let role = hint[0];\n    // 关键词 + 结构角色 → 组合名（hero + section = 首屏区块）；\n    // 只对\"修饰型\"关键词拼接，避免\"卡片内容块\"这种啰嗦结果\n    if (baseRole && STRUCTURAL_ROLES.has(baseRole) && HINT_TAKES_STRUCTURAL.has(role)) {\n      if (baseRole === role || baseRole.includes(role)) role = baseRole;\n      else if (!role.includes(baseRole)) role = role + baseRole;\n    }\n    return { role, hint: hint[0], kind, confidence: 0.9 };\n  }\n  if (baseRole) return { role: baseRole, hint: '', kind, confidence: 0.8 };\n  if (base) return { role: safeGenericName(kind), hint: '', kind, confidence: 0.5 };\n  return { role: '这一块区域', hint: '', kind: KIND.OTHER, confidence: 0.3 };\n}\n\n/** 大块元素加个\"大\"字（首屏区块 → 首屏大区块） */\nfunction addSizeWord(role, wide) {\n  if (!wide || !role || role.includes('大')) return role;\n  for (const tail of ['区块', '内容块', '卡片', '表格', '列表', '表单', '图片区']) {\n    if (role.endsWith(tail)) return role.slice(0, -tail.length) + '大' + tail;\n  }\n  return role;\n}\n\nfunction matchClassHint(classes) {\n  for (const cls of classes) {\n    const c = String(cls).toLowerCase();\n    if (c.startsWith('z-')) continue; // 编辑器自己的类名不算\n    for (const [re, name, kind] of CLASS_HINTS) {\n      if (re.test(`-${c}-`)) return [name, kind];\n    }\n  }\n  return null;\n}\n\nfunction safeGenericName(kind) {\n  switch (kind) {\n    case KIND.CONTAINER: return '一块区域';\n    case KIND.TEXT: return '一段文字';\n    case KIND.HEADING: return '一个标题';\n    case KIND.IMAGE: return '一张图片';\n    case KIND.NAV: return '一块导航';\n    case KIND.LIST: return '一个列表';\n    case KIND.INPUT: return '一个输入项';\n    case KIND.TABLE: return '一张表格';\n    default: return '这一块区域';\n  }\n}\n\n\nfunction iconFor(kind) {\n  return ICON_BY_KIND[kind] ?? ICON_BY_KIND[KIND.OTHER];\n}\n\n/* ------------------------------- 颜色 ------------------------------- */\n\nconst COLOR_PALETTE = { white: [255, 255, 255], black: [17, 24, 39], gray: [107, 114, 128] };\n\n/** 解析 rgb()/rgba()/#hex 成 {r,g,b,a}；解析不了返回 null */\n\nfunction parseColor(input) {\n  const s = String(input ?? '').trim().toLowerCase();\n  if (!s) return null;\n  let m = s.match(/^rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)(?:[,\\s/]+([\\d.%]+))?\\s*\\)$/);\n  if (m) {\n    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);\n    return { r: +m[1], g: +m[2], b: +m[3], a: Number.isFinite(a) ? a : 1 };\n  }\n  m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);\n  if (m) {\n    const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];\n    return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: 1 };\n  }\n  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };\n  return null;\n}\n\nfunction rgbToHsl({ r, g, b }) {\n  const rn = r / 255;\n  const gn = g / 255;\n  const bn = b / 255;\n  const max = Math.max(rn, gn, bn);\n  const min = Math.min(rn, gn, bn);\n  const l = (max + min) / 2;\n  const d = max - min;\n  if (d === 0) return { h: 0, s: 0, l };\n  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);\n  let h;\n  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;\n  else if (max === gn) h = ((bn - rn) / d + 2) * 60;\n  else h = ((rn - gn) / d + 4) * 60;\n  return { h, s, l };\n}\n\n/**\n * 颜色 → 中文色名。返回 null 表示\"这个颜色不值得写进名字\"\n * （接近白/透明/灰的底色说明它没有视觉特征，硬写反而啰嗦）。\n */\n\nfunction colorName(input, { forBackground = false, forText = false } = {}) {\n  const c = parseColor(input);\n  if (!c || c.a < 0.2) return null;\n  const hsl = rgbToHsl(c);\n  // 近黑/近白：无论偏什么色相，人眼都叫它黑/白\n  if (hsl.l < 0.14) return forText ? null : '黑色';\n  if (hsl.l > 0.94) return null; // 纯白/近白\n  if (hsl.s < 0.12) {\n    if (forBackground || forText) return null; // 浅灰底/灰字不值得写进名字\n    return hsl.l < 0.25 ? '黑色' : hsl.l > 0.7 ? '浅灰' : '灰色';\n  }\n  // 正文色大多偏深，写进名字是噪音；只有\"明显上了色\"的文字才值得提\n  if (forText && hsl.l < 0.55 && hsl.s < 0.45) return null;\n  let base;\n  if (hsl.h < 15 || hsl.h >= 345) base = '红色';\n  else if (hsl.h < 40) base = '橙色';\n  else if (hsl.h < 65) base = '黄色';\n  else if (hsl.h < 160) base = '绿色';\n  else if (hsl.h < 200) base = '青色';\n  else if (hsl.h < 250) base = '蓝色';\n  else if (hsl.h < 295) base = '紫色';\n  else base = '粉色';\n  const tone = hsl.l < 0.3 && hsl.s < 0.9 ? '深' : hsl.l > 0.78 ? '浅' : '';\n  return tone ? `${tone}${base}` : base;\n}\n\n/* ------------------------------- 文本 ------------------------------- */\n\n/** 把文本压成一行，去掉多余空白与首尾标点 */\n\nfunction cleanText(input) {\n  return String(input ?? '')\n    .replace(/\\s+/g, ' ')\n    .replace(/^[\\s·、,，。.!！?？:：;；\"'“”‘’\\-–—]+/, '')\n    .replace(/[\\s·、,，。.!！?？:：;；\"'“”‘’\\-–—]+$/, '')\n    .trim();\n}\n\n/**\n * 智能截断：中文按字数，英文尽量按词边界切。\n * 需求建议 8~12 字，这里默认 10。\n */\n\nfunction smartTruncate(input, max = 10) {\n  const s = cleanText(input);\n  if (!s) return '';\n  const chars = Array.from(s);\n  if (chars.length <= max) return s;\n  const head = chars.slice(0, max).join('');\n  // 英文单词被切断时回退到上一个空格\n  if (/[A-Za-z0-9]$/.test(head) && /[A-Za-z0-9]/.test(chars[max] ?? '')) {\n    const cut = head.lastIndexOf(' ');\n    if (cut > max * 0.5) return head.slice(0, cut) + '…';\n  }\n  return head + '…';\n}\n\n/** 这些角色\"自带文本\"，可以直接用；容器/表格类要去内部找一句代表性的话 */\nconst TEXT_OWNING_KINDS = new Set([KIND.HEADING, KIND.TEXT, KIND.LINK, KIND.BUTTON, KIND.LIST_ITEM, KIND.INPUT]);\n\n/* ------------------------------- 命名 ------------------------------- */\n\n/**\n * 纯函数：把\"事实\"组装成人话名。\n * @param {object} facts {tag, classes, kind, role, ownText, insideText, colorText, bgColor, inHeader, inFooter, fallbackText}\n * @param {string} [customName] 用户自定义名（优先级最高）\n */\n\nfunction describeFromFacts(facts, customName = '') {\n  const custom = cleanText(customName);\n  if (custom) {\n    return { name: custom, isCustom: true, role: facts.role ?? '', kind: facts.kind ?? KIND.OTHER };\n  }\n  const { kind } = facts;\n  const parts = [];\n  // 视觉特征：按钮/卡片这类\"看底色\"的元素用背景色；文字/链接只在\"明显上了色\"时才提颜色\n  const useBg = kind === KIND.BUTTON || kind === KIND.CONTAINER || kind === KIND.NAV || kind === KIND.IMAGE || kind === KIND.FORM;\n  const color = useBg\n    ? colorName(facts.bgColor, { forBackground: true })\n    : colorName(facts.colorText, { forText: true });\n  if (color) parts.push(color);\n\n  let text = cleanText(facts.ownText);\n  if (!TEXT_OWNING_KINDS.has(kind)) {\n    // 容器：优先用内部一句代表性的话，否则只在自身文本很短时才用\n    text = cleanText(facts.insideText) || (Array.from(cleanText(facts.ownText)).length <= 24 ? cleanText(facts.ownText) : '');\n  }\n  const short = smartTruncate(text, 10);\n\n  // 主角色名\n  let roleName = addSizeWord(facts.role || safeGenericName(kind), facts.wide);\n  if (kind === KIND.PAGE) roleName = '整个页面';\n  else if (facts.inHeader && kind === KIND.NAV && !/顶部/.test(roleName)) roleName = `顶部${roleName}`;\n  else if (facts.inFooter && !/页脚/.test(roleName)) roleName = `页脚${roleName}`;\n\n  const head = parts.join('') + roleName;\n  const name = short ? `${head}「${short}」` : head;\n  return { name, isCustom: false, role: roleName, kind, text: short };\n}\n\n/** 技术信息：保留但降级（tooltip / 面板次级区） */\n\nfunction technicalInfo({ selectorPath, tag, classes = [], box }) {\n  const cls = classes.length ? `.${classes.join('.')}` : '';\n  const size = box ? ` · ${box.w}×${box.h}px` : '';\n  return `${selectorPath ?? tag}${selectorPath ? '' : cls}${size}`;\n}\n\n/* ------------------------------- chips ------------------------------- */\n\nconst CHIPS_BY_KIND = {\n  [KIND.HEADING]: ['字号大一点', '加粗一点', '换个颜色', '居中对齐', '加点字间距', '缩小一点'],\n  [KIND.TEXT]: ['字号大一点', '行高一点', '换个颜色', '加粗一点', '居中对齐', '缩窄一点'],\n  [KIND.LINK]: ['换个颜色', '加下划线', '去掉下划线', '加粗一点'],\n  [KIND.BUTTON]: ['改文字', '换个颜色', '圆角大一点', '内边距大一点', '加个阴影', '缩小一点'],\n  [KIND.IMAGE]: ['圆角大一点', '加个阴影', '放大一点', '缩小一点', '换成圆形', '灰度处理'],\n  [KIND.ICON]: ['放大一点', '换个颜色', '加个背景', '旋转一下'],\n  [KIND.MEDIA]: ['圆角大一点', '放大一点', '加个阴影', '缩小一点'],\n  [KIND.LIST]: ['行间距大一点', '加个项目符号', '去掉项目符号', '缩进多一点'],\n  [KIND.LIST_ITEM]: ['加粗一点', '行高一点', '加个项目符号', '去掉项目符号'],\n  [KIND.TABLE]: ['加个边框', '行高一点', '字号小一点', '斑马纹', '加大内边距'],\n  [KIND.INPUT]: ['圆角大一点', '加个边框', '内边距大一点', '换个背景色', '加个阴影'],\n  [KIND.NAV]: ['间距大一点', '加个背景色', '加个下边框', '字号小一点', '居中一点'],\n  [KIND.FORM]: ['间距大一点', '加个背景色', '圆角大一点', '加个阴影'],\n  [KIND.CONTAINER]: ['加个阴影', '圆角大一点', '内边距大一点', '换个背景色', '收窄一点', '居中一点'],\n  [KIND.PAGE]: ['换个背景色', '换个字体', '整体字号大一点', '加个内边距'],\n  [KIND.OTHER]: ['换个颜色', '加个背景色', '圆角大一点'],\n};\n\n/** 按元素类型给出快捷指令（每类 ≤ 6 个，宁少勿多） */\n\nfunction chipsFor(kind, { max = 6 } = {}) {\n  const list = CHIPS_BY_KIND[kind] ?? CHIPS_BY_KIND[KIND.OTHER];\n  return list.slice(0, max);\n}\n\n/* ---------------------------- DOM 适配层 ---------------------------- */\n\n/** 取元素\"自己的文本\"（不含大量子元素时的噪音） */\nfunction ownTextOf(el) {\n  if (!el) return '';\n  const text = el.textContent ?? '';\n  return text;\n}\n\n/** 容器类：找内部一句最有代表性的话（表格优先用表头，别把整张表的内容堆上来） */\nfunction insideTextOf(el) {\n  if (!el?.querySelector) return '';\n  for (const sel of ['caption', 'h1', 'h2', 'h3', 'h4', 'th', 'button', 'a', 'strong', 'b', 'p', 'span', 'li', 'td']) {\n    const found = el.querySelector(sel);\n    const t = cleanText(found?.textContent);\n    if (t) return t;\n  }\n  return '';\n}\n\nfunction isInsideTag(el, tags) {\n  let cur = el?.parentElement ?? null;\n  let guard = 0;\n  while (cur && guard++ < 64) {\n    const tag = String(cur.tagName ?? '').toLowerCase();\n    if (tags.includes(tag)) return true;\n    const cls = typeof cur.className === 'string' ? cur.className : '';\n    if (tags.includes('header') && /(^|\\s)(site-header|topbar|navbar|header)(\\s|$)/.test(cls)) return true;\n    if (tags.includes('footer') && /(^|\\s)(site-footer|footer)(\\s|$)/.test(cls)) return true;\n    cur = cur.parentElement;\n  }\n  return false;\n}\n\n/**\n * 唯一的对外入口：element → 人话名。\n * 所有需要展示元素名的地方（弹层、面包屑、右侧面板、AI 上下文）都必须走这里，保证一致。\n *\n * @param {Element} el\n * @param {object} opts { win, names, box, selectorPath }\n * @returns {{name, icon, role, kind, text, isCustom, tooltip}}\n */\n\nfunction describeElement(el, opts = {}) {\n  const { win, names, box, selectorPath } = opts;\n  const tag = String(el?.tagName ?? '').toLowerCase();\n  const classes = (typeof el?.className === 'string' ? el.className : '')\n    .split(/\\s+/)\n    .filter((c) => c && c !== 'picker-selected' && !c.startsWith('z-'));\n\n  let colorText = '';\n  let bgColor = '';\n  try {\n    if (win?.getComputedStyle && el) {\n      const cs = win.getComputedStyle(el);\n      colorText = cs.getPropertyValue('color') || '';\n      bgColor = cs.getPropertyValue('background-color') || '';\n    }\n  } catch {\n    /* 取不到就算了，命名不能因为样式读失败而崩 */\n  }\n\n  const { role, kind } = roleOf(tag, classes);\n  const pid = el?.getAttribute?.('data-pid') ?? null;\n  const customName = pid && names ? names[pid] : '';\n  // \"大块\"判断：宽度超过可视区的 70%（用于\"首屏大区块\"这类名字）\n  let wide = false;\n  try {\n    const vw = win?.innerWidth || win?.document?.documentElement?.clientWidth || 0;\n    if (box && vw) wide = box.w >= vw * 0.7;\n  } catch {\n    wide = false;\n  }\n  const facts = {\n    tag,\n    classes,\n    role,\n    kind,\n    ownText: ownTextOf(el),\n    insideText: insideTextOf(el),\n    colorText,\n    bgColor,\n    wide,\n    inHeader: isInsideTag(el, ['header', 'nav']),\n    inFooter: isInsideTag(el, ['footer']),\n  };\n  const described = describeFromFacts(facts, customName);\n  return {\n    ...described,\n    icon: iconFor(kind),\n    kind,\n    tooltip: technicalInfo({ selectorPath, tag, classes, box }),\n    classes,\n    tag,\n  };\n}\n\n/**\n * 面包屑：把元素链翻成人话，最多 3 级，中间折叠为「…」。\n * （需求 R1.4：层级不超过 3 级）\n */\n\nfunction breadcrumbFromChain(chainNames = [], max = 3) {\n  const list = chainNames.filter(Boolean);\n  if (list.length <= max) return list.join(' › ');\n  return [list[0], '…', ...list.slice(-(max - 2))].join(' › ');\n}\n\n\nexports[\"KIND\"] = exports[\"KIND\"] ?? (typeof KIND !== 'undefined' ? KIND : undefined);\nexports[\"roleOf\"] = exports[\"roleOf\"] ?? (typeof roleOf !== 'undefined' ? roleOf : undefined);\nexports[\"iconFor\"] = exports[\"iconFor\"] ?? (typeof iconFor !== 'undefined' ? iconFor : undefined);\nexports[\"parseColor\"] = exports[\"parseColor\"] ?? (typeof parseColor !== 'undefined' ? parseColor : undefined);\nexports[\"colorName\"] = exports[\"colorName\"] ?? (typeof colorName !== 'undefined' ? colorName : undefined);\nexports[\"cleanText\"] = exports[\"cleanText\"] ?? (typeof cleanText !== 'undefined' ? cleanText : undefined);\nexports[\"smartTruncate\"] = exports[\"smartTruncate\"] ?? (typeof smartTruncate !== 'undefined' ? smartTruncate : undefined);\nexports[\"describeFromFacts\"] = exports[\"describeFromFacts\"] ?? (typeof describeFromFacts !== 'undefined' ? describeFromFacts : undefined);\nexports[\"technicalInfo\"] = exports[\"technicalInfo\"] ?? (typeof technicalInfo !== 'undefined' ? technicalInfo : undefined);\nexports[\"chipsFor\"] = exports[\"chipsFor\"] ?? (typeof chipsFor !== 'undefined' ? chipsFor : undefined);\nexports[\"describeElement\"] = exports[\"describeElement\"] ?? (typeof describeElement !== 'undefined' ? describeElement : undefined);\nexports[\"breadcrumbFromChain\"] = exports[\"breadcrumbFromChain\"] ?? (typeof breadcrumbFromChain !== 'undefined' ? breadcrumbFromChain : undefined);\n\n});\n\n__Z_DEF(\"schema.mjs\", function (exports, __Z_REQ) {\n/**\n * schema.mjs — Patch v1 的纯校验层（不碰 DOM，可被 Node 直接单测）。\n *\n * 为什么把校验独立出来：模型输出的东西永远不能直接相信。\n * 校验通过才允许执行器靠近 DOM；校验失败整单拒绝，一个字符都不动。\n */\nconst { ZError, assert } = __Z_REQ(\"util.mjs\");\n\nconst PATCH_VERSION = 1;\n\nconst MAX_CHANGES = 50;\n\nconst MAX_HTML_BYTES = 60 * 1024;\n\n\nconst OPS = ['setStyle', 'setText', 'setAttr', 'setHtml', 'insertHtml', 'removeNode'];\n\nconst INSERT_POSITIONS = ['before', 'after', 'append', 'prepend'];\n\n/** can-edit 的 CSS 属性白名单：覆盖布局/排版/颜色/装饰/变换，杜绝 position:fixed 之类的越界破坏 */\n\nconst STYLE_WHITELIST = new Set([\n  // 布局\n  'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'float', 'clear', 'box-sizing',\n  'flex', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'justify-content',\n  'align-items', 'align-self', 'align-content', 'gap', 'row-gap', 'column-gap', 'order',\n  'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row', 'grid-auto-flow', 'place-items',\n  'overflow', 'overflow-x', 'overflow-y', 'object-fit', 'object-position', 'aspect-ratio',\n  // 尺寸\n  'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height',\n  // 间距\n  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',\n  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',\n  // 排版\n  'font', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',\n  'word-spacing', 'text-align', 'text-decoration', 'text-transform', 'text-indent', 'text-shadow',\n  'white-space', 'word-break', 'overflow-wrap', 'vertical-align', 'writing-mode', 'text-overflow',\n  'font-variant', 'font-feature-settings', 'text-wrap', 'hyphens',\n  // 颜色与背景\n  'color', 'background', 'background-color', 'background-image', 'background-size', 'background-position',\n  'background-repeat', 'background-clip', 'opacity', 'mix-blend-mode', 'visibility',\n  // 边框与装饰\n  'border', 'border-width', 'border-style', 'border-color', 'border-radius', 'border-top', 'border-right',\n  'border-bottom', 'border-left', 'border-top-width', 'border-right-width', 'border-bottom-width',\n  'border-left-width', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',\n  'outline', 'outline-color', 'outline-offset', 'box-shadow', 'filter', 'backdrop-filter', 'cursor',\n  'list-style', 'list-style-type', 'list-style-position', 'content',\n  // 变换与动画\n  'transform', 'transform-origin', 'transition', 'transition-duration', 'transition-property',\n  'animation', 'animation-name', 'animation-duration', 'animation-delay', 'animation-iteration-count',\n  'animation-timing-function', 'clip-path', 'rotate', 'scale', 'translate',\n]);\n\n/** 禁止 setAttr 的属性：改了就破坏锚点/可撤销性/安全边界 */\n\nconst ATTR_BLACKLIST = new Set(['data-pid', 'style', 'classname']);\n\n\nfunction isForbiddenAttrName(name) {\n  const n = String(name ?? '').trim().toLowerCase();\n  if (!n) return true;\n  if (ATTR_BLACKLIST.has(n)) return true;\n  if (n.startsWith('on')) return true; // 事件处理器：AI 不许挂\n  if (n.startsWith('data-z-')) return true; // 编辑器自身命名空间\n  if (n === 'srcdoc' || n === 'sandbox') return true;\n  return false;\n}\n\n/** 会被\"导航/加载\"用到的属性：值必须过 URL 白名单，否则等于给 AI 开了 XSS 后门 */\nconst URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'poster', 'data', 'srcset']);\nconst SAFE_URL_VALUE = /^(?:https?:|mailto:|tel:|#|\\/|\\.\\/|\\.\\.\\/|data:image\\/)/i;\n\n\nfunction isForbiddenAttrValue(name, value) {\n  const n = String(name ?? '').trim().toLowerCase();\n  const v = String(value ?? '').trim();\n  if (!URL_ATTRS.has(n)) return false;\n  if (!v) return false;\n  if (SAFE_URL_VALUE.test(v)) return false;\n  // srcset 是逗号分隔的候选列表，逐项判断\n  if (n === 'srcset') return v.split(',').some((part) => !SAFE_URL_VALUE.test(part.trim().split(/\\s+/)[0] ?? ''));\n  return true;\n}\n\nfunction isPlainObject(v) {\n  return v != null && typeof v === 'object' && !Array.isArray(v);\n}\n\nfunction fail(message, code = 'E_PATCH_INVALID', detail = null) {\n  throw new ZError(message, code, detail);\n}\n\n/**\n * 结构校验：只检查\"形状\"，不管 DOM 里有没有这个 pid。\n * @returns {{ok:true, patch:object}|never}\n */\n\nfunction validatePatchShape(raw) {\n  if (!isPlainObject(raw)) fail('patch 必须是 JSON 对象', 'E_PATCH_SHAPE');\n  if (raw.version !== undefined && raw.version !== PATCH_VERSION) {\n    fail(`patch.version 只支持 ${PATCH_VERSION}，收到 ${raw.version}`, 'E_PATCH_VERSION');\n  }\n  if (!isPlainObject(raw.changes) && !Array.isArray(raw.changes)) fail('patch.changes 必须是数组', 'E_PATCH_SHAPE');\n  const changes = raw.changes;\n  if (!Array.isArray(changes) || changes.length === 0) fail('patch.changes 不能为空', 'E_PATCH_EMPTY');\n  if (changes.length > MAX_CHANGES) fail(`单次改动上限 ${MAX_CHANGES} 条，收到 ${changes.length} 条（疑似整页重写）`, 'E_PATCH_TOO_MANY');\n\n  const normalized = { version: PATCH_VERSION, target: null, summary: '', changes: [] };\n  if (raw.target !== undefined && raw.target !== null) {\n    if (typeof raw.target !== 'string') fail('patch.target 必须是 pid 字符串', 'E_PATCH_SHAPE');\n    normalized.target = raw.target;\n  }\n  normalized.summary = typeof raw.summary === 'string' ? raw.summary.slice(0, 300) : '';\n  normalized.notes = typeof raw.notes === 'string' ? raw.notes.slice(0, 1000) : '';\n\n  changes.forEach((change, i) => {\n    const at = `changes[${i}]`;\n    if (!isPlainObject(change)) fail(`${at} 必须是对象`, 'E_PATCH_SHAPE');\n    const op = change.op;\n    if (typeof op !== 'string' || !OPS.includes(op)) {\n      fail(`${at}.op 不支持：${JSON.stringify(op)}（只允许 ${OPS.join(' / ')}）`, 'E_PATCH_OP');\n    }\n    const target = change.target;\n    if (typeof target !== 'string' || !target.trim()) fail(`${at}.target 必须是非空 pid 字符串`, 'E_PATCH_TARGET');\n    const out = { op, target: target.trim() };\n\n    switch (op) {\n      case 'setText': {\n        if (typeof change.value !== 'string') fail(`${at}.value 必须是字符串`, 'E_PATCH_SHAPE');\n        out.value = change.value;\n        break;\n      }\n      case 'setAttr': {\n        const name = change.name ?? change.attr;\n        if (typeof name !== 'string' || !name.trim()) fail(`${at}.name 必须是非空字符串`, 'E_PATCH_SHAPE');\n        if (isForbiddenAttrName(name)) {\n          fail(`${at}.name 被禁止：${name}（pid / on* 事件 / style / class 之外的安全边界）`, 'E_PATCH_ATTR_FORBIDDEN');\n        }\n        out.name = name.trim();\n        if (!('value' in change)) fail(`${at}.value 缺失（删除属性请显式写 null）`, 'E_PATCH_SHAPE');\n        if (change.value !== null && typeof change.value !== 'string' && typeof change.value !== 'number' && typeof change.value !== 'boolean') {\n          fail(`${at}.value 只能是字符串/数字/布尔/null`, 'E_PATCH_SHAPE');\n        }\n        out.value = change.value === null ? null : String(change.value);\n        // 属性名合法不代表值合法：href=\"javascript:…\" 这类必须在这里拦掉\n        if (out.value !== null && isForbiddenAttrValue(out.name, out.value)) {\n          fail(`${at}.value 被拒绝：${out.name} 不允许指向 ${String(out.value).slice(0, 60)}（URL 白名单外）`, 'E_PATCH_ATTR_VALUE');\n        }\n        break;\n      }\n      case 'setStyle': {\n        const prop = String(change.prop ?? change.property ?? '').trim().toLowerCase();\n        if (!prop) fail(`${at}.prop 必须是非空字符串`, 'E_PATCH_SHAPE');\n        if (!STYLE_WHITELIST.has(prop)) fail(`${at}.prop 不在白名单：${prop}`, 'E_PATCH_STYLE_FORBIDDEN');\n        if (change.value === null || change.value === undefined) {\n          out.prop = prop;\n          out.value = null; // 显式删除该行内样式\n          break;\n        }\n        if (typeof change.value !== 'string' && typeof change.value !== 'number') {\n          fail(`${at}.value 必须是字符串/数字（删除请写 null）`, 'E_PATCH_SHAPE');\n        }\n        const rawValue = String(change.value);\n        if (/[;{}]/.test(rawValue)) fail(`${at}.value 不允许包含 ; { }（一次只改一个属性）`, 'E_PATCH_STYLE_VALUE');\n        if (/url\\s*\\(\\s*['\"]?\\s*javascript:/i.test(rawValue)) fail(`${at}.value 含危险 url()`, 'E_PATCH_STYLE_VALUE');\n        const m = rawValue.match(/\\s*!\\s*important\\s*$/i);\n        out.prop = prop;\n        out.value = m ? rawValue.slice(0, m.index).trim() : rawValue.trim();\n        out.priority = m ? 'important' : '';\n        if (!out.value) fail(`${at}.value 为空`, 'E_PATCH_SHAPE');\n        break;\n      }\n      case 'setHtml': {\n        if (typeof change.html !== 'string') fail(`${at}.html 必须是字符串`, 'E_PATCH_SHAPE');\n        if (change.html.length > MAX_HTML_BYTES) fail(`${at}.html 超过 ${MAX_HTML_BYTES} 字符上限`, 'E_PATCH_TOO_BIG');\n        out.html = change.html;\n        break;\n      }\n      case 'insertHtml': {\n        if (typeof change.html !== 'string' || !change.html.trim()) fail(`${at}.html 必须是非空字符串`, 'E_PATCH_SHAPE');\n        if (change.html.length > MAX_HTML_BYTES) fail(`${at}.html 超过 ${MAX_HTML_BYTES} 字符上限`, 'E_PATCH_TOO_BIG');\n        const pos = String(change.position ?? change.pos ?? 'after').toLowerCase();\n        if (!INSERT_POSITIONS.includes(pos)) fail(`${at}.position 只能是 ${INSERT_POSITIONS.join(' / ')}`, 'E_PATCH_SHAPE');\n        out.position = pos;\n        out.html = change.html;\n        break;\n      }\n      case 'removeNode':\n        break;\n      default:\n        fail(`${at}.op 不支持`, 'E_PATCH_OP');\n    }\n    normalized.changes.push(out);\n  });\n\n  return { ok: true, patch: normalized };\n}\n\n/**\n * 范围校验：每条改动的 target 必须落在 scope 内（含 scope 自身）。\n * @param {object} patch 已通过 shape 校验\n * @param {(pid:string)=>boolean} isWithin 由调用方提供的锚点校验函数\n */\n\nfunction validatePatchScope(patch, isWithin) {\n  for (const c of patch.changes) {\n    if (!isWithin(c.target)) {\n      fail(\n        `改动越界：${c.op} 想改 ${c.target}，但它不在当前选中元素范围内（AI 只被允许改选中的这一块）`,\n        'E_PATCH_OUT_OF_SCOPE',\n        c,\n      );\n    }\n  }\n  return true;\n}\n\n/** 一步到位：形状 + 范围。isWithin 可省略（省略时只校验形状）。 */\n\nfunction validatePatch(raw, isWithin) {\n  const { patch } = validatePatchShape(raw);\n  if (typeof isWithin === 'function') validatePatchScope(patch, isWithin);\n  return patch;\n}\n\n/** 供 UI 显示：把 patch 压成一行人话 */\n\nfunction summarizePatch(patch) {\n  if (!patch) return '';\n  if (patch.summary) return patch.summary;\n  const parts = (patch.changes ?? []).slice(0, 3).map((c) => {\n    switch (c.op) {\n      case 'setStyle':\n        return `${c.prop}: ${c.value ?? '删除'}`;\n      case 'setText':\n        return `文本“${String(c.value).slice(0, 12)}”`;\n      case 'setAttr':\n        return `${c.name}=${c.value === null ? '删除' : String(c.value).slice(0, 12)}`;\n      case 'setHtml':\n        return '换内部 HTML';\n      case 'insertHtml':\n        return `${c.position} 插入`;\n      case 'removeNode':\n        return '删除元素';\n      default:\n        return c.op;\n    }\n  });\n  const more = (patch.changes?.length ?? 0) - parts.length;\n  return parts.join('、') + (more > 0 ? ` 等 ${patch.changes.length} 处` : '');\n}\n\n/** 统计本次改动\"碰了什么\"（版本列表与日志用） */\n\nfunction patchStats(patch) {\n  const stats = { total: 0, byOp: {}, targets: new Set() };\n  for (const c of patch?.changes ?? []) {\n    stats.total++;\n    stats.byOp[c.op] = (stats.byOp[c.op] ?? 0) + 1;\n    stats.targets.add(c.target);\n  }\n  return { ...stats, targets: [...stats.targets] };\n}\n\n\nexports[\"PATCH_VERSION\"] = exports[\"PATCH_VERSION\"] ?? (typeof PATCH_VERSION !== 'undefined' ? PATCH_VERSION : undefined);\nexports[\"MAX_CHANGES\"] = exports[\"MAX_CHANGES\"] ?? (typeof MAX_CHANGES !== 'undefined' ? MAX_CHANGES : undefined);\nexports[\"MAX_HTML_BYTES\"] = exports[\"MAX_HTML_BYTES\"] ?? (typeof MAX_HTML_BYTES !== 'undefined' ? MAX_HTML_BYTES : undefined);\nexports[\"OPS\"] = exports[\"OPS\"] ?? (typeof OPS !== 'undefined' ? OPS : undefined);\nexports[\"INSERT_POSITIONS\"] = exports[\"INSERT_POSITIONS\"] ?? (typeof INSERT_POSITIONS !== 'undefined' ? INSERT_POSITIONS : undefined);\nexports[\"STYLE_WHITELIST\"] = exports[\"STYLE_WHITELIST\"] ?? (typeof STYLE_WHITELIST !== 'undefined' ? STYLE_WHITELIST : undefined);\nexports[\"ATTR_BLACKLIST\"] = exports[\"ATTR_BLACKLIST\"] ?? (typeof ATTR_BLACKLIST !== 'undefined' ? ATTR_BLACKLIST : undefined);\nexports[\"isForbiddenAttrName\"] = exports[\"isForbiddenAttrName\"] ?? (typeof isForbiddenAttrName !== 'undefined' ? isForbiddenAttrName : undefined);\nexports[\"isForbiddenAttrValue\"] = exports[\"isForbiddenAttrValue\"] ?? (typeof isForbiddenAttrValue !== 'undefined' ? isForbiddenAttrValue : undefined);\nexports[\"validatePatchShape\"] = exports[\"validatePatchShape\"] ?? (typeof validatePatchShape !== 'undefined' ? validatePatchShape : undefined);\nexports[\"validatePatchScope\"] = exports[\"validatePatchScope\"] ?? (typeof validatePatchScope !== 'undefined' ? validatePatchScope : undefined);\nexports[\"validatePatch\"] = exports[\"validatePatch\"] ?? (typeof validatePatch !== 'undefined' ? validatePatch : undefined);\nexports[\"summarizePatch\"] = exports[\"summarizePatch\"] ?? (typeof summarizePatch !== 'undefined' ? summarizePatch : undefined);\nexports[\"patchStats\"] = exports[\"patchStats\"] ?? (typeof patchStats !== 'undefined' ? patchStats : undefined);\n\n});\n\n__Z_DEF(\"anchor.mjs\", function (exports, __Z_REQ) {\n/**\n * anchor.mjs — data-pid 稳定锚点。\n *\n * 设计要点（见 CONTRACT.md §2）：\n *  - pid 由\"祖先路径 + 同级序号\"哈希而来，因此**同一份 HTML 每次得到同一套 pid**。\n *    这一点很关键：模型说\"把 p-1a2b3c4d 变大\"，下次打开还能指同一个元素。\n *  - 只在确实需要时写 DOM：injectAll 一次性注入，ensure 兜底。\n *  - pid 只能由本模块产生；patch 执行器禁止任何人改写/删除 data-pid。\n */\nconst { stableId } = __Z_REQ(\"util.mjs\");\nconst PID_ATTR = 'data-pid';\n\n/** 元素在父节点中的\"同类元素\"序号，保证路径唯一。 */\nfunction siblingIndexOf(el) {\n  if (!el || !el.parentElement) return 0;\n  const tag = el.tagName;\n  let index = 0;\n  for (const child of el.parentElement.children) {\n    if (child === el) break;\n    if (child.tagName === tag) index++;\n  }\n  return index;\n}\n\n/** 通往 root 的结构化路径：div:0>main:0>h1:1 */\n\nfunction pathKey(el) {\n  const parts = [];\n  let cur = el;\n  let guard = 0;\n  while (cur && cur.nodeType === 1 && guard++ < 256) {\n    parts.unshift(`${cur.tagName.toLowerCase()}:${siblingIndexOf(cur)}`);\n    cur = cur.parentElement;\n  }\n  return parts.join('>');\n}\n\n/** 给单个元素算 pid（不写 DOM）。 */\n\nfunction computePid(el) {\n  return stableId(pathKey(el));\n}\n\n\nclass AnchorManager {\n  constructor(doc) {\n    this.doc = doc;\n    this.seen = new Set();\n    this.collisions = 0;\n  }\n\n  /** 重新扫描已有 pid（回填 seen，防止重复注入）。 */\n  rescan() {\n    this.seen = new Set();\n    for (const el of this.doc.querySelectorAll(`[${PID_ATTR}]`)) {\n      const pid = el.getAttribute(PID_ATTR);\n      if (pid) this.seen.add(pid);\n    }\n    return this.seen.size;\n  }\n\n  /**\n   * 确保一个元素有 pid，返回 pid。\n   *\n   * 冲突判定的要点：只有\"确实还活在文档里的元素\"才算冲突。\n   * 撤销会把整棵子树从 DOM 里换掉，那些已消失元素的 pid 不能继续占用名额，\n   * 否则同一个元素还原后会拿到 p-xxx-1 这种漂移 pid——锚点一漂，\"还在说同一个元素\"就不成立了。\n   */\n  ensure(el) {\n    if (!el || el.nodeType !== 1) return null;\n    const existing = el.getAttribute?.(PID_ATTR);\n    if (existing) {\n      this.seen.add(existing);\n      return existing;\n    }\n    const isLiveConflict = (pid) => {\n      if (!this.seen.has(pid)) return false;\n      const holder = this.doc.querySelector(`[${PID_ATTR}=\"${pid}\"]`);\n      return !!holder && holder !== el;\n    };\n    let pid = computePid(el);\n    if (this.doc.querySelector(`[${PID_ATTR}=\"${pid}\"]`)) {\n      let n = 1;\n      let candidate = `${pid}-${n}`;\n      while (this.doc.querySelector(`[${PID_ATTR}=\"${candidate}\"]`)) {\n        n++;\n        candidate = `${pid}-${n}`;\n      }\n      pid = candidate;\n      this.collisions++;\n    } else if (isLiveConflict(pid)) {\n      let n = 1;\n      let candidate = `${pid}-${n}`;\n      while (isLiveConflict(candidate) || this.doc.querySelector(`[${PID_ATTR}=\"${candidate}\"]`)) {\n        n++;\n        candidate = `${pid}-${n}`;\n      }\n      pid = candidate;\n      this.collisions++;\n    }\n    el.setAttribute(PID_ATTR, pid);\n    this.seen.add(pid);\n    return pid;\n  }\n\n  /** 全量注入：从 documentElement 起的所有元素都拿到 pid。 */\n  injectAll(root = this.doc.documentElement) {\n    if (!root) return { injected: 0, total: 0 };\n    const all = [root, ...root.querySelectorAll('*')].filter((el) => el.nodeType === 1);\n    let injected = 0;\n    for (const el of all) {\n      if (!el.getAttribute(PID_ATTR)) injected++;\n      this.ensure(el);\n    }\n    // 用户 HTML 自己可能就带着重复的 data-pid（复制粘贴、模板残留）。\n    // 不修的话 resolve() 永远命中第一个，另一个元素永远改不到 —— 这里统一修成唯一。\n    const fixed = this.ensureUniquePids(root);\n    this.rescan();\n    return { injected, total: this.seen.size, duplicatesFixed: fixed };\n  }\n\n  /**\n   * 把子树里所有重复的 pid 重新分配成唯一值。返回修复个数。\n   * 以\"文档顺序里第一个持有者\"为合法所有者，后面的重发新号。\n   */\n  ensureUniquePids(root = this.doc.documentElement) {\n    if (!root) return 0;\n    const seen = new Set();\n    let fixed = 0;\n    const all = root.nodeType === 1 ? [root, ...root.querySelectorAll(`[${PID_ATTR}]`)] : [];\n    for (const el of all) {\n      const pid = el.getAttribute?.(PID_ATTR);\n      if (!pid) continue;\n      if (!seen.has(pid)) {\n        seen.add(pid);\n        this.seen.add(pid);\n        continue;\n      }\n      // 重复：按当前结构重算，直到拿到一个没被占用的\n      let candidate = computePid(el);\n      let n = 1;\n      while (seen.has(candidate) || this.doc.querySelector(`[${PID_ATTR}=\"${cssEscape(candidate)}\"]`)) {\n        candidate = `${computePid(el)}-${n++}`;\n      }\n      el.setAttribute(PID_ATTR, candidate);\n      seen.add(candidate);\n      this.seen.add(candidate);\n      this.collisions++;\n      fixed++;\n    }\n    return fixed;\n  }\n\n  /** pid → 元素；找不到返回 null（模型引用了不存在的 pid 时用它报错）。 */\n  resolve(pid) {\n    if (!pid) return null;\n    return this.doc.querySelector(`[${PID_ATTR}=\"${cssEscape(String(pid))}\"]`);\n  }\n\n  pidOf(el) {\n    return el?.getAttribute?.(PID_ATTR) ?? null;\n  }\n\n  /** 从元素到根的祖先链（含自身，从外到内）。 */\n  chainOf(el, limit = 12) {\n    const chain = [];\n    let cur = el;\n    while (cur && cur.nodeType === 1 && chain.length < limit) {\n      chain.push(cur);\n      cur = cur.parentElement;\n    }\n    return chain.reverse();\n  }\n\n  /** pid 是否在 scope 之内（含 scope 自身）。patch 范围硬校验用。 */\n  isWithin(pid, scopeEl) {\n    const el = this.resolve(pid);\n    if (!el || !scopeEl) return false;\n    return el === scopeEl || scopeEl.contains(el);\n  }\n\n  /** 给 scope 子树里所有元素补 pid（setHtml / insertHtml 之后必须调用）。 */\n  injectSubtree(scopeEl) {\n    if (!scopeEl) return 0;\n    let injected = 0;\n    const list = [scopeEl, ...scopeEl.querySelectorAll('*')];\n    for (const el of list) {\n      if (!el.getAttribute(PID_ATTR)) {\n        this.ensure(el);\n        injected++;\n      } else {\n        this.seen.add(el.getAttribute(PID_ATTR));\n      }\n    }\n    return injected;\n  }\n\n  /** 剥掉所有 pid（导出干净 HTML 用）。 */\n  stripAll(root = this.doc.documentElement) {\n    if (!root) return 0;\n    let stripped = 0;\n    const list = root.nodeType === 1 ? [root, ...root.querySelectorAll(`[${PID_ATTR}]`)] : [];\n    for (const el of list) {\n      if (el.hasAttribute?.(PID_ATTR)) {\n        el.removeAttribute(PID_ATTR);\n        stripped++;\n      }\n    }\n    return stripped;\n  }\n}\n\n/** CSS 属性选择器里转义值（pid 只含 [a-z0-9-]，但防御性写全） */\n\nfunction cssEscape(value) {\n  if (typeof CSS !== 'undefined' && CSS?.escape) return CSS.escape(value);\n  return String(value).replace(/[\"\\\\\\]]/g, '\\\\$&');\n}\n\n/** 人类可读的祖先链：body > main > section.hero > h1#title */\n\nfunction selectorPath(el) {\n  const parts = [];\n  let cur = el;\n  let guard = 0;\n  while (cur && cur.nodeType === 1 && guard++ < 64) {\n    let part = cur.tagName.toLowerCase();\n    if (cur.id) part += `#${cur.id}`;\n    else if (typeof cur.className === 'string' && cur.className.trim()) {\n      const cls = cur.className.trim().split(/\\s+/).filter((c) => c && c !== 'picker-selected').slice(0, 2);\n      if (cls.length) part += `.${cls.join('.')}`;\n    }\n    parts.unshift(part);\n    cur = cur.parentElement;\n  }\n  return parts.join(' > ');\n}\n\nObject.assign(exports, {\"PID_ATTR\": PID_ATTR});\n\n\nexports[\"pathKey\"] = exports[\"pathKey\"] ?? (typeof pathKey !== 'undefined' ? pathKey : undefined);\nexports[\"computePid\"] = exports[\"computePid\"] ?? (typeof computePid !== 'undefined' ? computePid : undefined);\nexports[\"AnchorManager\"] = exports[\"AnchorManager\"] ?? (typeof AnchorManager !== 'undefined' ? AnchorManager : undefined);\nexports[\"cssEscape\"] = exports[\"cssEscape\"] ?? (typeof cssEscape !== 'undefined' ? cssEscape : undefined);\nexports[\"selectorPath\"] = exports[\"selectorPath\"] ?? (typeof selectorPath !== 'undefined' ? selectorPath : undefined);\nexports[\"PID_ATTR\"] = exports[\"PID_ATTR\"] ?? (typeof PID_ATTR !== 'undefined' ? PID_ATTR : undefined);\n\n});\n\n__Z_DEF(\"patch.mjs\", function (exports, __Z_REQ) {\n/**\n * patch.mjs — 结构化 patch 的 DOM 执行器（唯一允许改用户 DOM 的地方）。\n *\n * 三条铁律：\n *  1. 先全量校验，再动手。任一条不合法 → 抛错，DOM 零改动。\n *  2. 只改 scope（选中元素及其子树）内部，pid 一律不改写、不删除。\n *  3. 每个操作都产出可精确回滚的\"逆条目\"；undo 逆序执行，回到改动前。\n *\n * 逆条目用\"受影响子树快照\"实现，而不是零碎地记旧值——因为一个 setText\n * 可能被另一个 setHtml 覆盖，零碎回滚顺序一错就还原不干净。\n */\nconst { AnchorManager, PID_ATTR } = __Z_REQ(\"anchor.mjs\");\nconst { validatePatchShape, validatePatchScope } = __Z_REQ(\"schema.mjs\");\nconst { ZError, uid } = __Z_REQ(\"util.mjs\");\nconst DANGEROUS_TAGS = new Set(['SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE', 'FORM', 'STYLE']);\nconst SAFE_URL = /^(?:https?:|mailto:|tel:|#|\\/|\\.\\/|\\.\\.\\/|data:image\\/)/i;\n\n/** 判断某个属性名是否属于\"编辑器自身\"（高亮/预览标记），导出与快照前会剥掉。 */\n\nfunction isEditorArtifactAttr(name) {\n  const n = String(name ?? '').toLowerCase();\n  return n.startsWith('data-z-') || n === 'data-pid' || n === 'contenteditable';\n}\n\n/**\n * 清洗模型给的 HTML 片段：去掉脚本、内联事件、危险 URL。\n * 这是\"AI 不许乱塞东西\"的最后一道闸。\n */\n\nfunction sanitizeHtmlFragment(doc, html) {\n  const tpl = doc.createElement('template');\n  tpl.innerHTML = String(html ?? '');\n  const walk = (node) => {\n    for (const child of [...node.children]) {\n      if (DANGEROUS_TAGS.has(child.tagName)) {\n        child.remove();\n        continue;\n      }\n      for (const attr of [...child.attributes]) {\n        const name = attr.name.toLowerCase();\n        const value = String(attr.value ?? '');\n        if (name.startsWith('on') || name === 'srcdoc' || name === 'sandbox') {\n          child.removeAttribute(attr.name);\n          continue;\n        }\n        // 编辑器私有命名空间：剥离属性即可。\n        // 不能留着 —— 导出时的 scrubEditorArtifacts 会把带 data-z-* 的元素**整块删掉**，\n        // 那样用户明明看到并\"接受\"的内容会在快照里凭空消失。\n        if (name.startsWith('data-z-')) {\n          child.removeAttribute(attr.name);\n          continue;\n        }\n        if ((name === 'href' || name === 'src' || name === 'xlink:href' || name === 'action' || name === 'formaction' || name === 'poster') && !SAFE_URL.test(value.trim())) {\n          child.removeAttribute(attr.name);\n          continue;\n        }\n        if (name === 'style' && /javascript\\s*:|expression\\s*\\(/i.test(value)) child.removeAttribute(attr.name);\n        if (name === PID_ATTR) child.removeAttribute(attr.name); // 由锚点管理器重新分配\n      }\n      walk(child);\n    }\n  };\n  walk(tpl.content);\n  return tpl.innerHTML;\n}\n\nfunction findByPid(doc, anchor, pid) {\n  const el = anchor.resolve(pid) ?? doc.querySelector(`[${PID_ATTR}=\"${pid}\"]`);\n  if (!el) throw new ZError(`找不到 pid=${pid} 对应的元素（可能已被删除）`, 'E_PATCH_TARGET_MISSING', { pid });\n  return el;\n}\n\n/**\n * 子树快照。\n * 关键：快照里**必须剥掉 data-pid**。否则撤销时把快照写回去，\n * 同一棵子树就会出现两个相同 pid 的元素（新生成的 + 快照里带回来的），\n * 之后 resolve(pid) 可能命中错的那个——锚点唯一的保证就此破功。\n * 剥掉之后由 injectSubtree 重新分配，因为 pid 是按结构哈希的，重算结果与原来一致。\n */\nfunction snapshotTree(anchor, el) {\n  const attrs = {};\n  for (const a of [...el.attributes]) {\n    if (a.name === PID_ATTR) continue;\n    attrs[a.name] = a.value;\n  }\n  return {\n    pid: anchor.pidOf(el),\n    html: el.innerHTML,\n    outer: el.outerHTML,\n    attrs,\n    style: el.hasAttribute('style') ? el.getAttribute('style') : null,\n  };\n}\n\n/**\n * 注意：这里**不再用正则**去\"删除 HTML 文本里的 data-pid\"。\n * 早期版本用 / data-pid=…/ 全局替换，会连正文里出现的 \" data-pid=…\" 一起吃掉，\n * 造成撤销时永久丢字。pid 的清理一律走 DOM 遍历（见 restoreElement），只动属性不动文本。\n */\n\n/**\n * 从一棵 documentElement 克隆里剥掉\"编辑器留下的痕迹\"，得到可以交付/入快照的干净 HTML。\n *\n * 抽成纯函数是为了能被单测：这里出错的后果很隐蔽——\n * 编辑器注入的 bootstrap <script> 会被写进每一个快照和导出文件里，\n * 页面上看不出来，但用户拿到的\"成品\"里全是编辑器代码。\n */\n\nfunction scrubEditorArtifacts(clone, doctypeName = 'html') {\n  const all = [clone, ...clone.querySelectorAll('*')];\n  for (const el of all) {\n    if (el.nodeType !== 1) continue;\n    // 1) 编辑器注入的节点：bootstrap 脚本、未来的 chrome 节点\n    if (el.hasAttribute('data-z-inject') || el.hasAttribute('data-z-chrome')) {\n      el.remove();\n      continue;\n    }\n    // 2) 任何带编辑器特征的 <script> 都不能进导出\n    if (el.tagName === 'SCRIPT') {\n      const body = el.textContent ?? '';\n      if (el.hasAttribute('data-z-inject') || /__zToken|__zBridge|zhidaiqi/i.test(body)) {\n        el.remove();\n        continue;\n      }\n    }\n    // 3) 锚点、编辑器私有属性、预览/选中类\n    if (el.hasAttribute('data-pid')) el.removeAttribute('data-pid');\n    for (const attr of [...(el.attributes ?? [])]) {\n      if (attr.name.startsWith('data-z-')) el.removeAttribute(attr.name);\n    }\n    if (typeof el.className === 'string') el.classList.remove('picker-selected', 'z-preview-flash', 'z-ai-touched');\n  }\n  const doctype = doctypeName ? `<!DOCTYPE ${doctypeName}>\\n` : '<!DOCTYPE html>\\n';\n  return doctype + clone.outerHTML;\n}\n\nfunction record(anchor, el, op, extra = {}) {\n  return { op, snapshots: [snapshotTree(anchor, el)], pids: [anchor.pidOf(el)], ...extra };\n}\n\n/**\n * 把一棵子树还原成快照的样子：**属性 + 内容**都还原。\n * 只回填 innerHTML 是不够的——setStyle 改的是元素自身的 style 属性，\n * 用 innerHTML 还原根本碰不到它，撤销后样式会残留在页面上。\n */\nfunction restoreElement(anchor, el, snap) {\n  if (!snap) return;\n  // 还原内容，然后把子树里残留的 pid 属性摘掉（DOM 遍历，不碰文本），再按快照恢复属性\n  el.innerHTML = snap.html ?? '';\n  for (const stale of el.querySelectorAll(`[${PID_ATTR}]`)) stale.removeAttribute(PID_ATTR);\n  if (el.hasAttribute(PID_ATTR)) el.removeAttribute(PID_ATTR);\n  if (snap.attrs) {\n    for (const name of [...el.attributes].map((a) => a.name)) {\n      if (name !== PID_ATTR && !(name in snap.attrs)) el.removeAttribute(name);\n    }\n    for (const [name, value] of Object.entries(snap.attrs)) {\n      if (name === PID_ATTR) continue;\n      el.setAttribute(name, value);\n    }\n    if (snap.style != null) el.setAttribute('style', snap.style);\n    else el.removeAttribute('style');\n  }\n  // 锚点用**快照里记录的 pid 原样恢复**，不能靠 ensure() 按当前结构重算。\n  // 原因：撤销前可能发生过 insertHtml/removeNode 改动过兄弟序号，\n  // 此时当前结构算出来的 hash 与元素原本的 pid 不同 —— 重算就等于锚点漂移，\n  // 模型与历史里持有的 pid 会变成野指针。快照里的 pid 就是权威值。\n  if (snap.pid) el.setAttribute(PID_ATTR, snap.pid);\n  anchor.seen.add(snap.pid ?? '');\n  anchor.injectSubtree(el); // 只给新出现的、还没有 pid 的后代补号\n  anchor.ensureUniquePids(el);\n}\n\n/** 撤销一堆条目后做一次体检：任何重复 pid 都要重新分配，保证 resolve 不歧义 */\nfunction sanitizeAnchors(anchor, scopeEl = null) {\n  const target = scopeEl ?? anchor.doc.documentElement;\n  if (target) anchor.ensureUniquePids(target);\n}\n\nfunction restoreSnapshots(anchor, entry) {\n  for (const snap of entry.snapshots) {\n    const el = anchor.resolve(snap.pid);\n    if (!el) continue;\n    restoreElement(anchor, el, snap);\n  }\n}\n\n/**\n * 撤销 insertHtml：把当初插入的那几个节点**精确摘掉**（含文本节点）。\n *\n * 为什么不重写父节点 innerHTML 兜底：那会把父节点下所有兄弟都重新解析一遍，\n * 兄弟的锚点会被重建（可能漂移），而\"取消一次插入\"本不该影响任何兄弟。\n */\nfunction removeInsertedNodes(entry) {\n  const nodes = Array.isArray(entry.nodes) ? entry.nodes : [];\n  const parent = nodes[0]?.parentNode ?? null;\n  if (!parent) return; // 已经被别的操作连带删掉了，无需处理\n\n  let removedAll = true;\n  for (const node of nodes) {\n    if (node.parentNode === parent) {\n      try {\n        parent.removeChild(node);\n      } catch {\n        removedAll = false;\n      }\n    } else {\n      removedAll = false;\n    }\n  }\n  if (removedAll) return;\n\n  // 有节点被挪走了：按当初记录的连续区段再摘一次\n  const kids = [...parent.childNodes];\n  const start = typeof entry.startIndex === 'number' ? entry.startIndex : kids.indexOf(nodes[0]);\n  if (start >= 0) {\n    const slice = kids.slice(start, start + nodes.length);\n    if (slice.length === nodes.length && slice.every((n, i) => n === nodes[i])) {\n      for (const n of slice) parent.removeChild(n);\n    }\n  }\n}\n\n/**\n * 应用 patch。\n * @param {Document} doc\n * @param {Element} scopeEl 选中的元素（范围边界）\n * @param {object} rawPatch 模型输出\n * @returns {{applied:Array, inverse:Array, anchor:AnchorManager, patch:object}}\n */\n\nfunction applyPatch(doc, scopeEl, rawPatch) {\n  if (!scopeEl) throw new ZError('没有选中元素，无法应用改动', 'E_NO_SELECTION');\n  const anchor = new AnchorManager(doc);\n  anchor.rescan();\n  anchor.ensure(scopeEl);\n  // 关键：不要在整轮操作里信任外部传入的元素引用。\n  // 撤销/还原会让旧引用变成悬空节点（DOM 里已经是另一个对象了），\n  // 一旦引用悬空，范围判断就会误判。所以先把 scope 固化成 pid，之后一律按 pid 解析。\n  const scopePid = anchor.pidOf(scopeEl);\n  if (!scopePid) throw new ZError('选中元素缺少 data-pid 锚点，请重新选中', 'E_NO_ANCHOR');\n  const resolveScope = () => anchor.resolve(scopePid) ?? (scopeEl.isConnected === false ? null : scopeEl);\n\n  const { patch } = validatePatchShape(rawPatch);\n  validatePatchScope(patch, (pid) => {\n    const scope = resolveScope();\n    return !!scope && (pid === scopePid || anchor.isWithin(pid, scope));\n  });\n\n  const applied = [];\n  const inverse = [];\n\n  // 事务性保证：任何一条改动不合法，DOM 必须回到**本次调用之前**。\n  // 前半段（形状/范围校验）在动手前就抛，天然零改动；\n  // 但 apply 过程中仍可能出错（例如前面的 removeNode 删掉了后续要改的节点），\n  // 这时必须逆序回滚已应用的改动，否则会留下\"改了一半\"的页面。\n  try {\n    for (const change of patch.changes) {\n      const el = findByPid(doc, anchor, change.target);\n      const scope = resolveScope();\n      // scope 为 null ⇒ 本 patch 已经把选中元素自己删掉了（removeNode target=scope）。\n      // 此时剩下能解析到的节点都不再属于选区，明确报\"越界\"而不是抛内部错误。\n      if (!scope) {\n        throw new ZError(\n          `改动越界：选中元素在本次改动中已被删除，无法继续改 ${change.target}`,\n          'E_PATCH_OUT_OF_SCOPE',\n          change,\n        );\n      }\n      if (el !== scope && !scope.contains(el)) {\n        throw new ZError(`改动越界：${change.target} 不在 ${scopePid} 之内`, 'E_PATCH_OUT_OF_SCOPE', change);\n      }\n      switch (change.op) {\n        case 'setText':\n        inverse.push(record(anchor, el, 'setText'));\n        el.textContent = change.value;\n        applied.push(change);\n        break;\n      case 'setAttr':\n        inverse.push(record(anchor, el, 'setAttr'));\n        if (change.value === null) el.removeAttribute(change.name);\n        else el.setAttribute(change.name, change.value);\n        applied.push(change);\n        break;\n      case 'setStyle':\n        inverse.push(record(anchor, el, 'setStyle'));\n        if (change.value === null) el.style.removeProperty(change.prop);\n        else el.style.setProperty(change.prop, change.value, change.priority ?? '');\n        applied.push(change);\n        break;\n      case 'setHtml':\n        inverse.push(record(anchor, el, 'setHtml'));\n        el.innerHTML = sanitizeHtmlFragment(doc, change.html);\n        anchor.injectSubtree(el);\n        applied.push(change);\n        break;\n      case 'insertHtml': {\n        const clean = sanitizeHtmlFragment(doc, change.html);\n        const holder = doc.createElement('div');\n        holder.innerHTML = clean;\n        const newNodes = [...holder.childNodes];\n        if (!newNodes.length) break; // 清洗之后什么都不剩，不必改动 DOM\n        const parent = change.position === 'before' || change.position === 'after' ? el.parentNode : el;\n        if (!parent) throw new ZError('插入位置不存在（元素没有父节点）', 'E_PATCH_INSERT_TARGET');\n\n        // 范围硬约束：插入**结果**必须落在选区里，只留一个合情理的例外。\n        //   - append/prepend：插到 target 内部，target 已被范围校验覆盖，天然在选区内；\n        //   - before/after：插成 target 的兄弟。允许的条件是二者之一：\n        //       a) 插入点的父节点在 scope 内（scope 自身或其后代）——插进选区内部；\n        //       b) target 就是选中元素本身，且插入点父节点 = 该元素的父节点——\"在这块旁边加东西\"（用户诉求）。\n        //     其余情况（例如选中卡片里的 <h3> 却把节点插到卡片外层）都是插到选区之外 → 整单拒绝。\n        if (change.position === 'before' || change.position === 'after') {\n          const scope = resolveScope();\n          const insertParent = el.parentNode;\n          // 落点在选区内 ⇔ 插入点的父节点就是 scope，或它是 scope 的祖先（ancestor.contains(scope)）。\n          const insideScope =\n            !!scope &&\n            insertParent != null &&\n            (insertParent === scope || (typeof insertParent.contains === 'function' && insertParent.contains(scope)));\n          const besideSelection = !!scope && el === scope && insertParent != null && insertParent === scope.parentNode;\n          if (!insideScope && !besideSelection) {\n            throw new ZError(\n              `改动越界：insertHtml(${change.position}) 会把内容插到选中元素之外（插入点 ${anchor.pidOf(insertParent) ?? '未知'}）`,\n              'E_PATCH_OUT_OF_SCOPE',\n              change,\n            );\n          }\n        }\n\n        const ref =\n          change.position === 'before' ? el\n            : change.position === 'after' ? el.nextSibling\n              : change.position === 'prepend' ? el.firstChild\n                : null;\n        const startIndex = ref ? [...parent.childNodes].indexOf(ref) : parent.childNodes.length;\n        // 记录插入前紧邻的锚点：撤销时用它把插入的节点精确摘掉，\n        // 而**不是**重写父节点 innerHTML —— 重写会连带重建兄弟节点、丢锚点。\n        const nextNode = ref ?? null;\n\n        const frag = doc.createDocumentFragment();\n        for (const n of newNodes) frag.appendChild(n);\n        parent.insertBefore(frag, ref);\n\n        const insertedElements = newNodes.filter((n) => n.nodeType === 1);\n        for (const n of insertedElements) anchor.injectSubtree(n);\n        if (parent.nodeType === 1) anchor.ensure(parent);\n\n        inverse.push({\n          op: 'insertHtml',\n          // 关键：text 节点也要一起记录并使用，否则\"插入纯文本\"撤销后文字会永久残留\n          nodes: newNodes,\n          pids: insertedElements.map((n) => anchor.pidOf(n)).filter(Boolean),\n          startIndex,\n          nextNode,\n          parentPid: anchor.pidOf(parent.nodeType === 1 ? parent : parent.parentElement ?? doc.documentElement),\n          beforeSnapshot: parent.nodeType === 1 ? snapshotTree(anchor, parent) : null,\n        });\n        applied.push(change);\n        break;\n      }\n      case 'removeNode': {\n        const parent = el.parentNode;\n        if (!parent) throw new ZError('元素没有父节点，无法删除', 'E_PATCH_REMOVE_TARGET');\n        // 不允许删 <html>：它的父节点是 Document，没有可供撤销的\"父元素快照\"，\n        // 删掉之后页面结构报废且无法还原。直接拒绝，别留一个静默失效的撤销。\n        if (parent.nodeType !== 1) {\n          throw new ZError('不允许删除文档根元素 <html>（无法安全撤销）', 'E_PATCH_REMOVE_ROOT');\n        }\n        // 允许删除\"选中元素本身\"（用户说\"这块删掉\"是很自然的诉求）；\n        // 撤销靠父节点快照精确还原，不会丢锚点。\n        inverse.push({\n          op: 'removeNode',\n          snapshots: [{ pid: anchor.pidOf(parent), html: parent.innerHTML, outer: '' }],\n          pids: [anchor.pidOf(el)],\n          removedOuter: el.outerHTML,\n          parentPid: anchor.pidOf(parent),\n          index: [...parent.childNodes].indexOf(el),\n        });\n        el.remove();\n        applied.push(change);\n        break;\n      }\n      default:\n        throw new ZError(`未实现的操作 ${change.op}`, 'E_PATCH_OP');\n      }\n    }\n  } catch (err) {\n    // 回滚已应用的改动，保证\"要么全改，要么一点都不改\"\n    if (inverse.length) {\n      try {\n        undoPatch(doc, inverse);\n      } catch (rollbackErr) {\n        console.error('[zhidaiqi] 回滚失败，页面可能处于中间状态：', rollbackErr);\n        if (err instanceof ZError) err.rollbackFailed = rollbackErr?.message ?? String(rollbackErr);\n      }\n    }\n    throw err;\n  }\n\n  anchor.rescan();\n  return { applied, inverse, anchor, patch, scopePid };\n}\n\n/** 逆序执行逆条目 = 回到 patch 之前。 */\n\nfunction undoPatch(doc, inverse) {\n  const anchor = new AnchorManager(doc);\n  anchor.rescan();\n  const undone = [];\n  for (const entry of [...inverse].reverse()) {\n    switch (entry.op) {\n      case 'setText':\n      case 'setAttr':\n      case 'setStyle':\n      case 'setHtml':\n        restoreSnapshots(anchor, entry);\n        break;\n      case 'insertHtml': {\n        // 优先用当初记录的节点对象精确摘除（含**文本节点**，纯文本插入也能撤干净）。\n        // 注意：这里绝不用\"重写父节点 innerHTML\"来兜底——那样会连带重建兄弟节点、丢锚点。\n        removeInsertedNodes(entry);\n        break;\n      }\n      case 'removeNode': {\n        const snap = entry.snapshots[0];\n        const parent = anchor.resolve(snap.pid);\n        if (parent) restoreElement(anchor, parent, snap);\n        break;\n      }\n      default:\n        break;\n    }\n    undone.push(entry.op);\n  }\n  anchor.rescan();\n  sanitizeAnchors(anchor);\n  return undone;\n}\n\n/**\n * 预览会话：把\"改动 → 预览 → 接受/取消\"封成一个对象，UI 只跟它打交道。\n */\n\nclass PreviewSession {\n  constructor(doc, scopeEl, patch) {\n    this.doc = doc;\n    this.scopeEl = scopeEl;\n    this.scopePid = scopeEl ? new AnchorManager(doc).pidOf(scopeEl) : null;\n    const result = applyPatch(doc, scopeEl, patch);\n    this.patch = result.patch;\n    this.applied = result.applied;\n    this.inverse = result.inverse;\n    this.anchor = result.anchor;\n    this.id = uid('preview');\n    this.settled = false;\n    this.touchedPids = [...new Set(this.applied.map((c) => c.target))];\n    this.markTouched();\n  }\n\n  /** 把改动处标出来（视觉上\"这几处是 AI 刚动的\"）。 */\n  markTouched(className = 'z-preview-flash') {\n    for (const pid of this.touchedPids) {\n      const el = this.anchor.resolve(pid);\n      if (el) el.classList.add(className);\n    }\n  }\n\n  clearMarks(className = 'z-preview-flash') {\n    for (const pid of this.touchedPids) {\n      const el = this.anchor.resolve(pid);\n      if (el) el.classList.remove(className);\n    }\n  }\n\n  /** 取消：精确回滚。返回 true 表示已回滚。 */\n  cancel() {\n    if (this.settled) return false;\n    this.clearMarks();\n    undoPatch(this.doc, this.inverse);\n    this.settled = true;\n    this.cancelled = true;\n    return true;\n  }\n\n  /** 接受：清掉预览标记，DOM 保持改动后的样子。 */\n  accept() {\n    if (this.settled) return false;\n    this.clearMarks();\n    this.settled = true;\n    this.accepted = true;\n    return true;\n  }\n}\n\n/** 便捷函数：一次性 apply + 立刻回滚（测试与 dry-run 用）。 */\n\nfunction dryRunPatch(doc, scopeEl, patch) {\n  const session = new PreviewSession(doc, scopeEl, patch);\n  const ok = session.cancel();\n  return { rolledBack: ok, applied: session.applied.length };\n}\nObject.assign(exports, {\"validatePatch\": __Z_REQ(\"schema.mjs\")[\"validatePatch\"], \"summarizePatch\": __Z_REQ(\"schema.mjs\")[\"summarizePatch\"], \"patchStats\": __Z_REQ(\"schema.mjs\")[\"patchStats\"]});\n\nexports[\"validatePatch\"] = exports[\"validatePatch\"] ?? (typeof validatePatch !== 'undefined' ? validatePatch : undefined);\nexports[\"summarizePatch\"] = exports[\"summarizePatch\"] ?? (typeof summarizePatch !== 'undefined' ? summarizePatch : undefined);\nexports[\"patchStats\"] = exports[\"patchStats\"] ?? (typeof patchStats !== 'undefined' ? patchStats : undefined);\nexports[\"isEditorArtifactAttr\"] = exports[\"isEditorArtifactAttr\"] ?? (typeof isEditorArtifactAttr !== 'undefined' ? isEditorArtifactAttr : undefined);\nexports[\"sanitizeHtmlFragment\"] = exports[\"sanitizeHtmlFragment\"] ?? (typeof sanitizeHtmlFragment !== 'undefined' ? sanitizeHtmlFragment : undefined);\nexports[\"scrubEditorArtifacts\"] = exports[\"scrubEditorArtifacts\"] ?? (typeof scrubEditorArtifacts !== 'undefined' ? scrubEditorArtifacts : undefined);\nexports[\"applyPatch\"] = exports[\"applyPatch\"] ?? (typeof applyPatch !== 'undefined' ? applyPatch : undefined);\nexports[\"undoPatch\"] = exports[\"undoPatch\"] ?? (typeof undoPatch !== 'undefined' ? undoPatch : undefined);\nexports[\"PreviewSession\"] = exports[\"PreviewSession\"] ?? (typeof PreviewSession !== 'undefined' ? PreviewSession : undefined);\nexports[\"dryRunPatch\"] = exports[\"dryRunPatch\"] ?? (typeof dryRunPatch !== 'undefined' ? dryRunPatch : undefined);\n\n});\n\n__Z_DEF(\"selector.mjs\", function (exports, __Z_REQ) {\n/**\n * selector.mjs — 生成\"发给模型的上下文\"。见 CONTRACT.md §3。\n *\n * 关键取舍：不整页丢给模型。\n *  选中元素 outerHTML（截断） + 关键计算样式 + 命中的 CSS 规则 + 用户原话\n * 这样 token 小、指向明确，模型也很难\"顺手改别处\"。\n */\nconst { truncateBytes } = __Z_REQ(\"util.mjs\");\nconst { describeElement } = __Z_REQ(\"naming.mjs\");\nconst { selectorPath } = __Z_REQ(\"anchor.mjs\");\n/** 计算样式里真正影响\"看起来怎样\"的属性子集。 */\n\nconst COMPUTED_KEYS = [\n  'display', 'position', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',\n  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',\n  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',\n  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',\n  'text-align', 'text-decoration-line', 'text-transform', 'white-space', 'word-break', 'overflow-wrap',\n  'color', 'background-color', 'background-image', 'border-radius', 'border-width', 'border-style',\n  'border-color', 'box-shadow', 'opacity', 'overflow', 'flex-direction', 'justify-content', 'align-items',\n  'gap', 'grid-template-columns', 'transform', 'z-index', 'visibility', 'cursor',\n];\n\n/** 命中规则里允许出现的属性（避免把整页 design token 灌给模型）。 */\nconst RULE_PROP_WHITELIST = new Set([\n  ...COMPUTED_KEYS,\n  'font', 'background', 'border', 'margin', 'padding', 'text-shadow', 'transition', 'flex', 'grid', 'content',\n]);\n\n\nfunction computedSubset(win, el) {\n  const cs = win.getComputedStyle(el);\n  const out = {};\n  for (const key of COMPUTED_KEYS) {\n    const v = cs.getPropertyValue(key);\n    if (v && v !== 'normal' && v !== 'none' && v !== 'auto' && v !== '0px') out[key] = v;\n    else if (v && ['display', 'position', 'color', 'font-size', 'font-weight'].includes(key)) out[key] = v;\n  }\n  return out;\n}\n\n\nfunction rectOf(el) {\n  const r = el.getBoundingClientRect();\n  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };\n}\n\n/** 反查：哪些样式表规则命中了这个元素。让模型知道\"现在为什么长这样\"。 */\n\nfunction matchedCssRules(win, doc, el, limit = 24) {\n  const found = [];\n  let sheets;\n  try {\n    sheets = [...doc.styleSheets];\n  } catch {\n    return found;\n  }\n  const visit = (rules, origin) => {\n    if (!rules || found.length >= limit) return;\n    for (const rule of rules) {\n      if (found.length >= limit) break;\n      if (rule.selectorText) {\n        let hit = false;\n        try {\n          hit = el.matches(rule.selectorText);\n        } catch {\n          hit = false; // 有些选择器（:has 等）在旧引擎里会抛错，跳过即可\n        }\n        if (hit) {\n          const props = [];\n          for (const prop of rule.style ?? []) {\n            if (RULE_PROP_WHITELIST.has(prop)) props.push(`${prop}: ${rule.style.getPropertyValue(prop)}${rule.style.getPropertyPriority(prop) ? ' !important' : ''}`);\n          }\n          if (props.length) {\n            found.push({\n              selector: rule.selectorText.slice(0, 160),\n              cssText: props.join('; '),\n              origin: origin || rule.parentStyleSheet?.href || 'inline <style>',\n            });\n          }\n        }\n      } else if (rule.cssRules) {\n        visit(rule.cssRules, rule.conditionText ? `@media ${rule.conditionText}` : origin);\n      }\n    }\n  };\n  for (const sheet of sheets) {\n    try {\n      visit(sheet.cssRules, sheet.href || 'inline <style>');\n    } catch {\n      /* 跨域样式表：忽略 */\n    }\n  }\n  return found;\n}\n\n/**\n * 构建 ContextEnvelope v1。\n * @param {object} p\n * @param {Window} p.win iframe 的 window\n * @param {Document} p.doc iframe 的 document\n * @param {Element} p.el 选中的元素\n * @param {string} p.pid\n * @param {string} p.request 用户原话\n * @param {Array} p.history 之前几轮对话（role/text）\n */\n\nfunction buildContext({ win, doc, el, pid, request, history = [], names = null, retry = null, maxHtmlBytes = 24 * 1024 }) {\n  const chain = [];\n  let cur = el;\n  while (cur && cur.nodeType === 1 && chain.length < 12) {\n    let human = null;\n    try {\n      human = describeElement(cur, { win, names, selectorPath: selectorPath(cur) });\n    } catch {\n      human = null; // 命名失败不能影响发给模型的上下文\n    }\n    const isTarget = cur === el;\n    chain.push({\n      // 关键：祖先元素**不给 pid**。\n      // 之前这里给的是 pid，模型会拿它去 setStyle，然后必然撞\"越界\"——\n      // 等于我们主动递了一把用不了的钥匙。祖先只作只读上下文，用 ref 标识。\n      ref: isTarget ? 'target' : `ancestor-${chain.length}`,\n      modifiable: false,\n      tag: cur.tagName.toLowerCase(),\n      humanName: human?.name ?? null,\n      id: cur.id || null,\n      classes: (typeof cur.className === 'string' ? cur.className : '')\n        .split(/\\s+/)\n        .filter((c) => c && c !== 'picker-selected' && !c.startsWith('z-')),\n      text: cur.children.length === 0 ? (cur.textContent || '').trim().slice(0, 40) : null,\n    });\n    cur = cur.parentElement;\n  }\n  chain.reverse();\n\n  const outer = truncateBytes(el.outerHTML, maxHtmlBytes);\n  const attrs = {};\n  for (const a of el.attributes) {\n    if (a.name === 'data-pid' || a.name.startsWith('data-z-')) continue;\n    attrs[a.name] = a.value.length > 300 ? a.value.slice(0, 300) + '…' : a.value;\n  }\n\n  let human = null;\n  try {\n    human = describeElement(el, { win, names, box: rectOf(el), selectorPath: chain.map((c) => c.tag).join(' > ') });\n  } catch {\n    human = null;\n  }\n\n  // 允许出现在 changes[].target 里的 pid：只有选中元素本身，以及它内部元素\n  // （内部元素的 pid 就在 outerHtml 里，模型可以直接看到）\n  const modifiablePids = [pid, ...[...el.querySelectorAll('[data-pid]')].map((n) => n.getAttribute('data-pid'))].filter(Boolean);\n\n  return {\n    kind: 'zhidaiqi.context',\n    version: 1,\n    target: {\n      pid,\n      // 明确列出\"可以改哪些 pid\"，避免模型去猜（它猜过祖先，必然越界）\n      modifiablePids,\n      humanName: human?.name ?? null,\n      elementKind: human?.kind ?? null,\n      tag: el.tagName.toLowerCase(),\n      selectorPath: chain\n        .map((c) => c.tag.toLowerCase() + (c.id ? `#${c.id}` : c.classes.length ? `.${c.classes.slice(0, 2).join('.')}` : ''))\n        .join(' > '),\n      chain,\n      outerHtml: outer.text,\n      htmlTruncated: outer.truncated,\n      innerText: (el.textContent || '').trim().slice(0, 500),\n      attrs,\n      rect: rectOf(el),\n      computed: computedSubset(win, el),\n      matchedCssRules: matchedCssRules(win, doc, el),\n      childCount: el.children.length,\n      descendantCount: el.querySelectorAll('*').length,\n    },\n    request: String(request ?? ''),\n    // 上一次被拒绝时的反馈（父窗口在\"越界\"后自动补上，让模型知道该怎么改）\n    retry: retry && typeof retry === 'object' ? retry : null,\n    history: (history ?? []).slice(-6),\n  };\n}\n\n\nexports[\"COMPUTED_KEYS\"] = exports[\"COMPUTED_KEYS\"] ?? (typeof COMPUTED_KEYS !== 'undefined' ? COMPUTED_KEYS : undefined);\nexports[\"computedSubset\"] = exports[\"computedSubset\"] ?? (typeof computedSubset !== 'undefined' ? computedSubset : undefined);\nexports[\"rectOf\"] = exports[\"rectOf\"] ?? (typeof rectOf !== 'undefined' ? rectOf : undefined);\nexports[\"matchedCssRules\"] = exports[\"matchedCssRules\"] ?? (typeof matchedCssRules !== 'undefined' ? matchedCssRules : undefined);\nexports[\"buildContext\"] = exports[\"buildContext\"] ?? (typeof buildContext !== 'undefined' ? buildContext : undefined);\n\n});\n\n__Z_DEF(\"picker.mjs\", function (exports, __Z_REQ) {\n/**\n * picker.mjs — 指代器核心：鼠标变准星，悬停识别元素链，按住左键列出候选，松开确认选中。\n *\n * 只上报事实（指向哪个 pid、矩形在哪、链有哪几段），不做任何 UI 决策。\n * 界面（高亮框、环绕泡泡）画在父窗口的覆盖层上，因此绝不往用户页面注入样式。\n */\nconst { PID_ATTR, selectorPath } = __Z_REQ(\"anchor.mjs\");\n\nconst MODES = { BROWSE: 'browse', PICK: 'pick' };\n\nfunction isEditorNode(el) {\n  if (!el || el.nodeType !== 1) return true;\n  if (el.hasAttribute('data-z-chrome')) return true;\n  const tag = el.tagName;\n  return tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE' || tag === 'NOSCRIPT';\n}\n\n/**\n * 命中测试。\n * 指代器开启时会铺一层全屏隔离层，`elementFromPoint` 会返回它 —— 那样就选不中任何东西了。\n * 所以优先用 `elementsFromPoint` 拿到整条命中栈，跳过编辑器自己的节点（隔离层/注入的样式）。\n */\nfunction hitAt(doc, x, y) {\n  if (typeof doc.elementsFromPoint === 'function') {\n    const stack = doc.elementsFromPoint(x, y) || [];\n    for (const el of stack) {\n      if (el && el.nodeType === 1 && !isEditorNode(el)) return el;\n    }\n    return null;\n  }\n  const single = doc.elementFromPoint(x, y);\n  return single && !isEditorNode(single) ? single : null;\n}\n\n\nclass Picker {\n  /**\n   * @param {object} deps\n   * @param {Document} deps.doc\n   * @param {Window} deps.win\n   * @param {{ensure:(el:Element)=>string, pidOf:(el:Element)=>string, resolve:(pid:string)=>Element|null}} deps.anchor\n   * @param {(evt:object)=>void} deps.emit 上报给桥/父窗口\n   * @param {(el:Element, box:object) => {name:string, icon:string, kind:string, tooltip:string}} [deps.nameOf]\n   *        人话命名（naming.mjs）。不传也能工作，只是退回技术名。\n   */\n  constructor({ doc, win, anchor, emit, nameOf }) {\n    this.doc = doc;\n    this.win = win;\n    this.anchor = anchor;\n    this.emit = emit;\n    this.nameOf = nameOf;\n    this.mode = MODES.PICK;\n    this.enabled = false;\n    this.hoverPid = null;\n    this.selectedPid = null;\n    this.bubble = null; // {x,y,chain,index}\n    this.bound = false;\n    this.lastMoveTs = 0;\n    this.onDown = this.onPointerDown.bind(this);\n    this.onMove = this.onPointerMove.bind(this);\n    this.onUp = this.onPointerUp.bind(this);\n    this.onKey = this.onKeyDown.bind(this);\n    this.onLeave = this.onMouseLeave.bind(this);\n    this.onScroll = this.onScrollOrResize.bind(this);\n    this.onContext = (e) => {\n      if (!this.enabled) return;\n      e.preventDefault();\n      this.closeBubble('cancel');\n    };\n  }\n\n  attach() {\n    if (this.bound) return;\n    this.bound = true;\n    // 监听挂在 **window 的捕获阶段**，而不是 document：\n    // 拦截守卫也是在 window 捕获阶段（注册得更晚），事件路径 window → document → … → 目标，\n    // 这样指代器永远是第一个拿到事件的人，守卫再把事件掐断，\n    // 页面绑在元素/容器/document/window 上的监听就全都收不到（否则守卫会把指代器自己也冻住）。\n    const w = this.win;\n    w.addEventListener('pointermove', this.onMove, true);\n    w.addEventListener('pointerdown', this.onDown, true);\n    w.addEventListener('pointerup', this.onUp, true);\n    w.addEventListener('keydown', this.onKey, true);\n    w.addEventListener('mouseleave', this.onLeave, true);\n    w.addEventListener('contextmenu', this.onContext, true);\n    w.addEventListener('scroll', this.onScroll, true);\n    w.addEventListener('resize', this.onScroll, true);\n  }\n\n  detach() {\n    if (!this.bound) return;\n    this.bound = false;\n    const w = this.win;\n    w.removeEventListener('pointermove', this.onMove);\n    w.removeEventListener('pointerdown', this.onDown);\n    w.removeEventListener('pointerup', this.onUp);\n    w.removeEventListener('keydown', this.onKey);\n    w.removeEventListener('mouseleave', this.onLeave);\n    w.removeEventListener('contextmenu', this.onContext);\n    w.removeEventListener('scroll', this.onScroll);\n    w.removeEventListener('resize', this.onScroll);\n  }\n\n  setMode(mode) {\n    this.mode = mode === MODES.PICK ? MODES.PICK : MODES.BROWSE;\n    this.enabled = this.mode === MODES.PICK;\n    this.applyCursorClass();\n    if (!this.enabled) this.closeBubble('cancel');\n    this.emit({ type: 'mode', mode: this.mode });\n    return this.mode;\n  }\n\n  applyCursorClass() {\n    const root = this.doc.documentElement;\n    if (!root) return;\n    root.classList.toggle('z-picking', this.enabled);\n  }\n\n  /** 从最外层到元素自身的祖先链（用于面包屑/面板，人话名由 describe 负责） */\n  chainOf(el, limit = 8) {\n    const chain = [];\n    let cur = el;\n    while (cur && cur.nodeType === 1 && chain.length < limit) {\n      chain.push(cur);\n      cur = cur.parentElement;\n    }\n    return chain.reverse();\n  }\n\n  /** 在某个坐标下，从最深层往外给出候选元素（用于\"按住左键选层级\"）。 */\n  chainAt(x, y) {\n    const hit = hitAt(this.doc, x, y);\n    if (!hit) return [];\n    const chain = [];\n    let cur = hit;\n    while (cur && cur.nodeType === 1) {\n      if (!isEditorNode(cur)) chain.push(cur);\n      cur = cur.parentElement;\n    }\n    return chain; // 最内层在前\n  }\n\n  describe(el, index) {\n    if (!el) return null;\n    const pid = this.anchor.ensure(el);\n    const rect = el.getBoundingClientRect();\n    let label = el.tagName.toLowerCase();\n    if (el.id) label += `#${el.id}`;\n    else if (typeof el.className === 'string' && el.className.trim()) {\n      const cls = el.className.trim().split(/\\s+/).filter((c) => c !== 'picker-selected' && !c.startsWith('z-'));\n      if (cls.length) label += `.${cls.slice(0, 2).join('.')}`;\n    }\n    const text = (el.textContent || '').replace(/\\s+/g, ' ').trim();\n    const box = {\n      x: Math.round(rect.x),\n      y: Math.round(rect.y),\n      w: Math.round(rect.width),\n      h: Math.round(rect.height),\n    };\n    const path = selectorPath(el);\n    // 人话名（需求 R1）：弹层、面包屑、右侧面板、AI 上下文都复用这一个结果\n    let named = null;\n    try {\n      named = this.nameOf ? this.nameOf(el, box) : null;\n    } catch {\n      named = null; // 命名失败绝不能影响指代器本身\n    }\n    return {\n      pid,\n      index,\n      label, // 技术名：只用于 tooltip / 面板次级区\n      name: named?.name ?? label,\n      icon: named?.icon ?? '',\n      kind: named?.kind ?? 'other',\n      tooltip: named?.tooltip ?? path,\n      isCustomName: !!named?.isCustom,\n      tag: el.tagName.toLowerCase(),\n      id: el.id || null,\n      classes: (typeof el.className === 'string' ? el.className : '')\n        .split(/\\s+/)\n        .filter((c) => c && c !== 'picker-selected' && !c.startsWith('z-')),\n      text: text.slice(0, 48),\n      descendantCount: el.querySelectorAll('*').length,\n      box,\n      selectorPath: path,\n    };\n  }\n\n  onPointerMove(e) {\n    if (!this.enabled) return;\n    // 按住期间（候选界面已打开）：**不用页面命中测试改层级**，但要把指针坐标继续回报。\n    // 为什么还要回报坐标：在 iframe 里按下后拖到外面时，Chrome 会把指针事件继续投递给 iframe\n    // （跨 frame 拖拽的捕获行为），父窗口收不到自己的 pointerover。\n    // 所以父窗口需要用这份坐标自己做\"是否落在某个选项行上\"的命中测试。\n    if (this.bubble) {\n      const now = e.timeStamp || Date.now();\n      if (now - this.lastMoveTs < 16) return;\n      this.lastMoveTs = now;\n      this.emit({ type: 'bubble-pointer', point: { x: e.clientX, y: e.clientY } });\n      return;\n    }\n    const now = e.timeStamp || Date.now();\n    if (now - this.lastMoveTs < 16) return; // 约 60fps，别把 iframe 打满\n    this.lastMoveTs = now;\n    const hit = hitAt(this.doc, e.clientX, e.clientY);\n    if (!hit || isEditorNode(hit)) return;\n    const pid = this.anchor.ensure(hit);\n    this.hoverPid = pid;\n    const chain = this.chainAt(e.clientX, e.clientY).slice(0, 6).map((el, i) => this.describe(el, i));\n    this.emit({\n      type: 'hover',\n      pid,\n      target: this.describe(hit, 0),\n      chain,\n      point: { x: e.clientX, y: e.clientY },\n    });\n  }\n\n  onPointerDown(e) {\n    if (!this.enabled) return;\n    if (e.button !== 0) return;\n    const chain = this.chainAt(e.clientX, e.clientY);\n    if (!chain.length) return;\n    const described = chain.slice(0, 8).map((el, i) => this.describe(el, i));\n    this.bubble = { chain: described, index: 0, point: { x: e.clientX, y: e.clientY } };\n    e.preventDefault();\n    e.stopPropagation();\n    this.emit({\n      type: 'bubble-open',\n      point: { x: e.clientX, y: e.clientY },\n      chain: described,\n      index: 0,\n    });\n  }\n\n  onPointerUp(e) {\n    if (!this.enabled) return;\n    if (!this.bubble) return;\n    e.preventDefault();\n    e.stopPropagation();\n    const index = this.bubble.index ?? 0;\n    const chain = this.bubble.chain;\n    const chosen = chain[index] ?? chain[0];\n    // 清掉内部气泡状态：松开之后鼠标再移动不应该继续改层级\n    this.bubble = null;\n    if (!chosen) return;\n    // 通知父窗口\"已选这一层\"，并把候选链一起带上 ——\n    // 父窗口据此把弹层**留在页面上**变成选中工具条（否则按钮根本点不到）。\n    this.emit({\n      type: 'bubble-pick',\n      pid: chosen.pid,\n      index,\n      chain,\n      point: { x: e.clientX, y: e.clientY },\n    });\n    this.select(chosen.pid, { source: 'bubble' });\n  }\n\n  onKeyDown(e) {\n    if (!this.enabled) return;\n    if (e.key === 'Escape') {\n      if (this.bubble) this.closeBubble('cancel');\n      else this.emit({ type: 'escape' });\n      return;\n    }\n    if (this.bubble && (e.key === 'ArrowUp' || e.key === 'ArrowLeft')) {\n      this.bubble.index = Math.max(0, this.bubble.index - 1);\n      this.emit({ type: 'bubble-move', bubble: { index: this.bubble.index }, point: this.bubble.point });\n      e.preventDefault();\n    }\n    if (this.bubble && (e.key === 'ArrowDown' || e.key === 'ArrowRight')) {\n      this.bubble.index = Math.min(this.bubble.chain.length - 1, this.bubble.index + 1);\n      this.emit({ type: 'bubble-move', bubble: { index: this.bubble.index }, point: this.bubble.point });\n      e.preventDefault();\n    }\n    if (this.bubble && e.key === 'Enter') {\n      const chosen = this.bubble.chain[this.bubble.index];\n      this.bubble = null;\n      this.emit({ type: 'bubble-close', reason: 'pick' });\n      if (chosen) this.select(chosen.pid, { source: 'keyboard' });\n    }\n  }\n\n  onMouseLeave() {\n    if (!this.bubble) this.emit({ type: 'hover-end' });\n  }\n\n  onScrollOrResize() {\n    const pid = this.selectedPid ?? this.hoverPid;\n    if (!pid) return;\n    const el = this.anchor.resolve(pid);\n    if (!el) return;\n    this.emit({ type: 'geometry', pid, target: this.describe(el, 0) });\n  }\n\n  closeBubble(reason = 'cancel') {\n    if (!this.bubble) return;\n    this.bubble = null;\n    this.emit({ type: 'bubble-close', reason });\n  }\n\n  /** 选中（幂等）：加 .picker-selected，回报元素信息。 */\n  select(pid, meta = {}) {\n    const el = this.anchor.resolve(pid);\n    if (!el) {\n      this.emit({ type: 'error', code: 'E_SELECT_MISSING', message: `找不到 pid=${pid}` });\n      return null;\n    }\n    this.clearSelection();\n    el.classList.add('picker-selected');\n    this.selectedPid = pid;\n    const desc = this.describe(el, 0);\n    const info = {\n      ...desc,\n      html: el.outerHTML.slice(0, 4000),\n      htmlTruncated: el.outerHTML.length > 4000,\n      childCount: el.children.length,\n      // 祖先链（人话名）：父窗口用它渲染面包屑，保证与弹层一致\n      chain: this.chainOf(el)\n        .slice(-6)\n        .map((node, i) => this.describe(node, i)),\n    };\n    this.emit({ type: 'select', pid, target: info, source: meta.source ?? 'api' });\n    return info;\n  }\n\n  clearSelection() {\n    for (const el of this.doc.querySelectorAll('.picker-selected')) el.classList.remove('picker-selected');\n    if (this.selectedPid) {\n      const pid = this.selectedPid;\n      this.selectedPid = null;\n      this.emit({ type: 'deselect', pid });\n    }\n  }\n\n  /** 滚动到选中元素（历史回看/定位用） */\n  scrollTo(pid, { block = 'center' } = {}) {\n    const el = this.anchor.resolve(pid);\n    if (!el) return false;\n    try {\n      el.scrollIntoView({ block, behavior: 'smooth' });\n    } catch {\n      el.scrollIntoView();\n    }\n    return true;\n  }\n\n  /** 选中元素是否还在（patch 后 UI 校验用） */\n  hasSelection() {\n    return !!(this.selectedPid && this.anchor.resolve(this.selectedPid));\n  }\n\n  state() {\n    return { mode: this.mode, hoverPid: this.hoverPid, selectedPid: this.selectedPid, bubble: !!this.bubble };\n  }\n}\n\nObject.assign(exports, {\"PID_ATTR\": PID_ATTR});\n\n\nexports[\"MODES\"] = exports[\"MODES\"] ?? (typeof MODES !== 'undefined' ? MODES : undefined);\nexports[\"Picker\"] = exports[\"Picker\"] ?? (typeof Picker !== 'undefined' ? Picker : undefined);\nexports[\"PID_ATTR\"] = exports[\"PID_ATTR\"] ?? (typeof PID_ATTR !== 'undefined' ? PID_ATTR : undefined);\n\n});\n\n__Z_DEF(\"bridge.mjs\", function (exports, __Z_REQ) {\n/**\n * bridge.mjs — iframe 内的 RPC 桥。\n *\n * 父窗口把所有\"改 DOM\"的动作都通过这里下发；iframe 只回报事实。\n * 这样模型、UI、快照全都在父窗口，iframe 里没有一行\"业务决策\"。\n *\n * 消息形状：{ __z: 'req'|'res'|'evt', id, op?, args?, ok?, result?, error? }\n */\nconst { AnchorManager, selectorPath } = __Z_REQ(\"anchor.mjs\");\nconst { Picker, MODES } = __Z_REQ(\"picker.mjs\");\nconst { applyPatch, undoPatch, sanitizeHtmlFragment, scrubEditorArtifacts } = __Z_REQ(\"patch.mjs\");\nconst { validatePatch } = __Z_REQ(\"schema.mjs\");\nconst { buildContext } = __Z_REQ(\"selector.mjs\");\nconst { describeElement } = __Z_REQ(\"naming.mjs\");\nconst { ZError, truncateBytes } = __Z_REQ(\"util.mjs\");\nconst NS = 'zhidaiqi';\n\n/* ======================================================================\n * 指代器开启时\"冻住\"页面自身的交互\n *\n * 需求：导入的 HTML 在指代器**关闭**时功能完全正常；**开启**后鼠标只属于指代器，\n * 页面自身收不到输入（例如按左键不该触发页面里\"左键翻页\"的逻辑）。\n *\n * 只靠一种手段挡不住全部情况，这里用两层：\n *   ① 全屏透明隔离层：事件目标直接落在它身上，页面元素既收不到事件、也不会进入 :hover；\n *   ② document/window 捕获阶段的守卫：掐断冒泡，页面绑在容器或 window 上的监听也拿不到。\n * 两层都只在 picker.enabled 时才生效。\n * ==================================================================== */\n\nconst SHIELD_ATTR = 'data-z-shield';\n\n/** 铺一层透明隔离层（指代器开启时） */\n\nfunction ensureShield(doc) {\n  if (doc.querySelector(`[${SHIELD_ATTR}]`)) return;\n  const shield = doc.createElement('div');\n  shield.setAttribute(SHIELD_ATTR, '');\n  shield.setAttribute('data-z-chrome', 'shield');\n  shield.style.cssText = ['position:fixed', 'inset:0', 'z-index:2147483646', 'background:transparent', 'cursor:crosshair'].join(';');\n  // 滚轮仍要能滚动页面，否则指代器一开就滚不动\n  shield.addEventListener(\n    'wheel',\n    (e) => {\n      e.preventDefault();\n      const root = doc.scrollingElement || doc.documentElement;\n      if (!root) return;\n      root.scrollTop += e.deltaY || 0;\n      root.scrollLeft += e.deltaX || 0;\n    },\n    { passive: false },\n  );\n  (doc.body || doc.documentElement)?.appendChild(shield);\n}\n\n\nfunction removeShield(doc) {\n  doc.querySelectorAll(`[${SHIELD_ATTR}]`).forEach((el) => el.remove());\n}\n\n/** 指代器开启时要拦掉的事件类型 */\nconst BLOCKED_EVENTS = [\n  'pointerdown', 'pointerup', 'pointermove', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave',\n  'mousedown', 'mouseup', 'mousemove', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave',\n  'click', 'dblclick', 'auxclick', 'contextmenu',\n  'keydown', 'keyup', 'keypress',\n  'touchstart', 'touchmove', 'touchend', 'touchcancel',\n  'dragstart', 'drag', 'dragend', 'drop', 'selectstart',\n];\n\n/** 应用级快捷键：键盘被冻住后这些仍要可用（转发给父窗口处理） */\nfunction shortcutOf(e) {\n  if (!(e.ctrlKey || e.metaKey)) return null;\n  const k = String(e.key || '').toLowerCase();\n  if (k === 'z') return e.shiftKey ? 'redo' : 'undo';\n  if (k === 's') return 'save';\n  if (k === 'enter') return 'accept';\n  return null;\n}\n\n/**\n * 安装交互守卫。\n *\n * 必须在 picker.attach() **之后**调用，而且两者都要挂在同一个对象（window）的捕获阶段：\n * 事件路径是 window → document → … → 目标，同节点同阶段按注册顺序执行，\n * 于是顺序变成「指代器先处理 → 守卫再掐断」，页面（含绑在 document/window 上的监听）全都收不到。\n *\n * 注意别把守卫挂在 document 上而把指代器留在 document 上就以为没事：\n * window 捕获比 document 捕获更早，守卫会把指代器自己一起冻住。\n */\n\nfunction installInteractionGuard({ win, picker, post }) {\n  const guard = (e) => {\n    if (!picker.enabled) return; // 指代器关闭 → 完全不拦，页面功能原样可用\n    const sc = shortcutOf(e);\n    if (sc) post('evt', { type: 'shortcut', action: sc }); // 应用快捷键转发给父窗口\n    e.preventDefault();\n    e.stopPropagation();\n  };\n  for (const type of BLOCKED_EVENTS) win.addEventListener(type, guard, { capture: true, passive: false });\n}\n\n/** 指代器激活时的光标反馈（R4.3）：注入到 iframe，但带 data-z-chrome，导出时会被剥掉 */\nconst PICKER_STYLE_ID = 'data-z-picker-style';\nfunction ensurePickerStyle(doc) {\n  if (doc.querySelector(`style[${PICKER_STYLE_ID}]`)) return;\n  const style = doc.createElement('style');\n  style.setAttribute(PICKER_STYLE_ID, '');\n  style.setAttribute('data-z-chrome', 'picker');\n  style.textContent = [\n    'html.z-picking, html.z-picking * { cursor: crosshair !important; }',\n    // 既然我们在 pointerdown 里 preventDefault 了（防拖拽选中），顺手也禁掉文本选择\n    'html.z-picking { user-select: none !important; -webkit-user-select: none !important; }',\n    '.picker-selected { outline: 2px solid rgba(76,141,255,.9) !important; outline-offset: 1px !important; }',\n    '.z-preview-flash { animation: zflash 1.1s ease-out 1; }',\n    '@keyframes zflash { 0% { background-color: rgba(52,211,153,.28); } 100% { background-color: transparent; } }',\n  ].join('\\n');\n  (doc.head || doc.documentElement)?.appendChild(style);\n}\n\n\nfunction installBridge({ win, doc, token }) {\n  const anchor = new AnchorManager(doc);\n  const pending = new Map();\n  let ready = false;\n  // 用户自定义命名（R5）：pid → 名字，由父窗口下发并持久化\n  let customNames = {};\n\n  /** 人话命名入口：弹层/面包屑/面板/AI 上下文统一走这里（R1.5）。\n   *  带缓存：hover 时每帧要对最多 6 个元素取名，读 computed style 是开销大头。\n   *  任何改动 DOM 或改名字的操作都会清缓存（见 invalidateNames）。 */\n  const nameCache = new Map();\n  const invalidateNames = () => nameCache.clear();\n  const nameOf = (el, box) => {\n    const pid = anchor.pidOf(el);\n    if (pid && nameCache.has(pid) && !box) return nameCache.get(pid);\n    const named = describeElement(el, {\n      win,\n      names: customNames,\n      box,\n      selectorPath: selectorPath(el),\n    });\n    if (pid) nameCache.set(pid, named);\n    return named;\n  };\n\n  const picker = new Picker({\n    doc,\n    win,\n    anchor,\n    nameOf,\n    emit: (evt) => post('evt', { type: evt.type, ...evt }),\n  });\n\n  function post(type, payload) {\n    try {\n      win.parent.postMessage({ __z: NS, type, token, payload }, '*');\n    } catch {\n      /* 父窗口已卸载 */\n    }\n  }\n\n  function reply(id, ok, result, error) {\n    try {\n      win.parent.postMessage({ __z: NS, type: 'res', token, id, ok, result, error }, '*');\n    } catch {\n      /* ignore */\n    }\n  }\n\n  function normalizeError(err) {\n    if (err instanceof ZError) return { code: err.code, message: err.message, detail: err.detail ?? null };\n    return { code: 'E_BRIDGE', message: err?.message ?? String(err) };\n  }\n\n  /* ------------------------------- 能力表 -------------------------------\n   * 契约：**每个 op 都只接收一个对象参数**（args）。\n   * 这条契约必须严格统一：曾经 `select: (pid)` 收字符串、而调用方发 `{pid}`，\n   * 结果 `resolve('[object Object]')` 永远失败——选中链路整条是坏的，但模块测试全绿。\n   * ------------------------------------------------------------------- */\n\n  const api = {\n    ping: () => ({ ready, href: doc.location.href, title: doc.title }),\n\n    injectAnchors: () => {\n      const res = anchor.injectAll();\n      return { ...res, pids: anchor.seen.size };\n    },\n\n    setMode: ({ mode } = {}) => {\n      const m = picker.setMode(mode);\n      syncShield();\n      return { mode: m };\n    },\n\n    /**\n     * 同步\"当前高亮的层级\"。\n     * 按住期间层级由父窗口的选择界面驱动，而真正在松手时执行选中动作的是 iframe 里的 picker，\n     * 所以父窗口每次切换高亮都要把 index 回传给 picker —— 否则松手选中的还是最初那一层。\n     */\n    setBubbleIndex: ({ index } = {}) => {\n      if (!picker.bubble) return { index: null };\n      const max = picker.bubble.chain.length - 1;\n      picker.bubble.index = Math.max(0, Math.min(Number(index) || 0, max));\n      return { index: picker.bubble.index };\n    },\n\n    /** 下发用户自定义命名（R5）：覆盖弹层 / 面包屑 / 面板 / AI 上下文 */\n    setNames: ({ names } = {}) => {\n      customNames = names && typeof names === 'object' ? { ...names } : {};\n      invalidateNames();\n      return { count: Object.keys(customNames).length };\n    },\n\n    select: ({ pid } = {}) => {\n      header.mode = MODES.PICK;\n      const info = picker.select(pid, { source: 'api' });\n      return info;\n    },\n\n    clearSelection: () => {\n      picker.clearSelection();\n      return true;\n    },\n\n    scrollTo: ({ pid } = {}) => ({ ok: picker.scrollTo(pid) }),\n\n    state: () => picker.state(),\n\n    /** 选中元素的完整上下文（给模型用的 ContextEnvelope v1） */\n    getContext: ({ request = '', history = [], retry = null } = {}) => {\n      const el = picker.selectedPid ? anchor.resolve(picker.selectedPid) : null;\n      if (!el) throw new ZError('当前没有选中元素', 'E_NO_SELECTION');\n      const ctx = buildContext({\n        win,\n        doc,\n        el,\n        pid: picker.selectedPid,\n        request,\n        history,\n        names: customNames,\n        retry,\n      });\n      invalidateNames();\n      return ctx;\n    },\n\n    getNodeHtml: ({ pid } = {}) => {\n      const el = anchor.resolve(pid);\n      if (!el) throw new ZError(`找不到 pid=${pid}`, 'E_TARGET_MISSING');\n      return truncateBytes(el.outerHTML, 40 * 1024);\n    },\n\n    /** 预览：应用 patch，DOM 上立刻可见。同时把 inverse 交给父窗口以便精确回滚 */\n    applyPatch: ({ patch } = {}) => {\n      const scopeEl = picker.selectedPid ? anchor.resolve(picker.selectedPid) : null;\n      if (!scopeEl) throw new ZError('当前没有选中元素，无法应用改动', 'E_NO_SELECTION');\n      const result = applyPatch(doc, scopeEl, patch);\n      invalidateNames(); // DOM 变了，缓存的人话名可能过期\n      return {\n        applied: result.applied,\n        count: result.applied.length,\n        scopePid: result.scopePid,\n        inverse: result.inverse,\n        touched: [...new Set(result.applied.map((c) => c.target))],\n      };\n    },\n\n    /** 取消：用当初那次 applyPatch 返回的 inverse 精确回滚（像素级回到改动前） */\n    undoPatch: ({ inverse } = {}) => {\n      if (!Array.isArray(inverse) || !inverse.length) return { rolledBack: 0 };\n      const undone = undoPatch(doc, inverse);\n      invalidateNames();\n      return { rolledBack: undone.length, ops: undone };\n    },\n\n    /** 干净 HTML：剥掉 pid / 选中类 / 编辑器注入，用于导出与快照 */\n    extractCleanHtml: () => {\n      const clone = doc.documentElement.cloneNode(true);\n      const html = scrubEditorArtifacts(clone, doc.doctype?.name ?? 'html');\n      return { html, bytes: html.length };\n    },\n\n    /** 选区/预览高亮（视觉标记由父窗口画，这里只打 class） */\n    markPreview: ({ pids = [], on = true } = {}) => {\n      let n = 0;\n      for (const pid of pids) {\n        const el = anchor.resolve(pid);\n        if (!el) continue;\n        el.classList.toggle('z-preview-flash', !!on);\n        n++;\n      }\n      return { marked: n };\n    },\n\n    highlight: ({ pids = [], on = true } = {}) => {\n      for (const pid of pids) {\n        const el = anchor.resolve(pid);\n        if (el) el.classList.toggle('z-ai-touched', !!on);\n      }\n      return true;\n    },\n\n    /** 手动改文字：用户直接编辑（作为 source=manual-edit 的版本来源） */\n    setTextDirect: ({ pid, value }) => {\n      const el = anchor.resolve(pid);\n      if (!el) throw new ZError(`找不到 pid=${pid}`, 'E_TARGET_MISSING');\n      el.textContent = String(value ?? '');\n      return { ok: true };\n    },\n\n    /** 元素统计（验收脚本用）。编辑器自己注入的节点（data-z-*）不计入页面元素。 */\n    stats: () => {\n      const page = [...doc.querySelectorAll('*')].filter((el) => !el.hasAttribute('data-z-chrome'));\n      return {\n        elements: page.length,\n        anchored: page.filter((el) => el.hasAttribute('data-pid')).length,\n        editorNodes: doc.querySelectorAll('[data-z-chrome]').length,\n        selected: picker.selectedPid,\n        mode: picker.mode,\n        bodyHtmlLength: (doc.body?.innerHTML ?? '').length,\n      };\n    },\n\n    /** 页面内任意只读求值（验收脚本用；不暴露写能力） */\n    evalRead: ({ expr } = {}) => {\n      // eslint-disable-next-line no-new-func\n      const fn = new Function(`\"use strict\";return (${expr});`);\n      return fn.call(win);\n    },\n\n    describe: ({ pid } = {}) => {\n      const el = anchor.resolve(pid);\n      if (!el) return null;\n      return {\n        pid,\n        label: selectorPath(el),\n        text: (el.textContent || '').trim().slice(0, 80),\n        box: (() => {\n          const r = el.getBoundingClientRect();\n          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };\n        })(),\n      };\n    },\n\n    /** 验收：选中元素的 outerHTML（用于比对\"取消后是否逐字节还原\"） */\n    outerHtmlOf: ({ pid } = {}) => {\n      const el = anchor.resolve(pid);\n      return el ? el.outerHTML : null;\n    },\n  };\n\n  const header = { mode: picker.mode };\n\n  /* ------------------------------ 消息处理 ------------------------------ */\n\n  win.addEventListener('message', async (e) => {\n    const msg = e.data;\n    if (!msg || msg.__z !== NS) return;\n    if (msg.token && token && msg.token !== token) return;\n    if (msg.type === 'inject') {\n      // 父窗口下发桥代码（单文件版直接调用；开发版由父窗口 push 脚本）\n      return;\n    }\n    if (msg.type !== 'req') return;\n    const { id, op, args } = msg;\n    const fn = api[op];\n    if (typeof fn !== 'function') {\n      reply(id, false, null, { code: 'E_NO_OP', message: `未知操作 ${op}` });\n      return;\n    }\n    try {\n      const result = await fn(args ?? {});\n      reply(id, true, result ?? null, null);\n    } catch (err) {\n      reply(id, false, null, normalizeError(err));\n    }\n  });\n\n  function boot() {\n    anchor.injectAll();\n    ensurePickerStyle(doc); // R4.3：指代器激活时的瞄准光标/选中描边\n    picker.attach();\n    // 守卫必须在 picker.attach() 之后注册：同节点同阶段按注册顺序执行，\n    // 先让指代器处理事件，再把事件掐断，页面自身才拿不到输入。\n    installInteractionGuard({ win, picker, post });\n    picker.setMode(MODES.PICK);\n    syncShield();\n    ready = true;\n    post('ready', { pids: anchor.seen.size, elements: doc.querySelectorAll('*').length });\n  }\n\n  /** 隔离层跟随\"指代器开关\"：开着才铺，关掉必须撤掉，页面才能正常交互 */\n  function syncShield() {\n    if (picker.enabled) ensureShield(doc);\n    else removeShield(doc);\n  }\n\n  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot, { once: true });\n  else boot();\n\n  // 页面尺寸变化 → 通知父窗口重算高亮\n  win.addEventListener('resize', () => post('evt', { type: 'resize' }));\n  // 巡检选中元素是否还在（节点被移除时清掉选中态）。定时器要能被清理，\n  // 否则 iframe 重载后旧定时器还会继续跑、对着作废的 DOM 报警。\n  const patrol = setInterval(() => {\n    const sel = picker.selectedPid ? anchor.resolve(picker.selectedPid) : null;\n    if (sel && !sel.isConnected) {\n      picker.clearSelection();\n      post('evt', { type: 'selection-lost', reason: 'node-detached' });\n    }\n  }, 500);\n  win.addEventListener('pagehide', () => clearInterval(patrol), { once: true });\n\n  return { api, anchor, picker, post };\n}\n\nObject.assign(exports, {\"NS\": NS});\n\n\nexports[\"ensureShield\"] = exports[\"ensureShield\"] ?? (typeof ensureShield !== 'undefined' ? ensureShield : undefined);\nexports[\"removeShield\"] = exports[\"removeShield\"] ?? (typeof removeShield !== 'undefined' ? removeShield : undefined);\nexports[\"installInteractionGuard\"] = exports[\"installInteractionGuard\"] ?? (typeof installInteractionGuard !== 'undefined' ? installInteractionGuard : undefined);\nexports[\"installBridge\"] = exports[\"installBridge\"] ?? (typeof installBridge !== 'undefined' ? installBridge : undefined);\nexports[\"NS\"] = exports[\"NS\"] ?? (typeof NS !== 'undefined' ? NS : undefined);\n\n});\nvar __zApi = __Z_REQ('bridge.mjs');\nvar __zInst = __zApi.installBridge({ win: window, doc: window.document, token: window.__zToken || 'standalone' });\nwindow.__zBridge = __zInst;\ntry { window.parent.postMessage({ __z: 'zhidaiqi', type: 'bridge-installed', token: window.__zToken || 'standalone' }, '*'); } catch (e) {}\nreturn __zInst;\n})();" };
})();
