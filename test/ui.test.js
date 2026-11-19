/**
 * 展示层回归守卫：
 * 1. 页面不再渲染「内置 2022—2024」这类年份来源说明；
 * 2. 内置题卡片仍保留年份、题干摘要、标签与解题入口；
 * 3. 自定义题目剖析入口与路由未被影响；
 * 4. 首页「浏览真题题库」不修改 hash 路由（否则 HashRouter 会渲染「页面不存在」）。
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

test('首页「浏览真题题库」不跳转 hash 路由，避免题库消失', () => {
  const home = read('web/src/pages/Home.jsx');
  // HashRouter 下 href="#library" 会被解析成 /library 路由，渲染「页面不存在」，
  // 表现为题库区域消失。必须使用按钮 + scrollIntoView 保持首页路由。
  assert.ok(!/<a[^>]*href="#library"/.test(home), '不应再使用 href="#library" 锚点');
  assert.ok(home.includes('scrollToLibrary'), '应通过按钮滚动到题库区域');
  assert.ok(home.includes("document.getElementById('library')"), '应直接定位题库容器');
});

test('三套题库详情页均含可识别的「写作指导」与范文点评板块', () => {
  const detail = read('web/src/pages/Detail.jsx');
  assert.ok(detail.includes('写作指导'), '详情页应出现「写作指导」标识');
  assert.ok(detail.includes('<EssaySection'), '详情页应渲染独立范文板块');
  const components = read('web/src/components.jsx');
  assert.ok(components.includes('精彩范文'), '范文板块应有独立标题');
  assert.ok(components.includes('范文点评'), '点评板块应有独立标题');
});

test('首页真题题库同时展示上海、江苏、浙江三个地区入口与九道真题', () => {
  const home = read('web/src/pages/Home.jsx');
  for (const name of ['上海', '江苏', '浙江']) {
    assert.ok(home.includes(`name: '${name}'`), `首页应有「${name}」独立地区标签`);
  }
  assert.ok(home.includes('真题题库'), '首页应有「真题题库」标题');
  assert.ok(home.includes('region-overview'), '首页应有地区总览入口');
  assert.ok(home.includes('region-group'), '首页应按地区分组渲染题目卡片');
  assert.equal(
    (home.match(/<PromptCard/g) || []).length,
    1,
    '九道题应通过同一个卡片组件渲染，避免某地区卡片漏渲染'
  );
  assert.ok(home.includes('重新加载') && home.includes('EmptyState') && home.includes('ErrorState'));
});

test('详情页提供写作指导 / 范文 / 点评锚点与三地区切换入口', () => {
  const detail = read('web/src/pages/Detail.jsx');
  for (const label of ['写作指导', '范文', '点评']) {
    assert.ok(detail.includes(label), `详情导航应含「${label}」`);
  }
  for (const name of ["name: '上海'", "name: '江苏'", "name: '浙江'"]) {
    assert.ok(detail.includes(name), `详情页应可切换到${name}`);
  }
  assert.ok(detail.includes('id="writing-guide"'), '写作指导应有可滚动定位的锚点');
  const components = read('web/src/components.jsx');
  assert.ok(components.includes('id="essay"'), '范文板块应有锚点');
  assert.ok(components.includes('id="essay-comment"'), '点评板块应有锚点');
});

test('自定义题目输入框为空时使用「开始分析」并给出非空校验', () => {
  const home = read('web/src/pages/Home.jsx');
  const analyze = read('web/src/pages/Analyze.jsx');
  for (const source of [home, analyze]) {
    assert.ok(source.includes('开始分析'), '提交按钮应使用「开始分析」文案');
    assert.ok(source.includes('不能为空'), '应有题目不能为空的校验提示');
  }
});

test('地区入口使用稳定的 /region 路由，加载中点击也不会退回首页', () => {
  const home = read('web/src/pages/Home.jsx');
  assert.ok(home.includes('to={`/region/${group.key}`}'), '地区卡片应指向稳定的地区路由');
  assert.ok(
    !home.includes("latest ? `/prompts/${latest.id}` : '/'"),
    '地区卡片不应在数据未载入时退化为首页链接'
  );
  assert.ok(!home.includes('latestPrompt'), '不再依赖已加载数据计算入口地址');

  const app = read('web/src/App.jsx');
  assert.ok(app.includes('path="/region/:region"'), '应注册地区入口路由');

  const region = read('web/src/pages/Region.jsx');
  for (const needle of ['正在载入', '重新加载', 'ErrorState', 'EmptyState', '<Navigate']) {
    assert.ok(region.includes(needle), `地区入口页应包含「${needle}」`);
  }
  assert.ok(
    region.includes('replace'),
    '地区入口解析完成后应使用 replace 跳转，避免返回时停留在加载页'
  );
  assert.ok(
    region.includes('to={`/prompts/${resolved.id}`}'),
    '地区入口解析完成后应跳转到真实题目详情而非首页'
  );
});
