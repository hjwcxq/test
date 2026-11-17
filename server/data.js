import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_PATH = path.resolve(here, '../data/prompts.json');
export const JIANGSU_DATA_PATH = path.resolve(here, '../data/jiangsu-prompts.json');
export const ZHEJIANG_DATA_PATH = path.resolve(here, '../data/zhejiang-prompts.json');

export const REQUIRED_YEARS = [2022, 2023, 2024];
export const JIANGSU_PROVINCE = '江苏';
export const JIANGSU_PAPER = '新课标I卷';
export const ZHEJIANG_PROVINCE = '浙江';
export const ZHEJIANG_PAPERS = ['浙江卷', '新课标I卷'];
export const PLACEHOLDER_RE = /TODO|待补充|占位文本|示例文本|placeholder|lorem ipsum|XXX/i;

/** 范文正文的最低字数（不计空白字符），以及点评必须覆盖的四个维度。 */
export const ESSAY_MIN_CHARS = 800;
export const ESSAY_COMMENT_FIELDS = ['intention', 'structure', 'language', 'takeaway'];
export const ESSAY_DISCLAIMER_KEYWORD = '范文仅供学习参考';

/** 统计范文正文的有效字符数：忽略空格、换行等空白，中英文标点均计入。 */
export function countEssayChars(text) {
  return Array.from(String(text || '').replace(/\s/g, '')).length;
}

function fail(message) {
  throw new Error(`[data/prompts.json 校验失败] ${message}`);
}

function isText(value) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    !PLACEHOLDER_RE.test(value)
  );
}

function assertText(value, label) {
  if (!isText(value)) fail(`${label} 必须是非空且非占位的中文文本`);
}

function assertArray(value, minLength, label) {
  if (!Array.isArray(value) || value.length < minLength) {
    fail(`${label} 必须是至少 ${minLength} 项的数组`);
  }
}

function assertObjects(list, label, fields) {
  list.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      fail(`${label}[${index}] 必须是对象`);
    }
    for (const field of fields) {
      assertText(item[field], `${label}[${index}].${field}`);
    }
  });
}

/**
 * 校验单题配套范文。每道内置题必须且只能有一篇范文：标题、完整正文、
 * 四维点评与学习参考声明齐全，正文不少于 ESSAY_MIN_CHARS 字且分自然段，
 * 避免用提纲、片段或占位文本充数。fail 用于复用各题库的中文错误前缀。
 */
function assertEssay(prompt, label, fail) {
  for (const field of ['essayTitle', 'essayBody', 'essayDisclaimer']) {
    if (!isText(prompt[field])) fail(`${label}.${field} 必须是非空且非占位的中文文本`);
  }

  const chars = countEssayChars(prompt.essayBody);
  if (chars < ESSAY_MIN_CHARS) {
    fail(`${label}.essayBody 正文至少 ${ESSAY_MIN_CHARS} 字，当前 ${chars} 字`);
  }

  const paragraphs = prompt.essayBody
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (paragraphs.length < 4) {
    fail(`${label}.essayBody 必须是完整成篇作文，至少包含 4 个自然段`);
  }

  const comment = prompt.essayComment;
  if (!comment || typeof comment !== 'object' || Array.isArray(comment)) {
    fail(`${label}.essayComment 必须是对象`);
  }
  for (const field of ESSAY_COMMENT_FIELDS) {
    if (!isText(comment[field])) {
      fail(`${label}.essayComment.${field} 必须是非空且非占位的中文文本`);
    }
    if (comment[field].trim().length < 20) {
      fail(`${label}.essayComment.${field} 需要至少 20 字的实质性点评`);
    }
  }

  if (!prompt.essayDisclaimer.includes(ESSAY_DISCLAIMER_KEYWORD)) {
    fail(`${label}.essayDisclaimer 必须包含「${ESSAY_DISCLAIMER_KEYWORD}」提示`);
  }
}

/**
 * 校验题目数据集的完整结构。任何缺字段 / 占位文本 / 年份缺失都会抛错，
 * 便于服务在启动阶段就暴露数据问题，而不是等到页面渲染时才发现空白内容。
 */
