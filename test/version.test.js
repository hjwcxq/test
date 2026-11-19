/**
 * 版本号展示的针对性测试：
 * 1. 版本规范化为「vX」且过滤不安全字符；
 * 2. 页面版本跟随部署/构建注入的实际交付版本，未注入时回退到兜底 v10；
 * 3. index.html 模板注入版本与基础路径后可重复渲染（刷新一致）；
 * 4. /health 返回当前版本，便于与发布记录核对；
 * 5. 前端页面从统一版本模块读取并带 data-testid，构建脚本产出 version.json。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, renderIndexHtml } from '../server/app.js';
import { DELIVERY_VERSION, envVersion, normalizeVersion, resolveVersion } from '../server/version.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const TEMPLATE =
  '<!doctype html><html><head><script>window.__APP_BASE_PATH__ = "__APP_BASE_PATH__";</script>' +
  '<script>window.__APP_VERSION__ = "__APP_VERSION__";</script></head><body>' +
  '<span class="app-version" data-testid="app-version">当前版本：__APP_VERSION_TEXT__</span>' +
  '<div id="root"></div></body></html>';

test('版本号统一规范化为 vX，并过滤脚本注入字符', () => {
  assert.equal(normalizeVersion('1.2.3'), 'v1.2.3');
  assert.equal(normalizeVersion('v1.2.3'), 'v1.2.3');
  assert.equal(normalizeVersion('  V 20261119.145000  '), 'v20261119.145000');
  assert.equal(normalizeVersion('1.0.0+build.2026'), 'v1.0.0+build.2026');
  assert.equal(normalizeVersion('1.0<script>alert(1)</script>'), 'v1.0-script-alert-1-script');
  assert.ok(!normalizeVersion('1.0<script>').includes('<'));
  assert.equal(normalizeVersion(''), '');
  assert.equal(normalizeVersion('   '), '');
  assert.equal(normalizeVersion(null), '');
  assert.equal(normalizeVersion('__APP_VERSION__'), '');
});

test('版本号跟随实际交付版本，未注入时回退到兜底 v10', () => {
  assert.equal(envVersion({ APP_VERSION: '2.0.0' }), 'v2.0.0');
  assert.equal(envVersion({ DELIVERY_VERSION: 'v3.1.0' }), 'v3.1.0');
  assert.equal(envVersion({ APP_VERSION: '', BUILD_VERSION: '4.2.1' }), 'v4.2.1');
  assert.equal(envVersion({ APP_VERSION: '   ' }), '');

  assert.equal(DELIVERY_VERSION, 'v10', '兜底版本应为最近一次成功交付 v10');
  assert.equal(resolveVersion({}, null), 'v10', '无任何注入时应展示兜底交付版本 v10');
  assert.equal(resolveVersion({ APP_VERSION: 'v10' }, null), 'v10', '部署注入 v10 时展示 v10');
  assert.equal(resolveVersion({ APP_VERSION: '11.2.0' }, null), 'v11.2.0', '新交付版本应自动展示，无需改代码');
  assert.equal(
    resolveVersion({ APP_VERSION: '11.2.0' }, { version: 'v10' }),
    'v11.2.0',
    '部署注入应优先于构建产物'
  );
  assert.equal(
    resolveVersion({}, { version: 'v9.2.1' }),
    'v9.2.1',
    '未注入环境变量时展示构建产物的实际版本'
  );
  assert.equal(envVersion({ GIT_COMMIT: 'a24affb' }), '', '提交哈希是构建元数据，不能当作展示版本');
});

test('index.html 注入运行时版本与基础路径，重复渲染（刷新）结果一致', () => {
  const first = renderIndexHtml(TEMPLATE, { basePath: '/apps/p1', version: 'v7.6.5' });
  const second = renderIndexHtml(TEMPLATE, { basePath: '/apps/p1', version: 'v7.6.5' });
  assert.equal(first, second, '同一版本刷新后应保持一致');
  assert.ok(first.includes('window.__APP_VERSION__ = "v7.6.5";'));
  assert.ok(first.includes('window.__APP_BASE_PATH__ = "/apps/p1";'));
  assert.ok(!first.includes('"__APP_VERSION__"'), '版本占位值必须被完全替换');
  assert.ok(!first.includes('"__APP_BASE_PATH__"'), '基础路径占位值必须被完全替换');
  assert.match(first, /data-testid="app-version">当前版本：v7\.6\.5<\/span>/);
  assert.ok(!first.includes('__APP_VERSION_TEXT__'), '首屏版本号文本占位符必须被替换');

  const updated = renderIndexHtml(TEMPLATE, { basePath: '', version: 'v7.6.6' });
  assert.ok(updated.includes('"v7.6.6"'), '版本变化后应注入新版本，而不是固定旧值');
  assert.ok(!updated.includes('v7.6.5'));

  const escaped = renderIndexHtml(TEMPLATE, { version: '<img src=x onerror=alert(1)>' });
  assert.ok(!escaped.includes('当前版本：<img'), '版本号文本必须做 HTML 转义');
  assert.ok(escaped.includes('当前版本：&lt;img'), '版本号文本应以 HTML 实体输出');
});

test('GET /health 返回与部署配置一致的当前版本', async () => {
  const app = createApp({
    prompts: [],
    jiangsuPrompts: [],
    zhejiangPrompts: [],
    version: 'v8.1.2',
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const pathname of ['/health', '/apps/p1/health']) {
      const first = await (await fetch(`${base}${pathname}`)).json();
      const second = await (await fetch(`${base}${pathname}`)).json();
      assert.equal(first.status, 'ok');
      assert.equal(first.version, 'v8.1.2');
      assert.equal(second.version, first.version, '重复请求（刷新）版本应一致');
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('版本号随首屏 HTML 服务端输出，无需等待脚本即可被验收定位', () => {
  const html = read('web/index.html');
  assert.equal((html.match(/data-testid="app-version"/g) || []).length, 1, '版本号节点必须唯一，避免定位歧义');
  assert.ok(html.includes('当前版本：'));
  assert.ok(html.includes('__APP_VERSION_TEXT__'), '模板应保留版本号文本占位符');
  assert.ok(html.includes('id="app-version"'), '版本号应提供稳定 id');

  const rendered = renderIndexHtml(html, { basePath: '/apps/p1', version: 'v1.2.3' });
  assert.match(rendered, /data-testid="app-version"[\s\S]*当前版本：v1\.2\.3<\/span>/);
  assert.ok(!rendered.includes('__APP_VERSION_TEXT__'));
  assert.equal((rendered.match(/data-testid="app-version"/g) || []).length, 1);

  // 本次交付的默认渲染结果：版本区域直接显示 v10（兜底即最近一次成功交付）。
  const delivery = renderIndexHtml(html, { basePath: '/apps/p1', version: resolveVersion({}, null) });
  assert.match(delivery, /data-testid="app-version"[^>]*>当前版本：v10<\/span>/, '首屏版本区域应显示 v10');
  assert.ok(!delivery.includes('当前版本：v8'), '页面不得再展示 v8 等过期版本');
  assert.ok(!delivery.includes('当前版本：v7'), '页面不得再展示 v7 等过期版本');

  // 版本号节点内部不能再嵌套元素：自动化验收常用 elementFromPoint 判断元素是否被遮挡，
  // 若中心点命中的是 <strong> 等子元素，会把可见的版本号误判为不可见。
  const tag = rendered.match(/<span[^>]*data-testid="app-version"[^>]*>([\s\S]*?)<\/span>/);
  assert.ok(tag, '应能定位版本号节点');
  assert.ok(!/<\/?[a-zA-Z][^>]*>/.test(tag[1]), `版本号节点内应为纯文本，实际「${tag[1].trim()}」`);

  const app = read('web/src/App.jsx');
  assert.ok(!/当前版本：v\d+\.\d+\.\d+/.test(app), '页面不应硬编码固定版本号');
  assert.ok(!app.includes('data-testid="app-version"'), 'React 不再重复渲染版本节点');
});

test('构建与部署配置注入版本：vite 产出 version.json，Dockerfile 接受 APP_VERSION', () => {
  const vite = read('web/vite.config.js');
  assert.ok(vite.includes('version.json'));
  assert.ok(vite.includes('__APP_VERSION_TEXT__'), '构建阶段应把版本写入首屏 HTML');
  assert.ok(vite.includes('APP_VERSION'));

  const dockerfile = read('Dockerfile');
  assert.ok(/ARG\s+APP_VERSION/.test(dockerfile), 'Dockerfile 应接受 APP_VERSION 构建参数');
  assert.ok(/COPY\s+server\s+\.\/server/.test(dockerfile), '构建阶段需复制 server（vite 读取版本模块）');

  const envExample = read('.env.example');
  assert.ok(envExample.includes('APP_VERSION'));
});
