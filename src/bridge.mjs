/**
 * bridge.mjs — iframe 内的 RPC 桥。
 *
 * 父窗口把所有"改 DOM"的动作都通过这里下发；iframe 只回报事实。
 * 这样模型、UI、快照全都在父窗口，iframe 里没有一行"业务决策"。
 *
 * 消息形状：{ __z: 'req'|'res'|'evt', id, op?, args?, ok?, result?, error? }
 */

import { AnchorManager, selectorPath } from './anchor.mjs';
import { Picker, MODES } from './picker.mjs';
import { applyPatch, undoPatch, sanitizeHtmlFragment, scrubEditorArtifacts } from './patch.mjs';
import { validatePatch } from './schema.mjs';
import { buildContext } from './selector.mjs';
import { describeElement } from './naming.mjs';
import { ZError, truncateBytes } from './util.mjs';

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

export function installBridge({ win, doc, token }) {
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

export { NS };
