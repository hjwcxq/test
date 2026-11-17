import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ESSAY_COMMENT_FIELDS,
  ESSAY_DISCLAIMER_KEYWORD,
  ESSAY_MIN_CHARS,
  countEssayChars,
  loadAllPrompts,
  loadJiangsuPrompts,
  loadPrompts,
  loadZhejiangPrompts,
  validateDataset,
  validateJiangsuDataset,
  validateZhejiangDataset,
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

function raw(file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
}

/** 每道内置题应能在范文中找到的核心概念，用于防止题目与范文错配。 */
const TOPIC_KEYWORDS = {
  'shanghai-2022': ['发问', '结论'],
  'shanghai-2023': ['好奇心'],
  'shanghai-2024': ['认可度'],
  'jiangsu-2022': ['本手', '妙手', '俗手'],
  'jiangsu-2023': ['故事'],
  'jiangsu-2024': ['答案', '问题'],
  'zhejiang-2022': ['徐枫灿', '杨杰', '之江实验室', '创新'],
  'zhejiang-2023': ['故事'],
  'zhejiang-2024': ['问题', '提问'],
};

test('九道内置题均有且仅有一篇完整范文，题目与范文一一对应', () => {
  const prompts = loadAllPrompts();
  assert.equal(prompts.length, 9);
  assert.equal(new Set(prompts.map((p) => p.id)).size, 9);

  const titles = new Set();
  const bodies = new Set();

  for (const prompt of prompts) {
    // 字段为单值字符串，结构上保证“一题一篇”，不存在数组式多篇范文。
    assert.equal(typeof prompt.essayTitle, 'string', `${prompt.id} 缺少范文标题`);
    assert.equal(typeof prompt.essayBody, 'string', `${prompt.id} 缺少范文正文`);
    assert.ok(prompt.essayTitle.trim().length >= 2, `${prompt.id} 范文标题过短`);
    assert.ok(!titles.has(prompt.essayTitle), `范文标题重复：${prompt.essayTitle}`);
    assert.ok(!bodies.has(prompt.essayBody), `${prompt.id} 范文正文与其他题目重复`);
    titles.add(prompt.essayTitle);
    bodies.add(prompt.essayBody);

    const chars = countEssayChars(prompt.essayBody);
    assert.ok(
      chars >= ESSAY_MIN_CHARS,
      `${prompt.id} 范文正文 ${chars} 字，低于 ${ESSAY_MIN_CHARS} 字`
    );

    const paragraphs = prompt.essayBody.split(/\n\s*\n/).filter((part) => part.trim());
    assert.ok(paragraphs.length >= 4, `${prompt.id} 范文应至少 4 个自然段`);
    for (const paragraph of paragraphs) {
      assert.ok(paragraph.trim().length >= 25, `${prompt.id} 存在过短段落，疑似提纲或片段`);
    }

    const keywords = TOPIC_KEYWORDS[prompt.id] || [];
    assert.ok(
      keywords.some((keyword) => prompt.essayBody.includes(keyword)),
      `${prompt.id} 范文未出现题目核心概念，可能错配`
    );

    for (const field of ESSAY_COMMENT_FIELDS) {
      const text = prompt.essayComment?.[field];
      assert.ok(typeof text === 'string' && text.trim().length >= 20, `${prompt.id} 点评缺少 ${field}`);
    }

    assert.match(prompt.essayDisclaimer, new RegExp(ESSAY_DISCLAIMER_KEYWORD));
    assert.match(prompt.essayDisclaimer, /非高考官方范文|不代表官方/, '免责声明需说明非官方范文');
  }

  assert.equal(titles.size, 9);
});

test('范文覆盖立意、结构、语言与可借鉴处四个维度，且与正文内容呼应', () => {
  for (const prompt of loadAllPrompts()) {
    const { intention, structure, language, takeaway } = prompt.essayComment;
    assert.ok(intention.length >= 30, `${prompt.id} 立意点评需具体`);
    assert.ok(structure.length >= 30, `${prompt.id} 结构点评需具体`);
    assert.ok(language.length >= 30, `${prompt.id} 语言点评需具体`);
    assert.ok(takeaway.length >= 20, `${prompt.id} 借鉴点评需具体`);

    assert.match(intention, /立意|中心|判断/, `${prompt.id} 立意点评应讨论中心判断`);
    assert.match(structure, /结构|段|层次|递进|推进/, `${prompt.id} 结构点评应讨论行文结构`);
    assert.match(language, /语言|句|比喻|表达|节奏/, `${prompt.id} 语言点评应讨论表达`);
  }
});

