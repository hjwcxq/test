/**
 * 静态检查：对服务端 / 脚本 / 测试文件做语法解析，并确认关键模块可正常加载、
 * 导出符合预期。前端 JSX 的语法与打包由 npm run build（Vite）负责。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
  'server/index.js',
  'server/app.js',
  'server/analyzer.js',
  'server/data.js',
  'server/llm.js',
  'server/essay.js',
  'server/delivery-resources.js',
  'server/version.js',
  'web/vite.config.js',
  'web/src/base.js',
  'web/src/api.js',
  'web/src/exportText.js',
  'web/src/constants.js',
  'web/src/storage.js',
  'scripts/smoke.mjs',
  'scripts/check-dockerfile.mjs',
  'scripts/browser-check.mjs',
  'test/analyzer.test.js',
  'test/data.test.js',
  'test/api.test.js',
  'test/jiangsu.test.js',
  'test/zhejiang.test.js',
  'test/essays.test.js',
  'test/custom-essay.test.js',
  'test/version.test.js',
];

for (const relative of targets) {
  const file = path.join(root, relative);
  assert.ok(fs.existsSync(file), `缺少文件：${relative}`);
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
}

const analyzer = await import('../server/analyzer.js');
const data = await import('../server/data.js');
const app = await import('../server/app.js');
const llm = await import('../server/llm.js');
const essay = await import('../server/essay.js');
const version = await import('../server/version.js');

assert.equal(typeof analyzer.analyzeLocal, 'function');
assert.equal(typeof analyzer.detectQuestionType, 'function');
assert.equal(analyzer.MAX_TOPIC_LENGTH, 2000);
assert.equal(typeof data.loadPrompts, 'function');
assert.equal(typeof data.loadJiangsuPrompts, 'function');
assert.equal(typeof data.loadZhejiangPrompts, 'function');
assert.equal(typeof app.createApp, 'function');
assert.equal(typeof llm.analyzeTopic, 'function');
assert.equal(typeof essay.generateCustomEssay, 'function');
assert.equal(typeof essay.composeLocalEssay, 'function');
assert.equal(typeof version.resolveVersion, 'function');
assert.equal(typeof version.normalizeVersion, 'function');
assert.equal(typeof version.resolveDeliveryTime, 'function');
assert.equal(typeof version.normalizeDeliveryTime, 'function');
assert.match(version.normalizeVersion('1.2.3'), /^v1\.2\.3$/);
assert.match(version.normalizeDeliveryTime('2026-11-19T10:13:00'), /^2026-11-19 10:13$/);
assert.equal(typeof app.renderIndexHtml, 'function');
assert.ok(app.renderIndexHtml('<script>window.__APP_VERSION__ = "__APP_VERSION__";</script>', { version: 'v9.9.9' }).includes('v9.9.9'));
assert.ok(
  app
    .renderIndexHtml('<span>__APP_VERSION_LABEL__</span>', { version: 'v9.9.9', deliveryTime: '2026-11-19 10:13' })
    .includes('当前版本：v9.9.9 · 交付时间：2026-11-19 10:13')
);
assert.equal(essay.ESSAY_MIN_CHARS, 600);
assert.equal(essay.ESSAY_MAX_CHARS, 1200);
assert.equal(data.loadPrompts().length, 3);
assert.equal(data.loadJiangsuPrompts().length, 3);
assert.equal(data.loadZhejiangPrompts().length, 3);
assert.equal(data.loadAllPrompts().length, 9);
assert.equal(typeof data.countEssayChars, 'function');
assert.equal(data.ESSAY_MIN_CHARS, 800);
for (const prompt of data.loadAllPrompts()) {
  assert.ok(prompt.essayTitle && prompt.essayBody, `${prompt.id} 缺少范文`);
  assert.ok(data.countEssayChars(prompt.essayBody) >= data.ESSAY_MIN_CHARS, `${prompt.id} 范文字数不足`);
  assert.match(prompt.essayDisclaimer, /范文仅供学习参考/);
}
const smokeAnalysis = await llm.analyzeTopic('谈谈读书', {
  essayGenerator: async (topic, analysis) => essay.composeLocalEssay(topic, analysis),
});
assert.equal(typeof smokeAnalysis.questionType.name, 'string');
assert.ok(smokeAnalysis.essay?.body && smokeAnalysis.review?.intention);

console.log(`[lint] 语法检查通过：${targets.length} 个文件；关键模块加载与导出校验通过。`);
