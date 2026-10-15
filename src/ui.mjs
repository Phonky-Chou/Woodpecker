/**
 * ui.mjs — 编辑器外壳的 DOM：单选卡片、AI 对话框、patch 预览卡、版本历史、设置抽屉。
 * 这里只管"怎么显示"，所有状态与决策在 app.mjs。
 */

import { escapeHtml, formatBytes, formatDateTime, formatTime, truncate } from './util.mjs';
import { patchToHtml } from './diff.mjs';

const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};

export class ChatPanel {
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

    /**
     * 图片区（像 DeepSeek 那样贴图）：
     * 缩略图 + 文件名 + 大小 + ✕ 移除；支持 📎 选择、Ctrl+V 粘贴、拖拽进输入区。
     */
    this.attachRow = el('div', 'z-attach-row');
    this.attachRow.dataset.el = 'attach-row';
    this.thumbs = el('div', 'z-thumbs');
    this.thumbs.dataset.el = 'attach-thumbs';
    this.attachRow.appendChild(this.thumbs);
    this.fileInput = el('input', 'z-hidden');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'image/png,image/jpeg,image/gif,image/webp,image/bmp';
    this.fileInput.multiple = true;
    this.attachBtn = el('button', 'z-btn', '🖼 图片');
    this.attachBtn.title = '加一张图片（也可以直接 Ctrl+V 粘贴截图，或把图片拖进来）';
    this.visionWrap = el('label', 'z-vision');
    this.visionWrap.title = '开启后会把图片一起发给模型（需要视觉模型）；关掉则只让模型按你的话决定插入位置';
    this.visionChk = el('input', 'z-hidden');
    this.visionChk.type = 'checkbox';
    this.visionChk.checked = true;
    this.visionWrap.append(this.visionChk, el('span', '', '让模型看图'));
    const attachBar = el('div', 'z-attach-bar');
    attachBar.append(this.attachBtn, this.visionWrap);
    this.composer.append(attachBar);

    this.row = el('div', 'z-composer-row');
    this.sendBtn = el('button', 'z-btn primary', '生成改动');
    this.sendBtn.disabled = true;
    this.settingsBtn = el('button', 'z-btn', '⚙ 模型设置');
    this.kbd = el('span', 'z-kbd', 'Ctrl+Enter 发送');
    this.row.append(this.sendBtn, this.settingsBtn, this.kbd);
    this.chips = el('div', 'z-chips');
    this.chips.dataset.el = 'chips';
    this.composer.append(this.ta, this.row, this.chips, this.attachRow, this.fileInput);
    this.root.appendChild(this.composer);
    this.renderChips(['大一点', '小一点', '换个颜色', '加个阴影']); // 未选中时的通用兜底

    this.attachBtn.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', () => {
      const files = [...(this.fileInput.files ?? [])];
      if (files.length) this.handlers.onAttachFiles?.(files);
      this.fileInput.value = '';
    });
    this.visionChk.addEventListener('change', () => this.handlers.onVisionToggle?.(this.visionChk.checked));
    // 粘贴截图（像 DeepSeek 一样直接 Ctrl+V）
    this.ta.addEventListener('paste', (e) => {
      const items = [...(e.clipboardData?.items ?? [])];
      const files = items.filter((it) => it.kind === 'file' && /^image\//.test(it.type)).map((it) => it.getAsFile()).filter(Boolean);
      if (files.length) {
        e.preventDefault();
        this.handlers.onAttachFiles?.(files);
      }
    });
    // 拖拽进输入区
    const onDrop = (e) => {
      const files = [...(e.dataTransfer?.files ?? [])].filter((f) => /^image\//.test(f.type));
      if (!files.length) return;
      e.preventDefault();
      this.composer.classList.remove('z-drop-hot');
      this.handlers.onAttachFiles?.(files);
    };
    this.ta.addEventListener('dragover', (e) => {
      if ([...(e.dataTransfer?.items ?? [])].some((it) => it.kind === 'file')) {
        e.preventDefault();
        this.composer.classList.add('z-drop-hot');
      }
    });
    this.ta.addEventListener('dragleave', () => this.composer.classList.remove('z-drop-hot'));
    this.ta.addEventListener('drop', onDrop);

    this.sendBtn.addEventListener('click', () => this.handlers.onSend?.(this.ta.value));
    this.settingsBtn.addEventListener('click', () => this.handlers.onSettings?.());    this.ta.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        this.handlers.onSend?.(this.ta.value);
      }
    });
  }

  /* ------------------------------ 附件缩略图 ------------------------------ */

  /**
   * 渲染待发送的图片（像 DeepSeek 的输入框那样）。
   * @param {Array<{id:string,name:string,bytes:number,width?:number,height?:number,dataUrl:string}>} assets
   */
  renderAttachments(assets = []) {
    this.attachments = assets;
    const has = assets.length > 0;
    this.attachRow.classList.toggle('z-on', has);
    this.thumbs.innerHTML = '';
    for (const a of assets) {
      const card = el('div', 'z-thumb');
      card.dataset.asset = a.id;
      const img = document.createElement('img');
      img.src = a.dataUrl;
      img.alt = a.name;
      const meta = el('div', 'z-thumb-meta');
      meta.innerHTML =
        `<b>${escapeHtml(truncate(a.name, 18))}</b>` +
        `<span>${a.width && a.height ? `${a.width}×${a.height} · ` : ''}${formatBytes(a.bytes)}</span>`;
      const rm = el('button', 'z-thumb-x', '✕');
      rm.title = '移除这张图';
      rm.addEventListener('click', () => this.handlers.onRemoveAsset?.(a.id));
      card.append(img, meta, rm);
      this.thumbs.appendChild(card);
    }
  }

  setVision(on) {
    if (this.visionChk) this.visionChk.checked = !!on;
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

export class VersionsPanel {
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

export class SettingsModal {
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
