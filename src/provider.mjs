/**
 * provider.mjs — 模型接入抽象层。
 *
 * 契约（CONTRACT.md §7）：
 *   provider.generate(context, {signal, onDelta}) → { raw, patch, provider, ms, mode }
 *   - patch 一定是**已经过 validatePatch 的合法 Patch v1**，上层拿到就能直接执行。
 *   - provider 绝不返回"要直接 innerHTML 的 HTML 字符串"。
 *
 * 三种 provider：
 *   mock   —— 离线规则引擎。默认，用来演示 + 回归测试，不联网、不要 key。
 *   server —— 本地 tools/serve.mjs 转发到 OpenAI 兼容端点（DeepSeek 官方 / 任意兼容服务）。
 *   ollama —— 本地 Ollama，无需 key。
 */

import { extractJson, ZError, uid } from './util.mjs';
import { validatePatch } from './schema.mjs';
import { SYSTEM_PROMPT, buildUserInstruction, buildRepairPrompt } from './systemprompt.mjs';

export const PROVIDERS = {
  MOCK: 'mock',
  SERVER: 'server',
  OLLAMA: 'ollama',
};

/* ============================== 通用 ============================== */

/** 把模型的自由输出规整成 Patch 形状（补 target、容错单条改动） */
export function coerceToPatch(raw, ctx) {
  const pid = ctx?.target?.pid ?? null;
  let obj = raw;
  if (typeof obj === 'string') obj = extractJson(obj);
  if (Array.isArray(obj)) obj = { changes: obj };
  if (obj && typeof obj === 'object' && !obj.changes && obj.op) obj = { changes: [obj] };
  if (obj && typeof obj === 'object' && !obj.changes && obj.operations) obj = { ...obj, changes: obj.operations };
  if (obj && typeof obj === 'object' && !obj.changes && obj.edits) obj = { ...obj, changes: obj.edits };
  if (!obj || typeof obj !== 'object') throw new ZError('模型输出不是 JSON 对象', 'E_MODEL_JSON');

  const out = { version: 1, target: obj.target ?? pid, summary: obj.summary ?? obj.note ?? obj.explanation ?? '', changes: obj.changes };
  if (Array.isArray(out.changes)) {
    out.changes = out.changes.map((c) => {
      if (!c || typeof c !== 'object') return c;
      const next = { ...c };
      if (!next.target) next.target = pid;
      // 容错：有些模型写 property 而不是 prop
      if (next.op === 'setStyle' && next.prop === undefined && next.property !== undefined) next.prop = next.property;
      // 容错：有些模型把删除属性写成 op=removeAttr
      if (next.op === 'removeAttr') {
        next.op = 'setAttr';
        next.value = null;
      }
      return next;
    });
  }
  return out;
}

/** 完整解析流程：自由文本 → 合法 patch（含一次自动修复机会） */
export function parseModelOutput(rawText, ctx) {
  try {
    const coerced = coerceToPatch(rawText, ctx);
    const patch = validatePatch(coerced);
    return { patch, repaired: false };
  } catch (firstError) {
    throw new ZError(`模型返回无法解析为合法 patch：${firstError.message}`, 'E_MODEL_PARSE', {
      raw: String(rawText ?? '').slice(0, 2000),
      cause: firstError.code ?? 'E_MODEL_PARSE',
    });
  }
}

/* ============================== Mock ============================== */

const CN_COLORS = [
  ['朱红', '#dc2626'], ['浅蓝', '#38bdf8'], ['深蓝', '#1e3a8a'], ['天蓝', '#0ea5e9'],
  ['金黄', '#d97706'], ['墨绿', '#065f46'], ['浅绿', '#4ade80'], ['深绿', '#15803d'],
  ['浅灰', '#d1d5db'], ['深灰', '#374151'], ['透明', null],
  ['红', '#dc2626'], ['橙', '#ea580c'], ['黄', '#eab308'], ['绿', '#16a34a'], ['青', '#0891b2'],
  ['蓝', '#2563eb'], ['紫', '#7c3aed'], ['粉', '#ec4899'], ['棕', '#78350f'], ['灰', '#6b7280'],
  ['黑', '#111827'], ['白', '#ffffff'],
];

function pickColor(text) {
  const hex = text.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/i);
  if (hex) return hex[0];
  const rgb = text.match(/rgba?\([^)]+\)/i);
  if (rgb) return rgb[0];
  // 按"名称长度降序"匹配：先看"浅蓝"，别让"蓝"把"浅蓝"截胡
  const sorted = [...CN_COLORS].sort((a, b) => b[0].length - a[0].length);
  for (const [cn, value] of sorted) {
    if (value && text.includes(cn)) return value;
  }
  return null;
}

