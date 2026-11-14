import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  JIANGSU_DATA_PATH,
  loadJiangsuPrompts,
  loadPrompts,
  validateJiangsuDataset,
} from '../server/data.js';
import { createApp } from '../server/app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let server;
let base;

before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function jsonRequest(url) {
  const response = await fetch(`${base}${url}`);
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { status: response.status, payload };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function rawJiangsu() {
  return JSON.parse(fs.readFileSync(JIANGSU_DATA_PATH, 'utf8'));
}

test('江苏题库文件存在，2022—2024 各 1 条且字段完整', () => {
  assert.ok(fs.existsSync(path.join(root, 'data/jiangsu-prompts.json')));
  const prompts = loadJiangsuPrompts();

  assert.equal(prompts.length, 3);
  assert.deepEqual(prompts.map((p) => p.year), [2022, 2023, 2024]);

  const shanghai = loadPrompts();
  const allIds = new Set(shanghai.map((p) => p.id));
  const allKeys = new Set(shanghai.map((p) => `${p.year}|${p.title}`));

  for (const p of prompts) {
    for (const field of ['id', 'province', 'paper', 'title', 'material', 'requirements', 'concept', 'source']) {
      assert.ok(typeof p[field] === 'string' && p[field].trim().length > 0, `${p.year}.${field} 不能为空`);
      assert.ok(!/TODO|占位|待补充|placeholder|示例文本/.test(p[field]), `${p.year}.${field} 不能是占位文本`);
    }
    assert.equal(p.province, '江苏');
    assert.equal(p.paper, '新课标I卷');
    assert.ok(p.material.length > 60, '题目材料应完整');
    assert.match(p.requirements, /不少于800字/);
    assert.ok(p.concept.length >= 30, '审题立意应有实质内容');
    assert.ok(p.source.includes(String(p.year)) && p.source.includes('新课标I卷'), '来源需含年份与试卷');
    assert.ok(p.tags.length >= 1);
    assert.ok(p.reviewPoints.length >= 2, '审题要点至少 2 条');
    assert.ok(p.writingTips.length >= 2, '写作提示至少 2 条');

    assert.ok(!allIds.has(p.id), `id 与原有题库重复：${p.id}`);
    assert.ok(!allKeys.has(`${p.year}|${p.title}`), `题目与原有题库重复：${p.year} ${p.title}`);
    allIds.add(p.id);
    allKeys.add(`${p.year}|${p.title}`);
  }
});

test('三条江苏题目分别包含可检索的核心材料', () => {
  const byYear = new Map(loadJiangsuPrompts().map((p) => [p.year, p]));
  assert.match(byYear.get(2022).material, /本手/);
  assert.match(byYear.get(2023).material, /好的故事/);
  assert.match(byYear.get(2024).material, /人工智能/);
});

test('江苏题库校验会拒绝缺字段、占位文本、重复年份、非法年份与 id 冲突', () => {
  const raw = rawJiangsu();

  const missing = clone(raw);
  delete missing.prompts[0].material;
  assert.throws(() => validateJiangsuDataset(missing), /material/);

  const placeholder = clone(raw);
  placeholder.prompts[0].concept = 'TODO 待补充';
  assert.throws(() => validateJiangsuDataset(placeholder), /concept/);

  const duplicateYear = clone(raw);
  duplicateYear.prompts[1].year = 2022;
  assert.throws(() => validateJiangsuDataset(duplicateYear), /年份重复/);

  const illegalYear = clone(raw);
  illegalYear.prompts[0].year = 2021;
  assert.throws(() => validateJiangsuDataset(illegalYear), /year/);

  const wrongProvince = clone(raw);
  wrongProvince.prompts[0].province = '浙江';
  assert.throws(() => validateJiangsuDataset(wrongProvince), /province/);

  const tooFewTips = clone(raw);
  tooFewTips.prompts[0].writingTips = ['只有一条'];
  assert.throws(() => validateJiangsuDataset(tooFewTips), /writingTips/);

  const idConflict = clone(raw);
  idConflict.prompts[0].id = 'shanghai-2022';
  assert.throws(() => validateJiangsuDataset(idConflict, { existingPrompts: loadPrompts() }), /重复/);
});

test('GET /api/jiangsu/prompts 返回三年数据，根路径与 /apps/p1/ 前缀一致', async () => {
  for (const prefix of ['', '/apps/p1']) {
    const { status, payload } = await jsonRequest(`${prefix}/api/jiangsu/prompts`);
    assert.equal(status, 200);
    assert.deepEqual(payload.map((p) => p.year), [2022, 2023, 2024]);
    for (const p of payload) {
      assert.equal(p.province, '江苏');
      assert.equal(p.paper, '新课标I卷');
      assert.ok(p.material && p.requirements && p.concept && p.source);
      assert.ok(p.reviewPoints.length >= 2 && p.writingTips.length >= 2);
    }
  }
});

test('江苏题库年份筛选严格一致', async () => {
  for (const year of [2022, 2023, 2024]) {
    const { status, payload } = await jsonRequest(`/api/jiangsu/prompts?year=${year}`);
    assert.equal(status, 200);
    assert.equal(payload.length, 1);
    assert.equal(payload[0].year, year);
  }
});

test('关键词检索：本手→2022、故事→2023、人工智能→2024', async () => {
  const cases = [
    ['本手', 2022],
    ['故事', 2023],
    ['人工智能', 2024],
  ];
  for (const [keyword, year] of cases) {
    const { status, payload } = await jsonRequest(`/api/jiangsu/prompts?keyword=${encodeURIComponent(keyword)}`);
    assert.equal(status, 200);
    assert.equal(payload.length, 1, `关键词「${keyword}」应只命中 1 条`);
    assert.equal(payload[0].year, year);
  }

  const none = await jsonRequest('/api/jiangsu/prompts?keyword=zzz-not-exist');
  assert.equal(none.status, 200);
  assert.deepEqual(none.payload, []);
});

test('非法年份参数返回 400 中文结构化错误', async () => {
  for (const year of ['2021', 'abc', '2024.5']) {
    const { status, payload } = await jsonRequest(`/api/jiangsu/prompts?year=${year}`);
    assert.equal(status, 400, `year=${year} 应返回 400`);
    assert.equal(payload.error.code, 'INVALID_YEAR');
    assert.match(payload.error.message, /年份参数无效/);
  }
});

test('江苏题目详情可通过统一 id 路由读取，不存在返回 404', async () => {
  const ok = await jsonRequest('/api/prompts/jiangsu-2022');
  assert.equal(ok.status, 200);
  assert.equal(ok.payload.title, '本手、妙手、俗手');
  assert.ok(ok.payload.material.includes('本手'));
  assert.ok(ok.payload.requirements.includes('不少于800字'));
  assert.ok(ok.payload.concept.length > 30);
  assert.ok(ok.payload.writingTips.length >= 2);
  assert.ok(ok.payload.source.includes('2022'));

  const missing = await jsonRequest('/api/prompts/jiangsu-9999');
  assert.equal(missing.status, 404);
  assert.equal(missing.payload.error.code, 'PROMPT_NOT_FOUND');
  assert.match(missing.payload.error.message, /未找到该题目/);
});

test('原有上海卷题库接口与详情不受新增题库影响', async () => {
  const list = await jsonRequest('/api/prompts');
  assert.equal(list.status, 200);
  assert.deepEqual(list.payload.map((p) => p.year), [2022, 2023, 2024]);
  assert.ok(list.payload.every((p) => p.region === '上海卷'));

  const byYear = await jsonRequest('/api/prompts?year=2023');
  assert.equal(byYear.status, 200);
  assert.equal(byYear.payload.length, 1);
  assert.equal(byYear.payload[0].id, 'shanghai-2023');

  const detail = await jsonRequest('/api/prompts/shanghai-2024');
  assert.equal(detail.status, 200);
  assert.equal(detail.payload.title, '认可度');
  assert.ok(detail.payload.angles.length >= 3);
});
