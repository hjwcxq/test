import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, normalizeBase } from '../server/app.js';
import { loadPrompts } from '../server/data.js';
import { composeLocalEssay } from '../server/essay.js';

let server;
let base;

// 测试使用确定性的本地范文组件，避免依赖外部模型；真实模型通道由 smoke 覆盖。
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

async function jsonRequest(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { status: response.status, payload, headers: response.headers };
}

function post(body, { prefix = '', contentType = 'application/json', raw = null } = {}) {
  return jsonRequest(`${prefix}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: raw !== null ? raw : JSON.stringify(body),
  });
}

const VALID_TOPIC = '一个人乐意去探索陌生世界，仅仅是因为好奇心吗？请写一篇文章，谈谈你对这个问题的认识和思考。';

test('基础路径规范化：安全字符、去尾斜杠、多值请求头', () => {
  assert.equal(normalizeBase('/apps/p1/'), '/apps/p1');
  assert.equal(normalizeBase('apps/p1'), '/apps/p1');
  assert.equal(normalizeBase('/apps/p1, /other'), '/apps/p1');
  assert.equal(normalizeBase('/'), '');
  assert.equal(normalizeBase(''), '');
  assert.equal(normalizeBase('/bad path"<script>'), '');
});

test('GET /health 与 /apps/p1/health 返回 200 且响应体表明健康', async () => {
  for (const path of ['/health', '/apps/p1/health']) {
    const { status, payload } = await jsonRequest(path);
    assert.equal(status, 200);
    assert.equal(payload.status, 'ok');
    assert.equal(payload.healthy, true);
    assert.ok(payload.service);
  }
});

test('GET /api/prompts 返回三年数据且含解题字段（根路径与 /apps/p1/ 前缀）', async () => {
  for (const prefix of ['', '/apps/p1']) {
    const { status, payload } = await jsonRequest(`${prefix}/api/prompts`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(payload));
    assert.deepEqual(payload.map((p) => p.year), [2022, 2023, 2024]);
    for (const p of payload) {
      assert.ok(p.original && p.overview && p.reviewPoints.length >= 2);
      assert.ok(p.keywords.length >= 2 && p.angles.length >= 3);
      assert.ok(p.structure.sections.length >= 4 && p.materials.length >= 2 && p.pitfalls.length >= 2);
    }
  }
});

test('题目库支持 year 与 keyword 检索', async () => {
  const byYear = await jsonRequest('/api/prompts?year=2023');
  assert.equal(byYear.status, 200);
  assert.equal(byYear.payload.length, 1);
  assert.equal(byYear.payload[0].year, 2023);

  const byKeyword = await jsonRequest('/api/prompts?keyword=%E8%AE%A4%E5%8F%AF%E5%BA%A6');
  assert.equal(byKeyword.status, 200);
  assert.equal(byKeyword.payload.length, 1);
  assert.equal(byKeyword.payload[0].year, 2024);

  const none = await jsonRequest('/api/prompts?keyword=zzz-not-exist');
  assert.equal(none.status, 200);
  assert.deepEqual(none.payload, []);
});

test('GET /api/prompts/:id 返回单题详情，不存在返回 404 结构化错误', async () => {
  const ok = await jsonRequest('/api/prompts/shanghai-2024');
  assert.equal(ok.status, 200);
  assert.equal(ok.payload.id, 'shanghai-2024');
  assert.ok(ok.payload.angles.length >= 3);
  assert.ok(ok.payload.structure.sections.length >= 4);

  const missing = await jsonRequest('/api/prompts/not-exist');
  assert.equal(missing.status, 404);
  assert.ok(missing.payload.error.code);
  assert.ok(/[\u4e00-\u9fa5]/.test(missing.payload.error.message), '错误信息应为中文');
});

test('POST /api/analyze 合法题目返回 200 且字段完整', async () => {
  for (const prefix of ['', '/apps/p1']) {
    const { status, payload } = await post({ topic: VALID_TOPIC }, { prefix });
    assert.equal(status, 200);
    assert.equal(payload.topic, VALID_TOPIC);
    assert.equal(payload.questionType.name, '思辨关系类');
    assert.ok(payload.questionType.reason);
    assert.ok(payload.coreConcepts.length >= 2);
    assert.ok(payload.constraints.length >= 3);
    assert.ok(payload.angles.length >= 3, '立意方向至少 3 个');
    assert.ok(payload.outline.length >= 4, '分段提纲非空');
    assert.ok(payload.materials.length >= 2);
    assert.ok(payload.writingTips.length >= 3);
    assert.ok(payload.risks.length >= 3);
    assert.ok(payload.engine);
    assert.ok(payload.essay, '应返回配套范文');
    assert.ok(payload.essay.title && payload.essay.body);
    assert.ok(payload.essay.wordCount >= 600 && payload.essay.wordCount <= 1200);
    assert.match(payload.essay.disclaimer, /示范范文，仅供学习参考/);
    assert.ok(payload.review?.intention && payload.review?.structure && payload.review?.highlight);
    for (const a of payload.angles) assert.ok(a.title && a.level && a.fit && a.description);
    for (const s of payload.outline) assert.ok(s.section && s.function && s.ratio && s.guidance);
  }
});

test('POST /api/analyze 空题目 / 纯空白 / 缺少 topic 返回 400 中文结构化错误', async () => {
  const cases = [{ topic: '' }, { topic: '   \n\t  ' }, {}, { topic: null }];
  for (const body of cases) {
    const { status, payload } = await post(body);
    assert.equal(status, 400, `body=${JSON.stringify(body)} 应返回 400`);
    assert.ok(payload.error.code);
    assert.match(payload.error.message, /请输入作文题目/);
    assert.equal(payload.essay, undefined, '空题目不应生成范文');
  }
});

test('POST /api/analyze 超过 2000 字返回 400，2000 字可通过', async () => {
  const tooLong = await post({ topic: '好'.repeat(2001) });
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.payload.error.code, 'TOPIC_TOO_LONG');

  const atLimit = await post({ topic: '好'.repeat(2000) });
  assert.equal(atLimit.status, 200);
});

test('POST /api/analyze 请求体非 JSON / 格式错误返回 400 而非 500', async () => {
  const malformed = await post(null, { raw: '{oops' });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.payload.error.code, 'INVALID_JSON');

  const plainText = await post(null, { contentType: 'text/plain', raw: 'hello' });
  assert.equal(plainText.status, 400);
  assert.ok(plainText.payload.error.code);
});

test('未知 API 路径返回 JSON 404', async () => {
  const { status, payload } = await jsonRequest('/api/definitely-not-exist');
  assert.equal(status, 404);
  assert.ok(payload.error.code);
});