function scalePx(value, ratio) {
  const n = parseFloat(String(value ?? ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * ratio) + (String(value).includes('rem') ? 'rem' : 'px');
}

function extractNumbers(text) {
  const out = [];
  const re = /(\d+(?:\.\d+)?)\s*(px|rem|em|%|倍|vw|vh|pt)?/g;
  let m;
  while ((m = re.exec(text))) out.push({ num: parseFloat(m[1]), unit: m[2] ?? null });
  return out;
}

/**
 * 离线规则引擎：把中文口语映射成合法 patch。
 * 覆盖"大一点/小一点、颜色、间距、圆角、加粗、居中、换文字、加/删元素"这些高频操作。
 */
export function mockPatch(context) {
  const target = context?.target ?? {};
  const pid = target.pid;
  const req = String(context?.request ?? '');
  const text = req.toLowerCase();
  const computed = target.computed ?? {};
  const changes = [];
  const notes = [];

  const wantBigger = /(大一点|更大|放大|大一些|变大|大点|加大|醒目|突出|bold|bigger|larger)/i.test(req);
  const wantSmaller = /(小一点|更小|缩小|小一些|变小|小点|less|smaller)/i.test(req);
  const curatedColor = pickColor(req);

  // 1) 字号
  if (/(字号|字体大小|font-?size|文字大|文字小|标题大|标题小)/i.test(req) || (wantBigger && /(标题|字|文本|文字)/i.test(req)) || wantSmaller) {
    const cur = parseFloat(computed['font-size'] ?? '16') || 16;
    const ratio = wantSmaller ? 0.8 : wantBigger ? 1.4 : null;
    const nums = extractNumbers(req).filter((n) => n.unit === 'px' || n.unit === 'rem');
    if (nums.length) changes.push({ op: 'setStyle', target: pid, prop: 'font-size', value: `${nums[0].num}${nums[0].unit ?? 'px'}` });
    else if (ratio) changes.push({ op: 'setStyle', target: pid, prop: 'font-size', value: scalePx(`${cur}px`, ratio) });
    else if (cur) changes.push({ op: 'setStyle', target: pid, prop: 'font-size', value: scalePx(`${cur}px`, 1.25) });
    notes.push('字号');
  }

  // 2) 颜色 / 背景
  if (curatedColor) {
    const wantsBackground = /(背景|底色|background)/i.test(req);
    if (wantsBackground) {
      changes.push({ op: 'setStyle', target: pid, prop: 'background-color', value: curatedColor });
      notes.push('背景色');
    } else {
      changes.push({ op: 'setStyle', target: pid, prop: 'color', value: curatedColor });
      notes.push('文字颜色');
    }
  }

  // 3) 间距
  if (/(间距|留白|内边距|内距|padding|外边距|外距|margin|宽松|紧凑|空一点)/i.test(req)) {
    const isMargin = /margin|外边距|外距/i.test(req);
    const prop = isMargin ? 'margin' : 'padding';
    const cur = parseFloat(computed[`${prop}-top`] ?? computed[prop] ?? '0') || 0;
    const nums = extractNumbers(req);
    if (nums.length) changes.push({ op: 'setStyle', target: pid, prop, value: `${nums[0].num}${nums[0].unit ?? 'px'}` });
    else {
      const ratio = /(紧凑|小|收|narrow|tight)/i.test(req) ? 0.6 : 1.6;
      changes.push({ op: 'setStyle', target: pid, prop, value: scalePx(`${cur}px`, ratio) ?? '16px' });
    }
    notes.push('间距');
  }

  // 4) 圆角
  if (/(圆角|圆一点|rounded|border-radius)/i.test(req)) {
    const nums = extractNumbers(req);
    changes.push({ op: 'setStyle', target: pid, prop: 'border-radius', value: nums.length ? `${nums[0].num}${nums[0].unit ?? 'px'}` : /(不|去|取消)/.test(req) ? '0px' : '12px' });
    notes.push('圆角');
  }

  // 5) 加粗 / 斜体 / 下划线
  if (/(加粗|粗体|bold|加黑|更粗)/i.test(req)) {
    changes.push({ op: 'setStyle', target: pid, prop: 'font-weight', value: '700' });
    notes.push('加粗');
  }
  if (/(变细|细体|不要粗)/i.test(req)) {
    changes.push({ op: 'setStyle', target: pid, prop: 'font-weight', value: '400' });
    notes.push('变细');
  }
  if (/(斜体|italic)/i.test(req)) {
    changes.push({ op: 'setStyle', target: pid, prop: 'font-style', value: 'italic' });
    notes.push('斜体');
  }
  if (/(下划线|underline)/i.test(req)) {
    changes.push({ op: 'setStyle', target: pid, prop: 'text-decoration', value: 'underline' });
    notes.push('下划线');
  }

  // 6) 对齐
  if (/(居中|center)/i.test(req)) {
    changes.push({ op: 'setStyle', target: pid, prop: 'text-align', value: 'center' });
    notes.push('居中');
  }
  if (/(左对齐)/i.test(req)) changes.push({ op: 'setStyle', target: pid, prop: 'text-align', value: 'left' });
  if (/(右对齐)/i.test(req)) changes.push({ op: 'setStyle', target: pid, prop: 'text-align', value: 'right' });

  // 7) 行高 / 字距 / 阴影 / 透明度
  if (/(行高|行间距|line-height)/i.test(req)) {
    const nums = extractNumbers(req);
    changes.push({ op: 'setStyle', target: pid, prop: 'line-height', value: nums.length ? String(nums[0].num) : '1.8' });
    notes.push('行高');
  }
  if (/(阴影|立体|shadow)/i.test(req)) {
    changes.push({ op: 'setStyle', target: pid, prop: 'box-shadow', value: '0 10px 30px rgba(15, 23, 42, 0.15)' });
    notes.push('阴影');
  }
  if (/(透明|淡一点|fade)/i.test(req)) {
    changes.push({ op: 'setStyle', target: pid, prop: 'opacity', value: '0.7' });
    notes.push('透明度');
  }

  // 8) 换文字：把"改成 xxx / 换成 xxx / 写 xxx"
  const textChange = req.match(/(?:改成|换成|改为|换为|变成|写成|文本(?:改成|改为)|内容(?:改成|改为))\s*[“"'「]?(.+?)[”"'」]?\s*$/);
  if (textChange && textChange[1] && !/(颜色|大小|字号|背景)/.test(textChange[1])) {
    changes.push({ op: 'setText', target: pid, value: textChange[1].trim() });
    notes.push('文本');
  }

  // 9) 删除 / 增加
  if (/(删掉|删除|去掉|移除|不要这个|remove)/i.test(req)) {
    changes.push({ op: 'removeNode', target: pid });
    notes.push('删除');
  } else if (/((加|增加|添加|插入)(一个|一段|一条)?)(按钮|button)/i.test(req)) {
    changes.push({ op: 'insertHtml', target: pid, position: 'after', html: '<button class="z-added" type="button">新按钮</button>' });
    notes.push('插入按钮');
  } else if (/((加|增加|添加|插入)(一个|一段|一条)?)(段落|文字|文本|标题)/i.test(req)) {
    const value = req.match(/[“"'「](.+?)[”"'」]/)?.[1] ?? '新增一行说明文字';
    changes.push({ op: 'insertHtml', target: pid, position: 'after', html: `<p class="z-added">${value}</p>` });
    notes.push('插入段落');
  }

  // 兜底：什么都不匹配时，给一个"看得见但不乱来"的改动，并诚实说明
  if (!changes.length) {
    const cur = computed['font-size'] ?? '16px';
    changes.push({ op: 'setStyle', target: pid, prop: 'font-size', value: scalePx(cur, 1.2) ?? '19px' });
    notes.push('离线 Mock 只能理解常见指令（大一点/小一点/颜色/间距/圆角/加粗/居中/改文字/删除）；已演示一次字号微调');
  }

  const deduped = [];
  const seenProps = new Set();
  for (const c of changes) {
    const key = c.op === 'setStyle' ? `s:${c.prop}` : `${c.op}:${c.target}`;
    if (c.op === 'setStyle' && seenProps.has(key)) continue;
    if (c.op === 'setStyle') seenProps.add(key);
    deduped.push(c);
  }

  return {
    version: 1,
    target: pid,
    summary: notes.length ? `离线 Mock：${notes.join('、')}` : '离线 Mock 改动',
    changes: deduped.slice(0, 20),
  };
}

/* ============================== HTTP Provider ============================== */

async function callOpenAiCompatible({ endpoint, apiKey, model, messages, signal, temperature = 0.2, jsonMode = true }) {
  const url = endpoint.replace(/\/+$/, '') + '/chat/completions';
  const body = {
    model,
    messages,
    temperature,
    max_tokens: 2000,
    stream: false,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const send = async (payload) =>
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(payload),
      signal,
    });

  let res = await send(body);
  let text = await res.text();

  // 不是所有 OpenAI 兼容端点/模型都支持 response_format。
  // 明确因此报错时，去掉它重试一次——不然用户换个模型就直接失败。
  if (!res.ok && jsonMode && res.status === 400 && /response_format|json_object|not support/i.test(text)) {
    delete body.response_format;
    res = await send(body);
    text = await res.text();
  }

  if (!res.ok) {
    throw new ZError(`模型接口 ${res.status}：${text.slice(0, 300)}`, 'E_MODEL_HTTP', { status: res.status });
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ZError('模型接口返回的不是 JSON', 'E_MODEL_HTTP', { body: text.slice(0, 300) });
  }
  const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? '';
  if (!content) throw new ZError('模型没有返回内容', 'E_MODEL_EMPTY', data);
  return { content, usage: data.usage ?? null, endpoint: url };
}

/** 通用"问模型 → 校验 → 失败自动重试一次"的流程 */
async function generateViaChat({ context, callChat, onDelta }) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserInstruction(context) },
  ];
  onDelta?.('正在请求模型…');
  const first = await callChat(messages);
  try {
    const { patch } = parseModelOutput(first.content, context);
    return { raw: first.content, patch, usage: first.usage, attempts: 1, repaired: false };
  } catch (err) {
    onDelta?.('模型输出不合规，正在要求它自我修复…');
    const repair = [
      ...messages,
      { role: 'assistant', content: String(first.content).slice(0, 2000) },
      { role: 'user', content: buildRepairPrompt(first.content, err.message) },
    ];
    const second = await callChat(repair);
    const { patch } = parseModelOutput(second.content, context);
    return { raw: second.content, patch, usage: second.usage, attempts: 2, repaired: true };
  }
}

/* ============================== 工厂 ============================== */

export function createProvider({ kind = PROVIDERS.MOCK, endpoint, apiKey, model } = {}) {
  if (kind === PROVIDERS.MOCK) {
    return {
      kind,
      label: '离线 Mock（无需联网）',
      async generate(context) {
        const started = Date.now();
        await new Promise((r) => setTimeout(r, 220)); // 模拟一点延迟，让"思考中"状态可见
        const raw = JSON.stringify(mockPatch(context), null, 2);
        const patch = validatePatch(coerceToPatch(raw, context));
        return { raw, patch, provider: kind, ms: Date.now() - started, mode: 'mock' };
      },
    };
  }

  if (kind === PROVIDERS.OLLAMA) {
    const url = endpoint || 'http://localhost:11434/v1';
    return {
      kind,
      label: `Ollama (${model || 'qwen2.5:7b'})`,
      async generate(context, { signal, onDelta } = {}) {
        const started = Date.now();
        const res = await generateViaChat({
          context,
          onDelta,
          callChat: (messages) => callOpenAiCompatible({ endpoint: url, model: model || 'qwen2.5:7b', messages, signal, jsonMode: true }),
        });
        return { ...res, provider: kind, ms: Date.now() - started };
      },
    };
  }

  // server（默认走本地代理，key 不出本机）
  const url = endpoint || '/api/chat';
  return {
    kind: PROVIDERS.SERVER,
    label: `服务端模型 (${model || 'deepseek-chat'})`,
    async generate(context, { signal, onDelta } = {}) {
      const started = Date.now();
      if (url.startsWith('/api/')) {
        onDelta?.('正在请求本地模型代理…');
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ context, model }),
          signal,
        });
        const text = await res.text();
        if (!res.ok) throw new ZError(`本地代理 ${res.status}：${text.slice(0, 300)}`, 'E_PROXY_HTTP', { status: res.status });
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          throw new ZError('本地代理返回的不是 JSON', 'E_PROXY_HTTP', { body: text.slice(0, 200) });
        }
        // 代理用 200 + {error} 报告"模型输出不合规"这类失败，必须显式检查，
        // 否则真实失败原因会被吞掉（前端只会看到"没有改动"这种含糊结果）。
        if (data.error && !data.patch) {
          throw new ZError(`本地代理报告失败：${data.error}`, 'E_PROXY_MODEL', data);
        }
        const patch = data.patch ? validatePatch(data.patch) : parseModelOutput(data.raw ?? data.content, context).patch;
        return { raw: data.raw ?? JSON.stringify(data.patch), patch, usage: data.usage ?? null, provider: kind, ms: Date.now() - started, mode: data.mode ?? 'server' };
      }
      const res = await generateViaChat({
        context,
        onDelta,
        callChat: (messages) => callOpenAiCompatible({ endpoint: url, apiKey, model: model || 'deepseek-chat', messages, signal }),
      });
      return { ...res, provider: kind, ms: Date.now() - started };
    },
  };
}

export { SYSTEM_PROMPT, buildUserInstruction, uid };
