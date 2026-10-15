/**
 * app.mjs — 编辑器主控。所有"业务决策"都在这里：
 *   装载用户 HTML → 桥接指代器事件 → 调模型拿 JSON patch → iframe 内预览
 *   → 接受则存快照 → 撤销/重做/回看
 *
 * iframe 只负责"事实"（选中的 pid、矩形、DOM 操作），一行决策都没有。
 */

import { SnapshotStore } from './snapshot.mjs';
import { createProvider, PROVIDERS } from './provider.mjs';
import { ChatPanel, VersionsPanel, SettingsModal } from './ui.mjs';
import { Overlay } from './overlay.mjs';
import { validatePatch, summarizePatch } from './schema.mjs';
import { deepClone, escapeHtml, formatBytes, formatDateTime, safeJsonParse, truncate, uid } from './util.mjs';
import { describePatch } from './diff.mjs';
import { chipsFor, breadcrumbFromChain } from './naming.mjs';

const NS = 'zhidaiqi';

/* ============================== 图片附件（常量与工具） ============================== */

/** 一次最多带几张图（和 context.assets 的截断保持一致，避免模型看到不存在的图） */
const MAX_ASSETS = 6;
/** 单张图的体积上限：图片会内嵌进 HTML 并随每次版本快照进 localStorage，必须压住 */
const MAX_ASSET_BYTES = 800 * 1024;
/** 长边上限（超过就等比缩小） */
const MAX_ASSET_EDGE = 1600;

/** 读文件为 data URL（浏览器用 FileReader；缺失时退回 arrayBuffer） */
async function readAsDataUrl(file) {
  if (typeof FileReader !== 'undefined') {
    return await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error('读文件失败'));
      fr.readAsDataURL(file);
    });
  }
  if (typeof file.arrayBuffer === 'function') {
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (const b of buf) bin += String.fromCharCode(b);
    return `data:${file.type || 'image/png'};base64,${btoa(bin)}`;
  }
  throw new Error('当前环境无法读取文件');
}

/** 量一下 data URL 的像素尺寸（没有 Image 就返回 null，不阻塞流程） */
function measureImage(dataUrl) {
  if (typeof Image === 'undefined') return Promise.resolve({ width: null, height: null });
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || img.width || null, height: img.naturalHeight || img.height || null });
    img.onerror = () => resolve({ width: null, height: null });
    img.src = dataUrl;
  });
}

/**
 * 超大图就等比缩小并重新编码。没有 canvas 的环境（Node 测试）直接原样返回。
 * @returns {Promise<{dataUrl:string,width:number|null,height:number|null,bytes:number}>}
 */
async function downscaleIfNeeded(dataUrl, mime) {
  const size = await measureImage(dataUrl);
  const bytesOf = (u) => Math.round(u.length * 0.75);
  const bigEdge = size.width && size.height && Math.max(size.width, size.height) > MAX_ASSET_EDGE;
  const bigBytes = bytesOf(dataUrl) > MAX_ASSET_BYTES;
  const canDraw = typeof document !== 'undefined' && typeof document.createElement === 'function';
  if ((!bigEdge && !bigBytes) || !canDraw || !size.width) {
    return { dataUrl, width: size.width, height: size.height, bytes: bytesOf(dataUrl) };
  }
  try {
    const scale = bigEdge ? MAX_ASSET_EDGE / Math.max(size.width, size.height) : 1;
    const w = Math.max(1, Math.round(size.width * scale));
    const h = Math.max(1, Math.round(size.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return { dataUrl, width: size.width, height: size.height, bytes: bytesOf(dataUrl) };
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('图片解码失败'));
      img.src = dataUrl;
    });
    ctx.drawImage(img, 0, 0, w, h);
    // PNG 可能是截图/带透明，体积优先用 JPEG，除非本来就很小
    const asJpeg = !/png/i.test(mime) || bytesOf(dataUrl) > MAX_ASSET_BYTES;
    const out = canvas.toDataURL?.(asJpeg ? 'image/jpeg' : 'image/png', 0.85) ?? dataUrl;
    return { dataUrl: out, width: w, height: h, bytes: bytesOf(out) };
  } catch {
    return { dataUrl, width: size.width, height: size.height, bytes: bytesOf(dataUrl) };
  }
}
const BUBBLE_ACTIONS = [
  { id: 'ai', label: '✦ 让 AI 改这块', primary: true },
  { id: 'rename', label: '✎ 改名' },
  { id: 'copy', label: '复制选择器' },
  { id: 'cancel', label: '取消' },
];

