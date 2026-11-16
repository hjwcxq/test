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

assert.equal(typeof analyzer.analyzeLocal, 'function');
assert.equal(typeof analyzer.detectQuestionType, 'function');
assert.equal(analyzer.MAX_TOPIC_LENGTH, 2000);
assert.equal(typeof data.loadPrompts, 'function');
assert.equal(typeof data.loadJiangsuPrompts, 'function');
assert.equal(typeof data.loadZhejiangPrompts, 'function');
assert.equal(typeof app.createApp, 'function');
assert.equal(typeof llm.analyzeTopic, 'function');
assert.equal(data.loadPrompts().length, 3);
assert.equal(data.loadJiangsuPrompts().length, 3);
assert.equal(data.loadZhejiangPrompts().length, 3);
assert.equal(data.loadAllPrompts().length, 9);
assert.equal(typeof (await llm.analyzeTopic('谈谈读书')).questionType.name, 'string');

console.log(`[lint] 语法检查通过：${targets.length} 个文件；关键模块加载与导出校验通过。`);
