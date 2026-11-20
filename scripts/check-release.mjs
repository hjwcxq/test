/**
 * 发布记录一致性检查。
 *
 * 校验：
 *   1. .delivery-release.json 是唯一版本依据，格式与字段合法；
 *   2. 发布记录、package.json、package-lock.json 版本同源；
 *   3. Dockerfile 将发布记录带入运行产物，.dockerignore 未排除它；
 *   4. 旧的按交付任务/分支/中心任务编号推算版本的实现已移除；
 *   5. 版本相关代码不再读取中心版本环境变量或中心接口。
 *
 * 任一项不满足即非零退出，供 npm run lint 与 Bridge 复验使用。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readReleaseRecord, resolveReleaseInfo } from '../server/version.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const exists = (name) => fs.existsSync(path.join(root, name));

const record = readReleaseRecord();
assert.ok(record.ok, `发布记录不可用（${record.reason}）`);

const release = JSON.parse(read('.delivery-release.json'));
assert.equal(release.schema, 1, '发布记录 schema 必须为 1');
assert.deepEqual(Object.keys(release).sort(), ['released_at', 'schema', 'version'], '发布记录只能包含 schema/version/released_at');
assert.match(release.version, /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, '版本号必须形如 v1.1.0');
assert.match(
  release.released_at,
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
  'released_at 必须是带时区的 ISO8601 时间'
);

const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
assert.equal(release.version, `v${pkg.version}`, '发布记录版本必须与 package.json 一致');
assert.equal(lock.version, pkg.version, 'package-lock.json 顶层版本必须与 package.json 一致');
assert.equal(lock.packages?.['']?.version, pkg.version, 'package-lock.json 根包版本必须与 package.json 一致');

const info = resolveReleaseInfo();
assert.equal(info.available, true);
assert.equal(info.version, release.version);
assert.match(info.releasedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);

const dockerfile = read('Dockerfile');
assert.match(dockerfile, /COPY\s+\.?\/?\.delivery-release\.json\s+/, 'Dockerfile 必须复制 .delivery-release.json');
assert.match(
  dockerfile,
  /COPY\s+--from=builder\s+\/app\/\.delivery-release\.json\s+\.\//,
  '运行阶段必须复用构建阶段的发布记录'
);
assert.doesNotMatch(dockerfile, /APP_VERSION|APP_DELIVERY_TIME|GIT_COMMIT/, 'Dockerfile 不得依赖中心版本注入');

const dockerignore = read('.dockerignore');
const blocked = dockerignore
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((line) => !line.startsWith('!'))
  .some((line) => line === '.delivery-release.json' || line === '*' || line === '.*');
assert.equal(blocked, false, '.dockerignore 不得排除 .delivery-release.json');

assert.equal(exists('scripts/delivery-index.mjs'), false, '旧的交付计数脚本必须移除');
assert.equal(exists('delivery.json'), false, '旧的 delivery.json 必须移除');

const versionSources = [
  'server/version.js',
  'server/app.js',
  'web/vite.config.js',
  'web/src/versionLabel.js',
].map(read);
for (const source of versionSources) {
  assert.doesNotMatch(source, /DELIVERY_TASK_ID|delivery\/task-|delivery-index/, '不得保留按交付任务/分支推算版本的逻辑');
  assert.doesNotMatch(source, /process\.env\.(?:APP_VERSION|VITE_APP_VERSION|DELIVERY_VERSION|APP_DELIVERY_TIME|DELIVERY_VERSION)/, '不得读取中心版本环境变量');
  assert.doesNotMatch(source, /child_process|execFileSync|simple-git/, '版本解析不得依赖 git 历史');
  assert.doesNotMatch(source, /center_url|\/api\/runtime\//, '版本解析不得调用中心运行时接口');
}

console.log(`[check:release] 发布记录 ${release.version}（${release.released_at}）与 package.json / package-lock.json 同源。`);
console.log('[check:release] Dockerfile、.dockerignore 与版本来源检查通过；无交付任务计数、中心接口或中心版本环境变量依赖。');
