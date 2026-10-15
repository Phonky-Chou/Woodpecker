/**
 * diff.mjs — 把一次 patch 变成"人能看懂、能验收"的说明。
 * 预览面板、版本列表、日志都用它。
 */

import { describeChange, escapeHtml } from './util.mjs';
import { summarizePatch, patchStats } from './schema.mjs';

export const OP_LABELS = {
  setStyle: '样式',
  setText: '文本',
  setAttr: '属性',
  setHtml: '内部结构',
  insertHtml: '插入节点',
  removeNode: '删除元素',
};

/** 结构化：一行一条改动，供列表渲染 */
export function describePatch(patch) {
  return (patch?.changes ?? []).map((c, i) => ({
    index: i,
    op: c.op,
    opLabel: OP_LABELS[c.op] ?? c.op,
    target: c.target,
    text: describeChange(c),
    raw: c,
  }));
}

/** 纯文本摘要（日志、版本标题） */
export function patchToText(patch) {
  const lines = [];
  if (patch?.summary) lines.push(`摘要：${patch.summary}`);
  const rows = describePatch(patch);
  rows.forEach((r) => lines.push(`${r.index + 1}. [${r.opLabel}] ${r.text}`));
  return lines.join('\n');
}

/** HTML 摘要（预览卡片） */
export function patchToHtml(patch) {
  const stats = patchStats(patch);
  const rows = describePatch(patch)
    .map(
      (r) =>
        `<li class="z-diff-row"><span class="z-op z-op-${escapeHtml(r.op)}">${escapeHtml(r.opLabel)}</span>` +
        `<span class="z-diff-text">${escapeHtml(r.text)}</span>` +
        `<code class="z-diff-target">${escapeHtml(r.target)}</code></li>`,
    )
    .join('');
  return (
    `<div class="z-diff"><div class="z-diff-head">${escapeHtml(summarizePatch(patch))}` +
    `<span class="z-diff-count">${stats.total} 处改动 / ${stats.targets.length} 个元素</span></div>` +
    `<ul class="z-diff-list">${rows}</ul></div>`
  );
}

/** 结构对比：选择器的"前后"是否有变化（版本面板显示 +/-） */
export function structuralDelta(beforeHtml, afterHtml) {
  const before = countTags(beforeHtml);
  const after = countTags(afterHtml);
  const added = [];
  const removed = [];
  for (const [tag, n] of Object.entries(after)) {
    const prev = before[tag] ?? 0;
    if (n > prev) added.push(`${tag} +${n - prev}`);
    if (n < prev) removed.push(`${tag} ${n - prev}`);
  }
  for (const [tag, n] of Object.entries(before)) {
    if (!(tag in after)) removed.push(`${tag} -${n}`);
  }
  return {
    added,
    removed,
    bytes: (afterHtml?.length ?? 0) - (beforeHtml?.length ?? 0),
    changed: (beforeHtml ?? '') !== (afterHtml ?? ''),
  };
}

function countTags(html) {
  const out = {};
  const re = /<([a-z][a-z0-9-]*)\b/gi;
  let m;
  while ((m = re.exec(String(html ?? '')))) {
    const tag = m[1].toLowerCase();
    out[tag] = (out[tag] ?? 0) + 1;
  }
  return out;
}

/** 只保留改动元素的可读定位（"hero 里的 h1"这一类） */
export function shortTargetLabel(desc, pid) {
  if (!desc) return pid;
  const parts = [];
  if (desc.tag) parts.push(desc.tag);
  if (desc.id) parts.push(`#${desc.id}`);
  const text = (desc.text ?? '').trim();
  if (text) parts.push(`“${text.slice(0, 16)}”`);
  return parts.join(' ') || pid;
}
