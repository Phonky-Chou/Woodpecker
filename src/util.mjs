/**
 * util.mjs — 无依赖小工具。必须保持"不碰 DOM、可被 Node 直接 import"。
 * 这些函数会被打包进单文件 HTML，也会被单元测试直接调用。
 */

/** 稳定的 32 位字符串哈希（FNV-1a 变体），同一输入永远同一输出。 */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** p-xxxxxxxx 形式的稳定 id。 */
export function stableId(seed) {
  return 'p-' + hash32(String(seed)).toString(16).padStart(8, '0');
}

let __seq = 0;
/** 运行时唯一 id（消息配对、快照 id 用，不要求跨会话稳定）。 */
export function uid(prefix = 'u') {
  __seq = (__seq + 1) % 0xffff;
  return `${prefix}-${Date.now().toString(36)}-${__seq.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 中文友好的"多少字符"计数 */
export function charCount(str) {
  return Array.from(String(str ?? '')).length;
}

export function truncate(str, max = 120) {
  const chars = Array.from(String(str ?? ''));
  if (chars.length <= max) return chars.join('');
  return chars.slice(0, max).join('') + '…';
}

export function truncateBytes(str, maxBytes = 24 * 1024) {
  const s = String(str ?? '');
  if (s.length <= maxBytes) return { text: s, truncated: false };
  return { text: s.slice(0, maxBytes) + '\n<!-- …已截断… -->', truncated: true };
}

export function formatBytes(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

export function formatTime(ts) {
  const d = new Date(Number(ts) || Date.now());
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function formatDateTime(ts) {
  const d = new Date(Number(ts) || Date.now());
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * 从模型回复里剥出 JSON。模型经常加 ```json 围栏或前后客套话。
 * 只做"剥离"，绝不把非 JSON 内容当结果用；剥不出来抛错。
 */
export function extractJson(text) {
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
export function deepClone(value) {
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

export function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/** patch 摘要 → 人类可读的一行话（版本列表用） */
export function describeChange(change) {
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
export class ZError extends Error {
  constructor(message, code = 'E_UNKNOWN', detail = null) {
    super(message);
    this.name = 'ZError';
    this.code = code;
    this.detail = detail;
  }
}

export function assert(cond, message, code = 'E_ASSERT') {
  if (!cond) throw new ZError(message, code);
}

/** 简单防抖 */
export function debounce(fn, wait = 60) {
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

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
