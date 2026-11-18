/**
 * 展示层回归守卫：
 * 1. 页面不再渲染「内置 2022—2024」这类年份来源说明；
 * 2. 内置题卡片仍保留年份、题干摘要、标签与解题入口；
 * 3. 自定义题目剖析入口与路由未被影响。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('页脚不再出现「内置 20XX—20XX」年份来源说明', () => {
  const app = read('web/src/App.jsx');
  assert.ok(!/内置\s*20\d{2}\s*[-—~至]\s*20\d{2}/.test(app), '页脚不应再包含年份来源说明');
  assert.ok(!app.includes('本地结构化剖析引擎'), '页脚来源说明整段应移除');
  assert.ok(app.includes('文思 · 把一道题目，拆成可落笔的思路'), '页脚品牌标语应保留');
});

test('内置题卡片仍渲染年份、摘要、标签与解题入口', () => {
  const home = read('web/src/pages/Home.jsx');
  for (const needle of ['year-seal', 'prompt-excerpt', 'tag-row', 'prompt-card-foot', '查看解题']) {
    assert.ok(home.includes(needle), `卡片应保留「${needle}」`);
  }
  assert.ok(home.includes('footText'), '卡片底部统计信息应保留');
  assert.ok(!/内置\s*20\d{2}/.test(home), '卡片不应渲染年份来源说明');
});

test('自定义剖析入口与题目详情路由保持可用', () => {
  const app = read('web/src/App.jsx');
  assert.ok(app.includes('path="/analyze"'), '自定义剖析路由应保留');
  assert.ok(app.includes('path="/prompts/:id"'), '题目详情路由应保留');

  const home = read('web/src/pages/Home.jsx');
  assert.ok(home.includes('开始自定义剖析'), '首页应保留自定义剖析入口');
});
