/**
 * tools/dom-shim.mjs — 极小的 DOM 实现，专门用来在 Node 里跑"真实链路"烟测。
 *
 * 定位（很重要，别指望更多）：
 *  - 只实现 src/ 里**实际用到**的那些 API：querySelector(All)、classList、
 *    getBoundingClientRect、elementFromPoint、innerHTML/outerHTML 解析、style.setProperty…
 *  - 目的是在没有无头浏览器的环境里，把"锚点 → 选中 → patch → 回滚 → 快照"整条链跑通；
 *    **像素级渲染、真实 CSS 级联、真实事件顺序仍然只能靠浏览器**（页面内自检负责那段）。
 *  - 因此它只在临时目录生成、用完即删，绝不污染仓库。
 *
 * 用法：生成一份 .cjs 再用 require 加载（CJS 才能方便地在这个沙箱里被 require 到）。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let cached = null;

/**
 * 是否在 shim 里执行内联 <script>。
 * 打开后 iframe 的 srcdoc / 动态注入的脚本会真的在一个独立 realm 里跑，
 * 于是"应用接线"（父窗口 message 监听、桥装进哪个 realm、rpc 往返）都能在 Node 里被验证。
 * 这正是之前所有测试都照不到的盲区。
 */
export function setScriptExecution(on) {
  loadDomShim().setScriptExecution(on);
}

