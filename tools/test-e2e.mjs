/**
 * tools/test-e2e.mjs — 真浏览器端到端验收（零依赖，走 Chrome DevTools Protocol）。
 *
 * 为什么必须做这一步：单测证明不了"指代器真的能选中""预览真的画在页面上"
 * "接受真的写进了版本栈"。这里用 Edge headless 把整条链路跑一遍。
 *
 * 运行：node tools/test-e2e.mjs
 */

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.ZHI_E2E_PORT ?? 5199);
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
];

const results = [];
let failed = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  if (!ok) failed++;
  const mark = ok ? '✔' : '✖';
  console.log(`${mark} ${name}${ok || !detail ? '' : `\n    ${detail}`}`);
}

/* ------------------------------ 迷你 WebSocket 客户端 ------------------------------ */

class MiniWs {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.closed = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const u = new URL(this.url);
      const key = crypto.randomBytes(16).toString('base64');
      const req = http.request({
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: 'GET',
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': key,
          Host: `${u.hostname}:${u.port}`,
        },
      });
      req.on('upgrade', (res, socket) => {
        this.socket = socket;
        socket.on('data', (chunk) => this.onData(chunk));
        socket.on('close', () => {
          this.closed = true;
          for (const { reject: rj } of this.pending.values()) rj(new Error('WebSocket 已关闭'));
          this.pending.clear();
        });
        socket.on('error', () => {});
        resolve(this);
      });
      req.on('response', (res) => reject(new Error(`握手失败 HTTP ${res.statusCode}`)));
      req.on('error', reject);
      req.end();
    });
  }

  onData(chunk) {
    this.buf = this.buf ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      const frame = this.readFrame();
      if (!frame) break;
      const { opcode, payload } = frame;
      if (opcode === 0x8) {
        this.closed = true;
        this.socket.end();
        return;
      }
      if (opcode === 0x1) {
        let msg;
        try {
          msg = JSON.parse(payload.toString('utf8'));
        } catch {
          continue;
        }
        if (msg.id != null && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          msg.error ? p.reject(new Error(`${msg.error.message} (${msg.error.code ?? ''})`)) : p.resolve(msg.result);
        } else if (msg.method) {
          for (const fn of this.handlers.get(msg.method) ?? []) fn(msg.params);
        }
      }
    }
  }

  readFrame() {
    const b = this.buf;
    if (!b || b.length < 2) return null;
    const fin = (b[0] & 0x80) !== 0;
    const opcode = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let offset = 2;
    if (len === 126) {
      if (b.length < 4) return null;
      len = b.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      if (b.length < 10) return null;
      const big = b.readBigUInt64BE(2);
      if (big > 64n * 1024n * 1024n) throw new Error('帧过大');
      len = Number(big);
      offset = 10;
    }
    if (masked) offset += 4;
    if (b.length < offset + len) return null;
    let payload = b.subarray(offset, offset + len);
    if (masked) {
      const mask = b.subarray(offset - 4, offset);
      payload = Buffer.from(payload);
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    }
    this.buf = b.subarray(offset + len);
    if (!fin) throw new Error('暂不支持分片帧');
    return { opcode, payload };
  }

  send(obj) {
    const payload = Buffer.from(JSON.stringify(obj), 'utf8');
    const mask = crypto.randomBytes(4);
    const len = payload.length;
    let header;
    if (len < 126) header = Buffer.alloc(2);
    else if (len < 65536) {
      header = Buffer.alloc(4);
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x81;
    header[1] = (len < 126 ? 0x80 | len : len < 65536 ? 0x80 | 126 : 0x80 | 127);
    const masked = Buffer.from(payload);
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
    this.socket.write(Buffer.concat([header, mask, masked]));
  }

  cmd(method, params = {}, timeout = 30000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP 超时：${method}`));
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
      this.send({ id, method, params });
    });
  }

  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }

  close() {
    try {
      this.socket?.end();
    } catch {
      /* ignore */
    }
  }
}

/* ------------------------------ 工具 ------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeout = 15000, interval = 150, label = '条件' } = {}) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (err) {
      last = err.message;
    }
    await sleep(interval);
  }
  throw new Error(`等待超时：${label}（最后状态：${typeof last === 'string' ? last : JSON.stringify(last)?.slice(0, 200)}）`);
}

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) throw new Error(`${url} → ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/* ------------------------------ 主流程 ------------------------------ */

async function main() {
  const edge = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
  if (!edge) {
    console.error('找不到 Edge/Chrome，跳过端到端测试。');
    process.exit(0);
  }

  const userDataDir = path.join(os.tmpdir(), `zhidaiqi-e2e-${Date.now()}`);
  const debugPort = await freePort();

  // 1) 起开发服务
  const server = spawn(process.execPath, [path.join(ROOT, 'tools', 'serve.mjs')], {
    env: { ...process.env, ZHI_PORT: String(PORT), ZHI_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => process.env.ZHI_E2E_VERBOSE && process.stdout.write(`[serve] ${d}`));
  server.stderr.on('data', (d) => process.stderr.write(`[serve:err] ${d}`));

  const cleanup = () => {
    try {
      server.kill();
    } catch {
      /* ignore */
    }
    try {
      browser?.kill();
    } catch {
      /* ignore */
    }
  };
  process.on('exit', cleanup);

  await waitFor(
    async () => {
      const health = await fetchJson(`http://127.0.0.1:${PORT}/api/health`);
      return health?.ok;
    },
    { label: '开发服务启动' },
  );
  check('开发服务已启动并能响应 /api/health', true);

  // 2) 起 headless 浏览器。有些受限环境不允许 node 直接 spawn 浏览器进程，
  //    这时可以先用 powershell/cmd 起好浏览器再让本脚本连上去：
  //      start msedge --headless=new --remote-debugging-port=9333 --user-data-dir=%TEMP%\z-e2e about:blank
  //      set ZHI_E2E_DEBUG_PORT=9333 && node tools/test-e2e.mjs
  const envPort = Number(process.env.ZHI_E2E_DEBUG_PORT ?? 0);
  let browser = null;
  let activePort = envPort || debugPort;

  const attach = async (port) => {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    return list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  };

  let targets = envPort ? await attach(envPort).catch(() => null) : null;
  if (targets) {
    console.log(`  复用已运行的浏览器（调试端口 ${activePort}）`);
  } else {
    try {
      browser = spawn(
        edge,
        [
          '--headless=new',
          '--disable-gpu',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-extensions',
          '--disable-background-networking',
          '--window-size=1440,900',
          `--remote-debugging-port=${debugPort}`,
          `--user-data-dir=${userDataDir}`,
          'about:blank',
        ],
        { stdio: 'ignore' },
      );
    } catch (err) {
      console.log(`\n⚠ 无法从 Node 启动浏览器（${err.code ?? err.message}）。`);
      console.log('  这是运行环境的进程启动限制，不是代码问题。请先用下面任一方式起好浏览器再重跑：');
      console.log(`    start msedge --headless=new --remote-debugging-port=${debugPort} --user-data-dir=%TEMP%\\z-e2e about:blank`);
      console.log(`    set ZHI_E2E_DEBUG_PORT=${debugPort} && node tools/test-e2e.mjs`);
      cleanup();
      process.exit(0);
    }
    targets = await waitFor(() => attach(debugPort), { label: '浏览器调试端口就绪', timeout: 20000 });
  }
  activePort = targets.port ?? activePort;

  const ws = await new MiniWs(targets.webSocketDebuggerUrl).connect();
  await ws.cmd('Page.enable');
  await ws.cmd('Runtime.enable');
  const consoleErrors = [];
  ws.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error') consoleErrors.push(p.args.map((a) => a.value ?? a.description ?? '').join(' '));
  });
  ws.on('Runtime.exceptionThrown', (p) => consoleErrors.push(`未捕获异常：${p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text}`));

  const evalIn = async (expression, { awaitPromise = true } = {}) => {
    const res = await ws.cmd('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: true });
    if (res.exceptionDetails) {
      throw new Error(`页面内执行失败：${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`);
    }
    return res.result?.value;
  };

  await ws.cmd('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await waitFor(() => evalIn('!!window.__zApp && !!window.__ztest'), { label: '编辑器初始化' });

  /* ---------------- 第 0 步：初始化与锚点 ---------------- */
  const boot = await evalIn(`(async () => {
    const t = window.__ztest;
    const s = await t.stats();
    return { elements: s.elements, anchored: s.anchored, versions: t.app.store.snapshots.length, mode: s.mode };
  })()`);
  check('页面加载后所有元素都拿到了 data-pid', boot.anchored === boot.elements && boot.elements > 30, JSON.stringify(boot));
  check('初始工作区自动建立版本 0', boot.versions === 1, JSON.stringify(boot));
  check('指代器默认处于选中模式', boot.mode === 'pick', String(boot.mode));

  /* ---------------- 第 1 步：指代器选中 ---------------- */
  const select = await evalIn(`(async () => {
    return await window.__ztest.selectCss('h1, .hero h1', '标题');
  })()`);
  check('指代器能按 css 选中元素并给出 pid', !!select?.pid && select.tag === 'h1', JSON.stringify(select));
  check('选中元素带 .picker-selected 标记', select.hasMark === true, JSON.stringify(select));
  check('选中信息包含选择器路径与尺寸', !!select.selectorPath && select.box.w > 0, JSON.stringify(select));

  const chain = await evalIn(`(async () => {
    const b = window.__ztest.bridge();
    b.picker.select(document.querySelector('.hero h1').dataset.pid);
    const chain = b.picker.chainAt(...(() => { const r = document.querySelector('.hero h1').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })());
    return chain.map((el) => el.tagName.toLowerCase());
  })()`);
  check('悬停命中能给出正确的元素链（h1 → … → html）', chain[0] === 'h1' && chain.at(-1) === 'html', JSON.stringify(chain));

  /* ---------------- 第 2 步：模型 → JSON patch → 预览 ---------------- */
  const before = await evalIn(`(async () => {
    const t = window.__ztest;
    return await t.outerHtml(t.app.selection.pid);
  })()`);
  const send = await evalIn(`(async () => {
    const t = window.__ztest;
    await t.send('标题再大一点，换成深蓝');
    const p = t.app.preview;
    return {
      hasPreview: !!p,
      changes: p?.patch?.changes?.length ?? 0,
      summary: p?.patch?.summary ?? '',
      rawLogged: true,
      pidSame: p?.patch?.changes?.every((c) => c.target === t.app.selection?.pid) ?? false,
    };
  })()`);
  check('输入中文需求后拿到了结构化 JSON patch', send.hasPreview && send.changes > 0, JSON.stringify(send));
  check('patch 只指向选中的那个 pid（没有越界）', send.pidSame === true, JSON.stringify(send));

  const previewed = await evalIn(`(async () => {
    const t = window.__ztest;
    return {
      fontSize: t.doc.querySelector('.hero h1').style.fontSize,
      color: t.doc.querySelector('.hero h1').style.color,
      htmlChanged: (await t.outerHtml(t.app.selection.pid)) !== ${JSON.stringify(before)},
    };
  })()`);
  check('改动已在页面上预览（字号已变）', /px/.test(previewed.fontSize ?? ''), JSON.stringify(previewed));
  check('改动的确是局部生效（DOM 已变化）', previewed.htmlChanged === true, JSON.stringify(previewed));

  /* ---------------- 取消 = 精确回滚 ---------------- */
  const cancelled = await evalIn(`(async () => {
    const t = window.__ztest;
    await t.app.cancelPreview();
    const after = await t.outerHtml(${JSON.stringify(select.pid)});
    return { identical: after === ${JSON.stringify(before)}, after: after.slice(0, 120) };
  })()`);
  check('点"取消"后元素 outerHTML 与改动前逐字节一致', cancelled.identical === true, JSON.stringify(cancelled).slice(0, 300));

  /* ---------------- 接受 = 存快照 ---------------- */
  const accepted = await evalIn(`(async () => {
    const t = window.__ztest;
    await t.send('标题再大一点，换成深蓝');
    await t.accept();
    const s = t.app.store;
    const cur = t.doc.querySelector('.hero h1');
    return {
      versions: s.snapshots.length,
      cursor: s.cursor,
      label: s.current().label,
      prompt: s.current().prompt,
      source: s.current().source,
      fontSize: cur.style.fontSize,
      snapshotHasPid: s.current().html.includes('data-pid'),
      cleanHtml: !s.current().html.includes('picker-selected') && !s.current().html.includes('data-z-inject'),
    };
  })()`);
  check('接受后生成新版本快照', accepted.versions === 2 && accepted.cursor === 1, JSON.stringify(accepted));
  check('快照记录了用户原话与改动摘要', /标题/.test(accepted.prompt) && accepted.label.length > 0, JSON.stringify(accepted));
  check('快照 HTML 是干净的（不含 pid / 编辑器注入）', accepted.snapshotHasPid === false && accepted.cleanHtml === true, JSON.stringify(accepted));
  check('页面保留改动后的效果', /px/.test(accepted.fontSize), JSON.stringify(accepted));

  /* ---------------- 连续三次改动 → 逐级撤销 ---------------- */
  const threeEdits = await evalIn(`(async () => {
    const t = window.__ztest;
    const log = [];
    for (const [css, text] of [['.card h3', '卡片标题加粗'], ['.card .badge', '标签换成绿色'], ['footer.site', '页脚小一点']]) {
      await t.selectCss(css);
      await t.send(text);
      await t.accept();
      log.push({ css, versions: t.app.store.snapshots.length, label: t.app.store.current().label });
    }
    return { log, versions: t.app.store.snapshots.length, cursor: t.app.store.cursor };
  })()`);
  check('连续三次改动各存一个版本', threeEdits.versions === 5 && threeEdits.cursor === 4, JSON.stringify(threeEdits));

  const undoSeq = await evalIn(`(async () => {
    const t = window.__ztest;
    const labels = [];
    for (let i = 0; i < 4; i++) {
      await t.app.undo();
      labels.push(t.app.store.current().label);
    }
    const atInitial = { cursor: t.app.store.cursor, canUndo: t.app.store.canUndo() };
    await t.app.undo();
    return { labels, atInitial, afterExtraUndo: t.app.store.cursor };
  })()`);
  check('连续撤销能逐级回到初始版本', undoSeq.atInitial.cursor === 0 && undoSeq.atInitial.canUndo === false, JSON.stringify(undoSeq));
  check('到初始版本后再撤销不会越界', undoSeq.afterExtraUndo === 0, JSON.stringify(undoSeq));

  const redoSeq = await evalIn(`(async () => {
    const t = window.__ztest;
    for (let i = 0; i < 4; i++) await t.app.redo();
    return { cursor: t.app.store.cursor, canRedo: t.app.store.canRedo(), label: t.app.store.current().label };
  })()`);
  check('连续重做能逐级回到最新版本', redoSeq.cursor === 4 && redoSeq.canRedo === false, JSON.stringify(redoSeq));

  /* ---------------- 还原后锚点仍然有效（验收标准 4） ---------------- */
  const afterRestore = await evalIn(`(async () => {
    const t = window.__ztest;
    await t.app.jumpTo(t.app.store.snapshots[2].id);
    const pid = t.app.store.current().targetPid;
    const sel = await t.bridge().api.select(pid);
    return { pid, label: sel?.label ?? null, fontSize: t.doc.querySelector('.hero h1')?.style.fontSize ?? '' };
  })()`);
  check('跳转历史版本后，该版本记录的 pid 依然能选中同一个元素', !!afterRestore.label, JSON.stringify(afterRestore));

  /* ---------------- 导出干净 HTML ---------------- */
  const cleanExport = await evalIn(`(async () => {
    const t = window.__ztest;
    const clean = await t.bridge().api.extractCleanHtml();
    return {
      bytes: clean.bytes,
      noPid: !clean.html.includes('data-pid'),
      noSelected: !clean.html.includes('picker-selected'),
      noInject: !clean.html.includes('data-z-inject'),
      hasDoctype: clean.html.startsWith('<!DOCTYPE'),
    };
  })()`);
  check('导出 HTML 干净：没有 pid / 选中类 / 编辑器注入', cleanExport.noPid && cleanExport.noSelected && cleanExport.noInject, JSON.stringify(cleanExport));

  /* ---------------- 越界防护（范围硬约束） ---------------- */
  const outOfScope = await evalIn(`(async () => {
    const t = window.__ztest;
    await t.selectCss('.hero h1');
    const outsidePid = document.querySelector('footer.site')?.dataset.pid ?? t.doc.querySelector('footer.site').dataset.pid;
    let rejected = false;
    let message = '';
    try {
      await t.bridge().api.applyPatch({ version: 1, target: t.app.selection.pid, changes: [{ op: 'setStyle', target: outsidePid, prop: 'color', value: 'red' }] });
    } catch (err) {
      rejected = true;
      message = err.message;
    }
    return { rejected, message };
  })()`);
  check('AI 试图改选中范围外的元素时被硬拒绝', outOfScope.rejected === true && /越界|范围/.test(outOfScope.message || ''), JSON.stringify(outOfScope));

  const forbidden = await evalIn(`(async () => {
    const t = window.__ztest;
    let pidRejected = false, scriptRejected = false, countRejected = false;
    const pid = t.app.selection?.pid ?? t.doc.querySelector('.hero h1').dataset.pid;
    const beforePid = t.doc.querySelector('.hero h1').dataset.pid;
    const api = t.bridge().api;
    try { await api.applyPatch({ version: 1, target: pid, changes: [{ op: 'setAttr', target: pid, name: 'data-pid', value: 'hacked' }] }); } catch { pidRejected = true; }
    const stillPid = t.doc.querySelector('.hero h1').dataset.pid === beforePid;
    try {
      await api.applyPatch({ version: 1, target: pid, changes: [{ op: 'setHtml', target: pid, html: '<b>ok</b><script>window.__pwned=1<\\/script>' }] });
    } catch { scriptRejected = true; }
    const pwned = !!t.win.__pwned;
    const node = t.doc.querySelector('.hero h1');
    const hasScript = !!node?.querySelector('script');
    try { await api.applyPatch({ version: 1, target: pid, changes: Array.from({ length: 60 }, () => ({ op: 'setText', target: pid, value: 'x' })) }); } catch { countRejected = true; }
    return { pidRejected, stillPid, scriptRejected, hasScript, pwned, countRejected };
  })()`);
  check('AI 不能篡改 data-pid 锚点', forbidden.pidRejected === true && forbidden.stillPid === true, JSON.stringify(forbidden));
  check('AI 注入的 <script> 被剥离且不执行', forbidden.hasScript === false && forbidden.pwned === false, JSON.stringify(forbidden));
  check('整页重写式的超量改动被拒绝', forbidden.countRejected === true, JSON.stringify(forbidden));

  /* ---------------- 历史面板渲染 ---------------- */
  const panel = await evalIn(`(() => {
    const t = window.__ztest;
    t.app.switchTab('versions');
    const rows = document.querySelectorAll('.z-ver').length;
    const cards = document.querySelectorAll('.z-card').length;
    const undoBtn = !!document.querySelector('[data-act="undo"]');
    return { rows, cards, undoBtn };
  })()`);
  check('版本历史面板渲染出了每一条版本', panel.rows >= 5, JSON.stringify(panel));
  check('对话区渲染出了 patch 预览卡', panel.cards >= 3, JSON.stringify(panel));

  /* ---------------- 控制台干净 ---------------- */
  check('运行期间没有未捕获的 JS 异常', consoleErrors.length === 0, consoleErrors.slice(0, 4).join('\n    '));

  /* ---------------- 汇总 ---------------- */
  ws.close();
  cleanup();
  await sleep(300);

  console.log(`\n端到端结果：${results.length - failed}/${results.length} 通过`);
  if (failed) {
    console.log('\n失败项：');
    for (const r of results.filter((x) => !x.ok)) console.log(`  ✖ ${r.name}\n    ${r.detail}`);
    process.exitCode = 1;
  } else {
    console.log('全部通过 ✔');
  }
}

main().catch((err) => {
  console.error('端到端测试异常中止：', err);
  process.exit(1);
});
