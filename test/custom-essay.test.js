import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import {
  EssayGenerationError,
  composeLocalEssay,
  countEssayChars,
  normalizeEssayPayload,
} from '../server/essay.js';
import { analyzeLocal } from '../server/analyzer.js';
import { loadPrompts } from '../server/data.js';

let server;
let base;

const localEssayGenerator = async (topic, analysis) => composeLocalEssay(topic, analysis);

before(async () => {
  server = createApp({
    prompts: loadPrompts(),
    essayGenerator: localEssayGenerator,
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function analyze(topic) {
  const response = await fetch(`${base}/apps/p1/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic }),
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

test('自定义题目剖析返回原有思路、完整范文与三方面点评', async () => {
  const topic = '人工智能让生活更便利还是更疏远？';
  const { status, payload } = await analyze(topic);
  assert.equal(status, 200);
  assert.equal(payload.topic, topic);
  assert.ok(payload.angles.length >= 3, '应保留立意角度');
  assert.ok(payload.outline.length >= 4, '应保留结构思路');

  assert.ok(payload.essay?.title && payload.essay?.body);
  assert.equal(payload.essay.disclaimer, '示范范文，仅供学习参考');
  const chars = countEssayChars(payload.essay.body);
  assert.ok(chars >= 600 && chars <= 1200, `范文应 600–1200 字，实际 ${chars} 字`);
  assert.ok(payload.essay.body.includes('人工智能'), '范文应回应题目关键词');
  assert.ok(payload.essay.body.split(/\n\s*\n/).filter(Boolean).length >= 4, '范文应分段成篇');

  for (const key of ['intention', 'structure', 'highlight']) {
    assert.ok(
      typeof payload.review?.[key] === 'string' && payload.review[key].trim().length >= 12,
      `点评缺少 ${key}`
    );
  }
});

test('不同题目生成不同范文，且新结果不残留上一题关键词', async () => {
  const first = await analyze('星火码头的去留应如何权衡？');
  const second = await analyze('青禾书院的传统手工艺如何传承？');
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);

  assert.ok(first.payload.essay.body.includes('星火码头'));
  assert.ok(second.payload.essay.body.includes('青禾书院'));
  assert.notEqual(first.payload.essay.body, second.payload.essay.body);
  assert.notEqual(first.payload.essay.title, second.payload.essay.title);
  assert.ok(!second.payload.essay.body.includes('星火码头'), '新范文不应残留上一题内容');
  assert.notEqual(first.payload.review.intention, second.payload.review.intention);
});

test('空字符串与纯空白题目返回请输入作文题目，不生成范文', async () => {
  for (const topic of ['', '   ', '\n\t  ']) {
    const { status, payload } = await analyze(topic);
    assert.equal(status, 400);
    assert.equal(payload.error.code, 'EMPTY_TOPIC');
    assert.match(payload.error.message, /请输入作文题目/);
    assert.equal(payload.essay, undefined);
  }
});

test('模型失败时返回可重试错误，不返回空白范文或占位文本', async () => {
  const failing = createApp({
    prompts: loadPrompts(),
    essayGenerator: async () => {
      throw new EssayGenerationError('模拟模型超时');
    },
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => failing.once('listening', resolve));
  const failingBase = `http://127.0.0.1:${failing.address().port}`;
  try {
    const response = await fetch(`${failingBase}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: '人工智能让生活更便利还是更疏远？' }),
    });
    assert.equal(response.status, 503);
    const payload = await response.json();
    assert.equal(payload.error.code, 'ESSAY_GENERATION_FAILED');
    assert.equal(payload.error.retryable, true);
    assert.match(payload.error.message, /重试/);
    assert.equal(payload.essay, undefined);
  } finally {
    await new Promise((resolve) => failing.close(resolve));
  }
});

test('上游资源不可用时自动降级为本地范文，接口仍返回完整成篇内容', async () => {
  const previous = process.env.DELIVERY_RESOURCE_CONTEXT_FILE;
  process.env.DELIVERY_RESOURCE_CONTEXT_FILE = path.resolve(
    process.cwd(),
    'test/fixtures/does-not-exist-resource-context.json'
  );
  const degraded = createApp({ prompts: loadPrompts() }).listen(0, '127.0.0.1');
  await new Promise((resolve) => degraded.once('listening', resolve));
  const degradedBase = `http://127.0.0.1:${degraded.address().port}`;
  try {
    const topic = '人工智能让生活更便利还是更疏远？';
    const response = await fetch(`${degradedBase}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic }),
    });
    assert.equal(response.status, 200, '上游不可用时不应返回空白或 5xx');
    const payload = await response.json();
    assert.equal(payload.essayEngine, 'local-fallback');
    assert.ok(payload.angles.length >= 3 && payload.outline.length >= 4);
    assert.ok(payload.essay.body.includes('人工智能'));
    const chars = countEssayChars(payload.essay.body);
    assert.ok(chars >= 600 && chars <= 1200, `降级范文 ${chars} 字超出范围`);
    for (const key of ['intention', 'structure', 'highlight']) {
      assert.ok(payload.review?.[key]?.trim(), `降级点评缺少 ${key}`);
    }
  } finally {
    if (previous === undefined) delete process.env.DELIVERY_RESOURCE_CONTEXT_FILE;
    else process.env.DELIVERY_RESOURCE_CONTEXT_FILE = previous;
    await new Promise((resolve) => degraded.close(resolve));
  }
});

test('模型返回过短或缺少点评时被拒绝，避免占位内容进入页面', () => {
  assert.throws(
    () => normalizeEssayPayload({ title: '太短', essay: '只有一句话。', review: {} }),
    /范文长度|点评/
  );
  assert.throws(
    () =>
      normalizeEssayPayload({
        title: '缺点评',
        essay: '第一段内容足够长。\n\n第二段内容足够长。\n\n第三段内容足够长。\n\n第四段内容足够长。'.repeat(30),
      }),
    /点评/
  );
});

test('本地范文组件对任意题目都生成 600–1200 字成篇内容', () => {
  for (const topic of ['谈谈读书', '城市老街区改造应保留记忆还是引入新业态？', '？']) {
    const analysis = analyzeLocal(topic);
    const { essay, review } = composeLocalEssay(topic, analysis);
    const chars = countEssayChars(essay.body);
    assert.ok(chars >= 600 && chars <= 1200, `${topic} 生成了 ${chars} 字`);
    assert.ok(essay.title.length >= 2);
    assert.ok(essay.body.split(/\n\s*\n/).filter(Boolean).length >= 4);
    assert.ok(review.intention && review.structure && review.highlight);
  }
});

test('范文容器内以精确文案展示「示范范文，仅供学习参考」且不带句号', () => {
  // 验收以精确文本匹配该提示，末尾多一个句号会导致查不到，这里做源码级守卫。
  const components = fs.readFileSync(
    path.resolve(process.cwd(), 'web/src/components.jsx'),
    'utf8'
  );
  assert.ok(
    components.includes("const disclaimer = '示范范文，仅供学习参考';"),
    '提示文案应为不带句号的精确文本'
  );
  const essayStart = components.indexOf('data-testid="custom-essay"');
  const noteIndex = components.indexOf('{disclaimer}', essayStart);
  const bodyIndex = components.indexOf('custom-essay-body', essayStart);
  assert.ok(essayStart !== -1 && noteIndex !== -1, '范文容器内应渲染提示');
  assert.ok(noteIndex < bodyIndex, '提示应位于范文正文之前的可见位置');
  assert.ok(
    !components.includes("essay.disclaimer ||"),
    '不应再用后端文案兜底，避免再次出现句号差异'
  );
});
