/**
 * patch.mjs — 结构化 patch 的 DOM 执行器（唯一允许改用户 DOM 的地方）。
 *
 * 三条铁律：
 *  1. 先全量校验，再动手。任一条不合法 → 抛错，DOM 零改动。
 *  2. 只改 scope（选中元素及其子树）内部，pid 一律不改写、不删除。
 *  3. 每个操作都产出可精确回滚的"逆条目"；undo 逆序执行，回到改动前。
 *
 * 逆条目用"受影响子树快照"实现，而不是零碎地记旧值——因为一个 setText
 * 可能被另一个 setHtml 覆盖，零碎回滚顺序一错就还原不干净。
 */

import { AnchorManager, PID_ATTR } from './anchor.mjs';
import { validatePatchShape, validatePatchScope } from './schema.mjs';
import { ZError, uid } from './util.mjs';

const DANGEROUS_TAGS = new Set(['SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE', 'FORM', 'STYLE']);
const SAFE_URL = /^(?:https?:|mailto:|tel:|#|\/|\.\/|\.\.\/|data:image\/)/i;

/** 判断某个属性名是否属于"编辑器自身"（高亮/预览标记），导出与快照前会剥掉。 */
export function isEditorArtifactAttr(name) {
  const n = String(name ?? '').toLowerCase();
  return n.startsWith('data-z-') || n === 'data-pid' || n === 'contenteditable';
}

/**
 * 清洗模型给的 HTML 片段：去掉脚本、内联事件、危险 URL。
 * 这是"AI 不许乱塞东西"的最后一道闸。
 */
export function sanitizeHtmlFragment(doc, html) {
  const tpl = doc.createElement('template');
  tpl.innerHTML = String(html ?? '');
  const walk = (node) => {
    for (const child of [...node.children]) {
      if (DANGEROUS_TAGS.has(child.tagName)) {
        child.remove();
        continue;
      }
      for (const attr of [...child.attributes]) {
        const name = attr.name.toLowerCase();
        const value = String(attr.value ?? '');
        if (name.startsWith('on') || name === 'srcdoc' || name === 'sandbox') {
          child.removeAttribute(attr.name);
          continue;
        }
        // 编辑器私有命名空间：剥离属性即可。
        // 不能留着 —— 导出时的 scrubEditorArtifacts 会把带 data-z-* 的元素**整块删掉**，
        // 那样用户明明看到并"接受"的内容会在快照里凭空消失。
        if (name.startsWith('data-z-')) {
          child.removeAttribute(attr.name);
          continue;
        }
        if ((name === 'href' || name === 'src' || name === 'xlink:href' || name === 'action' || name === 'formaction' || name === 'poster') && !SAFE_URL.test(value.trim())) {
          child.removeAttribute(attr.name);
          continue;
        }
        if (name === 'style' && /javascript\s*:|expression\s*\(/i.test(value)) child.removeAttribute(attr.name);
        if (name === PID_ATTR) child.removeAttribute(attr.name); // 由锚点管理器重新分配
      }
      walk(child);
    }
  };
  walk(tpl.content);
  return tpl.innerHTML;
}

function findByPid(doc, anchor, pid) {
  const el = anchor.resolve(pid) ?? doc.querySelector(`[${PID_ATTR}="${pid}"]`);
  if (!el) throw new ZError(`找不到 pid=${pid} 对应的元素（可能已被删除）`, 'E_PATCH_TARGET_MISSING', { pid });
  return el;
}

/**
 * 子树快照。
 * 关键：快照里**必须剥掉 data-pid**。否则撤销时把快照写回去，
 * 同一棵子树就会出现两个相同 pid 的元素（新生成的 + 快照里带回来的），
 * 之后 resolve(pid) 可能命中错的那个——锚点唯一的保证就此破功。
 * 剥掉之后由 injectSubtree 重新分配，因为 pid 是按结构哈希的，重算结果与原来一致。
 */
function snapshotTree(anchor, el) {
  const attrs = {};
  for (const a of [...el.attributes]) {
    if (a.name === PID_ATTR) continue;
    attrs[a.name] = a.value;
  }
  return {
    pid: anchor.pidOf(el),
    html: el.innerHTML,
    outer: el.outerHTML,
    attrs,
    style: el.hasAttribute('style') ? el.getAttribute('style') : null,
  };
}

/**
 * 注意：这里**不再用正则**去"删除 HTML 文本里的 data-pid"。
 * 早期版本用 / data-pid=…/ 全局替换，会连正文里出现的 " data-pid=…" 一起吃掉，
 * 造成撤销时永久丢字。pid 的清理一律走 DOM 遍历（见 restoreElement），只动属性不动文本。
 */

/**
 * 从一棵 documentElement 克隆里剥掉"编辑器留下的痕迹"，得到可以交付/入快照的干净 HTML。
 *
 * 抽成纯函数是为了能被单测：这里出错的后果很隐蔽——
 * 编辑器注入的 bootstrap <script> 会被写进每一个快照和导出文件里，
 * 页面上看不出来，但用户拿到的"成品"里全是编辑器代码。
 */
export function scrubEditorArtifacts(clone, doctypeName = 'html') {
  const all = [clone, ...clone.querySelectorAll('*')];
  for (const el of all) {
    if (el.nodeType !== 1) continue;
    // 1) 编辑器注入的节点：bootstrap 脚本、未来的 chrome 节点
    if (el.hasAttribute('data-z-inject') || el.hasAttribute('data-z-chrome')) {
      el.remove();
      continue;
    }
    // 2) 任何带编辑器特征的 <script> 都不能进导出
    if (el.tagName === 'SCRIPT') {
      const body = el.textContent ?? '';
      if (el.hasAttribute('data-z-inject') || /__zToken|__zBridge|zhidaiqi/i.test(body)) {
        el.remove();
        continue;
      }
    }
    // 3) 锚点、编辑器私有属性、预览/选中类
    if (el.hasAttribute('data-pid')) el.removeAttribute('data-pid');
    for (const attr of [...(el.attributes ?? [])]) {
      if (attr.name.startsWith('data-z-')) el.removeAttribute(attr.name);
    }
    if (typeof el.className === 'string') el.classList.remove('picker-selected', 'z-preview-flash', 'z-ai-touched');
  }
  const doctype = doctypeName ? `<!DOCTYPE ${doctypeName}>\n` : '<!DOCTYPE html>\n';
  return doctype + clone.outerHTML;
}

function record(anchor, el, op, extra = {}) {
  return { op, snapshots: [snapshotTree(anchor, el)], pids: [anchor.pidOf(el)], ...extra };
}

/**
 * 把一棵子树还原成快照的样子：**属性 + 内容**都还原。
 * 只回填 innerHTML 是不够的——setStyle 改的是元素自身的 style 属性，
 * 用 innerHTML 还原根本碰不到它，撤销后样式会残留在页面上。
 */
function restoreElement(anchor, el, snap) {
  if (!snap) return;
  // 还原内容，然后把子树里残留的 pid 属性摘掉（DOM 遍历，不碰文本），再按快照恢复属性
  el.innerHTML = snap.html ?? '';
  for (const stale of el.querySelectorAll(`[${PID_ATTR}]`)) stale.removeAttribute(PID_ATTR);
  if (el.hasAttribute(PID_ATTR)) el.removeAttribute(PID_ATTR);
  if (snap.attrs) {
    for (const name of [...el.attributes].map((a) => a.name)) {
      if (name !== PID_ATTR && !(name in snap.attrs)) el.removeAttribute(name);
    }
    for (const [name, value] of Object.entries(snap.attrs)) {
      if (name === PID_ATTR) continue;
      el.setAttribute(name, value);
    }
    if (snap.style != null) el.setAttribute('style', snap.style);
    else el.removeAttribute('style');
  }
  // 锚点用**快照里记录的 pid 原样恢复**，不能靠 ensure() 按当前结构重算。
  // 原因：撤销前可能发生过 insertHtml/removeNode 改动过兄弟序号，
  // 此时当前结构算出来的 hash 与元素原本的 pid 不同 —— 重算就等于锚点漂移，
  // 模型与历史里持有的 pid 会变成野指针。快照里的 pid 就是权威值。
  if (snap.pid) el.setAttribute(PID_ATTR, snap.pid);
  anchor.seen.add(snap.pid ?? '');
  anchor.injectSubtree(el); // 只给新出现的、还没有 pid 的后代补号
  anchor.ensureUniquePids(el);
}

/** 撤销一堆条目后做一次体检：任何重复 pid 都要重新分配，保证 resolve 不歧义 */
function sanitizeAnchors(anchor, scopeEl = null) {
  const target = scopeEl ?? anchor.doc.documentElement;
  if (target) anchor.ensureUniquePids(target);
}

function restoreSnapshots(anchor, entry) {
  for (const snap of entry.snapshots) {
    const el = anchor.resolve(snap.pid);
    if (!el) continue;
    restoreElement(anchor, el, snap);
  }
}

/**
 * 撤销 insertHtml：把当初插入的那几个节点**精确摘掉**（含文本节点）。
 *
 * 为什么不重写父节点 innerHTML 兜底：那会把父节点下所有兄弟都重新解析一遍，
 * 兄弟的锚点会被重建（可能漂移），而"取消一次插入"本不该影响任何兄弟。
 */
function removeInsertedNodes(entry) {
  const nodes = Array.isArray(entry.nodes) ? entry.nodes : [];
  const parent = nodes[0]?.parentNode ?? null;
  if (!parent) return; // 已经被别的操作连带删掉了，无需处理

  let removedAll = true;
  for (const node of nodes) {
    if (node.parentNode === parent) {
      try {
        parent.removeChild(node);
      } catch {
        removedAll = false;
      }
    } else {
      removedAll = false;
    }
  }
  if (removedAll) return;

  // 有节点被挪走了：按当初记录的连续区段再摘一次
  const kids = [...parent.childNodes];
  const start = typeof entry.startIndex === 'number' ? entry.startIndex : kids.indexOf(nodes[0]);
  if (start >= 0) {
    const slice = kids.slice(start, start + nodes.length);
    if (slice.length === nodes.length && slice.every((n, i) => n === nodes[i])) {
      for (const n of slice) parent.removeChild(n);
    }
  }
}

/**
 * 应用 patch。
 * @param {Document} doc
 * @param {Element} scopeEl 选中的元素（范围边界）
 * @param {object} rawPatch 模型输出
 * @returns {{applied:Array, inverse:Array, anchor:AnchorManager, patch:object}}
 */
export function applyPatch(doc, scopeEl, rawPatch) {
  if (!scopeEl) throw new ZError('没有选中元素，无法应用改动', 'E_NO_SELECTION');
  const anchor = new AnchorManager(doc);
  anchor.rescan();
  anchor.ensure(scopeEl);
  // 关键：不要在整轮操作里信任外部传入的元素引用。
  // 撤销/还原会让旧引用变成悬空节点（DOM 里已经是另一个对象了），
  // 一旦引用悬空，范围判断就会误判。所以先把 scope 固化成 pid，之后一律按 pid 解析。
  const scopePid = anchor.pidOf(scopeEl);
  if (!scopePid) throw new ZError('选中元素缺少 data-pid 锚点，请重新选中', 'E_NO_ANCHOR');
  const resolveScope = () => anchor.resolve(scopePid) ?? (scopeEl.isConnected === false ? null : scopeEl);

  const { patch } = validatePatchShape(rawPatch);
  validatePatchScope(patch, (pid) => {
    const scope = resolveScope();
    return !!scope && (pid === scopePid || anchor.isWithin(pid, scope));
  });

  const applied = [];
  const inverse = [];

  // 事务性保证：任何一条改动不合法，DOM 必须回到**本次调用之前**。
  // 前半段（形状/范围校验）在动手前就抛，天然零改动；
  // 但 apply 过程中仍可能出错（例如前面的 removeNode 删掉了后续要改的节点），
  // 这时必须逆序回滚已应用的改动，否则会留下"改了一半"的页面。
  try {
    for (const change of patch.changes) {
      const el = findByPid(doc, anchor, change.target);
      const scope = resolveScope();
      // scope 为 null ⇒ 本 patch 已经把选中元素自己删掉了（removeNode target=scope）。
      // 此时剩下能解析到的节点都不再属于选区，明确报"越界"而不是抛内部错误。
      if (!scope) {
        throw new ZError(
          `改动越界：选中元素在本次改动中已被删除，无法继续改 ${change.target}`,
          'E_PATCH_OUT_OF_SCOPE',
          change,
        );
      }
      if (el !== scope && !scope.contains(el)) {
        throw new ZError(`改动越界：${change.target} 不在 ${scopePid} 之内`, 'E_PATCH_OUT_OF_SCOPE', change);
      }
      switch (change.op) {
        case 'setText':
        inverse.push(record(anchor, el, 'setText'));
        el.textContent = change.value;
        applied.push(change);
        break;
      case 'setAttr':
        inverse.push(record(anchor, el, 'setAttr'));
        if (change.value === null) el.removeAttribute(change.name);
        else el.setAttribute(change.name, change.value);
        applied.push(change);
        break;
      case 'setStyle':
        inverse.push(record(anchor, el, 'setStyle'));
        if (change.value === null) el.style.removeProperty(change.prop);
        else el.style.setProperty(change.prop, change.value, change.priority ?? '');
        applied.push(change);
        break;
      case 'setHtml':
        inverse.push(record(anchor, el, 'setHtml'));
        el.innerHTML = sanitizeHtmlFragment(doc, change.html);
        anchor.injectSubtree(el);
        applied.push(change);
        break;
      case 'insertHtml': {
        const clean = sanitizeHtmlFragment(doc, change.html);
        const holder = doc.createElement('div');
        holder.innerHTML = clean;
        const newNodes = [...holder.childNodes];
        if (!newNodes.length) break; // 清洗之后什么都不剩，不必改动 DOM
        const parent = change.position === 'before' || change.position === 'after' ? el.parentNode : el;
        if (!parent) throw new ZError('插入位置不存在（元素没有父节点）', 'E_PATCH_INSERT_TARGET');

        // 范围硬约束：插入**结果**必须落在选区里，只留一个合情理的例外。
        //   - append/prepend：插到 target 内部，target 已被范围校验覆盖，天然在选区内；
        //   - before/after：插成 target 的兄弟。允许的条件是二者之一：
        //       a) 插入点的父节点在 scope 内（scope 自身或其后代）——插进选区内部；
        //       b) target 就是选中元素本身，且插入点父节点 = 该元素的父节点——"在这块旁边加东西"（用户诉求）。
        //     其余情况（例如选中卡片里的 <h3> 却把节点插到卡片外层）都是插到选区之外 → 整单拒绝。
        if (change.position === 'before' || change.position === 'after') {
          const scope = resolveScope();
          const insertParent = el.parentNode;
          // 落点在选区内 ⇔ 插入点的父节点就是 scope，或它是 scope 的祖先（ancestor.contains(scope)）。
          const insideScope =
            !!scope &&
            insertParent != null &&
            (insertParent === scope || (typeof insertParent.contains === 'function' && insertParent.contains(scope)));
          const besideSelection = !!scope && el === scope && insertParent != null && insertParent === scope.parentNode;
          if (!insideScope && !besideSelection) {
            throw new ZError(
              `改动越界：insertHtml(${change.position}) 会把内容插到选中元素之外（插入点 ${anchor.pidOf(insertParent) ?? '未知'}）`,
              'E_PATCH_OUT_OF_SCOPE',
              change,
            );
          }
        }

        const ref =
          change.position === 'before' ? el
            : change.position === 'after' ? el.nextSibling
              : change.position === 'prepend' ? el.firstChild
                : null;
        const startIndex = ref ? [...parent.childNodes].indexOf(ref) : parent.childNodes.length;
        // 记录插入前紧邻的锚点：撤销时用它把插入的节点精确摘掉，
        // 而**不是**重写父节点 innerHTML —— 重写会连带重建兄弟节点、丢锚点。
        const nextNode = ref ?? null;

        const frag = doc.createDocumentFragment();
        for (const n of newNodes) frag.appendChild(n);
        parent.insertBefore(frag, ref);

        const insertedElements = newNodes.filter((n) => n.nodeType === 1);
        for (const n of insertedElements) anchor.injectSubtree(n);
        if (parent.nodeType === 1) anchor.ensure(parent);

        inverse.push({
          op: 'insertHtml',
          // 关键：text 节点也要一起记录并使用，否则"插入纯文本"撤销后文字会永久残留
          nodes: newNodes,
          pids: insertedElements.map((n) => anchor.pidOf(n)).filter(Boolean),
          startIndex,
          nextNode,
          parentPid: anchor.pidOf(parent.nodeType === 1 ? parent : parent.parentElement ?? doc.documentElement),
          beforeSnapshot: parent.nodeType === 1 ? snapshotTree(anchor, parent) : null,
        });
        applied.push(change);
        break;
      }
      case 'removeNode': {
        const parent = el.parentNode;
        if (!parent) throw new ZError('元素没有父节点，无法删除', 'E_PATCH_REMOVE_TARGET');
        // 不允许删 <html>：它的父节点是 Document，没有可供撤销的"父元素快照"，
        // 删掉之后页面结构报废且无法还原。直接拒绝，别留一个静默失效的撤销。
        if (parent.nodeType !== 1) {
          throw new ZError('不允许删除文档根元素 <html>（无法安全撤销）', 'E_PATCH_REMOVE_ROOT');
        }
        // 允许删除"选中元素本身"（用户说"这块删掉"是很自然的诉求）；
        // 撤销靠父节点快照精确还原，不会丢锚点。
        inverse.push({
          op: 'removeNode',
          snapshots: [{ pid: anchor.pidOf(parent), html: parent.innerHTML, outer: '' }],
          pids: [anchor.pidOf(el)],
          removedOuter: el.outerHTML,
          parentPid: anchor.pidOf(parent),
          index: [...parent.childNodes].indexOf(el),
        });
        el.remove();
        applied.push(change);
        break;
      }
      default:
        throw new ZError(`未实现的操作 ${change.op}`, 'E_PATCH_OP');
      }
    }
  } catch (err) {
    // 回滚已应用的改动，保证"要么全改，要么一点都不改"
    if (inverse.length) {
      try {
        undoPatch(doc, inverse);
      } catch (rollbackErr) {
        console.error('[zhidaiqi] 回滚失败，页面可能处于中间状态：', rollbackErr);
        if (err instanceof ZError) err.rollbackFailed = rollbackErr?.message ?? String(rollbackErr);
      }
    }
    throw err;
  }

  anchor.rescan();
  return { applied, inverse, anchor, patch, scopePid };
}

/** 逆序执行逆条目 = 回到 patch 之前。 */
export function undoPatch(doc, inverse) {
  const anchor = new AnchorManager(doc);
  anchor.rescan();
  const undone = [];
  for (const entry of [...inverse].reverse()) {
    switch (entry.op) {
      case 'setText':
      case 'setAttr':
      case 'setStyle':
      case 'setHtml':
        restoreSnapshots(anchor, entry);
        break;
      case 'insertHtml': {
        // 优先用当初记录的节点对象精确摘除（含**文本节点**，纯文本插入也能撤干净）。
        // 注意：这里绝不用"重写父节点 innerHTML"来兜底——那样会连带重建兄弟节点、丢锚点。
        removeInsertedNodes(entry);
        break;
      }
      case 'removeNode': {
        const snap = entry.snapshots[0];
        const parent = anchor.resolve(snap.pid);
        if (parent) restoreElement(anchor, parent, snap);
        break;
      }
      default:
        break;
    }
    undone.push(entry.op);
  }
  anchor.rescan();
  sanitizeAnchors(anchor);
  return undone;
}

/**
 * 预览会话：把"改动 → 预览 → 接受/取消"封成一个对象，UI 只跟它打交道。
 */
export class PreviewSession {
  constructor(doc, scopeEl, patch) {
    this.doc = doc;
    this.scopeEl = scopeEl;
    this.scopePid = scopeEl ? new AnchorManager(doc).pidOf(scopeEl) : null;
    const result = applyPatch(doc, scopeEl, patch);
    this.patch = result.patch;
    this.applied = result.applied;
    this.inverse = result.inverse;
    this.anchor = result.anchor;
    this.id = uid('preview');
    this.settled = false;
    this.touchedPids = [...new Set(this.applied.map((c) => c.target))];
    this.markTouched();
  }

  /** 把改动处标出来（视觉上"这几处是 AI 刚动的"）。 */
  markTouched(className = 'z-preview-flash') {
    for (const pid of this.touchedPids) {
      const el = this.anchor.resolve(pid);
      if (el) el.classList.add(className);
    }
  }

  clearMarks(className = 'z-preview-flash') {
    for (const pid of this.touchedPids) {
      const el = this.anchor.resolve(pid);
      if (el) el.classList.remove(className);
    }
  }

  /** 取消：精确回滚。返回 true 表示已回滚。 */
  cancel() {
    if (this.settled) return false;
    this.clearMarks();
    undoPatch(this.doc, this.inverse);
    this.settled = true;
    this.cancelled = true;
    return true;
  }

  /** 接受：清掉预览标记，DOM 保持改动后的样子。 */
  accept() {
    if (this.settled) return false;
    this.clearMarks();
    this.settled = true;
    this.accepted = true;
    return true;
  }
}

/** 便捷函数：一次性 apply + 立刻回滚（测试与 dry-run 用）。 */
export function dryRunPatch(doc, scopeEl, patch) {
  const session = new PreviewSession(doc, scopeEl, patch);
  const ok = session.cancel();
  return { rolledBack: ok, applied: session.applied.length };
}

export { validatePatch, summarizePatch, patchStats } from './schema.mjs';
