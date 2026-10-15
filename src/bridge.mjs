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
export function ensureShield(doc) {
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

export function removeShield(doc) {
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
export function installInteractionGuard({ win, picker, post }) {
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

export { NS };
