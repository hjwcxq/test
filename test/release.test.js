/**
 * 独立构建、重复构建与进程重启的发布记录稳定性测试。
 *
 * 在临时目录复制项目源码（不含 .git），复用本仓库 node_modules，清空所有
 * 中心版本相关环境变量后真实执行 npm run build，并启动 server/index.js。
 * 验证：
 *   - 无 git、无中心网络/环境变量也能构建与运行；
 *   - 构建产物与运行产物包含 .delivery-release.json；
 *   - 重复构建、两次进程启动的版本与发布时间完全一致；
 *   - 发布工具能同步更新包版本与发布记录。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeReleasedAt } from '../server/version.js';
import { publishRelease } from '../scripts/release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION_ENV_KEYS = [
  'APP_VERSION',
  'VITE_APP_VERSION',
  'DELIVERY_VERSION',
  'DEPLOYMENT_VERSION',
  'RELEASE_VERSION',
  'BUILD_VERSION',
  'APP_RELEASE_VERSION',
  'IMAGE_VERSION',
  'RELEASE_TAG',
  'GIT_TAG',
  'VERSION',
  'APP_DELIVERY_TIME',
  'DELIVERY_TIME',
  'DELIVERED_AT',
  'APP_DELIVERED_AT',
  'DEPLOYED_AT',
  'RELEASE_TIME',
  'APP_DELIVERY_FILE',
  'DELIVERY_META_FILE',
  'DELIVERY_FILE',
  'APP_VERSION_FILE',
  'DELIVERY_TASK_ID',
];

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of VERSION_ENV_KEYS) delete env[key];
  // 明确指向不存在的 git 目录，证明构建与运行不依赖版本库历史。
  env.GIT_DIR = path.join(os.tmpdir(), 'wensi-no-git');
  delete env.GIT_WORK_TREE;
  return { ...env, ...extra };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(base, child) {
  for (let i = 0; i < 120; i += 1) {
    if (child.exitCode !== null) throw new Error(`服务进程提前退出，退出码 ${child.exitCode}`);
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {
      // 继续等待
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('服务在限定时间内未通过健康检查');
}

async function startServer(dir) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: dir,
    env: cleanEnv({ PORT: String(port), HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  child.stdout.on('data', () => {});
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(base, child);
  } catch (error) {
    child.kill('SIGKILL');
    throw new Error(`${error.message}\n${stderr}`);
  }
  return {
    base,
    async stop() {
      child.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
      if (child.exitCode === null) child.kill('SIGKILL');
    },
  };
}

function copyProject(dir) {
  for (const name of ['package.json', 'package-lock.json', '.delivery-release.json', 'README.md']) {
    fs.copyFileSync(path.join(root, name), path.join(dir, name));
  }
  for (const name of ['web', 'server', 'data']) {
    fs.cpSync(path.join(root, name), path.join(dir, name), { recursive: true });
  }
  // 复用已安装依赖，避免测试期间重复下载；构建解析规则与真实项目一致。
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
}

function runBuild(dir) {
  execFileSync('npm', ['run', 'build'], {
    cwd: dir,
    env: cleanEnv(),
    stdio: 'pipe',
    timeout: 180000,
  });
}

test('无 .git、无中心环境变量时可独立构建运行，重复构建与重启不改发布时间', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wensi-independent-'));
  try {
    assert.equal(fs.existsSync(path.join(root, 'node_modules')), true, '需要先安装依赖');
    copyProject(dir);
    assert.equal(fs.existsSync(path.join(dir, '.git')), false, '临时项目不应包含版本库历史');

    const releaseBefore = fs.readFileSync(path.join(dir, '.delivery-release.json'), 'utf8');
    const expected = JSON.parse(releaseBefore);

    runBuild(dir);
    assert.equal(
      fs.readFileSync(path.join(dir, '.delivery-release.json'), 'utf8'),
      releaseBefore,
      '构建不得改写发布记录'
    );
    assert.ok(fs.existsSync(path.join(dir, 'dist/index.html')), '构建应产出前端首页');
    assert.equal(fs.existsSync(path.join(dir, 'dist/version.json')), false, '版本不再由构建脚本推算');

    // 第二次构建（模拟同一版本重复构建）后发布记录仍不变。
    runBuild(dir);
    assert.equal(
      fs.readFileSync(path.join(dir, '.delivery-release.json'), 'utf8'),
      releaseBefore,
      '重复构建不得改变版本或发布时间'
    );

    const first = await startServer(dir);
    let firstVersion;
    let firstReleasedAt;
    try {
      const health = await (await fetch(`${first.base}/health`)).json();
      assert.equal(health.status, 'ok');
      assert.equal(health.versionAvailable, true);
      firstVersion = health.version;
      firstReleasedAt = health.releasedAt;
      assert.equal(firstVersion, expected.version);
      assert.equal(firstReleasedAt, normalizeReleasedAt(expected.released_at));

      const version = await (await fetch(`${first.base}/apps/p1/version.json`)).json();
      assert.equal(version.available, true);
      assert.equal(version.version, firstVersion);
      assert.equal(version.releasedAt, firstReleasedAt);

      const html = await (await fetch(`${first.base}/apps/p1/`)).text();
      assert.ok(
        html.includes(`应用版本：${firstVersion} · 发布时间：${firstReleasedAt}</span>`),
        '首屏应展示发布记录中的版本与发布时间'
      );
    } finally {
      await first.stop();
    }

    // 进程重启（模拟重新部署）不改变版本与发布时间。
    const second = await startServer(dir);
    try {
      const health = await (await fetch(`${second.base}/health`)).json();
      assert.equal(health.version, firstVersion, '重启后版本必须保持不变');
      assert.equal(health.releasedAt, firstReleasedAt, '重启后发布时间必须保持不变');
    } finally {
      await second.stop();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('发布工具同步更新 package.json、package-lock.json 与发布记录', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wensi-publish-'));
  try {
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      `${JSON.stringify({ name: 'demo', version: '1.1.0' }, null, 2)}\n`
    );
    fs.writeFileSync(
      path.join(dir, 'package-lock.json'),
      `${JSON.stringify(
        { name: 'demo', version: '1.1.0', lockfileVersion: 3, packages: { '': { name: 'demo', version: '1.1.0' } } },
        null,
        2
      )}\n`
    );

    const { record } = publishRelease('1.2.0', {
      rootDir: dir,
      now: new Date('2026-12-01T09:10:00+08:00'),
    });
    assert.equal(record.schema, 1);
    assert.equal(record.version, 'v1.2.0');
    assert.match(record.released_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    assert.ok(normalizeReleasedAt(record.released_at));

    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const lock = JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8'));
    const stored = JSON.parse(fs.readFileSync(path.join(dir, '.delivery-release.json'), 'utf8'));
    assert.equal(pkg.version, '1.2.0');
    assert.equal(lock.version, '1.2.0');
    assert.equal(lock.packages[''].version, '1.2.0');
    assert.equal(stored.version, 'v1.2.0');
    assert.equal(stored.released_at, record.released_at);

    assert.throws(() => publishRelease('1.2', { rootDir: dir }));
    assert.throws(() => publishRelease('', { rootDir: dir }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
