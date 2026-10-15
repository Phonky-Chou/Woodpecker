/**
 * selector.mjs — 生成"发给模型的上下文"。见 CONTRACT.md §3。
 *
 * 关键取舍：不整页丢给模型。
 *  选中元素 outerHTML（截断） + 关键计算样式 + 命中的 CSS 规则 + 用户原话
 * 这样 token 小、指向明确，模型也很难"顺手改别处"。
 */

import { truncateBytes } from './util.mjs';
import { describeElement } from './naming.mjs';
import { selectorPath } from './anchor.mjs';

/** 计算样式里真正影响"看起来怎样"的属性子集。 */
export const COMPUTED_KEYS = [
  'display', 'position', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'text-align', 'text-decoration-line', 'text-transform', 'white-space', 'word-break', 'overflow-wrap',
  'color', 'background-color', 'background-image', 'border-radius', 'border-width', 'border-style',
  'border-color', 'box-shadow', 'opacity', 'overflow', 'flex-direction', 'justify-content', 'align-items',
  'gap', 'grid-template-columns', 'transform', 'z-index', 'visibility', 'cursor',
];

/** 命中规则里允许出现的属性（避免把整页 design token 灌给模型）。 */
const RULE_PROP_WHITELIST = new Set([
  ...COMPUTED_KEYS,
  'font', 'background', 'border', 'margin', 'padding', 'text-shadow', 'transition', 'flex', 'grid', 'content',
]);

export function computedSubset(win, el) {
  const cs = win.getComputedStyle(el);
  const out = {};
  for (const key of COMPUTED_KEYS) {
    const v = cs.getPropertyValue(key);
    if (v && v !== 'normal' && v !== 'none' && v !== 'auto' && v !== '0px') out[key] = v;
    else if (v && ['display', 'position', 'color', 'font-size', 'font-weight'].includes(key)) out[key] = v;
  }
  return out;
}

export function rectOf(el) {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
}

/** 反查：哪些样式表规则命中了这个元素。让模型知道"现在为什么长这样"。 */
export function matchedCssRules(win, doc, el, limit = 24) {
  const found = [];
  let sheets;
  try {
    sheets = [...doc.styleSheets];
  } catch {
    return found;
  }
  const visit = (rules, origin) => {
    if (!rules || found.length >= limit) return;
    for (const rule of rules) {
      if (found.length >= limit) break;
      if (rule.selectorText) {
        let hit = false;
        try {
          hit = el.matches(rule.selectorText);
        } catch {
          hit = false; // 有些选择器（:has 等）在旧引擎里会抛错，跳过即可
        }
        if (hit) {
          const props = [];
          for (const prop of rule.style ?? []) {
            if (RULE_PROP_WHITELIST.has(prop)) props.push(`${prop}: ${rule.style.getPropertyValue(prop)}${rule.style.getPropertyPriority(prop) ? ' !important' : ''}`);
          }
          if (props.length) {
            found.push({
              selector: rule.selectorText.slice(0, 160),
              cssText: props.join('; '),
              origin: origin || rule.parentStyleSheet?.href || 'inline <style>',
            });
          }
        }
      } else if (rule.cssRules) {
        visit(rule.cssRules, rule.conditionText ? `@media ${rule.conditionText}` : origin);
      }
    }
  };
  for (const sheet of sheets) {
    try {
      visit(sheet.cssRules, sheet.href || 'inline <style>');
    } catch {
      /* 跨域样式表：忽略 */
    }
  }
  return found;
}

/**
 * 构建 ContextEnvelope v1。
 * @param {object} p
 * @param {Window} p.win iframe 的 window
 * @param {Document} p.doc iframe 的 document
 * @param {Element} p.el 选中的元素
 * @param {string} p.pid
 * @param {string} p.request 用户原话
 * @param {Array} p.history 之前几轮对话（role/text）
 */
