/**
 * selftest.mjs — 页面内自检套件。
 *
 * 为什么放在这里而不是只在 Node 里测：
 *  锚点注入、悬停命中、预览、回滚、撤销这些事的最终判据是**真实浏览器里的 DOM**。
 *  Node 单测覆盖不了它，而受限环境里又未必能起无头浏览器。
 *  所以把验收脚本放进页面：在真浏览器里跑，结果直接显示给你看（/ 顶栏"自检"按钮）。
 *
 * 调用方式：
 *   __Z__.req('selftest.mjs').runSelfTest(window.__zApp)
 *   —— 返回 { passed, failed, results:[{name, ok, detail}] }
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runSelfTest(app, { log = () => {} } = {}) {
  const results = [];
  const t = () => window.__ztest;

  const check = (name, ok, detail = '') => {
    results.push({ name, ok: !!ok, detail: detail ? String(detail).slice(0, 300) : '' });
    log(`${ok ? '✔' : '✖'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  };

  const want = (name, fn) => ({ name, fn });

  /** 在任意页面上找一个"确定存在、有文字"的候选元素，避免自检写死示例页的选择器 */
  const probeEl = () => {
    const doc = t().doc;
    return (
      doc.querySelector('h1') ||
      doc.querySelector('h2') ||
      doc.querySelector('h3') ||
      doc.querySelector('p') ||
      doc.querySelector('main *') ||
      doc.body?.firstElementChild ||
      null
    );
  };
  const SELECTOR = (() => {
    const el = probeEl();
    if (!el) return null;
    if (el.id) return `#${el.id}`;
    const cls = (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean)[0];
    return cls ? `${el.tagName.toLowerCase()}.${cls}` : el.tagName.toLowerCase();
  })();

  /* ------------------------------------------------------------------ */
  const steps = [
    want('页面所有元素都注入了唯一 data-pid', async () => {
      const stats = await app.rpc('stats');
      check('页面所有元素都注入了唯一 data-pid', stats.anchored === stats.elements && stats.elements > 5, `${stats.anchored}/${stats.elements}`);
    }),

    want('初始工作区自动建立版本 0', async () => {
      check('初始工作区自动建立版本 0', app.store.snapshots.length >= 1 && app.store.snapshots[0].source === 'initial', `versions=${app.store.snapshots.length}`);
    }),

    want('指代器选中元素并打上 .picker-selected', async () => {
      const sel = await t().selectCss(SELECTOR);
      const tag = t().doc.querySelector(SELECTOR).tagName.toLowerCase();
      check('指代器选中元素并打上 .picker-selected', !!sel?.pid && sel.hasMark === true && sel.tag === tag, JSON.stringify({ pid: sel?.pid, mark: sel?.hasMark }));
    }),

    want('元素链能反映从内到外的层级', async () => {
      const el = t().doc.querySelector(SELECTOR);
      const chain = await t().doc.defaultView.__zBridge.picker.chainAt(
        ...(() => {
          const r = el.getBoundingClientRect();
          return [r.x + Math.max(1, r.width / 2), r.y + Math.max(1, r.height / 2)];
        })(),
      );
      const tags = chain.map((x) => x.tagName.toLowerCase());
      check('元素链能反映从内到外的层级', tags[0] === el.tagName.toLowerCase() && tags.includes('body') && tags.at(-1) === 'html', tags.join('›'));
    }),

    want('选中元素的上下文包含计算样式与命中规则', async () => {
      const ctx = await t().context('再大一点');
      const hasComputed = !!ctx?.target?.computed?.['font-size'];
      check('选中元素的上下文包含计算样式与命中规则', hasComputed && ctx.target.pid === app.selection.pid, JSON.stringify(Object.keys(ctx?.target?.computed ?? {}).slice(0, 6)));
    }),

    want('模型返回结构化 JSON patch（不是 HTML 字符串）', async () => {
      await t().selectCss(SELECTOR);
      await t().send('再大一点，换成深蓝');
      const p = app.preview;
      const okPatch = !!p?.patch?.changes?.length && p.patch.changes.every((c) => typeof c.op === 'string' && typeof c.target === 'string');
      check('模型返回结构化 JSON patch（不是 HTML 字符串）', okPatch, JSON.stringify(p?.patch?.changes ?? null));
    }),

    want('预览态改动已经画在页面上', async () => {
      const el = t().doc.querySelector(SELECTOR);
      const changed = el.style.fontSize || el.style.color || el.style.fontWeight;
      check('预览态改动已经画在页面上', !!changed && app.preview != null, `fontSize=${el.style.fontSize} color=${el.style.color}`);
    }),

    want('取消后元素 outerHTML 逐字节还原', async () => {
      const pid = app.selection.pid;
      const before = await t().outerHtml(pid);
      await t().send('加粗');
      const mid = await t().outerHtml(pid);
      await app.cancelPreview();
      const after = await t().outerHtml(pid);
      check('取消后元素 outerHTML 逐字节还原', mid !== before && after === before, `midChanged=${mid !== before} restored=${after === before}`);
    }),

    want('取消"插入内容"（含纯文本）后也能逐字节还原', async () => {
      // 回归：逆操作曾经只收集元素节点，纯文本插入撤销后文字会永久残留
      await t().selectCss(SELECTOR);
      const pid = app.selection.pid;
      const samples = ['纯文本片段', '前<b>粗</b>后', '<span>纯元素</span>'];
      const failed = [];
      for (const html of samples) {
        const restored = await window.__ztest.insertAndUndo(pid, { op: 'insertHtml', target: pid, position: 'append', html });
        if (!restored) failed.push(html);
      }
      check('取消"插入内容"（含纯文本）后也能逐字节还原', failed.length === 0, failed.length ? `未还原：${failed.join(' / ')}` : `${samples.length} 种插入均已还原`);
    }),

    want('结构变化后锚点不漂移（撤销后仍指向同一元素）', async () => {
      const stable = await window.__ztest.pidStabilityCheck();
      check('结构变化后锚点不漂移（撤销后仍指向同一元素）', stable.ok, stable.detail);
    }),

    want('接受后写入版本快照', async () => {
      const before = app.store.snapshots.length;
      await t().selectCss(SELECTOR);
      await t().send('再大一点，换成深蓝');
      await t().accept();
      const s = app.store.current();
      check('接受后写入版本快照', app.store.snapshots.length === before + 1 && s.source === 'ai' && s.prompt.length > 0, `v=${app.store.cursor} label=${s.label}`);
    }),

    want('快照里的 HTML 是干净的（无 pid / 无编辑器注入）', async () => {
      const html = app.store.current().html;
      check('快照里的 HTML 是干净的（无 pid / 无编辑器注入）', !html.includes('data-pid') && !html.includes('picker-selected') && !html.includes('data-z-inject'), `含 pid=${html.includes('data-pid')}`);
    }),

    want('连续三次改动 → 逐级撤销 → 逐级重做', async () => {
      // 找三个互不相同的、确实存在的元素来连续改三次
      const doc = t().doc;
      const candidates = [SELECTOR, 'p', 'li', 'td', 'span', 'div'].map((sel) => ({ sel, el: doc.querySelector(sel) })).filter((x) => x.el);
      const picks = [];
      const seen = new Set();
      for (const c of candidates) {
        if (picks.length >= 3) break;
        if (seen.has(c.el)) continue;
        seen.add(c.el);
        picks.push(c);
      }
      while (picks.length < 3 && candidates.length) picks.push(candidates[picks.length % candidates.length]);
      for (const [i, pick] of picks.entries()) {
        await t().selectCss(pick.sel);
        await t().send(['再大一点', '加粗', '加个阴影'][i % 3]);
        await t().accept();
      }
      const top = app.store.cursor;
      while (app.store.canUndo()) await app.undo();
      const atZero = app.store.cursor === 0 && !app.store.canUndo();
      while (app.store.canRedo()) await app.redo();
      const back = app.store.cursor === top;
      check('连续三次改动 → 逐级撤销 → 逐级重做', atZero && back, `top=${top} 撤销到底=${atZero} 重做回顶=${back}`);
    }),

    want('跳回历史版本后，该版本的 pid 仍然能选中同一元素', async () => {
      const target = app.store.snapshots.find((s) => s.targetPid && s.source === 'ai');
      if (!target) {
        check('跳回历史版本后，该版本的 pid 仍然能选中同一元素', false, '没有带 pid 的版本可测');
        return;
      }
      await app.jumpTo(target.id);
      const info = await window.__ztest.bridge().api.select({ pid: target.targetPid });
      check('跳回历史版本后，该版本的 pid 仍然能选中同一元素', !!info?.pid, `pid=${target.targetPid} → ${info?.label ?? '未找到'}`);
    }),

    want('AI 改范围外的元素会被硬拒绝', async () => {
      await t().selectCss(SELECTOR);
      // 找一个确定不在选中范围里的元素（选中元素本身、或其祖先/后代都不算）
      const scope = t().doc.querySelector(SELECTOR);
      const outsideEl = [...t().doc.querySelectorAll('[data-pid]')].find(
        (el) => el !== scope && !scope.contains(el) && !el.contains(scope),
      );
      const outside = outsideEl?.getAttribute('data-pid');
      let rejected = false;
      let message = '';
      try {
        await window.__ztest.bridge().api.applyPatch({
          patch: {
            version: 1,
            target: app.selection.pid,
            changes: [{ op: 'setStyle', target: outside, prop: 'color', value: 'red' }],
          },
        });
      } catch (err) {
        rejected = true;
        message = err.message;
      }
      check('AI 改范围外的元素会被硬拒绝', rejected && /越界|范围/.test(message), message);
    }),

    want('AI 不能篡改 pid、不能注入脚本、不能整页重写', async () => {
      const api = window.__ztest.bridge().api;
      const pid = app.selection.pid;
      let pidRejected = false;
      let tooManyRejected = false;
      try {
        await api.applyPatch({ patch: { version: 1, target: pid, changes: [{ op: 'setAttr', target: pid, name: 'data-pid', value: 'hacked' }] } });
      } catch {
        pidRejected = true;
      }
      const stillPid = t().doc.querySelector(SELECTOR).getAttribute('data-pid') === pid;
      // 注意：这里的 </script> 必须写成 <\/script>。
      // 内联到单文件 HTML 时，任何裸的 </script> 都会让浏览器**提前结束**外层脚本，
      // 后面的全部内容会当纯文本渲染（曾因此打开页面只看到一堆源码）。
      await api.applyPatch({ patch: { version: 1, target: pid, changes: [{ op: 'setHtml', target: pid, html: '<b>ok</b><script>window.__pwned=1<\/script>' }] } });
      const hasScript = !!t().doc.querySelector(`${SELECTOR} script`);
      const pwned = !!t().win.__pwned;
      try {
        await api.applyPatch({ patch: { version: 1, target: pid, changes: Array.from({ length: 60 }, () => ({ op: 'setText', target: pid, value: 'x' })) } });
      } catch {
        tooManyRejected = true;
      }
      check('AI 不能篡改 pid、不能注入脚本、不能整页重写', pidRejected && stillPid && !hasScript && !pwned && tooManyRejected, JSON.stringify({ pidRejected, stillPid, hasScript, pwned, tooManyRejected }));
    }),

    want('导出 HTML 干净且保留改动', async () => {
      await app.jumpTo(app.store.snapshots.length - 1);
      const clean = await window.__ztest.bridge().api.extractCleanHtml();
      const html = clean.html;
      const leaked = ['data-pid', 'picker-selected', 'data-z-inject', '__zToken', '__zBridge', 'zhidaiqi'].filter((t) => html.includes(t));
      check(
        '导出 HTML 干净且保留改动',
        html.startsWith('<!DOCTYPE') && leaked.length === 0,
        leaked.length ? `残留：${leaked.join(', ')}` : `bytes=${clean.bytes}`,
      );
    }),

    want('快照 HTML 也不含编辑器注入', async () => {
      const html = app.store.current().html;
      const leaked = ['data-pid', 'picker-selected', 'data-z-inject', '__zToken', '__zBridge'].filter((t) => html.includes(t));
      check('快照 HTML 也不含编辑器注入', leaked.length === 0, leaked.length ? `残留：${leaked.join(', ')}` : '干净');
    }),

    want('R1 选中信息是"人话名"（界面里不再出现代码名）', async () => {
      await t().selectCss(SELECTOR);
      const sel = app.selection;
      const hasCode = /[.#>]/.test(sel?.name ?? '');
      const crumbText = app.crumb?.textContent ?? '';
      check(
        'R1 选中信息是"人话名"（界面里不再出现代码名）',
        !!sel?.name && !hasCode && !!sel.icon && !/[.#>]/.test(crumbText),
        `name=${sel?.name} icon=${sel?.icon} 面包屑=${crumbText}`,
      );
    }),

    want('R1.3 技术信息被降级保留（tooltip / 折叠区里还在）', async () => {
      const sel = app.selection;
      const tech = app.panelChat.selCard.querySelector('[data-el="selpath"]')?.textContent ?? '';
      check(
        'R1.3 技术信息被降级保留（tooltip / 折叠区里还在）',
        !!(sel?.tooltip && sel.tooltip.length > 0) && tech.length > 0,
        `tooltip=${(sel?.tooltip ?? '').slice(0, 40)} 折叠区选择器=${tech.slice(0, 40)}`,
      );
    }),

    want('R3.3 快捷词跟随元素类型变化', async () => {
      const doc = t().doc;
      const chipsOf = () => [...app.panelChat.chips.querySelectorAll('.z-chip')].map((b) => b.textContent);
      const heading = doc.querySelector('h1, h2, h3');
      const button = doc.querySelector('button');
      let a = [];
      let b = [];
      if (heading) {
        await t().selectCss(heading.tagName.toLowerCase());
        a = chipsOf();
      }
      if (button) {
        await t().selectCss('button');
        b = chipsOf();
      }
      check(
        'R3.3 快捷词跟随元素类型变化',
        a.length > 0 && b.length > 0 && a.join() !== b.join(),
        `标题=[${a.join('/')}] 按钮=[${b.join('/')}]`,
      );
    }),

    want('R5 重命名后弹层/面板/AI 上下文用同一个名字', async () => {
      await t().selectCss(SELECTOR);
      const pid = app.selection.pid;
      const custom = '自检改名测试';
      app.names[pid] = custom;
      app.saveNames();
      await app.pushNames();
      const fresh = await app.rpc('select', { pid });
      const ctx = await t().context('换个颜色');
      const panelName = app.panelChat.selCard.querySelector('[data-el="selname"]')?.textContent ?? '';
      const ok = fresh?.name === custom && ctx?.target?.humanName === custom && panelName.includes(custom);
      // 清理，避免污染后续用例与用户的命名
      delete app.names[pid];
      app.saveNames();
      await app.pushNames();
      await app.rpc('select', { pid }).catch(() => null);
      check('R5 重命名后弹层/面板/AI 上下文用同一个名字', ok, `选中=${fresh?.name} AI上下文=${ctx?.target?.humanName} 面板=${panelName}`);
    }),

    want('按住弹出 → 松开后选择界面留下，能点到「让 AI 改这块」', async () => {
      const doc = t().doc;
      const win = t().win;
      const el = doc.querySelector(SELECTOR);
      if (!el) {
        check('按住弹出 → 松开后选择界面留下，能点到「让 AI 改这块」', false, '找不到可测元素');
        return;
      }
      const r = el.getBoundingClientRect();
      const at = {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: Math.round(r.x) + Math.max(2, Math.min(6, r.width / 4)),
        clientY: Math.round(r.y) + Math.max(2, Math.min(6, r.height / 4)),
      };
      const fire = (type, extra = {}) => doc.dispatchEvent(new win.PointerEvent(type, { ...at, ...extra }));
      fire('pointerdown');
      await sleep(30);
      const popped = !!app.overlay.bubble;
      fire('pointerup');
      await sleep(60);
      const stuck = !!app.overlay.bubble && app.overlay.bubble.classList.contains('stuck');
      const hasAiBtn = !!app.overlay.bubble?.querySelector('[data-action="ai"]');
      // 清理：关掉工具条，别影响后面的用例
      app.bubbleStuck = false;
      app.overlay.closeBubble();
      check(
        '按住弹出 → 松开后选择界面留下，能点到「让 AI 改这块」',
        popped && stuck && hasAiBtn,
        `按住弹出=${popped} 松手后留下=${stuck} 有AI按钮=${hasAiBtn}`,
      );
    }),

    want('越界时会自动纠正，而不是让用户撞墙', async () => {
      await t().selectCss(SELECTOR);
      const doc = t().doc;
      const scope = doc.querySelector(SELECTOR);
      const pid = app.selection.pid;
      const outside = [...doc.querySelectorAll('[data-pid]')].find(
        (el) => el !== scope && !scope.contains(el) && !el.contains(scope),
      );
      if (!outside) {
        check('越界时会自动纠正，而不是让用户撞墙', false, '找不到范围外元素做测试');
        return;
      }
      const outsidePid = outside.getAttribute('data-pid');
      const original = app.provider;
      let calls = 0;
      app.provider = {
        kind: 'selftest',
        label: '自检用假模型',
        async generate() {
          calls++;
          if (calls === 1) {
            return {
              raw: '{}',
              patch: { version: 1, target: pid, summary: '越界示例', changes: [{ op: 'setStyle', target: outsidePid, prop: 'color', value: 'red' }] },
            };
          }
          return {
            raw: '{}',
            patch: { version: 1, target: pid, summary: '改为改选中元素自身', changes: [{ op: 'setStyle', target: pid, prop: 'background-color', value: 'rgb(240, 240, 240)' }] },
          };
        },
      };
      try {
        await t().send('给这段文字加个垫色块');
        const recovered = !!app.preview && calls === 2;
        if (app.preview) await app.cancelPreview();
        check('越界时会自动纠正，而不是让用户撞墙', recovered, `模型被调用 ${calls} 次，进入预览=${!!app.preview}`);
      } finally {
        app.provider = original;
      }
    }),

    want('按住时高亮由选择界面驱动，不跟随页面乱跳', async () => {
      const doc = t().doc;
      const win = t().win;
      await t().selectCss(SELECTOR);
      const el = doc.querySelector(SELECTOR);
      const r = el.getBoundingClientRect();
      const at = {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: Math.round(r.x) + Math.max(2, Math.min(6, r.width / 4)),
        clientY: Math.round(r.y) + Math.max(2, Math.min(6, r.height / 4)),
      };
      doc.dispatchEvent(new win.PointerEvent('pointerdown', at));
      await sleep(30);
      if (!app.overlay.bubble) {
        check('按住时高亮由选择界面驱动，不跟随页面乱跳', false, '候选界面没弹出来');
        return;
      }
      const initial = app.overlay.currentIndex;
      const initialLabel = app.overlay.hl.querySelector('.z-hl-tag')?.textContent ?? '';
      // 指针在页面上移动（换个位置）
      doc.dispatchEvent(new win.PointerEvent('pointermove', { ...at, clientX: 3, clientY: 3 }));
      await sleep(40);
      const afterMove = app.overlay.currentIndex;
      // 滑到选择界面的第 2 项
      const rows = app.overlay.bubble.querySelectorAll('[data-chain]');
      let afterHover = -1;
      let hoverHighlighted = false;
      if (rows.length >= 2) {
        rows[1].dispatchEvent(new win.MouseEvent('mouseover', { bubbles: true }));
        await sleep(40);
        afterHover = app.overlay.currentIndex;
        hoverHighlighted = rows[1].classList.contains('on');
      }
      const pageDidNotMove = afterMove === initial;
      const bubbleDrives = rows.length < 2 || (afterHover === 1 && hoverHighlighted);
      // 清理：结束这次按住，不留下工具条
      doc.dispatchEvent(new win.PointerEvent('pointerup', at));
      await sleep(40);
      app.bubbleStuck = false;
      app.overlay.closeBubble();
      check(
        '按住时高亮由选择界面驱动，不跟随页面乱跳',
        pageDidNotMove && bubbleDrives,
        `页面移动后层级不变=${pageDidNotMove}(${initial}→${afterMove}) 滑到第2项后=${afterHover} 该项高亮=${hoverHighlighted} 初始高亮=${initialLabel.slice(0, 12)}`,
      );
    }),

    want('版本历史与预览卡渲染正常', async () => {
      app.switchTab('versions');
      const rows = document.querySelectorAll('.z-ver').length;
      const cards = document.querySelectorAll('.z-card').length;
      check('版本历史与预览卡渲染正常', rows >= app.store.snapshots.length && cards >= 1, `rows=${rows} cards=${cards}`);
      app.switchTab('chat');
    }),
  ];

  for (const step of steps) {
    try {
      await step.fn();
    } catch (err) {
      check(step.name, false, `抛错：${err?.message ?? err}`);
    }
    await sleep(30);
  }

  const failed = results.filter((r) => !r.ok).length;
  return { passed: results.length - failed, failed, total: results.length, results };
}

/** 把自检结果渲染成一个浮层（顶栏"自检"按钮调用） */
export function showSelfTestPanel(result) {
  const existing = document.querySelector('.z-selftest-mask');
  existing?.remove();
  const mask = document.createElement('div');
  mask.className = 'z-modal-mask z-selftest-mask';
  const ok = result.failed === 0;
  mask.innerHTML =
    `<div class="z-modal" style="width:min(680px,100%)">` +
    `<div class="z-modal-head"><b>页面内自检</b>` +
    `<span style="font-size:11.5px;color:${ok ? 'var(--z-ok)' : 'var(--z-danger)'}">` +
    `${result.passed}/${result.total} 通过${ok ? ' ✔' : ` · ${result.failed} 项失败`}</span></div>` +
    `<div class="z-modal-body z-scroll" style="gap:6px">` +
    result.results
      .map(
        (r) =>
          `<div style="display:flex;gap:8px;align-items:flex-start;font-size:12px">` +
          `<span style="color:${r.ok ? 'var(--z-ok)' : 'var(--z-danger)'};font-weight:600">${r.ok ? '✔' : '✖'}</span>` +
          `<div><div>${r.name}</div>${r.detail ? `<div style="color:var(--z-dim-2);font-size:11px;font-family:var(--z-mono);word-break:break-all">${r.detail}</div>` : ''}</div></div>`,
      )
      .join('') +
    `</div>` +
    `<div class="z-modal-foot"><button class="z-btn primary" data-act="close">知道了</button></div></div>`;
  document.body.appendChild(mask);
  mask.addEventListener('click', (e) => {
    if (e.target === mask || e.target.closest('[data-act="close"]')) mask.remove();
  });
  return mask;
}
