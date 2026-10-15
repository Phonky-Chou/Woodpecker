/**
 * picker.mjs — 指代器核心：鼠标变准星，悬停识别元素链，按住左键列出候选，松开确认选中。
 *
 * 只上报事实（指向哪个 pid、矩形在哪、链有哪几段），不做任何 UI 决策。
 * 界面（高亮框、环绕泡泡）画在父窗口的覆盖层上，因此绝不往用户页面注入样式。
 */

import { PID_ATTR, selectorPath } from './anchor.mjs';

export const MODES = { BROWSE: 'browse', PICK: 'pick' };

function isEditorNode(el) {
  if (!el || el.nodeType !== 1) return true;
  if (el.hasAttribute('data-z-chrome')) return true;
  const tag = el.tagName;
  return tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE' || tag === 'NOSCRIPT';
}

export class Picker {
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
    // 按住期间（候选界面已打开）：层级完全由**选择界面**驱动 ——
    // 鼠标滑到哪个选项就高亮哪个（由父窗口的 mouseover 处理），
    // 指针在页面上移动不再改变层级。
    // 否则用户想伸手去够选项时，高亮会跟着页面元素乱跳，根本无法稳定选中想改的那一层。
    if (this.bubble) return;
    const now = e.timeStamp || Date.now();
    if (now - this.lastMoveTs < 16) return; // 约 60fps，别把 iframe 打满
    this.lastMoveTs = now;
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

export { PID_ATTR };
