/**
 * 应用版本来源与展示测试。
 *
 * 1. 唯一来源是项目发布记录 .delivery-release.json，不做任务计数、不看 git；
 * 2. 版本与发布时间同源，格式为「日期 时分」；
 * 3. 发布记录缺失/损坏时返回明确不可用状态，不回退旧版本；
 * 4. 页面首屏、/version.json、/health 三处一致；
 * 5. 发布记录替换后无需重启即可生效。
 *
 * 独立构建、重复构建与进程重启的稳定性由 test/release.test.js 覆盖。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, renderIndexHtml } from '../server/app.js';
import {
  UNAVAILABLE_LABEL,
  formatVersionLabel,
  isDisplayTime,
  normalizeReleasedAt,
  normalizeVersion,
  readReleaseRecord,
  resolveReleaseInfo,
} from '../server/version.js';
import {
  ERROR_LABEL,
  ReleaseUnavailableError,
  formatVersionLabel as formatClientVersionLabel,
  parseReleasePayload,
} from '../web/src/versionLabel.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const TEMPLATE =
  '<!doctype html><html><head><script>window.__APP_BASE_PATH__ = "__APP_BASE_PATH__";</script>' +
  '<script>window.__APP_VERSION__ = "__APP_VERSION__";</script></head><body>' +
  '<span class="app-version" data-testid="app-version">__APP_VERSION_LABEL__</span>' +
  '<div id="root"></div></body></html>';

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

function writeRecord(file, data) {
  fs.writeFileSync(file, typeof data === 'string' ? data : `${JSON.stringify(data)}\n`);
}

test('版本号规范化为 vX，并过滤脚本注入字符', () => {
  assert.equal(normalizeVersion('1.1.0'), 'v1.1.0');
  assert.equal(normalizeVersion('v1.1.0'), 'v1.1.0');
  assert.equal(normalizeVersion('  V 20261119.145000  '), 'v20261119.145000');
  assert.equal(normalizeVersion('1.0.0+build.2026'), 'v1.0.0+build.2026');
  assert.equal(normalizeVersion('1.0<script>alert(1)</script>'), 'v1.0-script-alert-1-script');
  assert.ok(!normalizeVersion('1.0<script>').includes('<'));
  assert.equal(normalizeVersion(''), '');
  assert.equal(normalizeVersion('   '), '');
  assert.equal(normalizeVersion(null), '');
  assert.equal(normalizeVersion('__APP_VERSION__'), '');
});

test('发布时间只接受带时区的 ISO8601，并转成「YYYY-MM-DD HH:MM」', () => {
  assert.equal(normalizeReleasedAt('2026-11-20T17:03:38+08:00'), '2026-11-20 17:03');
  assert.equal(normalizeReleasedAt('2026-11-20T09:03:38Z'), '2026-11-20 09:03');
  assert.equal(normalizeReleasedAt('2026-11-20T09:03Z'), '2026-11-20 09:03');
  assert.equal(normalizeReleasedAt('2026-11-20T09:03:38.123Z'), '2026-11-20 09:03');
  assert.equal(normalizeReleasedAt('2026-11-20T17:03:38+0800'), '2026-11-20 17:03');
  assert.equal(normalizeReleasedAt('2026-11-20 17:03'), '', '不接受不带时区的写法');
  assert.equal(normalizeReleasedAt('2026-13-01T10:00:00Z'), '');
  assert.equal(normalizeReleasedAt('2026-11-20T24:00:00Z'), '');
  assert.equal(normalizeReleasedAt('latest'), '');
  assert.equal(normalizeReleasedAt(''), '');

  assert.equal(isDisplayTime('2026-11-20 17:03'), true);
  assert.equal(isDisplayTime('2026-11-20T17:03'), false);
  assert.equal(isDisplayTime('2026-13-20 17:03'), false);
});

test('发布记录缺失、损坏或字段不全时返回明确不可用状态', () => {
  const dir = tempDir('wensi-release-invalid-');
  try {
    const missing = path.join(dir, 'missing.json');
    assert.deepEqual(readReleaseRecord(missing), { ok: false, reason: 'missing' });
    assert.deepEqual(resolveReleaseInfo(missing), {
      available: false,
      version: '',
      releasedAt: '',
      releasedAtIso: '',
      reason: 'missing',
    });

    const cases = [
      '{not json',
      '[]',
      'null',
      JSON.stringify({ schema: 2, version: 'v1.1.0', released_at: '2026-11-20T17:03:38+08:00' }),
      JSON.stringify({ version: 'v1.1.0', released_at: '2026-11-20T17:03:38+08:00' }),
      JSON.stringify({ schema: 1, released_at: '2026-11-20T17:03:38+08:00' }),
      JSON.stringify({ schema: 1, version: 'v1.1.0' }),
      JSON.stringify({ schema: 1, version: '', released_at: '2026-11-20T17:03:38+08:00' }),
      JSON.stringify({ schema: 1, version: 'v1.1.0', released_at: '2026-11-20 17:03' }),
    ];
    for (const [index, content] of cases.entries()) {
      const file = path.join(dir, `bad-${index}.json`);
      writeRecord(file, content);
      assert.deepEqual(readReleaseRecord(file), { ok: false, reason: 'invalid' }, content);
      assert.equal(resolveReleaseInfo(file).available, false);
      assert.equal(resolveReleaseInfo(file).version, '');
      assert.equal(resolveReleaseInfo(file).releasedAt, '');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('发布记录合法时版本与发布时间同源，且可重复读取保持不变', () => {
  const dir = tempDir('wensi-release-valid-');
  const file = path.join(dir, 'release.json');
  try {
    writeRecord(file, { schema: 1, version: 'v1.1.0', released_at: '2026-11-20T17:03:38+08:00' });
    const first = resolveReleaseInfo(file);
    const second = resolveReleaseInfo(file);
    assert.deepEqual(first, {
      available: true,
      version: 'v1.1.0',
      releasedAt: '2026-11-20 17:03',
      releasedAtIso: '2026-11-20T17:03:38+08:00',
      reason: null,
    });
    assert.deepEqual(first, second, '重复读取不得改变版本或发布时间');
    assert.deepEqual(readReleaseRecord(file), {
      ok: true,
      version: 'v1.1.0',
      releasedAt: '2026-11-20 17:03',
      releasedAtIso: '2026-11-20T17:03:38+08:00',
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('仓库发布记录与 package.json 同源，版本为 v1.1.0', () => {
  const record = JSON.parse(read('.delivery-release.json'));
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(record.schema, 1);
  assert.equal(record.version, 'v1.1.0');
  assert.equal(record.version, `v${pkg.version}`);
  assert.equal(pkg.version, '1.1.0');
  assert.equal(lock.version, '1.1.0');
  assert.equal(lock.packages[''].version, '1.1.0');
  assert.match(record.released_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);

  const info = resolveReleaseInfo();
  assert.equal(info.available, true);
  assert.equal(info.version, record.version);
  assert.equal(info.releasedAt, normalizeReleasedAt(record.released_at));
});

test('页面文案为「应用版本：vX · 发布时间：日期 时分」，缺失时给出不可用提示', () => {
  assert.equal(
    formatVersionLabel('v1.1.0', '2026-11-20 17:03'),
    '应用版本：v1.1.0 · 发布时间：2026-11-20 17:03'
  );
  assert.equal(formatVersionLabel('', ''), UNAVAILABLE_LABEL);
  assert.equal(formatVersionLabel('__APP_VERSION__', ''), UNAVAILABLE_LABEL);
  assert.equal(formatVersionLabel('v1.1.0', ''), '应用版本：v1.1.0 · 发布时间不可用');
  assert.equal(
    formatClientVersionLabel('v1.1.0', '2026-11-20 17:03'),
    formatVersionLabel('v1.1.0', '2026-11-20 17:03')
  );
  assert.equal(formatClientVersionLabel('', ''), UNAVAILABLE_LABEL);
  assert.equal(ERROR_LABEL, '应用版本信息不可用，请刷新重试');
});

test('首屏 HTML 注入版本、发布时间与基础路径，不残留占位符也不回退旧版本', () => {
  const first = renderIndexHtml(TEMPLATE, {
    basePath: '/apps/p1',
    version: 'v1.1.0',
    releasedAt: '2026-11-20T17:03:38+08:00',
  });
  const second = renderIndexHtml(TEMPLATE, {
    basePath: '/apps/p1',
    version: 'v1.1.0',
    releasedAt: '2026-11-20T17:03:38+08:00',
  });
  assert.equal(first, second, '同一发布记录重复渲染结果一致');
  assert.ok(first.includes('window.__APP_VERSION__ = "v1.1.0";'));
  assert.ok(first.includes('window.__APP_BASE_PATH__ = "/apps/p1";'));
  assert.match(
    first,
    /data-testid="app-version">应用版本：v1\.1\.0 · 发布时间：2026-11-20 17:03<\/span>/
  );
  assert.ok(!first.includes('__APP_VERSION_LABEL__'));
  assert.ok(!first.includes('"__APP_VERSION__"'));

  const unavailable = renderIndexHtml(TEMPLATE, { version: '', releasedAt: '' });
  assert.ok(unavailable.includes(`>${UNAVAILABLE_LABEL}<`));
  assert.ok(!/应用版本：v\d/.test(unavailable), '不可用时不得展示任何版本号');

  const escaped = renderIndexHtml(TEMPLATE, { version: '<img src=x onerror=alert(1)>' });
  assert.ok(!escaped.includes('<img'), '版本号文本必须转义或规范化');
  assert.ok(!escaped.includes('"<img'), '内联脚本中的版本号也必须规范化');
});

test('GET /version.json、/health 与首屏同源，缺失/损坏记录返回不可用状态', async () => {
  const dir = tempDir('wensi-release-http-');
  const file = path.join(dir, 'release.json');
  try {
    writeRecord(file, { schema: 1, version: 'v1.1.0', released_at: '2026-11-20T17:03:38+08:00' });
    await withServer({ releaseFile: file }, async (base) => {
      const health = await (await fetch(`${base}/health`)).json();
      assert.equal(health.status, 'ok');
      assert.equal(health.healthy, true);
      assert.equal(health.versionAvailable, true);
      assert.equal(health.version, 'v1.1.0');
      assert.equal(health.releasedAt, '2026-11-20 17:03');

      for (const pathname of ['/version', '/version.json', '/apps/p1/version', '/apps/p1/version.json']) {
        const response = await fetch(`${base}${pathname}`);
        assert.equal(response.status, 200, `${pathname} 应返回 200`);
        assert.match(response.headers.get('content-type') || '', /application\/json/);
        assert.match(response.headers.get('cache-control') || '', /no-store/, `${pathname} 必须禁止缓存`);
        assert.equal(response.headers.get('etag'), null);
        const body = await response.json();
        assert.equal(body.available, true);
        assert.equal(body.version, 'v1.1.0');
        assert.equal(body.releasedAt, '2026-11-20 17:03');
        assert.equal(body.released_at, '2026-11-20T17:03:38+08:00');
      }

      // 发布记录替换后刷新即生效，不需要重启进程。
      writeRecord(file, { schema: 1, version: 'v1.2.0', released_at: '2026-12-01T09:10:00+08:00' });
      const updated = await (await fetch(`${base}/apps/p1/version.json`)).json();
      assert.equal(updated.version, 'v1.2.0');
      assert.equal(updated.releasedAt, '2026-12-01 09:10');

      // 删除记录后立即变为不可用，不回退到上一个版本。
      fs.rmSync(file);
      const missing = await (await fetch(`${base}/apps/p1/version.json`)).json();
      assert.equal(missing.available, false);
      assert.equal(missing.version, null);
      assert.equal(missing.releasedAt, null);
      assert.equal(missing.reason, 'missing');
      assert.ok(missing.message);

      const missingHealth = await (await fetch(`${base}/health`)).json();
      assert.equal(missingHealth.versionAvailable, false);
      assert.equal(missingHealth.version, null);
    });

    writeRecord(file, '{broken');
    await withServer({ releaseFile: file }, async (base) => {
      const body = await (await fetch(`${base}/version.json`)).json();
      assert.equal(body.available, false);
      assert.equal(body.reason, 'invalid');
      assert.equal(body.version, null);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('首屏 HTML 输出当前发布记录，HTML 禁止缓存（构建产物存在时）', async () => {
  if (!fs.existsSync(path.join(root, 'dist/index.html'))) {
    const html = renderIndexHtml(read('web/index.html'), {
      basePath: '/apps/p1',
      version: 'v1.1.0',
      releasedAt: '2026-11-20 17:03',
    });
    assert.match(html, /data-testid="app-version"[^>]*>应用版本：v1\.1\.0 · 发布时间：2026-11-20 17:03<\/span>/);
    return;
  }
  await withServer(
    { release: { version: 'v1.1.0', releasedAt: '2026-11-20 17:03' } },
    async (base) => {
      for (const url of [`${base}/`, `${base}/apps/p1/`]) {
        const response = await fetch(url);
        assert.equal(response.status, 200);
        assert.match(response.headers.get('cache-control') || '', /no-store/);
        const html = await response.text();
        assert.match(html, /window\.__APP_VERSION__ = "v1\.1\.0";/);
        assert.match(
          html,
          /data-testid="app-version"[^>]*>应用版本：v1\.1\.0 · 发布时间：2026-11-20 17:03<\/span>/
        );
        assert.ok(!html.includes('__APP_VERSION_LABEL__'));
      }
    }
  );

  // 发布记录缺失时，真实页面首屏也必须是可识别的不可用提示，而不是旧版本。
  await withServer({ releaseFile: path.join(root, 'no-such-release-file.json') }, async (base) => {
    const html = await (await fetch(`${base}/apps/p1/`)).text();
    assert.ok(html.includes(`>${UNAVAILABLE_LABEL}<`), '缺失记录时首屏应显示不可用提示');
    assert.ok(!/应用版本：v\d/.test(html), '缺失记录时不得显示任何版本号');
  });
});

test('前端版本接口解析：可用时读取版本与时间，不可用时抛出可识别错误', () => {
  assert.deepEqual(
    parseReleasePayload({ available: true, version: 'v1.1.0', releasedAt: '2026-11-20 17:03' }),
    { version: 'v1.1.0', releasedAt: '2026-11-20 17:03' }
  );
  assert.throws(() => parseReleasePayload(null));
  assert.throws(() => parseReleasePayload([]));
  assert.throws(() => parseReleasePayload({ version: 'v1.1.0', releasedAt: '2026-11-20 17:03' }));
  assert.throws(() => parseReleasePayload({ available: true, version: '', releasedAt: '2026-11-20 17:03' }));
  assert.throws(() => parseReleasePayload({ available: true, version: 'v1.1.0', releasedAt: '' }));
  assert.throws(() => parseReleasePayload({ available: true, version: 'v1.1.0', releasedAt: '2026/11/20 17:03' }));
  assert.throws(
    () => parseReleasePayload({ available: false, reason: 'missing' }),
    (error) => error instanceof ReleaseUnavailableError && error.reason === 'missing'
  );
});
