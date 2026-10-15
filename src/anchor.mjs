/**
 * anchor.mjs — data-pid 稳定锚点。
 *
 * 设计要点（见 CONTRACT.md §2）：
 *  - pid 由"祖先路径 + 同级序号"哈希而来，因此**同一份 HTML 每次得到同一套 pid**。
 *    这一点很关键：模型说"把 p-1a2b3c4d 变大"，下次打开还能指同一个元素。
 *  - 只在确实需要时写 DOM：injectAll 一次性注入，ensure 兜底。
 *  - pid 只能由本模块产生；patch 执行器禁止任何人改写/删除 data-pid。
 */

import { stableId } from './util.mjs';

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
export function pathKey(el) {
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
export function computePid(el) {
  return stableId(pathKey(el));
}

export class AnchorManager {
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
export function cssEscape(value) {
  if (typeof CSS !== 'undefined' && CSS?.escape) return CSS.escape(value);
  return String(value).replace(/["\\\]]/g, '\\$&');
}

/** 人类可读的祖先链：body > main > section.hero > h1#title */
export function selectorPath(el) {
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

export { PID_ATTR };
