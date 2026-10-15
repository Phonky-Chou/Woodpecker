/**
 * snapshot.mjs — 版本快照 + 撤销/重做栈。见 CONTRACT.md §6。
 *
 * 设计取舍：快照存"干净整页 HTML 字符串"，而不是存 patch 的叠加。
 * 理由：局部 patch 叠三层之后就很难保证"回滚到第 N 版"是精确的；
 * 存整页虽然占点空间，但**跳转任意版本都是确定性的**，而且实现简单到不会错。
 *
 * 纯逻辑 + 一个可注入的 storage，所以能在 Node 里直接单测。
 */

import { deepClone, safeJsonParse, uid } from './util.mjs';

export const MAX_SNAPSHOTS = 40;
export const STORAGE_LIMIT_BYTES = 4 * 1024 * 1024;

export class SnapshotStore {
  /**
   * @param {object} opts
   * @param {string} opts.keyPrefix localStorage 前缀
   * @param {Storage|null} opts.storage 传 null = 纯内存（测试用）
   * @param {number} opts.maxSnapshots
   */
  constructor({ keyPrefix = 'zhidaiqi/v1', storage = null, maxSnapshots = MAX_SNAPSHOTS } = {}) {
    this.keyPrefix = keyPrefix;
    this.storage = storage;
    this.maxSnapshots = maxSnapshots;
    this.snapshots = [];
    this.cursor = -1;
    this.workspace = null; // { name, original }
    this.listeners = new Set();
    this.persistWarning = null;
  }

  get key() {
    return `${this.keyPrefix}/snapshots`;
  }

