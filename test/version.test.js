/**
 * 版本与交付时间展示的针对性测试：
 * 1. 版本号由交付历史自动推导（任务号去重计数），不再手写常量；
 * 2. 版本与时间取当前运行实例的交付记录，旧环境变量/旧文件不会把页面拉回上一版；
 * 3. 页面打开后从 /version.json 读取最新版本，接口禁止缓存；
 * 4. 获取失败或数据异常时展示可识别提示，不回退旧版本号；
 * 5. 既有的基础路径、题库、剖析等业务行为由其余测试与冒烟脚本覆盖。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, renderIndexHtml } from '../server/app.js';
import {
  DELIVERY_TIME,
  DELIVERY_VERSION,
  formatDeliveryTimestamp,
  formatVersionLabel,
  normalizeDeliveryTime,
  normalizeVersion,
  readDeliveryMeta,
  resolveDeliveryInfo,
  runtimeStartedAt,
} from '../server/version.js';
import {
  TASK_COMMIT_PATTERN,
  computeDeliveryIndex,
  newerVersion,
  parseBranchTask,
  parseTaskIds,
  versionFromTaskIds,
} from '../scripts/delivery-index.mjs';
import {
  ERROR_LABEL,
  formatVersionLabel as formatClientVersionLabel,
  parseDeliveryPayload,
} from '../web/src/versionLabel.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const TEMPLATE =
  '<!doctype html><html><head><script>window.__APP_BASE_PATH__ = "__APP_BASE_PATH__";</script>' +
  '<script>window.__APP_VERSION__ = "__APP_VERSION__";</script></head><body>' +
  '<span class="app-version" data-testid="app-version">__APP_VERSION_LABEL__</span>' +
  '<div id="root"></div></body></html>';

/** 启动一个只含版本相关路由的测试服务，按需注入交付记录选项。 */
async function withServer(overrides, fn) {
  const app = createApp({ prompts: [], jiangsuPrompts: [], zhejiangPrompts: [], ...overrides });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('版本号统一规范化为 vX，并过滤脚本注入字符', () => {
  assert.equal(normalizeVersion('1.2.3'), 'v1.2.3');
  assert.equal(normalizeVersion('v1.2.3'), 'v1.2.3');
  assert.equal(normalizeVersion('  V 20261119.145000  '), 'v20261119.145000');
  assert.equal(normalizeVersion('15'), 'v15');
  assert.equal(normalizeVersion('1.0.0+build.2026'), 'v1.0.0+build.2026');
  assert.equal(normalizeVersion('1.0<script>alert(1)</script>'), 'v1.0-script-alert-1-script');
  assert.ok(!normalizeVersion('1.0<script>').includes('<'));
  assert.equal(normalizeVersion(''), '');
  assert.equal(normalizeVersion('   '), '');
  assert.equal(normalizeVersion(null), '');
  assert.equal(normalizeVersion('__APP_VERSION__'), '');
});

test('交付时间统一规范化为「YYYY-MM-DD HH:MM」，展示到分钟', () => {
  assert.equal(normalizeDeliveryTime('2026-11-20 06:59'), '2026-11-20 06:59');
  assert.equal(normalizeDeliveryTime('2026-11-20T06:59'), '2026-11-20 06:59');
  assert.equal(normalizeDeliveryTime('2026-11-20T06:59:32.000Z'), '2026-11-20 06:59');
  assert.equal(normalizeDeliveryTime('2026-1-9 9:05'), '2026-01-09 09:05');
  assert.equal(normalizeDeliveryTime('  2026-11-20 06:59  '), '2026-11-20 06:59');
  assert.equal(normalizeDeliveryTime(''), '');
  assert.equal(normalizeDeliveryTime(null), '');
  assert.equal(normalizeDeliveryTime('latest'), '');
  assert.equal(normalizeDeliveryTime('2026-13-01 10:00'), '');
  assert.equal(normalizeDeliveryTime('2026-11-20 24:00'), '');
  assert.equal(normalizeDeliveryTime('2026-11-20 10:99'), '');
  assert.equal(normalizeDeliveryTime('<img src=x onerror=alert(1)>'), '');
  assert.equal(normalizeDeliveryTime('__APP_DELIVERY_TIME__'), '');
});

test('交付历史解析：任务号去重计数得到版本号，当前分支任务补入', () => {
  assert.deepEqual([...parseTaskIds('实现交付任务 #1 (#2)')], [1]);
  assert.deepEqual([...parseTaskIds('实现交付任务 #1\n实现交付任务 #1\n其他提交')], [1]);
  assert.deepEqual([...parseTaskIds('<!-- delivery-task:42 -->\n正文')], [42]);
  assert.deepEqual([...parseTaskIds('初始化项目')], []);
  assert.equal(parseBranchTask('delivery/task-37'), 37);
  assert.equal(parseBranchTask('main'), 0);
  assert.equal(versionFromTaskIds([1, 2, 2, 6]), 'v3');
  assert.equal(versionFromTaskIds([]), '');
  assert.equal(newerVersion('v10', 'v11'), 'v11');
  assert.equal(newerVersion('v11', 'v10'), 'v11');
  assert.equal(newerVersion('v15', ''), 'v15');
  assert.ok(TASK_COMMIT_PATTERN.test('实现交付任务 #30 (#33)'));
});

test('computeDeliveryIndex 从真实 git 历史计算版本，并保留已提交记录作为下限', () => {
  const dir = tempDir('wensi-git-');
  try {
    const run = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
    run('init', '-q');
    run('config', 'user.email', 'test@example.com');
    run('config', 'user.name', 'test');
    fs.writeFileSync(path.join(dir, 'history.txt'), 'init\n');
    run('add', '.');
    run('commit', '-q', '-m', '初始化自动交付项目');

    for (const [message, file] of [
      ['实现交付任务 #1 (#2)', 'a.txt'],
      ['实现交付任务 #2 (#4)', 'b.txt'],
      ['实现交付任务 #2 (#5)', 'c.txt'],
    ]) {
      fs.writeFileSync(path.join(dir, file), message);
      run('add', '.');
      run('commit', '-q', '-m', message);
    }

    run('checkout', '-q', '-b', 'delivery/task-3');
    const file = path.join(dir, 'delivery.json');
    fs.writeFileSync(file, JSON.stringify({ version: 'v2', deliveredAt: '' }));
    const index = computeDeliveryIndex({ cwd: dir, env: {}, file });
    assert.equal(index.version, 'v3', '去重任务 1、2 加当前分支任务 3 应为 v3');
    assert.deepEqual(index.taskIds, [1, 2, 3]);
    assert.equal(index.gitAvailable, true);

    // 历史不可用（非 git 目录）时沿用已提交记录，且不倒退。
    const empty = tempDir('wensi-nogit-');
    try {
      fs.writeFileSync(path.join(empty, 'delivery.json'), JSON.stringify({ version: 'v9', deliveredAt: '' }));
      const fallback = computeDeliveryIndex({
        cwd: empty,
        env: {},
        file: path.join(empty, 'delivery.json'),
      });
      assert.equal(fallback.gitAvailable, false);
      assert.equal(fallback.version, 'v9');
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('仓库交付记录由构建脚本自动维护，版本与当前交付历史一致', () => {
  const meta = JSON.parse(read('delivery.json'));
  assert.match(meta.version, /^v\d+$/, 'delivery.json 应包含自动推导的版本号');
  assert.equal(meta.deliveredAt, '', '交付时间由运行实例启动时间确定，构建阶段不写死');
  const index = computeDeliveryIndex();
  assert.equal(meta.version, index.version, 'committed delivery.json 应与交付历史推导结果一致');
  assert.equal(DELIVERY_VERSION, normalizeVersion(meta.version));
  assert.equal(DELIVERY_TIME, '');
});

test('版本与时间优先取当前实例记录；旧环境变量不会覆盖更新的构建版本', () => {
  const build = { version: 'v15', deliveredAt: '', builtAt: '2026-11-20T06:58:50.000Z' };
  const meta = { version: 'v10', deliveredAt: '2026-11-20 06:59' };
  const baseEnv = { NODE_ENV: 'production', APP_STARTED_AT: '2026-11-20 07:00' };

  assert.deepEqual(resolveDeliveryInfo(baseEnv, build, meta), {
    version: 'v15',
    deliveredAt: '2026-11-20 07:00',
    source: 'build',
  });

  // 遗留的旧注入值不得把版本拉回上一版。
  assert.equal(
    resolveDeliveryInfo({ ...baseEnv, APP_VERSION: 'v10', APP_DELIVERY_TIME: '2026-11-19 10:45' }, build, meta)
      .version,
    'v15'
  );

  // 部署注入的新版本优先于构建产物，并配对注入时间。
  assert.deepEqual(
    resolveDeliveryInfo(
      { ...baseEnv, APP_VERSION: 'v16', APP_DELIVERY_TIME: '2026-11-20 09:10' },
      build,
      meta
    ),
    { version: 'v16', deliveredAt: '2026-11-20 09:10', source: 'env' }
  );

  // 只注入版本不注入时间时，使用本实例启动时间，不借用旧记录时间。
  assert.deepEqual(
    resolveDeliveryInfo({ ...baseEnv, APP_VERSION: 'v16' }, build, meta),
    { version: 'v16', deliveredAt: '2026-11-20 07:00', source: 'env' }
  );

  // 构建记录没有时间时，时间取容器首次启动时间。
  assert.equal(
    resolveDeliveryInfo(baseEnv, { version: 'v15', deliveredAt: '' }, meta).deliveredAt,
    '2026-11-20 07:00'
  );

  // 生产环境无任何当前记录时不回退仓库旧版本。
  assert.deepEqual(resolveDeliveryInfo({ NODE_ENV: 'production' }, null, meta), {
    version: '',
    deliveredAt: '',
    source: 'missing',
  });

  // 开发环境允许仓库记录兜底，便于本地直接启动。
  assert.equal(resolveDeliveryInfo({ NODE_ENV: 'development' }, null, meta).version, 'v10');
});

test('部署挂载的交付记录替换后刷新即生效，无需重启或重建', async () => {
  const dir = tempDir('wensi-delivery-');
  const file = path.join(dir, 'delivery.json');
  try {
    fs.writeFileSync(file, JSON.stringify({ version: 'v16', deliveredAt: '2026-11-20 09:10' }));
    const env = { NODE_ENV: 'production', APP_DELIVERY_FILE: file };
    assert.deepEqual(resolveDeliveryInfo(env, { version: 'v15', deliveredAt: '' }, null), {
      version: 'v16',
      deliveredAt: '2026-11-20 09:10',
      source: 'deployment',
    });

    await withServer({ env }, async (base) => {
      const first = await (await fetch(`${base}/apps/p1/version.json`)).json();
      assert.equal(first.version, 'v16');
      assert.equal(first.deliveredAt, '2026-11-20 09:10');

      // 下一次交付：只替换挂载文件，进程不重启，刷新即显示新版本。
      fs.writeFileSync(file, JSON.stringify({ version: 'v17', deliveredAt: '2026-11-20 11:30' }));
      const second = await (await fetch(`${base}/apps/p1/version.json`)).json();
      assert.equal(second.version, 'v17');
      assert.equal(second.deliveredAt, '2026-11-20 11:30');
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('交付记录缺失/损坏时显示明确提示，不回退旧版本号', () => {
  assert.equal(formatVersionLabel('', ''), '版本信息获取中…');
  assert.equal(formatVersionLabel('__APP_VERSION__', ''), '版本信息获取中…');
  assert.equal(formatVersionLabel('v15', ''), '当前版本：v15 · 交付时间获取失败');

  const html = renderIndexHtml(TEMPLATE, { version: '', deliveryTime: '' });
  assert.ok(html.includes('版本信息获取中…'), '页面应显示明确的未知状态');
  assert.ok(!/当前版本[:：]\s*v1[0-4]/.test(html), '页面不得回退展示旧版本');
  assert.ok(!html.includes('__APP_VERSION_LABEL__'), '占位符必须被替换');

  assert.equal(readDeliveryMeta(path.join(root, 'not-exists.json')), null);
});

test('页面展示文案包含版本号与交付时间（日期 + 时分）', () => {
  assert.equal(
    formatVersionLabel('v15', '2026-11-20 06:59'),
    '当前版本：v15 · 交付时间：2026-11-20 06:59'
  );
  assert.equal(formatVersionLabel('v15', ''), '当前版本：v15 · 交付时间获取失败');
  assert.equal(formatVersionLabel('', '2026-11-20 06:59'), '版本信息获取中…');
  assert.equal(
    formatClientVersionLabel('v15', '2026-11-20 06:59'),
    formatVersionLabel('v15', '2026-11-20 06:59')
  );
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

  // 版本号会写进 HTML，任何标记都必须被规范化/转义，不能形成可执行标签。
  const escaped = renderIndexHtml(TEMPLATE, { version: '<img src=x onerror=alert(1)>' });
  assert.ok(!escaped.includes('当前版本：<img'), '版本号文本必须转义或规范化');
  assert.ok(!/当前版本：[^<]*<img/i.test(escaped), '不得输出原始 img 标签');
  assert.match(escaped, /当前版本：vimg/, '危险字符应被规范化，而不是原样输出');
  assert.ok(!escaped.includes('"<img'), '内联脚本中的版本号也必须规范化');
});

test('GET /health、/version 与 /version.json 返回同一条当前交付记录且禁止缓存', async () => {
  await withServer({ version: 'v8.1.2', deliveryTime: '2026-11-20 06:59' }, async (base) => {
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.version, 'v8.1.2');
    assert.equal(health.deliveredAt, '2026-11-20 06:59');

    for (const pathname of ['/version', '/apps/p1/version', '/version.json', '/apps/p1/version.json']) {
      const response = await fetch(`${base}${pathname}`);
      assert.equal(response.status, 200, `${pathname} 应返回 200`);
      assert.match(response.headers.get('content-type') || '', /application\/json/);
      assert.match(response.headers.get('cache-control') || '', /no-store/, `${pathname} 必须禁止缓存`);
      assert.equal(response.headers.get('etag'), null, `${pathname} 不应返回 ETag，避免 304 旧内容`);
      assert.deepEqual(await response.json(), {
        version: 'v8.1.2',
        deliveredAt: '2026-11-20 06:59',
        source: 'override',
      });
    }
  });
});

test('首屏 HTML 输出当前版本与时间，HTML 本身禁止缓存', async () => {
  // 单元测试可能在 npm run build 之前执行；构建产物存在时再做真实 HTTP 首屏检查，
  // 构建后的完整首屏检查由 npm run smoke / browser-check 覆盖。
  if (!fs.existsSync(path.join(root, 'dist/index.html'))) {
    const html = renderIndexHtml(read('web/index.html'), {
      basePath: '/apps/p1',
      version: 'v15',
      deliveryTime: '2026-11-20 06:59',
    });
    assert.match(
      html,
      /data-testid="app-version"[^>]*>当前版本：v15 · 交付时间：2026-11-20 06:59<\/span>/
    );
    return;
  }
  await withServer({ version: 'v15', deliveryTime: '2026-11-20 06:59' }, async (base) => {
    for (const url of [`${base}/`, `${base}/apps/p1/`]) {
      const response = await fetch(url);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('cache-control') || '', /no-store/);
      const html = await response.text();
      assert.match(html, /window\.__APP_VERSION__ = "v15";/);
      assert.match(
        html,
        /data-testid="app-version"[^>]*>当前版本：v15 · 交付时间：2026-11-20 06:59<\/span>/
      );
      assert.ok(!html.includes('__APP_VERSION_LABEL__'));
      assert.ok(!/当前版本[:：]\s*v1[0-4]/.test(html), '不得展示上一版旧版本');
    }
  });
});

test('版本信息获取异常时页面不显示过期版本，并有可识别提示', () => {
  const html = renderIndexHtml(read('web/index.html'), {
    basePath: '/apps/p1',
    version: '',
    deliveryTime: '',
  });
  assert.match(
    html,
    /data-testid="app-version"[^>]*>版本信息获取中…<\/span>/,
    '首屏应显示「版本信息获取中」而不是旧版本'
  );
  assert.ok(!/当前版本[:：]\s*v1[0-9]/.test(html));

  assert.equal(ERROR_LABEL, '版本信息获取失败，请刷新重试');
  assert.equal(formatClientVersionLabel('', ''), '版本信息获取中…');
  assert.throws(() => parseDeliveryPayload({ version: '', deliveredAt: '' }));
  assert.throws(() => parseDeliveryPayload({ version: 'v15', deliveredAt: '2026/11/20 06:59' }));
  assert.deepEqual(parseDeliveryPayload({ version: 'v15', deliveredAt: '' }), {
    version: 'v15',
    deliveredAt: '',
  });
});

test('运行实例启动时间稳定，并按版本/构建时间隔离不同部署', () => {
  const dir = tempDir('wensi-clock-');
  const file = path.join(dir, 'started.json');
  try {
    // 预置一个属于其他构建的时间，确认不会被当前实例误用。
    fs.writeFileSync(
      file,
      `${JSON.stringify({ key: 'other|build', deliveredAt: '2000-01-01 00:00' })}\n`
    );
    const env = { DELIVERY_STARTED_AT_FILE: file, APP_STARTED_AT: '' };
    const build = { version: 'v15', deliveredAt: '', builtAt: '2026-11-20T06:58:50.000Z' };
    const first = runtimeStartedAt(build, env);
    const second = runtimeStartedAt(build, env);
    assert.equal(first, second, '同一实例重复请求时间应稳定');
    assert.notEqual(first, '2000-01-01 00:00', '不得读取其他构建的启动时间');
    assert.match(first, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  assert.match(formatDeliveryTimestamp(new Date('2026-11-20T06:59:32Z')), /^2026-11-20 06:59$/);
});

test('构建与部署配置：版本自动生成、Dockerfile 复制脚本并禁用缓存', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.prebuild, 'node scripts/delivery-index.mjs');
  assert.match(pkg.scripts.build, /vite build/);

  const dockerfile = read('Dockerfile');
  assert.match(dockerfile, /COPY\s+scripts\s+\.\/scripts/, '构建阶段必须复制自动版本脚本');
  assert.match(dockerfile, /EXPOSE\s+8080/);
  assert.match(dockerfile, /ENV\s+PORT=8080/);
  assert.match(dockerfile, /COPY\s+.*dist/);
  assert.match(dockerfile, /HEALTHCHECK/);

  const indexHtml = read('web/index.html');
  assert.equal((indexHtml.match(/data-testid="app-version"/g) || []).length, 1);
  assert.ok(indexHtml.includes('__APP_VERSION_LABEL__'));

  const app = read('web/src/App.jsx');
  assert.ok(!app.includes('data-testid="app-version"'), 'React 不重复渲染版本节点');

  const versionSource = read('server/version.js');
  assert.ok(!/['"]v1[0-4]['"]/.test(versionSource), '服务端不得硬编码历史版本号');
  assert.ok(versionSource.includes('runtimeStartedAt'), '交付时间应取运行实例启动时间');

  const smoke = read('scripts/smoke.mjs');
  assert.ok(smoke.includes('/version.json'), '冒烟必须检查版本接口');
});

test('版本接口返回空数据时前端仍可识别为异常，而不是渲染空版本', () => {
  assert.equal(formatClientVersionLabel('', ''), '版本信息获取中…');
  assert.equal(formatClientVersionLabel('v15', ''), '当前版本：v15 · 交付时间获取失败');
  assert.throws(() => parseDeliveryPayload(null));
  assert.throws(() => parseDeliveryPayload([]));
  assert.deepEqual(parseDeliveryPayload({ version: 'v15', deliveredAt: '2026-11-20 06:59' }), {
    version: 'v15',
    deliveredAt: '2026-11-20 06:59',
  });
});
