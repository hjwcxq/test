/**
 * 版本与交付时间展示的针对性测试：
 * 1. 版本规范化为「vX」且过滤不安全字符；
 * 2. 交付时间规范化为「YYYY-MM-DD HH:MM」；
 * 3. 页面版本跟随部署/构建注入的实际交付版本，未注入时回退到兜底 v11；
 * 4. 交付时间随版本一起展示，未注入时回退到该版本的交付时间；
 * 5. index.html 模板注入版本、交付时间与基础路径后可重复渲染（刷新一致）；
 * 6. /health 返回当前版本与交付时间，便于与发布记录核对；
 * 7. 前端页面从统一版本模块读取并带 data-testid，构建脚本产出 version.json。
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
  assert.equal(normalizeDeliveryTime('2026-11-19 10:13'), '2026-11-19 10:13');
  assert.equal(normalizeDeliveryTime('2026-11-19T10:13'), '2026-11-19 10:13');
  assert.equal(normalizeDeliveryTime('2026-11-19T10:13:45.000Z'), '2026-11-19 10:13');
  assert.equal(normalizeDeliveryTime('2026-1-9 9:05'), '2026-01-09 09:05');
  assert.equal(normalizeDeliveryTime('  2026-11-19 10:13  '), '2026-11-19 10:13');
  assert.equal(normalizeDeliveryTime(''), '');
  assert.equal(normalizeDeliveryTime(null), '');
  assert.equal(normalizeDeliveryTime('v11'), '');
  assert.equal(normalizeDeliveryTime('2026-13-01 10:00'), '');
  assert.equal(normalizeDeliveryTime('2026-11-19 24:00'), '');
  assert.equal(normalizeDeliveryTime('2026-11-19 10:99'), '');
  assert.equal(normalizeDeliveryTime('<img src=x onerror=alert(1)>'), '');
  assert.equal(normalizeDeliveryTime('__APP_DELIVERY_TIME__'), '');
});

test('版本号跟随实际交付版本，未注入时回退到兜底 v11', () => {
  assert.equal(envVersion({ APP_VERSION: '2.0.0' }), 'v2.0.0');
  assert.equal(envVersion({ DELIVERY_VERSION: 'v3.1.0' }), 'v3.1.0');
  assert.equal(envVersion({ APP_VERSION: '', BUILD_VERSION: '4.2.1' }), 'v4.2.1');
  assert.equal(envVersion({ APP_VERSION: '   ' }), '');

  assert.equal(DELIVERY_VERSION, 'v11', '兜底版本应为最近一次成功交付 v11');
  assert.equal(resolveVersion({}, null), 'v11', '无任何注入时应展示兜底交付版本 v11');
  assert.equal(resolveVersion({ APP_VERSION: 'v11' }, null), 'v11', '部署注入 v11 时展示 v11');
  assert.equal(resolveVersion({ APP_VERSION: '12.1.0' }, null), 'v12.1.0', '新交付版本应自动展示，无需改代码');
  assert.equal(
    resolveVersion({ APP_VERSION: '12.1.0' }, { version: 'v11' }),
    'v12.1.0',
    '部署注入应优先于构建产物'
  );
  assert.equal(resolveVersion({}, { version: 'v9.2.1' }), 'v9.2.1', '未注入环境变量时展示构建产物的实际版本');
  assert.equal(envVersion({ GIT_COMMIT: 'a24affb' }), '', '提交哈希是构建元数据，不能当作展示版本');
});

test('交付时间跟随实际交付记录，支持环境变量与构建产物覆盖', () => {
  assert.equal(envDeliveryTime({ APP_DELIVERY_TIME: '2026-11-19T10:13' }), '2026-11-19 10:13');
  assert.equal(envDeliveryTime({ DELIVERY_TIME: '2026-11-19 10:13:59' }), '2026-11-19 10:13');
  assert.equal(envDeliveryTime({ APP_DELIVERY_TIME: 'not-a-time' }), '');
  assert.equal(envDeliveryTime({ APP_DELIVERY_TIME: '  ' }), '');

  assert.equal(DELIVERY_TIME, '2026-11-19 10:13', '兜底交付时间应为 v11 的交付时刻');
  assert.equal(resolveDeliveryTime({}, null), DELIVERY_TIME, '无注入时应展示 v11 的交付时间');
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
});

test('页面展示文案包含版本号与交付时间（日期 + 时分）', () => {
  assert.equal(formatVersionLabel('v11', '2026-11-19 10:13'), '当前版本：v11 · 交付时间：2026-11-19 10:13');
  assert.equal(formatVersionLabel('v11', ''), '当前版本：v11');
  assert.equal(formatVersionLabel('', '2026-11-19 10:13'), `当前版本：${DELIVERY_VERSION} · 交付时间：2026-11-19 10:13`);
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
    deliveryTime: '2026-11-19 10:13',
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
      assert.equal(first.deliveredAt, '2026-11-19 10:13');
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
    deliveryTime: '2026-11-19 10:13',
  });
  assert.match(
    rendered,
    /data-testid="app-version"[\s\S]*当前版本：v1\.2\.3 · 交付时间：2026-11-19 10:13<\/span>/
  );
  assert.ok(!rendered.includes('__APP_VERSION_LABEL__'));
  assert.equal((rendered.match(/data-testid="app-version"/g) || []).length, 1);

  // 本次交付的默认渲染结果：v11 + 2026-11-19 10:13（兜底即最近一次成功交付记录）。
  const delivery = renderIndexHtml(html, {
    basePath: '/apps/p1',
    version: resolveVersion({}, null),
    deliveryTime: resolveDeliveryTime({}, null),
  });
  assert.match(
    delivery,
    /data-testid="app-version"[^>]*>当前版本：v11 · 交付时间：2026-11-19 10:13<\/span>/,
    '首屏版本区域应展示 v11 与到分钟的交付时间'
  );
  assert.ok(!delivery.includes('当前版本：v10'), '页面不得再展示过期版本 v10');
  assert.ok(!delivery.includes('当前版本：v8'), '页面不得再展示 v8 等过期版本');
  assert.ok(!delivery.includes('当前版本：v7'), '页面不得再展示 v7 等过期版本');

  // 版本文案节点内部不能再嵌套元素：自动化验收常用 elementFromPoint 判断元素是否被遮挡，
  // 若中心点命中的是 <strong> 等子元素，会把可见的版本文案误判为不可见。
  const tag = rendered.match(/<span[^>]*data-testid="app-version"[^>]*>([\s\S]*?)<\/span>/);
  assert.ok(tag, '应能定位版本号节点');
  assert.ok(!/<\/?[a-zA-Z][^>]*>/.test(tag[1]), `版本号节点内应为纯文本，实际「${tag[1].trim()}」`);

  const app = read('web/src/App.jsx');
  assert.ok(!/当前版本：v\d+\.\d+\.\d+/.test(app), '页面不应硬编码固定版本号');
  assert.ok(!app.includes('data-testid="app-version"'), 'React 不再重复渲染版本节点');
});

test('构建与部署配置注入版本和交付时间：vite 产出 version.json，Dockerfile 接受 APP_VERSION', () => {
  const vite = read('web/vite.config.js');
  assert.ok(vite.includes('version.json'));
  assert.ok(vite.includes('__APP_VERSION_LABEL__'), '构建阶段应把版本文案写入首屏 HTML');
  assert.ok(vite.includes('APP_VERSION'));
  assert.ok(vite.includes('deliveredAt'), 'version.json 应记录交付时间');
  assert.ok(vite.includes('resolveDeliveryTime'), '构建阶段应解析交付时间（APP_DELIVERY_TIME 等注入）');

  const dockerfile = read('Dockerfile');
  assert.ok(/ARG\s+APP_VERSION/.test(dockerfile), 'Dockerfile 应接受 APP_VERSION 构建参数');
  assert.ok(/ARG\s+APP_DELIVERY_TIME/.test(dockerfile), 'Dockerfile 应接受 APP_DELIVERY_TIME 构建参数');
  assert.ok(/COPY\s+server\s+\.\/server/.test(dockerfile), '构建阶段需复制 server（vite 读取版本模块）');

  const envExample = read('.env.example');
  assert.ok(envExample.includes('APP_VERSION'));
  assert.ok(envExample.includes('APP_DELIVERY_TIME'));
});