  get workspaceKey() {
    return `${this.keyPrefix}/workspace`;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(reason) {
    const payload = { reason, count: this.snapshots.length, cursor: this.cursor, current: this.current() };
    for (const fn of this.listeners) {
      try {
        fn(payload);
      } catch (err) {
        console.warn('[snapshot] listener error', err);
      }
    }
  }

  /* ----------------------------- 基础操作 ----------------------------- */

  current() {
    return this.snapshots[this.cursor] ?? null;
  }

  canUndo() {
    return this.cursor > 0;
  }

  canRedo() {
    return this.cursor >= 0 && this.cursor < this.snapshots.length - 1;
  }

  /** 初始化工作区（导入 HTML 时调用），产生 version 0 快照。 */
  initWorkspace({ name, html, source = 'initial' }) {
    this.workspace = { name, original: html, createdAt: Date.now() };
    this.snapshots = [];
    this.cursor = -1;
    this.push({ html, label: '初始版本', source, prompt: '', patch: null, targetPid: null });
    this.persist();
    this.emit('init');
    return this.current();
  }

  /**
   * 压入新版本。若 cursor 不在末尾（撤销后又改了），先砍掉"未来"分支——这是标准编辑器语义。
   */
  push({ html, label = '', source = 'ai', prompt = '', patch = null, targetPid = null, createdAt = Date.now() }) {
    if (this.cursor < this.snapshots.length - 1) {
      this.snapshots = this.snapshots.slice(0, this.cursor + 1);
    }
    const parent = this.current();
    const snap = {
      id: uid('s'),
      version: 1,
      createdAt,
      label: label || (source === 'initial' ? '初始版本' : '未命名改动'),
      prompt,
      source,
      patch: patch ? deepClone(patch) : null,
      targetPid,
      html,
      bytes: (html ?? '').length,
      parentId: parent?.id ?? null,
    };
    this.snapshots.push(snap);
    this.trim();
    this.cursor = this.snapshots.length - 1;
    this.persist();
    this.emit('push');
    return snap;
  }

  /** 撤销：cursor 左移，返回目标快照（调用方负责把 html 还原进 iframe）。 */
  undo() {
    if (!this.canUndo()) return null;
    this.cursor--;
    this.persist();
    this.emit('undo');
    return this.current();
  }

  redo() {
    if (!this.canRedo()) return null;
    this.cursor++;
    this.persist();
    this.emit('redo');
    return this.current();
  }

  /** 直接跳到某个版本（历史面板"回看/还原"） */
  jumpTo(indexOrId) {
    const index = typeof indexOrId === 'number' ? indexOrId : this.snapshots.findIndex((s) => s.id === indexOrId);
    if (index < 0 || index >= this.snapshots.length) return null;
    this.cursor = index;
    this.persist();
    this.emit('jump');
    return this.current();
  }

  /** 回看（不动 cursor，只取内容） */
  peek(indexOrId) {
    const index = typeof indexOrId === 'number' ? indexOrId : this.snapshots.findIndex((s) => s.id === indexOrId);
    return this.snapshots[index] ?? null;
  }

  remove(indexOrId) {
    const index = typeof indexOrId === 'number' ? indexOrId : this.snapshots.findIndex((s) => s.id === indexOrId);
    if (index <= 0 || index >= this.snapshots.length) return false; // 初始版本不允许删
    this.snapshots.splice(index, 1);
    if (this.cursor >= index) this.cursor = Math.max(0, this.cursor - 1);
    this.persist();
    this.emit('remove');
    return true;
  }

  list() {
    return this.snapshots.map((s, index) => ({
      index,
      id: s.id,
      label: s.label,
      createdAt: s.createdAt,
      source: s.source,
      bytes: s.bytes,
      current: index === this.cursor,
      future: index > this.cursor,
      changes: s.patch?.changes?.length ?? 0,
      summary: s.patch?.summary ?? '',
    }));
  }

  /** 超出上限时丢最老的（但初始版本永远保留） */
  trim() {
    if (this.snapshots.length <= this.maxSnapshots) return 0;
    const initial = this.snapshots[0];
    const rest = this.snapshots.slice(1);
    const keep = rest.slice(rest.length - (this.maxSnapshots - 1));
    const dropped = rest.length - keep.length;
    this.snapshots = [initial, ...keep];
    return dropped;
  }

  /* ------------------------------ 持久化 ------------------------------ */

  persist() {
    if (!this.storage) return { ok: true, bytes: 0 };
    const payload = JSON.stringify({ version: 1, cursor: this.cursor, snapshots: this.snapshots });
    const bytes = payload.length;
    try {
      if (bytes > STORAGE_LIMIT_BYTES) {
        // 太胖了：先丢最老的再试
        while (this.snapshots.length > 2 && JSON.stringify({ version: 1, cursor: this.cursor, snapshots: this.snapshots }).length > STORAGE_LIMIT_BYTES) {
          this.snapshots.splice(1, 1);
          if (this.cursor > 0) this.cursor--;
        }
        this.persistWarning = '版本过多，已自动丢弃最老的版本以适配浏览器存储上限';
        const retry = JSON.stringify({ version: 1, cursor: this.cursor, snapshots: this.snapshots });
        this.storage.setItem(this.key, retry);
        if (this.workspace) this.storage.setItem(this.workspaceKey, JSON.stringify(this.workspace));
        return { ok: true, bytes: retry.length, trimmed: true };
      }
      this.storage.setItem(this.key, payload);
      if (this.workspace) this.storage.setItem(this.workspaceKey, JSON.stringify(this.workspace));
      this.persistWarning = null;
      return { ok: true, bytes };
    } catch (err) {
      this.persistWarning = `本地存储写入失败（${err?.name ?? 'Error'}）：请及时导出备份`;
      return { ok: false, error: err, bytes };
    }
  }

  restore() {
    if (!this.storage) return false;
    const raw = safeJsonParse(this.storage.getItem(this.key) ?? '', null);
    const ws = safeJsonParse(this.storage.getItem(this.workspaceKey) ?? '', null);
    if (!raw || !Array.isArray(raw.snapshots) || !raw.snapshots.length) return false;
    this.snapshots = raw.snapshots.map((s) => ({ ...s, version: 1 }));
    this.cursor = Math.min(Math.max(0, raw.cursor ?? raw.snapshots.length - 1), this.snapshots.length - 1);
    if (ws) this.workspace = ws;
    this.emit('restore');
    return true;
  }

  clear() {
    this.snapshots = [];
    this.cursor = -1;
    this.workspace = null;
    if (this.storage) {
      this.storage.removeItem(this.key);
      this.storage.removeItem(this.workspaceKey);
    }
    this.emit('clear');
  }

  /* ------------------------------ 导入导出 ------------------------------ */

  /** 导出完整工程（可再导入继续改） */
  exportProject() {
    return {
      kind: 'zhidaiqi.project',
      version: 1,
      exportedAt: Date.now(),
      workspace: this.workspace,
      cursor: this.cursor,
      snapshots: this.snapshots,
    };
  }

  importProject(obj) {
    if (!obj || obj.kind !== 'zhidaiqi.project' || !Array.isArray(obj.snapshots) || !obj.snapshots.length) {
      return false;
    }
    this.snapshots = obj.snapshots;
    this.cursor = Math.min(Math.max(0, obj.cursor ?? this.snapshots.length - 1), this.snapshots.length - 1);
    this.workspace = obj.workspace ?? { name: '导入的工程', original: this.snapshots[0].html, createdAt: Date.now() };
    this.persist();
    this.emit('import');
    return true;
  }

  stats() {
    const bytes = this.snapshots.reduce((sum, s) => sum + (s.bytes ?? 0), 0);
    return {
      count: this.snapshots.length,
      cursor: this.cursor,
      bytes,
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      warning: this.persistWarning,
    };
  }
}

/** Node 测试用的内存 storage */
export function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}