export function validateDataset(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('根节点必须是对象');
  }
  assertArray(raw.prompts, REQUIRED_YEARS.length, 'prompts');

  const seenIds = new Set();
  const seenYears = new Set();
  const seenEssayTitles = new Set();
  const prompts = [];

  for (const [index, p] of raw.prompts.entries()) {
    const label = `prompts[${index}]`;
    if (!p || typeof p !== 'object' || Array.isArray(p)) fail(`${label} 必须是对象`);

    assertText(p.id, `${label}.id`);
    assertText(p.region, `${label}.region`);
    assertText(p.title, `${label}.title`);
    assertText(p.original, `${label}.original`);
    assertText(p.overview, `${label}.overview`);
    assertText(p.conceptRelations, `${label}.conceptRelations`);

    if (!Number.isInteger(p.year)) fail(`${label}.year 必须是整数`);
    if (!REQUIRED_YEARS.includes(p.year)) {
      fail(`${label}.year 为 ${p.year}，只允许 ${REQUIRED_YEARS.join('/')}`);
    }
    if (seenIds.has(p.id)) fail(`题目 id 重复：${p.id}`);
    if (seenYears.has(p.year)) fail(`年份重复：${p.year}`);
    seenIds.add(p.id);
    seenYears.add(p.year);

    assertArray(p.tags, 1, `${label}.tags`);
    p.tags.forEach((tag, i) => assertText(tag, `${label}.tags[${i}]`));

    assertArray(p.reviewPoints, 2, `${label}.reviewPoints`);
    p.reviewPoints.forEach((point, i) => assertText(point, `${label}.reviewPoints[${i}]`));

    assertArray(p.keywords, 2, `${label}.keywords`);
    assertObjects(p.keywords, `${label}.keywords`, ['term', 'analysis']);

    assertArray(p.angles, 3, `${label}.angles`);
    assertObjects(p.angles, `${label}.angles`, ['title', 'fit', 'level', 'description']);

    if (!p.structure || typeof p.structure !== 'object') fail(`${label}.structure 必须是对象`);
    assertText(p.structure.wordBudget, `${label}.structure.wordBudget`);
    assertArray(p.structure.sections, 4, `${label}.structure.sections`);
    assertObjects(p.structure.sections, `${label}.structure.sections`, [
      'part',
      'function',
      'ratio',
      'guidance',
    ]);

    assertArray(p.materials, 2, `${label}.materials`);
    assertObjects(p.materials, `${label}.materials`, ['direction']);
    p.materials.forEach((m, i) => {
      assertArray(m.examples, 1, `${label}.materials[${i}].examples`);
      m.examples.forEach((ex, j) => assertText(ex, `${label}.materials[${i}].examples[${j}]`));
    });

    assertArray(p.pitfalls, 2, `${label}.pitfalls`);
    assertObjects(p.pitfalls, `${label}.pitfalls`, ['mistake', 'upgrade']);

    assertEssay(p, label, fail);
    if (seenEssayTitles.has(p.essayTitle)) fail(`范文标题重复：${p.essayTitle}`);
    seenEssayTitles.add(p.essayTitle);

    prompts.push(p);
  }

  for (const year of REQUIRED_YEARS) {
    if (!seenYears.has(year)) fail(`缺少 ${year} 年上海卷题目`);
  }

  return prompts.sort((a, b) => a.year - b.year);
}

/** 读取并校验数据文件，返回按年份升序排序的题目数组。 */
export function loadPrompts(filePath = DATA_PATH) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`[data/prompts.json 读取失败] ${error.message}`);
  }
  return validateDataset(parsed);
}

function failJiangsu(message) {
  throw new Error(`[data/jiangsu-prompts.json 校验失败] ${message}`);
}

function assertJiangsuArray(value, minLength, label) {
  if (!Array.isArray(value) || value.length < minLength) {
    failJiangsu(`${label} 必须是至少 ${minLength} 项的数组`);
  }
}