export function loadDomShim() {
  if (cached) return cached;
  // 防呆（真踩过两次）：
  // ① SHIM_SOURCE 是用 String.raw 模板嵌进来的，正文里出现**反引号**或 ${ 会把模板提前截断，
  //    生成出一份"语法错误、但外层模块不报错"的 .cjs（偶数个反引号时尤其阴险）；
  // ② 直接对生成结果做一次语法校验，任何形式的改坏都当场暴露，而不是变成奇怪的运行时行为。
  const TICK = String.fromCharCode(96);
  const DOLLAR_BRACE = '$' + '{';
  if (SHIM_SOURCE.includes(TICK) || SHIM_SOURCE.includes(DOLLAR_BRACE)) {
    throw new Error('[shim] SHIM_SOURCE 正文里不允许出现反引号或 ${ —— 会把 String.raw 模板截断');
  }
  try {
    new vm.Script(SHIM_SOURCE, { filename: 'dom-shim.generated.cjs' });
  } catch (err) {
    throw new Error('[shim] 生成的 shim 源码语法错误，请检查嵌入方式：' + err.message);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhidaiqi-dom-'));
  const file = path.join(dir, 'dom-shim.cjs');
  fs.writeFileSync(file, SHIM_SOURCE, 'utf8');
  cached = { ...require(file), dir, file };
  return cached;
}

export function cleanupDomShim() {
  if (!cached) return;
  try {
    fs.rmSync(cached.dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  cached = null;
}

const SHIM_SOURCE = String.raw`
'use strict';
const vm = require('node:vm');
const VOID_TAGS = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);

/** 是否执行内联 <script>（由外层测试开关控制） */
let EXEC_SCRIPTS = false;
function setScriptExecution(on) { EXEC_SCRIPTS = !!on; }

/** 把消息投递给某个 window 上的 message 监听器（异步，和浏览器一致） */
function makeMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => map.set(String(k), String(v)),
    removeItem: (k) => map.delete(String(k)),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
    _map: map,
  };
}
function deliverMessage(win, data) {
  if (!win) return;
  // 监听条目形如 { fn, capture }（addEventListener 会记录阶段），这里取 fn
  const listeners = (win._listeners?.get('message') ?? []).map((e) => (typeof e === 'function' ? e : e.fn));
  const list = [...listeners];
  if (!list.length) return;
  const evt = { data, origin: '*', source: null, type: 'message' };
  for (const fn of list) {
    setTimeout(() => {
      try {
        fn(evt);
      } catch (err) {
        // 监听器抛错不应该影响投递流程
        process.emitWarning?.('[shim] message listener error: ' + err.message);
      }
    }, 0);
  }
}

/**
 * 事件派发（忠实度关键，别简化）：
 *  ① 完整路径：元素 → … → document → window；
 *  ② 区分**捕获阶段**（window → document → … → target）与**冒泡阶段**（target → … → window），
 *     addEventListener 第三个参数会被真正尊重；
 *  ③ 真正遵守 stopPropagation / stopImmediatePropagation / preventDefault。
 * 这三点必须忠实：页面可能把监听绑在 document/window 上（reveal.js 风格演示页就是这样），
 * 而"指代器开启时冻住页面交互"正是靠**捕获阶段** stopPropagation 实现的。
 */
function dispatchThrough(target, evt) {
  const path = [];
  let node = target;
  let guard = 0;
  while (node && guard++ < 64) {
    path.push(node);
    node = node.nodeType === 1 ? node.parentElement ?? null : null;
  }
  const doc = target.nodeType === 9 ? target : target.ownerDocument ?? null;
  const win = doc?._win ?? null;
  const full = []; // window → document → … → target
  if (win) full.push(win);
  if (doc && !full.includes(doc)) full.push(doc);
  for (const el of [...path].reverse()) if (!full.includes(el)) full.push(el);

  const base = { ...evt };
  const state = { stopped: false, immediate: false };
  const runNode = (t, wantCapture) => {
    if (state.stopped) return;
    const entries = t._listeners?.get(evt.type) ?? [];
    state.immediate = false;
    for (const entry of [...entries]) {
      if (state.immediate || state.stopped) break;
      if (!!entry.capture !== wantCapture) continue;
      entry.fn.call(t, {
        ...base,
        target,
        currentTarget: t,
        preventDefault: () => {
          base.defaultPrevented = true;
        },
        stopPropagation: () => {
          state.stopped = true;
        },
        stopImmediatePropagation: () => {
          state.stopped = true;
          state.immediate = true;
        },
      });
    }
  };
  for (const t of full) runNode(t, true); // 捕获：window → … → target
  for (const t of [...full].reverse()) runNode(t, false); // 冒泡：target → … → window
  return !base.defaultPrevented;
}

/** 在一个"独立 realm"里求值一段脚本：直接把 window 对象做成该 realm 的全局对象 */
function runScriptInRealm(win, code) {
  if (!EXEC_SCRIPTS || !win || !code) return;
  try {
    // 关键：contextify 的是 window 对象本身，这样脚本里的 globalThis / window 就是它，
    // 属性写入（如 window.__zBridge）也会落回这个对象上，测试才能观察到。
    // 用 Object.create(null) 当沙箱会丢掉原型方法（addEventListener 等），之前就踩了这个坑。
    const ctx = vm.createContext(win);
    vm.runInContext(code, ctx, { filename: 'iframe-script.js', timeout: 5000 });
  } catch (err) {
    // 静默吞掉页面脚本的异常 = 虚假信心：页面监听根本没挂上，测试却"通过"了。
    // 默认就出声（可用 Z_SHIM_QUIET=1 关掉）。
    if (!process.env.Z_SHIM_QUIET) {
      console.error('[shim] 页面内联脚本执行失败（该脚本的监听/初始化都没有生效）：' + err.message);
      if (process.env.Z_SHIM_VERBOSE) console.error(err.stack);
    }
  }
}

class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  _sync() { this.el._class = [...this.set].join(' '); }
  add(...cs) { cs.forEach((c) => this.set.add(c)); this._sync(); }
  remove(...cs) { cs.forEach((c) => this.set.delete(c)); this._sync(); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) {
    const on = force === undefined ? !this.set.has(c) : !!force;
    on ? this.set.add(c) : this.set.delete(c);
    this._sync();
    return on;
  }
  get value() { return [...this.set].join(' '); }
}

class StyleDecl {
  constructor() { this.map = new Map(); this.priority = new Map(); }
  setProperty(prop, value, priority) {
    if (value === '' || value == null) this.removeProperty(prop);
    else { this.map.set(prop, String(value)); this.priority.set(prop, priority || ''); }
  }
  removeProperty(prop) { this.map.delete(prop); this.priority.delete(prop); }
  getPropertyValue(prop) { return this.map.get(prop) ?? ''; }
  getPropertyPriority(prop) { return this.priority.get(prop) ?? ''; }
  get cssText() { return [...this.map].map(([k, v]) => k + ': ' + v).join('; '); }
  get fontSize() { return this.getPropertyValue('font-size'); }
  set fontSize(v) { this.setProperty('font-size', v); }
  get color() { return this.getPropertyValue('color'); }
  set color(v) { this.setProperty('color', v); }
  get backgroundColor() { return this.getPropertyValue('background-color'); }
  set backgroundColor(v) { this.setProperty('background-color', v); }
  // style["font-size"] 这种下标访问（patch 执行器用 setProperty，但别的地方可能会读）
  get(prop) { return this.map.get(prop); }
}

class AttrMap {
  constructor() { this.map = new Map(); }
  get(name) { return this.map.get(name); }
  set(name, value) { this.map.set(name, String(value)); }
  delete(name) { this.map.delete(name); }
  get names() { return [...this.map.keys()]; }
}

let UID = 0;

class El {
  constructor(tag, doc) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this._doc = doc;
    this.children = [];
    this.childNodes = [];
    this.parentElement = null;
    this.parentNode = null;
    this.ownerDocument = doc;
    this.attrs = new AttrMap();
    this.style = new StyleDecl();
    this.classList = new ClassList(this);
    this._class = '';
    this._text = '';
    this._rect = { x: 0, y: 0, width: 0, height: 0 };
    this._listeners = new Map();
    this._uid = ++UID;
    this.isConnected = true;
    this.value = '';
    this.disabled = false;
    this.checked = false;
    this.placeholder = '';
    // dataset 走真实读写（camelCase ↔ data-kebab-case）。之前是个只吞不存的 Proxy，
    // 会让"dataset.x = y"静默失效，测出来的行为与浏览器不一致。
    this.dataset = new Proxy(
      {},
      {
        get: (_t, key) => {
          const name = 'data-' + String(key).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
          const v = this.attrs.get(name);
          return v === undefined ? undefined : v;
        },
        set: (_t, key, value) => {
          const name = 'data-' + String(key).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
          this.setAttribute(name, String(value));
          return true;
        },
        has: (_t, key) => this.attrs.get('data-' + String(key).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())) !== undefined,
      },
    );
    this.attributes = [];
  }

  get id() { return this.attrs.get('id') ?? ''; }
  set id(v) { this.setAttribute('id', v); }
  get className() { return this.classList.value; }
  set className(v) {
    this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean));
    this.classList._sync();
  }
  get textContent() {
    if (this.childNodes.length === 0) return this._text;
    return this.childNodes.map((c) => (c.nodeType === 3 ? c.textContent : c.textContent)).join('');
  }
  set textContent(v) {
    this.children = [];
    this.childNodes = [];
    this._text = String(v ?? '');
  }
  get innerHTML() {
    if (this.tagName === 'TEMPLATE') return this.content.innerHTML;
    if (this.childNodes.length === 0) return this._text;
    return this.childNodes.map((c) => (c.nodeType === 3 ? escapeText(c.textContent) : c.outerHTML)).join('');
  }
  set innerHTML(html) {
    // <template> 的内容落在 .content 上，与浏览器一致（sanitizeHtmlFragment 依赖这一点）
    if (this.tagName === 'TEMPLATE') {
      this.content.innerHTML = String(html ?? '');
      return;
    }
    this.children = [];
    this.childNodes = [];
    this._text = '';
    const parsed = parseHtmlFragment(String(html ?? ''), this._doc);
    for (const child of parsed.nodes) this._adopt(child);
  }
  get outerHTML() {
    const tag = this.tagName.toLowerCase();
    const attrList = this.attributes.filter((a) => a.name && a.value !== undefined && a.name !== 'style');
    const cssText = this.style.cssText;
    const parts = attrList.map((a) => (a.value === '' ? ' ' + a.name : ' ' + a.name + '="' + escapeAttr(a.value) + '"'));
    if (cssText) parts.push(' style="' + escapeAttr(cssText) + '"');
    const attrs = parts.join('');
    if (VOID_TAGS.has(tag)) return '<' + tag + attrs + '>';
    return '<' + tag + attrs + '>' + this.innerHTML + '</' + tag + '>';
  }
  _adopt(child) {
    child.parentElement = this;
    child.parentNode = this;
    this.children.push(child);
    this.childNodes.push(child);
    if (child.nodeType === 1) {
      if (child.tagName === 'IFRAME') child._ensureFrameRealm();
      // 内联脚本：在所属文档的 realm 里求值（打开开关时），用来验证"应用接线"。
      // 必须延后到解析结束再执行 —— 采纳元素时它的文本子节点还没挂上，立刻跑会拿到空代码。
      if (child.tagName === 'SCRIPT' && !child.getAttribute('src') && !child.getAttribute('type')) {
        const ownerWin = this.ownerDocument?._win ?? this._doc?._win ?? null;
        const scriptEl = child;
        setTimeout(() => runScriptInRealm(ownerWin, scriptEl.textContent), 0);
      }
    }
  }
  appendChild(child) {
    if (child && child.nodeType === 11) { for (const c of [...child.children]) this.appendChild(c); return child; }
    this._adopt(child);
    return child;
  }
  append(...nodes) { nodes.forEach((n) => this.appendChild(typeof n === 'string' ? this._doc.createTextNode(n) : n)); }
  prepend(...nodes) { nodes.reverse().forEach((n) => this.insertBefore(n, this.children[0] ?? null)); }
  insertBefore(node, ref) {
    if (node && node.nodeType === 11) {
      const moved = [...node.children];
      moved.forEach((c) => this.insertBefore(c, ref));
      return node;
    }
    const idx = ref ? this.children.indexOf(ref) : -1;
    if (idx === -1) this._adopt(node);
    else {
      node.parentElement = this;
      node.parentNode = this;
      this.children.splice(idx, 0, node);
      this.childNodes.splice(idx, 0, node);
    }
    return node;
  }
  get firstChild() { return this.childNodes[0] ?? null; }
  get nextSibling() {
    if (!this.parentElement) return null;
    const i = this.parentElement.childNodes.indexOf(this);
    return this.parentElement.childNodes[i + 1] ?? null;
  }
  removeChild(node) {
    const i = this.children.indexOf(node);
    if (i >= 0) { this.children.splice(i, 1); this.childNodes.splice(i, 1); node.parentElement = null; node.parentNode = null; }
    return node;
  }
  remove() { this.parentElement?.removeChild(this); this.isConnected = false; }
  cloneNode(deep) {
    const copy = new El(this.tagName, this._doc);
    for (const n of this.attrs.names) copy.setAttribute(n, this.attrs.get(n));
    copy._class = this._class;
    copy.classList.set = new Set(this.classList.set);
    for (const [k, v] of this.style.map) copy.style.setProperty(k, v, this.style.getPropertyPriority(k));
    copy._text = this._text;
    if (deep) for (const c of this.childNodes) copy._adopt(c.cloneNode ? c.cloneNode(true) : { ...c });
    return copy;
  }
  /** <template> 的 .content：独立容器，行为与浏览器一致（写 innerHTML 不落到元素自身） */
  get content() {
    if (!this._contentFrag) {
      const frag = new El('#fragment', this._doc);
      frag.nodeType = 11;
      frag.remove = () => {};
      this._contentFrag = frag;
    }
    return this._contentFrag;
  }
  set content(v) {
    this._contentFrag = v;
  }

  /* ------------------------- iframe：独立 realm ------------------------- */
  _ensureFrameRealm() {
    if (this._cwin) return this._cwin;
    const doc = new Doc();
    const win = new Win(doc);
    doc._win = win;
    win.parent = this.ownerDocument?._win ?? null;
    win.top = win;
    win.postMessage = (msg) => deliverMessage(win, msg);
    win.__zToken = undefined;
    this._cwin = win;
    this._cdoc = doc;
    return win;
  }
  get contentWindow() {
    return this._ensureFrameRealm();
  }
  get contentDocument() {
    this._ensureFrameRealm();
    return this._cdoc;
  }
  get srcdoc() {
    return this._srcdoc ?? '';
  }
  set srcdoc(html) {
    this._srcdoc = String(html ?? '');
    const doc = this.contentDocument;
    // 等价于一次 iframe 重载：清空、重新解析。注意每个节点只 _adopt 一次，否则脚本会跑两遍。
    doc.children = [];
    doc.childNodes = [];
    const parsed = parseHtmlFragment(this._srcdoc, doc);
    const hasHtml = parsed.nodes.some((n) => n.nodeType === 1 && n.tagName === 'HTML');
    if (hasHtml) {
      for (const n of parsed.nodes) doc._adopt(n);
    } else {
      const htmlEl = new El('html', doc);
      const bodyEl = new El('body', doc);
      for (const n of parsed.nodes) bodyEl._adopt(n);
      htmlEl._adopt(bodyEl);
      doc._adopt(htmlEl);
    }
  }
  setAttribute(name, value) {
    const n = String(name);
    this.attrs.set(n, value === '' ? '' : String(value));
    const rec = this.attributes.find((a) => a.name === n);
    if (rec) rec.value = String(value); else this.attributes.push({ name: n, value: String(value) });
    if (n === 'class') this.className = value;
    // style 属性不做 attrs 存储：浏览器里 el.style.setProperty 与 style 属性是同一份数据，
    // 这里统一以 this.style 为唯一真相（getAttribute('style')/outerHTML 都从它派生），
    // 否则会出现"属性数组与样式表不同步"的假象，误导对 undo 精确性的判断。
    if (n === 'style') {
      this.style.map.clear();
      this.style.priority.clear();
      for (const decl of String(value).split(';')) {
        const i = decl.indexOf(':');
        if (i > 0) this.style.setProperty(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
      }
      this.attrs.delete('style');
    }
    if (n.startsWith('data-') && n.length > 5) this._dataCache = null;
  }
  getAttribute(name) {
    const n = String(name);
    if (n === 'style') {
      const css = this.style.cssText;
      return css ? css : null;
    }
    const v = this.attrs.get(n);
    return v === undefined ? null : v;
  }
  removeAttribute(name) {
    const n = String(name);
    this.attrs.delete(n);
    const i = this.attributes.findIndex((a) => a.name === n);
    if (i >= 0) this.attributes.splice(i, 1);
    if (n === 'class') this.className = '';
    // 浏览器里 removeAttribute('style') 会清空整段行内样式，这里必须跟上
    if (n === 'style') {
      this.style.map.clear();
      this.style.priority.clear();
    }
  }
  hasAttribute(name) {
    const n = String(name);
    // 浏览器里 el.style.setProperty 会让 style 属性"存在"；shim 必须跟上，
    // 否则 hasAttribute('style') 恒为 false，快照就会丢掉行内样式（这是 shim 曾经的失真点）。
    if (n === 'style') return this.style.map.size > 0;
    return this.attrs.get(n) !== undefined;
  }
  matches(sel) { return matchesSelector(this, sel); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  querySelectorAll(sel) {
    const out = [];
    for (const s of String(sel).split(',')) {
      const text = s.trim();
      if (text) collect(this, text, out);
    }
    return out;
  }
  contains(node) {
    let cur = node;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentElement;
    }
    return false;
  }
  closest(sel) {
    let cur = this;
    while (cur) {
      if (matchesSelector(cur, sel)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
  addEventListener(type, fn, opts) {
    const capture = typeof opts === 'boolean' ? opts : !!opts?.capture;
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push({ fn, capture });
  }
  removeEventListener(type, fn) {
    const arr = this._listeners.get(type);
    if (arr) this._listeners.set(type, arr.filter((e) => e.fn !== fn));
  }
  dispatchEvent(evt) {
    return dispatchThrough(this, evt);
  }
  getBoundingClientRect() {
    if (this._rectOverride) return this._rectOverride;
    // 给每个元素一个稳定的假矩形，便于测试 rect 相关的链路
    const base = (this._uid % 40) * 10;
    return { x: 0, y: base, width: 320, height: 40, left: 0, top: base, right: 320, bottom: base + 40 };
  }
  getClientRects() { return [this.getBoundingClientRect()]; }
  scrollIntoView() {}
  get children2() { return this.children; }
  get tagNameLower() { return this.tagName.toLowerCase(); }
  focus() {}
  click() { this.dispatchEvent({ type: 'click' }); }
  insertAdjacentHTML() {}
}

class Doc extends El {
  constructor() {
    super('#document', null);
    this.nodeType = 9;
    this._doc = this;
    this.ownerDocument = this;
    this.doctype = { name: 'html' };
    this.readyState = 'complete';
    this.title = '';
    this.styleSheets = [];
    this._listeners = new Map();
  }
  createElement(tag) { return new El(tag, this); }
  getElementById(id) { return this.querySelector('#' + id); }
  getElementsByTagName(tag) { return this.querySelectorAll(String(tag)); }
  createTextNode(text) { const t = { nodeType: 3, textContent: String(text), parentElement: null, parentNode: null, outerHTML: '', remove() {} }; return t; }
  createDocumentFragment() { const f = new El('#fragment', this); f.nodeType = 11; return f; }
  elementFromPoint(x, y) { return this.elementFromPointResult ?? null; }
  /** 命中栈：浏览器里返回最上层到最下层；这里返回桩元素（有隔离层时上层是先放进去的节点） */
  elementsFromPoint(x, y) {
    const top = this.elementFromPointResult;
    if (!top) return [];
    const out = [];
    let cur = top;
    let guard = 0;
    while (cur && guard++ < 32) {
      out.push(cur);
      cur = cur.parentElement ?? null;
    }
    return out;
  }
  addEventListener(type, fn, opts) {
    const capture = typeof opts === 'boolean' ? opts : !!opts?.capture;
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push({ fn, capture });
  }
  removeEventListener(type, fn) {
    const arr = this._listeners.get(type);
    if (arr) this._listeners.set(type, arr.filter((e) => e.fn !== fn));
  }
  dispatchEvent(evt) {
    return dispatchThrough(this, evt);
  }
  get documentElement() { return this.children.find((c) => c.tagName === 'HTML') ?? null; }
  get head() { return this.querySelector('head'); }
  get body() { return this.querySelector('body'); }
  get location() { return { href: 'about:blank' }; }
  get defaultView() { return this._win; }
}

class Win {
  constructor(doc) {
    this.document = doc;
    this._listeners = new Map();
    doc._win = this;
    // 浏览器里 window 自带定时器；应用代码直接用全局 setTimeout，所以这里必须提供
    this.setTimeout = setTimeout;
    this.clearTimeout = clearTimeout;
    this.setInterval = () => 0; // 假定时器：避免把 Node 事件循环钉住
    this.clearInterval = () => {};
    this.requestAnimationFrame = () => 0;
    this.cancelAnimationFrame = () => {};
    this.postMessage = (msg) => deliverMessage(this, msg);
    this.parent = this;
    this.top = this;
    // 浏览器里 window.window === window、self === window；脚本里常直接引用 window，必须补上
    this.window = this;
    this.self = this;
    this.globalThis = this;
    // 内存版 localStorage/sessionStorage：让"持久化"这条路真的被测到
    this.localStorage = makeMemoryStorage();
    this.sessionStorage = makeMemoryStorage();
  }
  addEventListener(type, fn, opts) {
    const capture = typeof opts === 'boolean' ? opts : !!opts?.capture;
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push({ fn, capture });
  }
  removeEventListener(type, fn) {
    const arr = this._listeners.get(type);
    if (arr) this._listeners.set(type, arr.filter((e) => e.fn !== fn));
  }
  /** window 也要能被派发（页面常把监听绑在 window 上，例如方向键翻页） */
  dispatchEvent(evt) {
    return dispatchThrough(this, evt);
  }
  getComputedStyle(el) {
    const stub = {};
    const raw = {};
    const set = (prop, value) => { raw[prop] = value; };
    set('font-size', el.style.getPropertyValue('font-size') || '16px');
    set('color', el.style.getPropertyValue('color') || 'rgb(17, 24, 39)');
    set('display', 'block');
    set('position', 'static');
    return { getPropertyValue: (p) => raw[p] ?? '', _raw: raw };
  }
}

function escapeAttr(v) { return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
function escapeText(v) { return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/* --------------------------- HTML 片段解析（够用即可） --------------------------- */

/** 内容是"原始文本"的元素：内部允许出现 < （例如 JS 里的 index < 0），不能当标签解析 */
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title']);

function parseHtmlFragment(html, doc) {
  const nodes = [];
  const stack = [];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!doctype[^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>|([^<]+)/gi;
  let m;
  const push = (node) => {
    const parent = stack[stack.length - 1];
    if (parent) parent._adopt(node);
    else {
      node.parentElement = null;
      node.parentNode = null;
      nodes.push(node);
    }
  };
  /** 遇到 script/style 这类原始文本元素：把内容整段取出，绝不能逐字符过标签正则 */
  const consumeRawText = (tag) => {
    const close = new RegExp('</' + tag + '\\s*>', 'i');
    const rest = html.slice(re.lastIndex);
    const hit = rest.match(close);
    if (!hit) {
      push(makeTextNode(rest));
      re.lastIndex = html.length;
      stack.pop(); // 没找到闭合标签：这个元素到此为止
      return;
    }
    const end = re.lastIndex + hit.index;
    push(makeTextNode(html.slice(re.lastIndex, end)));
    re.lastIndex = end + hit[0].length; // 连闭合标签一起跳过
    // 闭合标签已经被我们吃掉了，这里必须自己把元素弹出栈 ——
    // 否则后续兄弟元素会变成它的子节点（真踩过：脚本被 sanitize 删掉时，后面的内容跟着一起消失）。
    stack.pop();
  };
  while ((m = re.exec(html))) {
    if (m[5] !== undefined) {
      push(makeTextNode(m[5]));
      continue;
    }
    if (m[1]) {
      const tag = m[1].toLowerCase();
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tagName.toLowerCase() === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    if (m[2]) {
      const tag = m[2];
      const el = new El(tag, doc);
      parseAttrs(el, m[3] ?? '');
      push(el);
      const selfClosing = !!m[4] || VOID_TAGS.has(tag.toLowerCase());
      if (!selfClosing) {
        stack.push(el);
        // 原始文本元素：立刻吃掉内容（否则 JS/CSS 里的 < 会被当成标签，把代码改坏）
        if (RAW_TEXT_TAGS.has(tag.toLowerCase())) consumeRawText(tag.toLowerCase());
      }
      continue;
    }
  }
  return { nodes };
}

function makeTextNode(text) {
  const node = {
    nodeType: 3,
    tagName: '#text',
    textContent: String(text),
    nodeValue: String(text),
    parentElement: null,
    parentNode: null,
    children: [],
    childNodes: [],
    attributes: [],
    get outerHTML() { return escapeText(this.textContent); },
    get innerHTML() { return escapeText(this.textContent); },
    remove() {
      if (this.parentElement) this.parentElement.removeChild(this);
    },
    cloneNode() {
      return makeTextNode(this.textContent);
    },
    _adopt() {},
  };
  return node;
}

function parseAttrs(el, str) {
  const re = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(str))) {
    const name = m[1];
    if (!name) continue;
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    el.setAttribute(name, value);
  }
}

/* --------------------------- 选择器匹配（支持子集） --------------------------- */

function matchesSelector(el, selector) {
  if (el.nodeType !== 1) return false;
  const parts = String(selector).trim().split(/\s+/);
  const last = parts[parts.length - 1];
  if (!matchSimple(el, last)) return false;
  let cur = el.parentElement;
  for (let i = parts.length - 2; i >= 0; i--) {
    let found = false;
    while (cur) {
      if (matchSimple(cur, parts[i])) { found = true; cur = cur.parentElement; break; }
      cur = cur.parentElement;
    }
    if (!found) return false;
  }
  return true;
}

function matchSimple(el, simple) {
  if (!simple) return true;
  // 去掉伪类（:hover 等），空格已在上面切过
  let s = simple.replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, '');
  if (!s) return true;
  // 后代/兄弟组合子不在 simple 里处理
  const tagMatch = s.match(/^[a-zA-Z*][\w-]*/);
  const tag = tagMatch ? tagMatch[0].toLowerCase() : null;
  if (tag && tag !== '*' && el.tagName.toLowerCase() !== tag) return false;
  for (const m of s.matchAll(/\[([\w-]+)(?:([~|^$*]?=)\s*("[^"]*"|'[^']*'|[^\]]+))?\]/g)) {
    const name = m[1];
    if (m[2]) {
      const want = String(m[3]).replace(/^["']|["']$/g, '');
      const have = el.getAttribute(name);
      if (have == null) return false;
      const op = m[2];
      if (op === '=' && have !== want) return false;
      if (op === '^=' && !have.startsWith(want)) return false;
      if (op === '$=' && !have.endsWith(want)) return false;
      if (op === '*=' && !have.includes(want)) return false;
    } else if (el.getAttribute(name) == null) return false;
  }
  for (const m of s.matchAll(/\.([\w-]+)/g)) if (!el.classList.contains(m[1])) return false;
  const idMatch = s.match(/#([\w-]+)/);
  if (idMatch && el.id !== idMatch[1]) return false;
  return true;
}

function collect(root, selector, out) {
  const descend = (node) => {
    if (node.nodeType !== 1) return;
    if (matchesSelector(node, selector) && !out.includes(node)) out.push(node);
    for (const c of node.children) descend(c);
  };
  for (const c of root.children) descend(c);
}

/* --------------------------- 文档解析 --------------------------- */

function parseDocument(html) {
  const doc = new Doc();
  const win = new Win(doc);
  // 去掉 doctype 与注释
  let body = String(html).replace(/<!doctype[^>]*>/gi, '');
  const m = body.match(/<html([^>]*)>([\s\S]*)<\/html>/i);
  const htmlEl = new El('html', doc);
  doc._adopt(htmlEl);
  if (m) {
    parseAttrs(htmlEl, m[1] ?? '');
    body = m[2];
  }
  const headMatch = body.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const headEl = new El('head', doc);
  htmlEl._adopt(headEl);
  if (headMatch) {
    const parsed = parseHtmlFragment(headMatch[1], doc);
    for (const n of parsed.nodes) headEl._adopt(n);
    body = body.replace(headMatch[0], '');
  }
  const bodyMatch = body.match(/<body([^>]*)>([\s\S]*?)<\/body>/i);
  const bodyEl = new El('body', doc);
  htmlEl._adopt(bodyEl);
  if (bodyMatch) {
    parseAttrs(bodyEl, bodyMatch[1] ?? '');
    const parsed = parseHtmlFragment(bodyMatch[2], doc);
    for (const n of parsed.nodes) bodyEl._adopt(n);
  } else {
    const parsed = parseHtmlFragment(body, doc);
    for (const n of parsed.nodes) bodyEl._adopt(n);
  }
  return { window: win, document: doc };
}

module.exports = { parseDocument, El, Doc, parseHtmlFragment, matchesSelector, VOID_TAGS, setScriptExecution };`;
