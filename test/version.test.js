/**
 * 版本与交付时间展示的针对性测试：
 * 1. 版本规范化为「vX」且过滤不安全字符；
 * 2. 交付时间规范化为「YYYY-MM-DD HH:MM」；
 * 3. 版本号与交付时间来自同一条交付记录（delivery.json），不再分别维护；
 * 4. 页面版本跟随部署/构建注入的实际交付版本，未注入时读取仓库交付记录 v12；
 * 5. 交付记录缺失时显示「版本信息未知」，不回退到上一版旧值；
 * 6. index.html 模板注入版本、交付时间与基础路径后可重复渲染（刷新一致）；
 * 7. /health 返回当前版本与交付时间，便于与发布记录核对；
 * 8. 前端页面从统一版本模块读取并带 data-testid，构建脚本产出 version.json。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, renderIndexHtml } from '../server/app.js';
import {
  DELIVERY_TIME,
  DELIVERY_VERSION,
  envDeliveryTime,
  envVersion,
  formatVersionLabel,
  normalizeDeliveryTime,
  normalizeVersion,
  readDeliveryMeta,
  resolveDeliveryInfo,
  resolveDeliveryTime,
  resolveVersion,
} from '../server/version.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const TEMPLATE =
  '<!doctype html><html><head><script>window.__APP_BASE_PATH__ = "__APP_BASE_PATH__";</script>' +
  '<script>window.__APP_VERSION__ = "__APP_VERSION__";</script></head><body>' +
  '<span class="app-version" data-testid="app-version">__APP_VERSION_LABEL__</span>' +
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

test('交付时间统一规范化为「YYYY-MM-DD HH:MM」，展示到分钟', () => {
  assert.equal(normalizeDeliveryTime('2026-11-19 10:34'), '2026-11-19 10:34');
  assert.equal(normalizeDeliveryTime('2026-11-19T10:34'), '2026-11-19 10:34');
  assert.equal(normalizeDeliveryTime('2026-11-19T10:34:45.000Z'), '2026-11-19 10:34');
  assert.equal(normalizeDeliveryTime('2026-1-9 9:05'), '2026-01-09 09:05');
  assert.equal(normalizeDeliveryTime('  2026-11-19 10:34  '), '2026-11-19 10:34');
  assert.equal(normalizeDeliveryTime(''), '');
  assert.equal(normalizeDeliveryTime(null), '');
  assert.equal(normalizeDeliveryTime('v12'), '');
  assert.equal(normalizeDeliveryTime('2026-13-01 10:00'), '');
  assert.equal(normalizeDeliveryTime('2026-11-19 24:00'), '');
  assert.equal(normalizeDeliveryTime('2026-11-19 10:99'), '');
  assert.equal(normalizeDeliveryTime('<img src=x onerror=alert(1)>'), '');
  assert.equal(normalizeDeliveryTime('__APP_DELIVERY_TIME__'), '');
});

test('版本号与交付时间来自同一条交付记录 delivery.json（本次为 v12 / 2026-11-19 10:34）', () => {
  const meta = JSON.parse(read('delivery.json'));
  assert.equal(meta.version, 'v12', '本次交付记录版本应为 v12');
  assert.equal(meta.deliveredAt, '2026-11-19 10:34', '本次交付时间应为 2026-11-19 10:34');

  // 兜底常量由交付记录派生，两者不可能各自维护而互相错位。
  assert.equal(DELIVERY_VERSION, normalizeVersion(meta.version));
  assert.equal(DELIVERY_TIME, normalizeDeliveryTime(meta.deliveredAt));
  assert.equal(DELIVERY_VERSION, 'v12');
  assert.equal(DELIVERY_TIME, '2026-11-19 10:34');

  assert.deepEqual(resolveDeliveryInfo({}, null), {
    version: 'v12',
    deliveredAt: '2026-11-19 10:34',
    source: 'repository',
  });

  // 替换同一条记录后，版本与时间一起跟随，不会出现版本变了时间没变。
  const replaced = resolveDeliveryInfo({}, null, { version: 'v13', deliveredAt: '2026-11-20 09:05' });
  assert.equal(replaced.version, 'v13');
  assert.equal(replaced.deliveredAt, '2026-11-20 09:05', '版本与时间应来自同一条记录');

  // 代码中不得再保留上一版的固定版本号或交付时间。
  const source = read('server/version.js');
  assert.ok(!source.includes("'v11'"), '不应再硬编码上一版 v11');
  assert.ok(!source.includes("'2026-11-19 10:13'"), '不应再硬编码上一版交付时间');
});

test('版本号跟随实际交付版本，未注入时展示交付记录 v12', () => {
  assert.equal(envVersion({ APP_VERSION: '2.0.0' }), 'v2.0.0');
  assert.equal(envVersion({ DELIVERY_VERSION: 'v3.1.0' }), 'v3.1.0');
  assert.equal(envVersion({ APP_VERSION: '', BUILD_VERSION: '4.2.1' }), 'v4.2.1');
  assert.equal(envVersion({ APP_VERSION: '   ' }), '');

  assert.equal(resolveVersion({}, null), 'v12', '无任何注入时应展示交付记录版本 v12');
  assert.equal(resolveVersion({ APP_VERSION: 'v12' }, null), 'v12', '部署注入 v12 时展示 v12');
  assert.equal(resolveVersion({ APP_VERSION: '12.1.0' }, null), 'v12.1.0', '新交付版本应自动展示，无需改代码');
  assert.equal(
    resolveVersion({ APP_VERSION: '12.1.0' }, { version: 'v12' }),
    'v12.1.0',
    '部署注入应优先于构建产物'
  );
  assert.equal(resolveVersion({}, { version: 'v9.2.1' }), 'v9.2.1', '未注入环境变量时展示构建产物的实际版本');
  assert.equal(envVersion({ GIT_COMMIT: 'a24affb' }), '', '提交哈希是构建元数据，不能当作展示版本');
});

test('交付时间跟随实际交付记录，支持环境变量与构建产物覆盖', () => {
  assert.equal(envDeliveryTime({ APP_DELIVERY_TIME: '2026-11-19T10:34' }), '2026-11-19 10:34');
  assert.equal(envDeliveryTime({ DELIVERY_TIME: '2026-11-19 10:34:59' }), '2026-11-19 10:34');
  assert.equal(envDeliveryTime({ APP_DELIVERY_TIME: 'not-a-time' }), '');
  assert.equal(envDeliveryTime({ APP_DELIVERY_TIME: '  ' }), '');

  assert.equal(DELIVERY_TIME, '2026-11-19 10:34', '交付记录时间应为 2026-11-19 10:34');
  assert.equal(resolveDeliveryTime({}, null), DELIVERY_TIME, '无注入时应展示交付记录的时间');
  assert.equal(
    resolveDeliveryTime({ APP_DELIVERY_TIME: '2026-11-20 09:30' }, null),
    '2026-11-20 09:30',
    '部署注入的交付时间应优先展示'
  );
  assert.equal(
    resolveDeliveryTime({}, { deliveredAt: '2026-11-18 08:05' }),
    '2026-11-18 08:05',
    '未注入环境变量时展示构建产物记录的交付时间'
  );
  assert.equal(
    resolveDeliveryTime({ APP_DELIVERY_TIME: '2026-11-20 09:30' }, { deliveredAt: '2026-11-18 08:05' }),
    '2026-11-20 09:30',
    '部署注入应优先于构建产物'
  );

  // 只注入版本时不能借用旧记录的交付时间，避免版本与时间来自不同交付。
  assert.equal(resolveDeliveryInfo({ APP_VERSION: 'v13' }, null).deliveredAt, '');
  // 注入的版本与交付记录一致时，才补齐该版本的交付时间（同一次交付）。
  assert.deepEqual(resolveDeliveryInfo({ APP_VERSION: 'v12' }, null), {
    version: 'v12',
    deliveredAt: '2026-11-19 10:34',
    source: 'env',
  });
});

test('交付记录缺失时显示明确的未知状态，不回退到上一版旧值', () => {
  const missing = resolveDeliveryInfo({}, null, null);
  assert.deepEqual(missing, { version: '', deliveredAt: '', source: 'missing' });
  assert.equal(resolveVersion({}, null, null), '', '无交付记录时版本为空');
  assert.equal(resolveDeliveryTime({}, null, null), '', '无交付记录时时间为空');
  assert.equal(formatVersionLabel('', ''), '版本信息未知');
  assert.equal(formatVersionLabel('__APP_VERSION__', ''), '版本信息未知');

  const html = renderIndexHtml(TEMPLATE, { version: '', deliveryTime: '' });
  assert.ok(html.includes('版本信息未知'), '页面应显示明确的未知状态');
  assert.ok(!html.includes('当前版本：v11'), '页面不得回退展示上一版 v11');
  assert.ok(!html.includes('__APP_VERSION_LABEL__'), '占位符必须被替换');

  // delivery.json 缺失或格式非法时回退为 null，由调用方展示未知状态。
  assert.equal(readDeliveryMeta(path.join(root, 'not-exists.json')), null);
});

test('页面展示文案包含版本号与交付时间（日期 + 时分）', () => {
  assert.equal(formatVersionLabel('v12', '2026-11-19 10:34'), '当前版本：v12 · 交付时间：2026-11-19 10:34');
  assert.equal(formatVersionLabel('v12', ''), '当前版本：v12');
  assert.equal(formatVersionLabel('', '2026-11-19 10:34'), '版本信息未知');
});

test('index.html 注入运行时版本、交付时间与基础路径，重复渲染（刷新）结果一致', () => {
  const first = renderIndexHtml(TEMPLATE, {
    basePath: '/apps/p1',
    version: 'v7.6.5',
    deliveryTime: '2026-06-01 08:30',
  });
  const second = renderIndexHtml(TEMPLATE, {
    basePath: '/apps/p1',
    version: 'v7.6.5',
    deliveryTime: '2026-06-01 08:30',
  });
  assert.equal(first, second, '同一版本刷新后应保持一致');
  assert.ok(first.includes('window.__APP_VERSION__ = "v7.6.5";'));
  assert.ok(first.includes('window.__APP_BASE_PATH__ = "/apps/p1";'));
  assert.ok(!first.includes('"__APP_VERSION__"'), '版本占位值必须被完全替换');
  assert.ok(!first.includes('"__APP_BASE_PATH__"'), '基础路径占位值必须被完全替换');
  assert.match(
    first,
    /data-testid="app-version">当前版本：v7\.6\.5 · 交付时间：2026-06-01 08:30<\/span>/,
    '首屏应同时展示版本号与到分钟的交付时间'
  );
  assert.ok(!first.includes('__APP_VERSION_LABEL__'), '首屏版本文案占位符必须被替换');

  const updated = renderIndexHtml(TEMPLATE, {
    version: 'v7.6.6',
    deliveryTime: '2026-06-02 09:05',
  });
  assert.ok(updated.includes('"v7.6.6"'), '版本变化后应注入新版本，而不是固定旧值');
  assert.ok(updated.includes('当前版本：v7.6.6 · 交付时间：2026-06-02 09:05'));
  assert.ok(!updated.includes('v7.6.5'));

  const escaped = renderIndexHtml(TEMPLATE, { version: '<img src=x onerror=alert(1)>' });
  assert.ok(!escaped.includes('当前版本：<img'), '版本号文本必须做 HTML 转义');
  assert.ok(escaped.includes('当前版本：&lt;img'), '版本号文本应以 HTML 实体输出');
});

test('GET /health 返回与部署配置一致的当前版本与交付时间', async () => {
  const app = createApp({
    prompts: [],
    jiangsuPrompts: [],
    zhejiangPrompts: [],
    version: 'v8.1.2',
    deliveryTime: '2026-11-19 10:34',
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
      assert.equal(first.deliveredAt, '2026-11-19 10:34');
      assert.equal(second.deliveredAt, first.deliveredAt, '重复请求（刷新）交付时间应一致');
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('版本与交付时间随首屏 HTML 服务端输出，无需等待脚本即可被验收定位', () => {
  const html = read('web/index.html');
  assert.equal((html.match(/data-testid="app-version"/g) || []).length, 1, '版本号节点必须唯一，避免定位歧义');
  assert.ok(html.includes('__APP_VERSION_LABEL__'), '模板应保留版本文案占位符');
  assert.ok(html.includes('id="app-version"'), '版本号应提供稳定 id');

  const rendered = renderIndexHtml(html, {
    basePath: '/apps/p1',
    version: 'v1.2.3',
    deliveryTime: '2026-11-19 10:34',
  });
  assert.match(
    rendered,
    /data-testid="app-version"[\s\S]*当前版本：v1\.2\.3 · 交付时间：2026-11-19 10:34<\/span>/
  );
  assert.ok(!rendered.includes('__APP_VERSION_LABEL__'));
  assert.equal((rendered.match(/data-testid="app-version"/g) || []).length, 1);

  // 本次交付的默认渲染结果：v12 + 2026-11-19 10:34（与交付记录一致）。
  const delivery = renderIndexHtml(html, {
    basePath: '/apps/p1',
    version: resolveVersion({}, null),
    deliveryTime: resolveDeliveryTime({}, null),
  });
  assert.match(
    delivery,
    /data-testid="app-version"[^>]*>当前版本：v12 · 交付时间：2026-11-19 10:34<\/span>/,
    '首屏版本区域应展示 v12 与到分钟的交付时间'
  );
  assert.equal((delivery.match(/data-testid="app-version"/g) || []).length, 1);
  for (const stale of ['v11', 'v10', 'v8', 'v7']) {
    assert.ok(!delivery.includes(`当前版本：${stale}`), `页面不得再展示过期版本 ${stale}`);
  }

  // 版本文案节点内部不能再嵌套元素：自动化验收常用 elementFromPoint 判断元素是否被遮挡，
  // 若中心点命中的是 <strong> 等子元素，会把可见的版本文案误判为不可见。
  const tag = rendered.match(/<span[^>]*data-testid="app-version"[^>]*>([\s\S]*?)<\/span>/);
  assert.ok(tag, '应能定位版本号节点');
  assert.ok(!/<\/?[a-zA-Z][^>]*>/.test(tag[1]), `版本号节点内应为纯文本，实际「${tag[1].trim()}」`);

  const app = read('web/src/App.jsx');
  assert.ok(!/当前版本：v\d+\.\d+\.\d+/.test(app), '页面不应硬编码固定版本号');
  assert.ok(!app.includes('data-testid="app-version"'), 'React 不再重复渲染版本节点');
});

test('构建与部署配置读取同一份交付记录：vite 产出 version.json，Dockerfile 复制 delivery.json', () => {
  const vite = read('web/vite.config.js');
  assert.ok(vite.includes('version.json'));
  assert.ok(vite.includes('__APP_VERSION_LABEL__'), '构建阶段应把版本文案写入首屏 HTML');
  assert.ok(vite.includes('resolveDeliveryInfo'), '构建阶段应一次性解析版本与交付时间');
  assert.ok(vite.includes('APP_VERSION'), '构建阶段应支持 APP_VERSION 注入');
  assert.ok(vite.includes('deliveredAt'), 'version.json 应记录交付时间');
  assert.ok(!vite.includes('resolveDeliveryTime'), '不应再分别解析版本与时间，避免两者不同步');

  const dockerfile = read('Dockerfile');
  assert.ok(/ARG\s+APP_VERSION/.test(dockerfile), 'Dockerfile 应接受 APP_VERSION 构建参数');
  assert.ok(/ARG\s+APP_DELIVERY_TIME/.test(dockerfile), 'Dockerfile 应接受 APP_DELIVERY_TIME 构建参数');
  assert.ok(/COPY\s+server\s+\.\/server/.test(dockerfile), '构建阶段需复制 server（vite 读取版本模块）');
  assert.ok(
    (dockerfile.match(/COPY\s+delivery\.json\s+\.\/delivery\.json/g) || []).length >= 2,
    '构建与运行阶段都应复制交付记录 delivery.json'
  );

  const envExample = read('.env.example');
  assert.ok(envExample.includes('APP_VERSION'));
  assert.ok(envExample.includes('APP_DELIVERY_TIME'));
  assert.ok(envExample.includes('2026-11-19 10:34'), '.env.example 的示例时间应与本次交付一致');
});