/**
 * 校验江苏高考作文题库：每年恰好 1 条，字段完整，且不与已有题库（上海卷）
 * 发生 id 或“年份 + 标题”重复。数据错误在服务启动阶段即暴露。
 */
export function validateJiangsuDataset(raw, options = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    failJiangsu('根节点必须是对象');
  }
  assertJiangsuArray(raw.prompts, REQUIRED_YEARS.length, 'prompts');

  const existingPrompts = Array.isArray(options.existingPrompts) ? options.existingPrompts : [];
  const existingIds = new Set(existingPrompts.map((p) => p.id));
  const existingTitles = new Set(existingPrompts.map((p) => `${p.year}|${p.title}`));
  const existingEssayTitles = new Set(
    existingPrompts.map((p) => p.essayTitle).filter(Boolean)
  );

  const seenIds = new Set();
  const seenYears = new Set();
  const seenEssayTitles = new Set();
  const prompts = [];

  for (const [index, p] of raw.prompts.entries()) {
    const label = `prompts[${index}]`;
    if (!p || typeof p !== 'object' || Array.isArray(p)) failJiangsu(`${label} 必须是对象`);

    for (const field of ['id', 'province', 'paper', 'title', 'material', 'requirements', 'concept', 'source']) {
      if (!isText(p[field])) failJiangsu(`${label}.${field} 必须是非空且非占位的中文文本`);
    }

    if (!Number.isInteger(p.year)) failJiangsu(`${label}.year 必须是整数`);
    if (!REQUIRED_YEARS.includes(p.year)) {
      failJiangsu(`${label}.year 为 ${p.year}，只允许 ${REQUIRED_YEARS.join('/')}`);
    }
    if (p.province !== JIANGSU_PROVINCE) failJiangsu(`${label}.province 必须是「${JIANGSU_PROVINCE}」`);
    if (p.paper !== JIANGSU_PAPER) failJiangsu(`${label}.paper 必须是「${JIANGSU_PAPER}」`);
    if (seenIds.has(p.id)) failJiangsu(`题目 id 重复：${p.id}`);
    if (existingIds.has(p.id)) failJiangsu(`题目 id 与原有题库重复：${p.id}`);
    if (seenYears.has(p.year)) failJiangsu(`年份重复：${p.year}`);
    if (existingTitles.has(`${p.year}|${p.title}`)) {
      failJiangsu(`题目与原有题库重复：${p.year} ${p.title}`);
    }
    seenIds.add(p.id);
    seenYears.add(p.year);

    assertJiangsuArray(p.tags, 1, `${label}.tags`);
    p.tags.forEach((tag, i) => {
      if (!isText(tag)) failJiangsu(`${label}.tags[${i}] 不能为空`);
    });

    assertJiangsuArray(p.reviewPoints, 2, `${label}.reviewPoints`);
    p.reviewPoints.forEach((point, i) => {
      if (!isText(point)) failJiangsu(`${label}.reviewPoints[${i}] 不能为空`);
    });

    assertJiangsuArray(p.writingTips, 2, `${label}.writingTips`);
    p.writingTips.forEach((tip, i) => {
      if (!isText(tip)) failJiangsu(`${label}.writingTips[${i}] 不能为空`);
    });

    if (p.concept.length < 30) failJiangsu(`${label}.concept 需要完整的审题立意说明`);
    if (p.source.length < 10) failJiangsu(`${label}.source 需要可核验的来源说明`);

    assertEssay(p, label, failJiangsu);
    if (seenEssayTitles.has(p.essayTitle) || existingEssayTitles.has(p.essayTitle)) {
      failJiangsu(`范文标题重复：${p.essayTitle}`);
    }
    seenEssayTitles.add(p.essayTitle);

    prompts.push(p);
  }

  for (const year of REQUIRED_YEARS) {
    if (!seenYears.has(year)) failJiangsu(`缺少 ${year} 年江苏新课标I卷题目`);
  }

  return prompts.sort((a, b) => a.year - b.year);
}

