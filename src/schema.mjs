/**
 * schema.mjs — Patch v1 的纯校验层（不碰 DOM，可被 Node 直接单测）。
 *
 * 为什么把校验独立出来：模型输出的东西永远不能直接相信。
 * 校验通过才允许执行器靠近 DOM；校验失败整单拒绝，一个字符都不动。
 */

import { ZError, assert } from './util.mjs';

export const PATCH_VERSION = 1;
export const MAX_CHANGES = 50;
export const MAX_HTML_BYTES = 60 * 1024;

export const OPS = ['setStyle', 'setText', 'setAttr', 'setHtml', 'insertHtml', 'insertImage', 'setBackgroundImage', 'removeNode'];
export const INSERT_POSITIONS = ['before', 'after', 'append', 'prepend'];
/** 背景图的尺寸/位置/重复：只给有限几个安全值，避免模型塞进任意 CSS */
export const BG_SIZES = ['cover', 'contain', 'auto', '100% 100%', '100% auto', 'auto 100%'];
export const BG_POSITIONS = ['center', 'top', 'bottom', 'left', 'right', 'top left', 'top right', 'bottom left', 'bottom right', 'center center'];
export const BG_REPEATS = ['no-repeat', 'repeat', 'repeat-x', 'repeat-y'];

/** can-edit 的 CSS 属性白名单：覆盖布局/排版/颜色/装饰/变换，杜绝 position:fixed 之类的越界破坏 */
export const STYLE_WHITELIST = new Set([
  // 布局
  'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'float', 'clear', 'box-sizing',
  'flex', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'justify-content',
  'align-items', 'align-self', 'align-content', 'gap', 'row-gap', 'column-gap', 'order',
  'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row', 'grid-auto-flow', 'place-items',
  'overflow', 'overflow-x', 'overflow-y', 'object-fit', 'object-position', 'aspect-ratio',
  // 尺寸
  'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height',
  // 间距
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  // 排版
  'font', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'word-spacing', 'text-align', 'text-decoration', 'text-transform', 'text-indent', 'text-shadow',
  'white-space', 'word-break', 'overflow-wrap', 'vertical-align', 'writing-mode', 'text-overflow',
  'font-variant', 'font-feature-settings', 'text-wrap', 'hyphens',
  // 颜色与背景
  'color', 'background', 'background-color', 'background-image', 'background-size', 'background-position',
  'background-repeat', 'background-clip', 'opacity', 'mix-blend-mode', 'visibility',
  // 边框与装饰
  'border', 'border-width', 'border-style', 'border-color', 'border-radius', 'border-top', 'border-right',
  'border-bottom', 'border-left', 'border-top-width', 'border-right-width', 'border-bottom-width',
  'border-left-width', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'outline', 'outline-color', 'outline-offset', 'box-shadow', 'filter', 'backdrop-filter', 'cursor',
  'list-style', 'list-style-type', 'list-style-position', 'content',
  // 变换与动画
  'transform', 'transform-origin', 'transition', 'transition-duration', 'transition-property',
  'animation', 'animation-name', 'animation-duration', 'animation-delay', 'animation-iteration-count',
  'animation-timing-function', 'clip-path', 'rotate', 'scale', 'translate',
]);

/** 禁止 setAttr 的属性：改了就破坏锚点/可撤销性/安全边界 */
export const ATTR_BLACKLIST = new Set(['data-pid', 'style', 'classname']);

export function isForbiddenAttrName(name) {
  const n = String(name ?? '').trim().toLowerCase();
  if (!n) return true;
  if (ATTR_BLACKLIST.has(n)) return true;
  if (n.startsWith('on')) return true; // 事件处理器：AI 不许挂
  if (n.startsWith('data-z-')) return true; // 编辑器自身命名空间
  if (n === 'srcdoc' || n === 'sandbox') return true;
  return false;
}

