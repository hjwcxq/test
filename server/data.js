import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_PATH = path.resolve(here, '../data/prompts.json');

export const REQUIRED_YEARS = [2022, 2023, 2024];
export const PLACEHOLDER_RE = /TODO|待补充|占位文本|示例文本|placeholder|lorem ipsum|XXX/i;

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