export function buildContext({ win, doc, el, pid, request, history = [], names = null, retry = null, assets = [], maxHtmlBytes = 24 * 1024 }) {
  const chain = [];
  let cur = el;
  while (cur && cur.nodeType === 1 && chain.length < 12) {
    let human = null;
    try {
      human = describeElement(cur, { win, names, selectorPath: selectorPath(cur) });
    } catch {
      human = null; // 命名失败不能影响发给模型的上下文
    }
    const isTarget = cur === el;
    chain.push({
      // 关键：祖先元素**不给 pid**。
      // 之前这里给的是 pid，模型会拿它去 setStyle，然后必然撞"越界"——
      // 等于我们主动递了一把用不了的钥匙。祖先只作只读上下文，用 ref 标识。
      ref: isTarget ? 'target' : `ancestor-${chain.length}`,
      modifiable: false,
      tag: cur.tagName.toLowerCase(),
      humanName: human?.name ?? null,
      id: cur.id || null,
      classes: (typeof cur.className === 'string' ? cur.className : '')
        .split(/\s+/)
        .filter((c) => c && c !== 'picker-selected' && !c.startsWith('z-')),
      text: cur.children.length === 0 ? (cur.textContent || '').trim().slice(0, 40) : null,
    });
    cur = cur.parentElement;
  }
  chain.reverse();

  const outer = truncateBytes(el.outerHTML, maxHtmlBytes);
  const attrs = {};
  for (const a of el.attributes) {
    if (a.name === 'data-pid' || a.name.startsWith('data-z-')) continue;
    attrs[a.name] = a.value.length > 300 ? a.value.slice(0, 300) + '…' : a.value;
  }

  let human = null;
  try {
    human = describeElement(el, { win, names, box: rectOf(el), selectorPath: chain.map((c) => c.tag).join(' > ') });
  } catch {
    human = null;
  }

  // 允许出现在 changes[].target 里的 pid：只有选中元素本身，以及它内部元素
  // （内部元素的 pid 就在 outerHtml 里，模型可以直接看到）
  const modifiablePids = [pid, ...[...el.querySelectorAll('[data-pid]')].map((n) => n.getAttribute('data-pid'))].filter(Boolean);

  return {
    kind: 'zhidaiqi.context',
    version: 1,
    target: {
      pid,
      // 明确列出"可以改哪些 pid"，避免模型去猜（它猜过祖先，必然越界）
      modifiablePids,
      humanName: human?.name ?? null,
      elementKind: human?.kind ?? null,
      tag: el.tagName.toLowerCase(),
      selectorPath: chain
        .map((c) => c.tag.toLowerCase() + (c.id ? `#${c.id}` : c.classes.length ? `.${c.classes.slice(0, 2).join('.')}` : ''))
        .join(' > '),
      chain,
      outerHtml: outer.text,
      htmlTruncated: outer.truncated,
      innerText: (el.textContent || '').trim().slice(0, 500),
      attrs,
      rect: rectOf(el),
      computed: computedSubset(win, el),
      matchedCssRules: matchedCssRules(win, doc, el),
      childCount: el.children.length,
      descendantCount: el.querySelectorAll('*').length,
    },
    request: String(request ?? ''),
    // 用户从对话框带进来的图片：**只给元数据**（id/名称/尺寸/大小），不给 base64 ——
    // 模型只需要"用哪张、放哪里"，图片本体由父窗口在应用 patch 时补上。
    assets: (Array.isArray(assets) ? assets : [])
      .slice(0, 6)
      .map((a) => ({
        id: String(a?.id ?? ''),
        name: String(a?.name ?? '').slice(0, 60),
        mime: String(a?.mime ?? ''),
        width: Number(a?.width) || null,
        height: Number(a?.height) || null,
        bytes: Number(a?.bytes) || null,
      }))
      .filter((a) => a.id),
    // 上一次被拒绝时的反馈（父窗口在"越界/资源不存在"后自动补上，让模型知道该怎么改）
    retry: retry && typeof retry === 'object' ? retry : null,
    history: (history ?? []).slice(-6),
  };
}
