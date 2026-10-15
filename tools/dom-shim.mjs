/**
 * tools/dom-shim.mjs — 极小的 DOM 实现，专门用来在 Node 里跑"真实链路"烟测。
 *
 * 定位（很重要，别指望更多）：
 *  - 只实现 src/ 里**实际用到**的那些 API：querySelector(All)、classList、
 *    getBoundingClientRect、elementFromPoint、innerHTML/outerHTML 解析、style.setProperty…
 *  - 目的是在没有无头浏览器的环境里，把"锚点 → 选中 → patch → 回滚 → 快照"整条链跑通；
 *    **像素级渲染、真实 CSS 级联、真实事件顺序仍然只能靠浏览器**（页面内自检负责那段）。
 *  - 因此它只在临时目录生成、用完即删，绝不污染仓库。
 *
 * 用法：生成一份 .cjs 再用 require 加载（CJS 才能方便地在这个沙箱里被 require 到）。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let cached = null;

/**
 * 是否在 shim 里执行内联 <script>。
 * 打开后 iframe 的 srcdoc / 动态注入的脚本会真的在一个独立 realm 里跑，
 * 于是"应用接线"（父窗口 message 监听、桥装进哪个 realm、rpc 往返）都能在 Node 里被验证。
 * 这正是之前所有测试都照不到的盲区。
 */
export function setScriptExecution(on) {
  loadDomShim().setScriptExecution(on);
}

export function loadDomShim() {
  if (cached) return cached;
  // 正文现在放在 dom-shim-impl.cjs 里，直接按普通脚本加载。
  // （早先它嵌在 String.raw 模板里，正文里出现反引号就会把模板截断 —— 踩过三次，
  //   最阴险的一次是反引号成偶数：外层模块照样解析，生成的 .cjs 却是坏的。）
  // 仍然做一次语法校验：任何形式的改坏都当场暴露，而不是变成奇怪的运行时行为。
  try {
    new vm.Script(SHIM_SOURCE, { filename: 'dom-shim-impl.cjs' });
  } catch (err) {
    throw new Error('[shim] dom-shim-impl.cjs 语法错误：' + err.message);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhidaiqi-dom-'));
  const file = path.join(dir, 'dom-shim.cjs');
  fs.writeFileSync(file, SHIM_SOURCE, 'utf8');
  cached = { ...require(file), dir, file };
  return cached;
}

export function cleanupDomShim() {
  if (!cached) return;
  try {
    fs.rmSync(cached.dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  cached = null;
}

/** shim 的实现正文（普通 CJS 文件；由 loadDomShim 语法校验后加载） */
const SHIM_SOURCE = fs.readFileSync(new URL('./dom-shim-impl.cjs', import.meta.url), 'utf8');