export class EditorApp {
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

    // 图片附件：只活在本次会话（图片本体已经内嵌进页面 HTML，不需要额外持久化）
    this.assets = [];
    this.assetSeq = 0;
    this.visionSend = true; // 默认也把图发给模型（视觉模型能"看图"），可在输入区关掉
    // 端点明确拒绝图片输入后就记住，别每次再传 ~1MB（位置判断只靠文字也能做）
    this.visionBlocked = false;

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
          { label: '🧪 页面内自检', hint: '真实浏览器里跑一遍', run: () => this.runSelfTest() },
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
      onAttachFiles: (files) => this.ingestFiles(files),
      onRemoveAsset: (id) => this.removeAsset(id),
      onVisionToggle: (on) => {
        this.visionSend = !!on;
      },
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
      const useVision = this.visionSend && !this.visionBlocked;
      let context = await this.rpc('getContext', { request, history: this.history.slice(-6), assets: this.assetMeta() });
      this.panelChat.setBusy(true, `正在读取 ${this.selection.name ?? this.selection.label} 的样式与结构…`);
      let result = await this.provider.generate(context, {
        onDelta: (hint) => this.panelChat.setBusy(true, hint),
        assets: useVision ? this.assets : [],
      });
      this.panelChat.setBusy(false);
      // 这个模型/端点不接受图片输入 → 记住它，之后不再上传（一张图 base64 就是 ~1MB，
      // 反复上传既慢又容易被网关拒掉；位置判断本来只靠文字就能完成）
      if (result.visionFallback && !this.visionBlocked) {
        this.visionBlocked = true;
        this.panelChat.addMessage(
          'sys',
          '这个模型不接受图片输入，后续不再把图片发给它（插入位置/背景仍按你的描述判断）。\n' +
            '想让模型真的"看图"，请在 模型设置 里换一个视觉模型。',
        );
      }
      // 第 1 步的验收要求：先能在控制台看到结构化输出
      console.log('[zhidaiqi] 模型返回原文：\n', result.raw);
      console.log('[zhidaiqi] 解析后的 Patch v1：', result.patch);

      // 自愈：模型偶尔会引用选中范围外的元素，或引用不存在的图片资源。
      // 不把它变成用户的死路 —— 把"可用的 pid / 可用的图片 id"回喂给模型，让它自己纠正一次。
      let retried = false;
      for (;;) {
        try {
          await this.openPreview(result);
          break;
        } catch (err) {
          const scopeError = err?.code === 'E_PATCH_OUT_OF_SCOPE' || err?.code === 'E_PATCH_TARGET_MISSING';
          const assetError = err?.code === 'E_PATCH_UNKNOWN_ASSET' || err?.code === 'E_PATCH_BAD_ASSET';
          if ((!scopeError && !assetError) || retried) {
            this.lastScopeError = scopeError ? { error: err.message, request } : null;
            throw err;
          }
          retried = true;
          const allowedPids = context.target?.modifiablePids ?? [context.target?.pid].filter(Boolean);
          const allowedAssets = this.assets.map((a) => a.id);
          this.panelChat.addMessage(
            'sys',
            assetError
              ? `AI 引用的图片不存在（${err.message.slice(0, 60)}…）。我已把可用的图片 id 告诉它，让它重新生成…`
              : `AI 想改的那块不在你选中的范围内（${err.message.slice(0, 60)}…）。\n` +
                  `我已把"只能改这 ${allowedPids.length} 个元素"告诉它，让它改用选中元素自身能实现的方式重新生成…`,
          );
          this.panelChat.setBusy(true, '正在按约束重新生成…');
          context = await this.rpc('getContext', {
            request,
            history: this.history.slice(-6),
            assets: this.assetMeta(),
            retry: { error: err.message, allowedPids, allowedAssets },
          });
          result = await this.provider.generate(context, {
            onDelta: (hint) => this.panelChat.setBusy(true, hint),
            assets: this.visionSend && !this.visionBlocked ? this.assets : [],
          });
          if (result.visionFallback) this.visionBlocked = true;
          this.panelChat.setBusy(false);
          console.log('[zhidaiqi] 被拒后重试返回：', result.patch);
        }
      }
      this.lastScopeError = null;
      // 图片已经内嵌进页面了，待发送区清空（取消预览时页面会还原，用户可以重新贴）
      if (this.assets.length) {
        this.clearAssets();
        this.panelChat.addMessage('sys', '图片已插入页面并内嵌为 base64（单文件可直接分享），待发送区已清空。');
      }
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
    const applied = await this.rpc('applyPatch', { patch, assets: this.assetMap() });
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

