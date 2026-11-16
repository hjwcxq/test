/**
 * 容器交付静态校验。
 *
 * 当前执行环境未安装 docker / podman，无法真实构建镜像；本脚本校验 Dockerfile
 * 与 .dockerignore 的必需交付属性，并确认服务入口默认监听 8080。
 * 运行期行为由 npm run smoke（真实启动 node server/index.js 并做 HTTP 冒烟）覆盖。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => {
  const file = path.join(root, name);
  assert.ok(fs.existsSync(file), `根目录缺少 ${name}`);
  return fs.readFileSync(file, 'utf8');
};

const dockerfile = read('Dockerfile');
const dockerignore = read('.dockerignore');
const entry = read('server/index.js');
const pkg = JSON.parse(read('package.json'));

const stages = dockerfile.match(/^\s*FROM\s+/gim) || [];
assert.ok(stages.length >= 2, 'Dockerfile 必须是多阶段构建');
assert.match(dockerfile, /FROM\s+node:20-alpine/, '构建/运行阶段应使用 node:20-alpine');
assert.match(dockerfile, /EXPOSE\s+8080/, '必须暴露 8080');
assert.match(dockerfile, /USER\s+(?!root\b)[A-Za-z0-9_-]+/, '必须以非 root 用户运行');
assert.match(dockerfile, /CMD\s+\[?\s*"node"\s*,\s*"server\/index\.js"/, 'CMD 必须启动 node server/index.js');
assert.match(dockerfile, /npm\s+run\s+build/, '构建阶段必须构建前端产物');
assert.match(dockerfile, /--omit=dev|npm\s+ci\s+--omit=dev|NODE_ENV=production/, '运行阶段应只安装生产依赖');
assert.match(dockerfile, /COPY\s+.*dist/, '运行阶段必须复制前端构建产物');
assert.match(dockerfile, /COPY\s+data\s+\.\/data/, '运行阶段必须复制 data 目录（含江苏、浙江题库）');
assert.match(dockerfile, /ENV\s+PORT=8080/, '容器默认端口必须是 8080');
assert.match(dockerfile, /HEALTHCHECK/, '应声明 HEALTHCHECK');
assert.match(dockerignore, /node_modules/, '.dockerignore 必须排除 node_modules');
assert.match(dockerignore, /^dist\/?$/m, '.dockerignore 必须排除 dist（由构建阶段产出）');
assert.match(dockerignore, /\.git/, '.dockerignore 必须排除 .git');

assert.match(entry, /0\.0\.0\.0/, '服务必须监听 0.0.0.0');
assert.match(entry, /process\.env\.PORT\s*\|\|\s*8080/, '服务默认端口必须是 8080');
assert.equal(pkg.scripts.start, 'node server/index.js');

console.log('[check:docker] Dockerfile / .dockerignore / 8080 监听与启动入口静态校验通过。');
console.log('[check:docker] 说明：本环境未安装 docker，镜像构建与容器运行由调度中心执行；本地以 npm run smoke 覆盖运行期行为。');
