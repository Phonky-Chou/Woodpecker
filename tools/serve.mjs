/**
 * tools/serve.mjs — 本地服务：开发页 + 真实模型代理。
 *
 * 为什么需要它：浏览器里放 API key 是不安全的（也过不了 CORS）。
 * 这个服务把 key 留在本机：浏览器 → /api/chat → OpenAI 兼容端点。
 *
 * 用法：
 *   set ZHI_API_KEY=sk-xxx            # 或 DEEPSEEK_API_KEY
 *   node tools/serve.mjs              # 默认 http://127.0.0.1:5188
 *   可调环境变量：
 *     ZHI_PORT=5188
 *     ZHI_BASE_URL=https://api.deepseek.com
 *     ZHI_MODEL=deepseek-chat
 *     ZHI_API_KEY / DEEPSEEK_API_KEY
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildHtml, bridgeSource } from './build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

const PORT = Number(process.env.ZHI_PORT ?? 5188);
const HOST = process.env.ZHI_HOST ?? '127.0.0.1';
const BASE_URL = (process.env.ZHI_BASE_URL ?? 'https://api.deepseek.com').replace(/\/+$/, '');
const MODEL = process.env.ZHI_MODEL ?? 'deepseek-chat';
const API_KEY = process.env.ZHI_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? '';

/** 懒加载打包器里的纯逻辑模块（Node 直接 import ESM 源码） */
async function loadCore() {
  const { createProvider } = await import(pathToFileURL(path.join(SRC, 'provider.mjs')).href);
  const { validatePatch, summarizePatch } = await import(pathToFileURL(path.join(SRC, 'schema.mjs')).href);
  const { SYSTEM_PROMPT, buildUserInstruction, buildRepairPrompt } = await import(pathToFileURL(path.join(SRC, 'systemprompt.mjs')).href);
  const { extractJson } = await import(pathToFileURL(path.join(SRC, 'util.mjs')).href);
  return { createProvider, validatePatch, summarizePatch, SYSTEM_PROMPT, buildUserInstruction, buildRepairPrompt, extractJson };
}

/** 开发页：与单文件版同一套源码，但桥源码单独暴露，便于断点调试 */
function devHtml() {
  const sample = fs.readFileSync(path.join(SRC, 'sample.html'), 'utf8');
  const full = buildHtml();
  // 直接把单文件版的 body 内容搬过来即可（保证开发态与发布态行为一致）
  return full
    .replace('<title>指代器 · AI HTML 编辑器</title>', '<title>指代器 · AI HTML 编辑器（开发态）</title>')
    .replace('</head>', `<script>window.__Z_BRIDGE_SRC__ = ${JSON.stringify(bridgeSource())};</script>\n</head>`);
}

function json(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readBody(req, limit = 512 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function handleChat(req, res) {
  const { SYSTEM_PROMPT, buildUserInstruction, validatePatch, extractJson } = await loadCore();
  let payload;
  try {
    payload = JSON.parse((await readBody(req)) || '{}');
  } catch (err) {
    return json(res, 400, { error: `请求体不是 JSON：${err.message}` });
  }
  const context = payload.context;
  if (!context?.target?.pid) return json(res, 400, { error: '缺少 context.target.pid' });

  const model = payload.model || MODEL;
  const mode = API_KEY ? 'server' : 'no-key';

  if (!API_KEY) {
    // 没有 key 时不要静默失败：告诉调用方怎么配，并回退到离线 Mock，保证流程可演示
    const { createProvider } = await loadCore();
    const provider = createProvider({ kind: 'mock' });
    const result = await provider.generate(context, {});
    return json(res, 200, {
      mode: 'mock-fallback',
      raw: result.raw,
      patch: result.patch,
      usage: null,
      note: '未设置 ZHI_API_KEY / DEEPSEEK_API_KEY，已回退到离线规则引擎。',
    });
  }

  const body = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserInstruction(context) },
    ],
    temperature: 0.2,
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  };

  let upstream;
  try {
    upstream = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return json(res, 502, { error: `连不上模型端点 ${BASE_URL}：${err.message}` });
  }

  const text = await upstream.text();
  if (!upstream.ok) {
    return json(res, upstream.status, { error: `上游 ${upstream.status}：${text.slice(0, 500)}` });
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return json(res, 502, { error: '上游返回的不是 JSON', body: text.slice(0, 500) });
  }
  const raw = data?.choices?.[0]?.message?.content ?? '';
  try {
    const patch = validatePatch(extractJson(raw));
    return json(res, 200, { mode, raw, patch, usage: data.usage ?? null, model });
  } catch (err) {
    // 把"模型输出不合规"如实回报，让前端弹错误而不是悄悄改成别的东西
    return json(res, 200, { mode: 'invalid', raw, error: `模型输出不符合 Patch v1：${err.message}`, model });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'POST' && url.pathname === '/api/chat') return await handleChat(req, res);
    if (url.pathname === '/api/health') {
      const { summarizePatch } = await loadCore();
      return json(res, 200, {
        ok: true,
        keyConfigured: !!API_KEY,
        baseUrl: BASE_URL,
        model: MODEL,
        port: PORT,
        hint: 'POST /api/chat {context}',
        summarize: typeof summarizePatch === 'function',
      });
    }
    if (url.pathname === '/bridge.js') {
      const body = bridgeSource();
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(body);
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const body = devHtml();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(body);
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
  } catch (err) {
    console.error('[serve] 处理失败：', err);
    json(res, 500, { error: err?.message ?? String(err) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`指代器开发服务已启动：http://${HOST}:${PORT}`);
  console.log(`  模型端点：${BASE_URL}  模型：${MODEL}`);
  console.log(API_KEY ? '  API key：已从环境变量读取 ✔' : '  API key：未设置 → /api/chat 会回退到离线规则引擎（页面仍可完整演示）');
  console.log('  提示：页面右上角"设置"里把 Provider 切到"本地代理"即可用真实模型。');
});
