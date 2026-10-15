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

import { escapeHtml } from './util.mjs';

export class Overlay {
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
      `<div class="z-bubble-hint">↑↓ 换层级<br>Enter 选中<br>Esc 取消<br>双击可改名</div>` +
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

    // 按住时把指针移到弹层上：立刻"钉住"，
    // 否则弹层会继续跟着指针换层级，用户根本没法稳定点到某一项或按钮。
    el.addEventListener('mouseenter', () => {
      if (this.bubble?.classList.contains('stuck')) return;
      this.onAction?.({ type: 'bubble-hover', chain: this.chain ?? chain, index: this.currentIndex ?? index });
    });

    // R2.4：在弹层里 hover 某一项时，预览区实时高亮对应元素
    el.addEventListener('mouseover', (e) => {
      const chainBtn = e.target.closest('[data-chain]');
      if (!chainBtn) return;
      const i = Number(chainBtn.dataset.chain);
      const c = chain[i];
      if (!c) return;
      this.setBubbleIndex(i);
      this.showHighlight(c, { label: `${c.icon ?? ''} ${c.name ?? ''} · ${c.box?.w ?? 0}×${c.box?.h ?? 0}` });
    });

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
    }
  }

  /**
   * 松开鼠标后把弹层**留在页面上**，变成"已选中"工具条。
   *
   * 为什么必须这么做：原来一松手就整体消失，用户根本来不及点到「让 AI 改这块」，
   * 主功能等于不可用。现在松开 = 选中 + 工具条常驻，用户可以从容点按钮。
   * 位置锚定到选中元素的下方（贴边时 positionBubble 会自动翻转）。
   */
  stickBubble({ chain, index = 0 }) {
    if (!this.bubble) return false;
    this.bubble.classList.add('stuck');
    this.chain = chain ?? this.chain;
    this.setBubbleIndex(index);
    const c = this.chain?.[index];
    const hint = this.bubble.querySelector('.z-bubble-hint');
    if (hint) hint.innerHTML = '已选中<br>↑↓ 换层级<br>Esc 关闭';
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
