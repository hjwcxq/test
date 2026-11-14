import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_PATH, REQUIRED_YEARS, loadPrompts, validateDataset } from '../server/data.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('数据文件存在且可被解析', () => {
  assert.ok(fs.existsSync(path.join(root, 'data/prompts.json')));
  const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  assert.ok(Array.isArray(raw.prompts));
});

test('三年真题齐全，按年份升序，字段完整且非占位', () => {
  const prompts = loadPrompts();
  assert.equal(prompts.length, 3);
  assert.deepEqual(prompts.map((p) => p.year), REQUIRED_YEARS);

  for (const p of prompts) {
    for (const field of ['id', 'region', 'title', 'original', 'overview', 'conceptRelations']) {
      assert.ok(typeof p[field] === 'string' && p[field].trim().length > 0, `${p.year}.${field} 不能为空`);
      assert.ok(!/TODO|占位|待补充|placeholder|示例文本/.test(p[field]), `${p.year}.${field} 不能是占位文本`);
    }
    assert.ok(p.original.length > 30, '题目原文应完整');

    assert.ok(p.tags.length >= 1);
    assert.ok(p.reviewPoints.length >= 2, '审题要点至少 2 条');
    assert.ok(p.keywords.length >= 2, '关键词拆解至少 2 条');
    assert.ok(p.angles.length >= 3, '立意角度至少 3 个');
    assert.ok(p.structure.sections.length >= 4, '结构框架至少 4 段');
    assert.ok(p.materials.length >= 2, '素材方向至少 2 组');
    assert.ok(p.pitfalls.length >= 2, '常见误区至少 2 条');

    for (const k of p.keywords) assert.ok(k.term && k.analysis);
    for (const a of p.angles) {
      assert.ok(a.title && a.fit && a.level && a.description);
      assert.ok(a.description.length > 20, '立意描述不能是占位短句');
    }
    for (const s of p.structure.sections) {
      assert.ok(s.part && s.function && s.ratio && s.guidance);
      assert.ok(/字|%/.test(s.ratio), '结构框架需含字数配比');
    }
    for (const m of p.materials) {
      assert.ok(m.direction && m.examples.length >= 1);
    }
    for (const pit of p.pitfalls) assert.ok(pit.mistake && pit.upgrade);
  }
});

test('启动校验会拒绝缺字段、占位文本、重复年份与非法年份', () => {
  const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));

  const missing = clone(raw);
  delete missing.prompts[0].angles;
  assert.throws(() => validateDataset(missing), /angles/);

  const placeholder = clone(raw);
  placeholder.prompts[0].overview = 'TODO 待补充';
  assert.throws(() => validateDataset(placeholder), /overview/);

  const tooFewAngles = clone(raw);
  tooFewAngles.prompts[0].angles = tooFewAngles.prompts[0].angles.slice(0, 2);
  assert.throws(() => validateDataset(tooFewAngles), /angles/);

  const duplicateYear = clone(raw);
  duplicateYear.prompts[1].year = 2022;
  assert.throws(() => validateDataset(duplicateYear), /年份重复/);

  const illegalYear = clone(raw);
  illegalYear.prompts[0].year = 2021;
  assert.throws(() => validateDataset(illegalYear), /year/);

  const incomplete = clone(raw);
  incomplete.prompts = incomplete.prompts.slice(0, 2);
  assert.throws(() => validateDataset(incomplete), /至少 3 项/);

  const brokenStructure = clone(raw);
  brokenStructure.prompts[0].structure.sections = brokenStructure.prompts[0].structure.sections.slice(0, 2);
  assert.throws(() => validateDataset(brokenStructure), /structure\.sections/);
});
