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
    const d = this.doc;
    d.addEventListener('pointermove', this.onMove, true);
    d.addEventListener('pointerdown', this.onDown, true);
    d.addEventListener('pointerup', this.onUp, true);
    d.addEventListener('keydown', this.onKey, true);
    d.addEventListener('mouseleave', this.onLeave, true);
    d.addEventListener('contextmenu', this.onContext, true);
    this.win.addEventListener('scroll', this.onScroll, true);
    this.win.addEventListener('resize', this.onScroll, true);
  }

  detach() {
    if (!this.bound) return;
    this.bound = false;
    const d = this.doc;
    d.removeEventListener('pointermove', this.onMove, true);
    d.removeEventListener('pointerdown', this.onDown, true);
    d.removeEventListener('pointerup', this.onUp, true);
    d.removeEventListener('keydown', this.onKey, true);
    d.removeEventListener('mouseleave', this.onLeave, true);
    d.removeEventListener('contextmenu', this.onContext, true);
    this.win.removeEventListener('scroll', this.onScroll, true);
    this.win.removeEventListener('resize', this.onScroll, true);
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
    const hit = this.doc.elementFromPoint(x, y);
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
    const now = e.timeStamp || Date.now();
    if (now - this.lastMoveTs < 16) return; // 约 60fps，别把 iframe 打满
    this.lastMoveTs = now;
    if (this.bubble) {
      // 泡泡打开时：移动只在链内切换候选，不重开
      const chain = this.bubble.chain;
      const hovered = chain.findIndex((c) => {
        const el = this.anchor.resolve(c.pid);
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      });
      this.emit({
        type: 'bubble-move',
        point: { x: e.clientX, y: e.clientY },
        bubble: { index: hovered === -1 ? this.bubble.index : hovered },
      });
      return;
    }
    const hit = this.doc.elementFromPoint(e.clientX, e.clientY);
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

/** 指代器激活时的光标反馈（R4.3）：注入到 iframe，但带 data-z-chrome，导出时会被剥掉 */
const PICKER_STYLE_ID = 'data-z-picker-style';
function ensurePickerStyle(doc) {
  if (doc.querySelector(`style[${PICKER_STYLE_ID}]`)) return;
  const style = doc.createElement('style');
  style.setAttribute(PICKER_STYLE_ID, '');
  style.setAttribute('data-z-chrome', 'picker');
  style.textContent = [
    'html.z-picking, html.z-picking * { cursor: crosshair !important; }',
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

    setMode: ({ mode } = {}) => ({ mode: picker.setMode(mode) }),

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
    picker.setMode(MODES.PICK);
    ready = true;
    post('ready', { pids: anchor.seen.size, elements: doc.querySelectorAll('*').length });
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


exports["installBridge"] = exports["installBridge"] ?? (typeof installBridge !== 'undefined' ? installBridge : undefined);
exports["NS"] = exports["NS"] ?? (typeof NS !== 'undefined' ? NS : undefined);

});
var __zApi = __Z_REQ('bridge.mjs');
var __zInst = __zApi.installBridge({ win: window, doc: window.document, token: window.__zToken || 'standalone' });
window.__zBridge = __zInst;
try { window.parent.postMessage({ __z: 'zhidaiqi', type: 'bridge-installed', token: window.__zToken || 'standalone' }, '*'); } catch (e) {}
return __zInst;
})();