/** 读取并校验江苏题库，返回按年份升序排序的题目数组。 */
export function loadJiangsuPrompts(filePath = JIANGSU_DATA_PATH) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`[data/jiangsu-prompts.json 读取失败] ${error.message}`);
  }
  return validateJiangsuDataset(parsed, { existingPrompts: loadPrompts() });
}

function failZhejiang(message) {
  throw new Error(`[data/zhejiang-prompts.json 校验失败] ${message}`);
}

function assertZhejiangText(value, label) {
  if (!isText(value)) failZhejiang(`${label} 必须是非空且非占位的中文文本`);
}

function assertZhejiangArray(value, minLength, label) {
  if (!Array.isArray(value) || value.length < minLength) {
    failZhejiang(`${label} 必须是至少 ${minLength} 项的数组`);
  }
}

function assertZhejiangObjects(list, label, fields) {
  list.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      failZhejiang(`${label}[${index}] 必须是对象`);
    }
    for (const field of fields) {
      assertZhejiangText(item[field], `${label}[${index}].${field}`);
    }
  });
}

/**
 * 校验浙江高考作文题库：每年恰好 1 条，详情字段完整（材料、要求、审题立意、
 * 关键词、立意方向、结构提纲、素材、表达建议、误区、评分关注点、来源），
 * 且 id 与“年份 + 标题”不与上海、江苏题库重复。数据问题在启动阶段即暴露。
 */