/** 会被"导航/加载"用到的属性：值必须过 URL 白名单，否则等于给 AI 开了 XSS 后门 */
const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'poster', 'data', 'srcset']);
const SAFE_URL_VALUE = /^(?:https?:|mailto:|tel:|#|\/|\.\/|\.\.\/|data:image\/)/i;

export function isForbiddenAttrValue(name, value) {
  const n = String(name ?? '').trim().toLowerCase();
  const v = String(value ?? '').trim();
  if (!URL_ATTRS.has(n)) return false;
  if (!v) return false;
  if (SAFE_URL_VALUE.test(v)) return false;
  // srcset 是逗号分隔的候选列表，逐项判断
  if (n === 'srcset') return v.split(',').some((part) => !SAFE_URL_VALUE.test(part.trim().split(/\s+/)[0] ?? ''));
  return true;
}

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function fail(message, code = 'E_PATCH_INVALID', detail = null) {
  throw new ZError(message, code, detail);
}

/**
 * 结构校验：只检查"形状"，不管 DOM 里有没有这个 pid。
 * @returns {{ok:true, patch:object}|never}
 */
export function validatePatchShape(raw) {
  if (!isPlainObject(raw)) fail('patch 必须是 JSON 对象', 'E_PATCH_SHAPE');
  if (raw.version !== undefined && raw.version !== PATCH_VERSION) {
    fail(`patch.version 只支持 ${PATCH_VERSION}，收到 ${raw.version}`, 'E_PATCH_VERSION');
  }
  if (!isPlainObject(raw.changes) && !Array.isArray(raw.changes)) fail('patch.changes 必须是数组', 'E_PATCH_SHAPE');
  const changes = raw.changes;
  if (!Array.isArray(changes) || changes.length === 0) fail('patch.changes 不能为空', 'E_PATCH_EMPTY');
  if (changes.length > MAX_CHANGES) fail(`单次改动上限 ${MAX_CHANGES} 条，收到 ${changes.length} 条（疑似整页重写）`, 'E_PATCH_TOO_MANY');

  const normalized = { version: PATCH_VERSION, target: null, summary: '', changes: [] };
  if (raw.target !== undefined && raw.target !== null) {
    if (typeof raw.target !== 'string') fail('patch.target 必须是 pid 字符串', 'E_PATCH_SHAPE');
    normalized.target = raw.target;
  }
  normalized.summary = typeof raw.summary === 'string' ? raw.summary.slice(0, 300) : '';
  normalized.notes = typeof raw.notes === 'string' ? raw.notes.slice(0, 1000) : '';

  changes.forEach((change, i) => {
    const at = `changes[${i}]`;
    if (!isPlainObject(change)) fail(`${at} 必须是对象`, 'E_PATCH_SHAPE');
    const op = change.op;
    if (typeof op !== 'string' || !OPS.includes(op)) {
      fail(`${at}.op 不支持：${JSON.stringify(op)}（只允许 ${OPS.join(' / ')}）`, 'E_PATCH_OP');
    }
    const target = change.target;
    if (typeof target !== 'string' || !target.trim()) fail(`${at}.target 必须是非空 pid 字符串`, 'E_PATCH_TARGET');
    const out = { op, target: target.trim() };

    switch (op) {
      case 'setText': {
        if (typeof change.value !== 'string') fail(`${at}.value 必须是字符串`, 'E_PATCH_SHAPE');
        out.value = change.value;
        break;
      }
      case 'setAttr': {
        const name = change.name ?? change.attr;
        if (typeof name !== 'string' || !name.trim()) fail(`${at}.name 必须是非空字符串`, 'E_PATCH_SHAPE');
        if (isForbiddenAttrName(name)) {
          fail(`${at}.name 被禁止：${name}（pid / on* 事件 / style / class 之外的安全边界）`, 'E_PATCH_ATTR_FORBIDDEN');
        }
        out.name = name.trim();
        if (!('value' in change)) fail(`${at}.value 缺失（删除属性请显式写 null）`, 'E_PATCH_SHAPE');
        if (change.value !== null && typeof change.value !== 'string' && typeof change.value !== 'number' && typeof change.value !== 'boolean') {
          fail(`${at}.value 只能是字符串/数字/布尔/null`, 'E_PATCH_SHAPE');
        }
        out.value = change.value === null ? null : String(change.value);
        // 属性名合法不代表值合法：href="javascript:…" 这类必须在这里拦掉
        if (out.value !== null && isForbiddenAttrValue(out.name, out.value)) {
          fail(`${at}.value 被拒绝：${out.name} 不允许指向 ${String(out.value).slice(0, 60)}（URL 白名单外）`, 'E_PATCH_ATTR_VALUE');
        }
        break;
      }
      case 'setStyle': {
        const prop = String(change.prop ?? change.property ?? '').trim().toLowerCase();
        if (!prop) fail(`${at}.prop 必须是非空字符串`, 'E_PATCH_SHAPE');
        if (!STYLE_WHITELIST.has(prop)) fail(`${at}.prop 不在白名单：${prop}`, 'E_PATCH_STYLE_FORBIDDEN');
        if (change.value === null || change.value === undefined) {
          out.prop = prop;
          out.value = null; // 显式删除该行内样式
          break;
        }
        if (typeof change.value !== 'string' && typeof change.value !== 'number') {
          fail(`${at}.value 必须是字符串/数字（删除请写 null）`, 'E_PATCH_SHAPE');
        }
        const rawValue = String(change.value);
        if (/[;{}]/.test(rawValue)) fail(`${at}.value 不允许包含 ; { }（一次只改一个属性）`, 'E_PATCH_STYLE_VALUE');
        if (/url\s*\(\s*['"]?\s*javascript:/i.test(rawValue)) fail(`${at}.value 含危险 url()`, 'E_PATCH_STYLE_VALUE');
        const m = rawValue.match(/\s*!\s*important\s*$/i);
        out.prop = prop;
        out.value = m ? rawValue.slice(0, m.index).trim() : rawValue.trim();
        out.priority = m ? 'important' : '';
        if (!out.value) fail(`${at}.value 为空`, 'E_PATCH_SHAPE');
        break;
      }
      case 'setHtml': {
        if (typeof change.html !== 'string') fail(`${at}.html 必须是字符串`, 'E_PATCH_SHAPE');
        if (change.html.length > MAX_HTML_BYTES) fail(`${at}.html 超过 ${MAX_HTML_BYTES} 字符上限`, 'E_PATCH_TOO_BIG');
        out.html = change.html;
        break;
      }
      case 'insertHtml': {
        if (typeof change.html !== 'string' || !change.html.trim()) fail(`${at}.html 必须是非空字符串`, 'E_PATCH_SHAPE');
        if (change.html.length > MAX_HTML_BYTES) fail(`${at}.html 超过 ${MAX_HTML_BYTES} 字符上限`, 'E_PATCH_TOO_BIG');
        const pos = String(change.position ?? change.pos ?? 'after').toLowerCase();
        if (!INSERT_POSITIONS.includes(pos)) fail(`${at}.position 只能是 ${INSERT_POSITIONS.join(' / ')}`, 'E_PATCH_SHAPE');
        out.position = pos;
        out.html = change.html;
        break;
      }
      case 'insertImage': {
        // 用户从对话框带进来的图片：模型只需要给出"放哪"和"用哪张"，
        // 资源本体（data URL）由父窗口在应用时补上，绝不让模型碰 base64。
        const asset = String(change.asset ?? change.assetId ?? change.image ?? '').trim();
        if (!asset) fail(`${at}.asset 必填（用 context.assets[].id 指定要插入的图片）`, 'E_PATCH_SHAPE');
        out.asset = asset;
        // 图片默认落在选中元素**内部末尾**（不写位置时不要插到选区外面去）
        const pos = String(change.position ?? change.pos ?? 'append').toLowerCase();
        if (!INSERT_POSITIONS.includes(pos)) fail(`${at}.position 只能是 ${INSERT_POSITIONS.join(' / ')}`, 'E_PATCH_SHAPE');
        out.position = pos;
        if (change.alt != null) out.alt = String(change.alt).slice(0, 200);
        if (change.style != null) {
          if (typeof change.style !== 'object' || Array.isArray(change.style)) fail(`${at}.style 必须是对象`, 'E_PATCH_SHAPE');
          const style = {};
          for (const [rawProp, rawValue] of Object.entries(change.style)) {
            style[String(rawProp)] = String(rawValue ?? '');
          }
          out.style = style;
        }
        break;
      }
      case 'setBackgroundImage': {
        // "把这张图当这一页的背景"：背景不是插入元素，而是给元素设 background-image。
        // 模型同样只给 asset id，真实 data URL 由父窗口补。
        const asset = String(change.asset ?? change.assetId ?? change.image ?? '').trim();
        if (!asset) fail(`${at}.asset 必填（用 context.assets[].id 指定哪张图当背景）`, 'E_PATCH_SHAPE');
        out.asset = asset;
        const size = String(change.size ?? change['background-size'] ?? 'cover').toLowerCase().trim();
        if (!BG_SIZES.includes(size)) fail(`${at}.size 只能是 ${BG_SIZES.join(' / ')}`, 'E_PATCH_SHAPE');
        out.size = size;
        const position = String(change.position ?? change['background-position'] ?? 'center').toLowerCase().trim();
        if (!BG_POSITIONS.includes(position)) fail(`${at}.position 只能是 ${BG_POSITIONS.join(' / ')}`, 'E_PATCH_SHAPE');
        out.position = position;
        const repeat = String(change.repeat ?? change['background-repeat'] ?? 'no-repeat').toLowerCase().trim();
        if (!BG_REPEATS.includes(repeat)) fail(`${at}.repeat 只能是 ${BG_REPEATS.join(' / ')}`, 'E_PATCH_SHAPE');
        out.repeat = repeat;
        break;
      }
      case 'removeNode':
        break;
      default:
        fail(`${at}.op 不支持`, 'E_PATCH_OP');
    }
    normalized.changes.push(out);
  });

  return { ok: true, patch: normalized };
}

/**
 * 范围校验：每条改动的 target 必须落在 scope 内（含 scope 自身）。
 * @param {object} patch 已通过 shape 校验
 * @param {(pid:string)=>boolean} isWithin 由调用方提供的锚点校验函数
 */
export function validatePatchScope(patch, isWithin) {
  for (const c of patch.changes) {
    if (!isWithin(c.target)) {
      fail(
        `改动越界：${c.op} 想改 ${c.target}，但它不在当前选中元素范围内（AI 只被允许改选中的这一块）`,
        'E_PATCH_OUT_OF_SCOPE',
        c,
      );
    }
  }
  return true;
}

/** 一步到位：形状 + 范围。isWithin 可省略（省略时只校验形状）。 */
export function validatePatch(raw, isWithin) {
  const { patch } = validatePatchShape(raw);
  if (typeof isWithin === 'function') validatePatchScope(patch, isWithin);
  return patch;
}

/** 供 UI 显示：把 patch 压成一行人话 */
export function summarizePatch(patch) {
  if (!patch) return '';
  if (patch.summary) return patch.summary;
  const parts = (patch.changes ?? []).slice(0, 3).map((c) => {
    switch (c.op) {
      case 'setStyle':
        return `${c.prop}: ${c.value ?? '删除'}`;
      case 'setText':
        return `文本“${String(c.value).slice(0, 12)}”`;
      case 'setAttr':
        return `${c.name}=${c.value === null ? '删除' : String(c.value).slice(0, 12)}`;
      case 'setHtml':
        return '换内部 HTML';
      case 'insertHtml':
        return `${c.position} 插入`;
      case 'insertImage': {
        const where = { before: '前面', after: '后面', append: '内部末尾', prepend: '内部开头' }[c.position] ?? c.position;
        return `图片插到${where}`;
      }
      case 'setBackgroundImage':
        return '换成背景图';
      case 'removeNode':
        return '删除元素';
      default:
        return c.op;
    }
  });
  const more = (patch.changes?.length ?? 0) - parts.length;
  return parts.join('、') + (more > 0 ? ` 等 ${patch.changes.length} 处` : '');
}

/** 统计本次改动"碰了什么"（版本列表与日志用） */
export function patchStats(patch) {
  const stats = { total: 0, byOp: {}, targets: new Set() };
  for (const c of patch?.changes ?? []) {
    stats.total++;
    stats.byOp[c.op] = (stats.byOp[c.op] ?? 0) + 1;
    stats.targets.add(c.target);
  }
  return { ...stats, targets: [...stats.targets] };
}