test('各题库校验会拒绝缺失、过短、缺维度或缺少免责声明的范文', () => {
  const shanghaiRaw = raw('data/prompts.json');

  const missingTitle = clone(shanghaiRaw);
  delete missingTitle.prompts[0].essayTitle;
  assert.throws(() => validateDataset(missingTitle), /essayTitle/);

  const shortBody = clone(shanghaiRaw);
  shortBody.prompts[0].essayBody = '这是一段远不足八百字的所谓范文。';
  assert.throws(() => validateDataset(shortBody), /essayBody/);

  const outlineBody = clone(shanghaiRaw);
  outlineBody.prompts[0].essayBody = '第一段要点'.repeat(200);
  assert.throws(() => validateDataset(outlineBody), /至少包含 4 个自然段/);

  const missingComment = clone(shanghaiRaw);
  delete missingComment.prompts[0].essayComment.language;
  assert.throws(() => validateDataset(missingComment), /essayComment\.language/);

  const missingDisclaimer = clone(shanghaiRaw);
  missingDisclaimer.prompts[0].essayDisclaimer = '仅供参考。';
  assert.throws(() => validateDataset(missingDisclaimer), /范文仅供学习参考/);

  const duplicateEssay = clone(shanghaiRaw);
  duplicateEssay.prompts[1].essayTitle = duplicateEssay.prompts[0].essayTitle;
  assert.throws(() => validateDataset(duplicateEssay), /范文标题重复/);

  const jiangsuRaw = raw('data/jiangsu-prompts.json');
  const shortJiangsu = clone(jiangsuRaw);
  shortJiangsu.prompts[0].essayBody = '太短了。';
  assert.throws(
    () => validateJiangsuDataset(shortJiangsu, { existingPrompts: loadPrompts() }),
    /essayBody/
  );

  const zhejiangRaw = raw('data/zhejiang-prompts.json');
  const missingZhejiangComment = clone(zhejiangRaw);
  delete missingZhejiangComment.prompts[0].essayComment.takeaway;
  assert.throws(
    () => validateZhejiangDataset(missingZhejiangComment, { existingPrompts: loadPrompts() }),
    /essayComment\.takeaway/
  );
});

test('三套题库接口均返回配套范文（根路径与 /apps/p1/ 前缀）', async () => {
  const endpoints = [
    ['/api/prompts', 3],
    ['/api/jiangsu/prompts', 3],
    ['/api/zhejiang/prompts', 3],
  ];
  for (const prefix of ['', '/apps/p1']) {
    for (const [endpoint, count] of endpoints) {
      const { status, payload } = await jsonRequest(`${prefix}${endpoint}`);
      assert.equal(status, 200);
      assert.equal(payload.length, count);
      for (const prompt of payload) {
        assert.ok(prompt.essayTitle && prompt.essayBody, `${endpoint} 缺少范文字段`);
        assert.ok(countEssayChars(prompt.essayBody) >= ESSAY_MIN_CHARS);
        assert.equal(typeof prompt.essayComment, 'object');
        assert.match(prompt.essayDisclaimer, /范文仅供学习参考/);
      }
    }
  }
});

test('单题详情返回对应范文，题目 id 与范文标题一一匹配', async () => {
  const expected = new Map(loadAllPrompts().map((p) => [p.id, p.essayTitle]));
  for (const [id, title] of expected) {
    const { status, payload } = await jsonRequest(`/apps/p1/api/prompts/${id}`);
    assert.equal(status, 200);
    assert.equal(payload.id, id);
    assert.equal(payload.essayTitle, title);
    assert.ok(countEssayChars(payload.essayBody) >= ESSAY_MIN_CHARS);
  }
});

test('自定义题目剖析不返回范文字段，行为保持原有 AI/本地剖析输出', async () => {
  const { status, payload } = await jsonRequest('/apps/p1/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic: '一个人乐意去探索陌生世界，仅仅是因为好奇心吗？' }),
  });
  assert.equal(status, 200);
  assert.equal(payload.topic, '一个人乐意去探索陌生世界，仅仅是因为好奇心吗？');
  assert.ok(payload.questionType?.name);
  assert.ok(payload.coreConcepts.length >= 2);
  assert.ok(payload.outline.length >= 4);
  for (const field of ['essayTitle', 'essayBody', 'essayComment', 'essayDisclaimer']) {
    assert.equal(payload[field], undefined, `自定义剖析不应出现 ${field}`);
  }
});

test('详情页以独立板块渲染范文，且自定义剖析页不引入范文组件', () => {
  const detail = fs.readFileSync(path.join(root, 'web/src/pages/Detail.jsx'), 'utf8');
  const essayComponent = fs.readFileSync(path.join(root, 'web/src/components.jsx'), 'utf8');
  const analyzePage = fs.readFileSync(path.join(root, 'web/src/pages/Analyze.jsx'), 'utf8');

  assert.match(essayComponent, /export function EssaySection/);
  assert.match(essayComponent, /精彩范文/);
  assert.match(essayComponent, /essayDisclaimer/);
  assert.equal((detail.match(/<EssaySection/g) || []).length, 3, '上海、江苏、浙江详情页各需一处范文板块');
  assert.doesNotMatch(analyzePage, /EssaySection/, '自定义剖析页不应出现范文板块');
});

test('范文可导出为纯文本，包含标题、正文、四维点评与免责声明', async () => {
  const { promptToText, jiangsuPromptToText, zhejiangPromptToText } = await import(
    '../web/src/exportText.js'
  );
  const shanghai = (await import('../server/data.js')).loadPrompts()[0];
  const jiangsu = loadJiangsuPrompts()[0];
  const zhejiang = loadZhejiangPrompts()[0];

  for (const [prompt, toText] of [
    [shanghai, promptToText],
    [jiangsu, jiangsuPromptToText],
    [zhejiang, zhejiangPromptToText],
  ]) {
    const text = toText(prompt);
    assert.match(text, /精彩范文/);
    assert.ok(text.includes(prompt.essayTitle));
    assert.ok(text.includes(prompt.essayBody.split(/\n\s*\n/)[0].trim()));
    assert.match(text, /点评·立意/);
    assert.match(text, /点评·结构/);
    assert.match(text, /点评·语言/);
    assert.match(text, /点评·借鉴/);
    assert.match(text, /范文仅供学习参考/);
  }
});