  /* ================================ 图片附件 ================================ */

  /**
   * 把用户贴进来的图片转成"可内嵌进 HTML 的 data URL"。
   *
   * 为什么要处理尺寸与体积：图片会被内嵌进 HTML，而每次"接受"都会存一份快照到 localStorage，
   * 一张 4 MB 的原图叠几个版本就会把 5 MB 的配额撑爆。所以这里统一压到
   * 长边 ≤ 1600px、单张 ≤ 800 KB（照片转 JPEG，小图保持原格式）。
   * 所有浏览器 API 都做了存在性判断：Node 测试环境（shim）里没有 Image/FileReader/canvas，
   * 那一层直接跳过处理、接受现成的 data URL，功能逻辑仍然可测。
   */
  async ingestFiles(files) {
    const list = [...(files ?? [])].filter((f) => f && (/^image\//i.test(f.type ?? '') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name ?? '')));
    if (!list.length) return;
    if (list.some((f) => f.type && !/^image\/(png|jpe?g|gif|webp|bmp)$/i.test(f.type))) {
      this.toast('只支持 png / jpg / gif / webp / bmp 图片', 'warn');
      return;
    }
    for (const file of list) {
      if (this.assets.length >= MAX_ASSETS) {
        this.toast(`一次最多带 ${MAX_ASSETS} 张图`, 'warn');
        break;
      }
      try {
        const dataUrl = await readAsDataUrl(file);
        const processed = await downscaleIfNeeded(dataUrl, file.type ?? '');
        if (processed.bytes > MAX_ASSET_BYTES) {
          this.toast(`「${file.name ?? '图片'}」处理后仍然太大（${formatBytes(processed.bytes)}），换张小一点的`, 'err');
          continue;
        }
        this.addAsset({
          name: file.name || `图片${this.assets.length + 1}`,
          mime: (processed.dataUrl.match(/^data:([^;]+)/) ?? [, 'image/png'])[1],
          dataUrl: processed.dataUrl,
          width: processed.width,
          height: processed.height,
          bytes: processed.bytes,
        });
      } catch (err) {
        this.toast(`读取图片失败：${err.message}`, 'err');
      }
    }
  }

  /** 登记一张图片（测试与粘贴/拖拽/选择文件都走这里） */
  addAsset(asset) {
    if (!asset?.dataUrl) return null;
    const id = `a${++this.assetSeq}`;
    const item = {
      id,
      name: String(asset.name ?? '图片').slice(0, 60),
      mime: String(asset.mime ?? 'image/png'),
      dataUrl: String(asset.dataUrl),
      width: Number(asset.width) || null,
      height: Number(asset.height) || null,
      bytes: Number(asset.bytes) || Math.round(String(asset.dataUrl).length * 0.75),
    };
    this.assets.push(item);
    this.panelChat.renderAttachments(this.assets);
    console.log('[zhidaiqi] 已加入图片：', item.id, item.name, formatBytes(item.bytes));
    return item;
  }

  removeAsset(id) {
    this.assets = this.assets.filter((a) => a.id !== id);
    this.panelChat.renderAttachments(this.assets);
  }

  clearAssets() {
    this.assets = [];
    this.panelChat.renderAttachments([]);
  }

  /** 给桥用的资源表：id → data URL（应用 patch 时把 insertImage 补成真的 img） */
  assetMap() {
    const map = {};
    for (const a of this.assets) map[a.id] = { dataUrl: a.dataUrl, name: a.name, width: a.width, height: a.height };
    return map;
  }

  /** 给模型的资源清单：只有元数据，没有 base64 */
  assetMeta() {
    return this.assets.map((a) => ({ id: a.id, name: a.name, mime: a.mime, width: a.width, height: a.height, bytes: a.bytes }));
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