export function validateZhejiangDataset(raw, options = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    failZhejiang('根节点必须是对象');
  }
  assertZhejiangText(raw.sourceNote, 'sourceNote');
  assertZhejiangArray(raw.prompts, REQUIRED_YEARS.length, 'prompts');

  const existingPrompts = Array.isArray(options.existingPrompts) ? options.existingPrompts : [];
  const existingIds = new Set(existingPrompts.map((p) => p.id));
  const existingTitles = new Set(existingPrompts.map((p) => `${p.year}|${p.title}`));
  const existingEssayTitles = new Set(
    existingPrompts.map((p) => p.essayTitle).filter(Boolean)
  );

  const seenIds = new Set();
  const seenYears = new Set();
  const seenEssayTitles = new Set();
  const prompts = [];

  for (const [index, p] of raw.prompts.entries()) {
    const label = `prompts[${index}]`;
    if (!p || typeof p !== 'object' || Array.isArray(p)) failZhejiang(`${label} 必须是对象`);

    for (const field of ['id', 'province', 'paper', 'title', 'material', 'requirements', 'concept', 'source']) {
      assertZhejiangText(p[field], `${label}.${field}`);
    }

    if (!Number.isInteger(p.year)) failZhejiang(`${label}.year 必须是整数`);
    if (!REQUIRED_YEARS.includes(p.year)) {
      failZhejiang(`${label}.year 为 ${p.year}，只允许 ${REQUIRED_YEARS.join('/')}`);
    }
    if (p.province !== ZHEJIANG_PROVINCE) {
      failZhejiang(`${label}.province 必须是「${ZHEJIANG_PROVINCE}」`);
    }
    if (!ZHEJIANG_PAPERS.includes(p.paper)) {
      failZhejiang(`${label}.paper 只允许 ${ZHEJIANG_PAPERS.join('/')}`);
    }
    if (seenIds.has(p.id)) failZhejiang(`题目 id 重复：${p.id}`);
    if (existingIds.has(p.id)) failZhejiang(`题目 id 与原有题库重复：${p.id}`);
    if (seenYears.has(p.year)) failZhejiang(`年份重复：${p.year}`);
    if (existingTitles.has(`${p.year}|${p.title}`)) {
      failZhejiang(`题目与原有题库重复：${p.year} ${p.title}`);
    }
    seenIds.add(p.id);
    seenYears.add(p.year);

    if (p.material.length < 30) failZhejiang(`${label}.material 需要完整的作文材料`);
    if (p.requirements.length < 10) failZhejiang(`${label}.requirements 需要完整的写作要求`);
    if (p.concept.length < 30) failZhejiang(`${label}.concept 需要完整的审题立意说明`);
    if (p.source.length < 10) failZhejiang(`${label}.source 需要可核验的来源说明`);
    if (!p.source.includes(String(p.year))) failZhejiang(`${label}.source 需包含年份 ${p.year}`);
    if (!p.source.includes(ZHEJIANG_PROVINCE)) failZhejiang(`${label}.source 需注明浙江卷或浙江使用情况`);

    assertZhejiangArray(p.tags, 1, `${label}.tags`);
    p.tags.forEach((tag, i) => assertZhejiangText(tag, `${label}.tags[${i}]`));

    assertZhejiangArray(p.reviewPoints, 3, `${label}.reviewPoints`);
    p.reviewPoints.forEach((point, i) => assertZhejiangText(point, `${label}.reviewPoints[${i}]`));

    assertZhejiangArray(p.keywords, 3, `${label}.keywords`);
    assertZhejiangObjects(p.keywords, `${label}.keywords`, ['term', 'analysis']);

    assertZhejiangArray(p.angles, 3, `${label}.angles`);
    assertZhejiangObjects(p.angles, `${label}.angles`, ['title', 'fit', 'level', 'description']);
    p.angles.forEach((angle, i) => {
      if (angle.description.length < 20) failZhejiang(`${label}.angles[${i}].description 不能是占位短句`);
    });

    if (!p.structure || typeof p.structure !== 'object') failZhejiang(`${label}.structure 必须是对象`);
    assertZhejiangText(p.structure.wordBudget, `${label}.structure.wordBudget`);
    assertZhejiangArray(p.structure.sections, 4, `${label}.structure.sections`);
    assertZhejiangObjects(p.structure.sections, `${label}.structure.sections`, [
      'part',
      'function',
      'ratio',
      'guidance',
    ]);

    assertZhejiangArray(p.materials, 2, `${label}.materials`);
    assertZhejiangObjects(p.materials, `${label}.materials`, ['direction']);
    p.materials.forEach((m, i) => {
      assertZhejiangArray(m.examples, 1, `${label}.materials[${i}].examples`);
      m.examples.forEach((ex, j) => assertZhejiangText(ex, `${label}.materials[${i}].examples[${j}]`));
    });

    assertZhejiangArray(p.writingTips, 2, `${label}.writingTips`);
    p.writingTips.forEach((tip, i) => assertZhejiangText(tip, `${label}.writingTips[${i}]`));

    assertZhejiangArray(p.pitfalls, 2, `${label}.pitfalls`);
    assertZhejiangObjects(p.pitfalls, `${label}.pitfalls`, ['mistake', 'upgrade']);

    assertZhejiangArray(p.scoringPoints, 3, `${label}.scoringPoints`);
    p.scoringPoints.forEach((point, i) => assertZhejiangText(point, `${label}.scoringPoints[${i}]`));

    assertEssay(p, label, failZhejiang);
    if (seenEssayTitles.has(p.essayTitle) || existingEssayTitles.has(p.essayTitle)) {
      failZhejiang(`范文标题重复：${p.essayTitle}`);
    }
    seenEssayTitles.add(p.essayTitle);

    prompts.push(p);
  }

  for (const year of REQUIRED_YEARS) {
    if (!seenYears.has(year)) failZhejiang(`缺少 ${year} 年浙江高考作文题目`);
  }

  return prompts.sort((a, b) => a.year - b.year);
}

/** 读取并校验浙江题库，返回按年份升序排序的题目数组。 */
export function loadZhejiangPrompts(filePath = ZHEJIANG_DATA_PATH) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`[data/zhejiang-prompts.json 读取失败] ${error.message}`);
  }
  return validateZhejiangDataset(parsed, {
    existingPrompts: [...loadPrompts(), ...loadJiangsuPrompts()],
  });
}

/** 合并三套题库，供详情页按 id 统一查找。 */
export function loadAllPrompts() {
  return [...loadPrompts(), ...loadJiangsuPrompts(), ...loadZhejiangPrompts()];
}
