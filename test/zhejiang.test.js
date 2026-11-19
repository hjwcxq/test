import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REQUIRED_YEARS,
  ZHEJIANG_DATA_PATH,
  loadJiangsuPrompts,
  loadPrompts,
  loadZhejiangPrompts,
  validateZhejiangDataset,
} from '../server/data.js';
import { createApp } from '../server/app.js';
import { composeLocalEssay } from '../server/essay.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let server;
let base;

before(async () => {
  server = createApp({
    essayGenerator: async (topic, analysis) => composeLocalEssay(topic, analysis),
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function jsonRequest(url, options = {}) {
  const response = await fetch(`${base}${url}`, options);
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

function rawZhejiang() {
  return JSON.parse(fs.readFileSync(ZHEJIANG_DATA_PATH, 'utf8'));
}

test('浙江题库文件存在，2022—2024 各 1 条，字段完整且为实质内容', () => {
  assert.ok(fs.existsSync(path.join(root, 'data/zhejiang-prompts.json')));
  const prompts = loadZhejiangPrompts();

  assert.equal(prompts.length, 3);
  assert.deepEqual(prompts.map((p) => p.year), REQUIRED_YEARS);
  assert.equal(new Set(prompts.map((p) => p.year)).size, 3, '年份不能重复');

  const others = [...loadPrompts(), ...loadJiangsuPrompts()];
  const otherIds = new Set(others.map((p) => p.id));
  const otherTitles = new Set(others.map((p) => `${p.year}|${p.title}`));

  for (const p of prompts) {
    for (const field of ['id', 'province', 'paper', 'title', 'material', 'requirements', 'concept', 'source']) {
      assert.ok(typeof p[field] === 'string' && p[field].trim().length > 0, `${p.year}.${field} 不能为空`);
      assert.ok(!/TODO|占位|待补充|placeholder|示例文本|lorem ipsum/i.test(p[field]), `${p.year}.${field} 不能是占位文本`);
    }
    assert.equal(p.province, '浙江');
    assert.equal(p.paper, p.year === 2022 ? '浙江卷' : '新课标I卷');
    assert.ok(p.material.length > 60, '作文材料应完整');
    assert.ok(p.requirements.includes('800字'), '写作要求应包含字数要求');
    assert.ok(p.concept.length >= 30, '审题立意应有实质内容');
    assert.ok(p.source.includes(String(p.year)) && p.source.includes('浙江'), '来源需含年份与浙江');
    assert.ok(p.source.length >= 10, '来源说明需可核验');

    assert.ok(p.tags.length >= 1);
    assert.ok(p.reviewPoints.length >= 3, '审题要点至少 3 条');
    assert.ok(p.keywords.length >= 3, '关键词拆解至少 3 条');
    assert.ok(p.angles.length >= 3, '立意方向至少 3 个');
    assert.ok(p.structure.sections.length >= 4, '结构提纲至少 4 段');
    assert.ok(p.materials.length >= 2, '素材方向至少 2 组');
    assert.ok(p.writingTips.length >= 2, '表达建议至少 2 条');
    assert.ok(p.pitfalls.length >= 2, '常见误区至少 2 条');
    assert.ok(p.scoringPoints.length >= 3, '评分关注点至少 3 条');

    for (const k of p.keywords) {
      assert.ok(k.term && k.analysis && k.analysis.length > 20, '关键词分析需有实质内容');
    }
    for (const a of p.angles) {
      assert.ok(a.title && a.fit && a.level && a.description);
      assert.ok(a.description.length > 20, '立意描述不能是占位短句');
    }
    for (const s of p.structure.sections) {
      assert.ok(s.part && s.function && s.ratio && s.guidance);
    }
    for (const m of p.materials) {
      assert.ok(m.direction && m.examples.length >= 1);
    }
    for (const pitfall of p.pitfalls) {
      assert.ok(pitfall.mistake && pitfall.upgrade);
    }

    assert.ok(!otherIds.has(p.id), `id 与上海/江苏题库重复：${p.id}`);
    assert.ok(!otherTitles.has(`${p.year}|${p.title}`), `题目与上海/江苏题库混淆：${p.year} ${p.title}`);
    otherIds.add(p.id);
    otherTitles.add(`${p.year}|${p.title}`);
  }
});

test('浙江三条题目分别包含可检索的核心材料', () => {
  const byYear = new Map(loadZhejiangPrompts().map((p) => [p.year, p]));
  assert.match(byYear.get(2022).material, /徐枫灿/);
  assert.match(byYear.get(2022).material, /杨杰/);
  assert.match(byYear.get(2022).material, /之江实验室/);
  assert.match(byYear.get(2023).material, /好的故事/);
  assert.match(byYear.get(2024).material, /人工智能/);
});

test('浙江题库校验会拒绝缺字段、占位文本、重复年份、非法年份、错误省份与 id 冲突', () => {
  const raw = rawZhejiang();

  const missing = clone(raw);
  delete missing.prompts[0].material;
  assert.throws(() => validateZhejiangDataset(missing), /material/);

  const placeholder = clone(raw);
  placeholder.prompts[0].concept = 'TODO 待补充';
  assert.throws(() => validateZhejiangDataset(placeholder), /concept/);

  const duplicateYear = clone(raw);
  duplicateYear.prompts[1].year = 2022;
  assert.throws(() => validateZhejiangDataset(duplicateYear), /年份重复/);

  const illegalYear = clone(raw);
  illegalYear.prompts[0].year = 2021;
  assert.throws(() => validateZhejiangDataset(illegalYear), /year/);

  const wrongProvince = clone(raw);
  wrongProvince.prompts[0].province = '江苏';
  assert.throws(() => validateZhejiangDataset(wrongProvince), /province/);

  const wrongPaper = clone(raw);
  wrongPaper.prompts[0].paper = '全国甲卷';
  assert.throws(() => validateZhejiangDataset(wrongPaper), /paper/);

  const missingScoring = clone(raw);
  delete missingScoring.prompts[0].scoringPoints;
  assert.throws(() => validateZhejiangDataset(missingScoring), /scoringPoints/);

  const emptySource = clone(raw);
  emptySource.prompts[0].source = '';
  assert.throws(() => validateZhejiangDataset(emptySource), /source/);

  const sourceWithoutYear = clone(raw);
  sourceWithoutYear.prompts[0].source = '据公开试题文本整理，以官方发布为准。';
  assert.throws(() => validateZhejiangDataset(sourceWithoutYear), /年份/);

  const idConflict = clone(raw);
  idConflict.prompts[0].id = 'jiangsu-2022';
  assert.throws(
    () => validateZhejiangDataset(idConflict, { existingPrompts: loadJiangsuPrompts() }),
    /重复/
  );

  const titleConflict = clone(raw);
  titleConflict.prompts[0].title = loadJiangsuPrompts()[0].title;
  assert.throws(
    () =>
      validateZhejiangDataset(titleConflict, {
        existingPrompts: loadJiangsuPrompts().filter((p) => p.year === 2022),
      }),
    /混淆|重复/
  );
});

test('GET /api/zhejiang/prompts 返回三年数据，根路径与 /apps/p1/ 前缀一致', async () => {
  for (const prefix of ['', '/apps/p1']) {
    const { status, payload } = await jsonRequest(`${prefix}/api/zhejiang/prompts`);
    assert.equal(status, 200);
    assert.deepEqual(payload.map((p) => p.year), [2022, 2023, 2024]);
    for (const p of payload) {
      assert.equal(p.province, '浙江');
      assert.ok(p.material && p.requirements && p.concept && p.source);
      assert.ok(p.keywords.length >= 3 && p.angles.length >= 3);
      assert.ok(p.structure.sections.length >= 4 && p.scoringPoints.length >= 3);
      assert.ok(p.materials.length >= 2 && p.writingTips.length >= 2 && p.pitfalls.length >= 2);
    }
  }
});

test('浙江题库年份筛选严格一致', async () => {
  for (const year of [2022, 2023, 2024]) {
    const { status, payload } = await jsonRequest(`/api/zhejiang/prompts?year=${year}`);
    assert.equal(status, 200);
    assert.equal(payload.length, 1);
    assert.equal(payload[0].year, year);
  }

  const invalid = await jsonRequest('/api/zhejiang/prompts?year=2021');
  assert.equal(invalid.status, 400);
  assert.equal(invalid.payload.error.code, 'INVALID_YEAR');
});

test('浙江题库关键词检索命中对应年份', async () => {
  const cases = [
    ['徐枫灿', 2022],
    ['杨杰', 2022],
    ['好的故事', 2023],
    ['人工智能', 2024],
  ];
  for (const [keyword, year] of cases) {
    const { status, payload } = await jsonRequest(
      `/api/zhejiang/prompts?keyword=${encodeURIComponent(keyword)}`
    );
    assert.equal(status, 200);
    assert.equal(payload.length, 1, `关键词「${keyword}」应只命中 1 条`);
    assert.equal(payload[0].year, year);
  }

  const none = await jsonRequest('/api/zhejiang/prompts?keyword=zzz-not-exist');
  assert.equal(none.status, 200);
  assert.deepEqual(none.payload, []);
});

test('浙江题目详情可通过统一 id 路由读取，字段完整且不存在返回 404', async () => {
  const ok = await jsonRequest('/api/prompts/zhejiang-2024');
  assert.equal(ok.status, 200);
  assert.equal(ok.payload.province, '浙江');
  assert.equal(ok.payload.paper, '新课标I卷');
  assert.equal(ok.payload.year, 2024);
  assert.match(ok.payload.material, /人工智能/);
  assert.match(ok.payload.requirements, /不少于800字/);
  assert.ok(ok.payload.concept.length > 30);
  assert.ok(ok.payload.keywords.length >= 3);
  assert.ok(ok.payload.angles.length >= 3);
  assert.ok(ok.payload.structure.sections.length >= 4);
  assert.ok(ok.payload.materials.length >= 2);
  assert.ok(ok.payload.pitfalls.length >= 2);
  assert.ok(ok.payload.scoringPoints.length >= 3);
  assert.ok(ok.payload.source.includes('2024') && ok.payload.source.includes('浙江'));

  const missing = await jsonRequest('/api/prompts/zhejiang-9999');
  assert.equal(missing.status, 404);
  assert.equal(missing.payload.error.code, 'PROMPT_NOT_FOUND');
});

test('原有上海卷与江苏题库数量、年份和详情不受浙江题库影响', async () => {
  const shanghai = await jsonRequest('/api/prompts');
  assert.equal(shanghai.status, 200);
  assert.equal(shanghai.payload.length, 3);
  assert.deepEqual(shanghai.payload.map((p) => p.year), [2022, 2023, 2024]);
  assert.ok(shanghai.payload.every((p) => p.region === '上海卷'));

  const jiangsu = await jsonRequest('/api/jiangsu/prompts');
  assert.equal(jiangsu.status, 200);
  assert.equal(jiangsu.payload.length, 3);
  assert.deepEqual(jiangsu.payload.map((p) => p.year), [2022, 2023, 2024]);
  assert.ok(jiangsu.payload.every((p) => p.province === '江苏' && p.paper === '新课标I卷'));

  const shanghaiDetail = await jsonRequest('/api/prompts/shanghai-2024');
  assert.equal(shanghaiDetail.status, 200);
  assert.equal(shanghaiDetail.payload.title, '认可度');
  assert.ok(shanghaiDetail.payload.angles.length >= 3);

  const jiangsuDetail = await jsonRequest('/api/prompts/jiangsu-2023');
  assert.equal(jiangsuDetail.status, 200);
  assert.equal(jiangsuDetail.payload.title, '故事的力量');
  assert.ok(jiangsuDetail.payload.writingTips.length >= 2);

  const zhejiang = await jsonRequest('/api/zhejiang/prompts');
  for (const p of zhejiang.payload) {
    assert.ok(!shanghai.payload.some((s) => s.id === p.id), '浙江不应与上海共用 id');
    assert.ok(!jiangsu.payload.some((j) => j.id === p.id), '浙江不应与江苏共用 id');
  }
});

test('自定义题目剖析入口在新增题库后仍可用，异常输入返回中文提示', async () => {
  const valid = await jsonRequest('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic: '有人说，只有不断追问，才能接近真正的答案。你怎么看？' }),
  });
  assert.equal(valid.status, 200);
  assert.ok(valid.payload.angles.length >= 3 && valid.payload.outline.length >= 4);
  assert.ok(valid.payload.essay?.body && valid.payload.review?.highlight);

  const empty = await jsonRequest('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic: '   ' }),
  });
  assert.equal(empty.status, 400);
  assert.equal(empty.payload.error.code, 'EMPTY_TOPIC');

  const tooLong = await jsonRequest('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic: '好'.repeat(2001) }),
  });
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.payload.error.code, 'TOPIC_TOO_LONG');
});
