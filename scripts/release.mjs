/**
 * 项目发布工具：由项目自己发布一个新应用版本。
 *
 * 用法：npm run release -- 1.2.0
 *
 * 同步更新三处，保证版本同源：
 *   1. package.json 的 version
 *   2. package-lock.json 的 version（顶层与根包）
 *   3. 仓库根目录 .delivery-release.json（唯一版本依据）
 *
 * released_at 在运行本脚本的时刻生成，带本地时区偏移，写入后固定不变；
 * 重复构建、重新部署或进程重启都不会改写它。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RELEASE_SCHEMA, normalizeVersion } from '../server/version.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function pad2(value) {
  return String(value).padStart(2, '0');
}

/** 当前时刻的带时区 ISO8601，例如 2026-11-20T17:03:38+08:00。 */
export function localIsoTimestamp(date = new Date()) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    `T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}` +
    `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
  );
}

/** 规范化命令行传入的新版本号：接受 1.2.0 或 v1.2.0，返回 [semver, vSemver]。 */
export function parseReleaseVersion(raw) {
  const text = String(raw || '').trim();
  if (!/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(text)) {
    throw new Error(`版本号不合法：${text || '(空)'}；示例：npm run release -- 1.2.0`);
  }
  const semver = text.replace(/^v/i, '');
  return { semver, version: `v${semver}` };
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

export function publishRelease(rawVersion, { now = new Date(), rootDir = root } = {}) {
  const { semver, version } = parseReleaseVersion(rawVersion);
  const packageFile = path.join(rootDir, 'package.json');
  const lockFile = path.join(rootDir, 'package-lock.json');
  const releaseFile = path.join(rootDir, '.delivery-release.json');

  const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  pkg.version = semver;
  writeJson(packageFile, pkg);

  const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  lock.version = semver;
  if (lock.packages && lock.packages['']) lock.packages[''].version = semver;
  writeJson(lockFile, lock);

  const record = {
    schema: RELEASE_SCHEMA,
    version: normalizeVersion(version),
    released_at: localIsoTimestamp(now),
  };
  writeJson(releaseFile, record);

  return { file: releaseFile, record };
}

function main() {
  const raw = process.argv[2];
  if (!raw) {
    console.error('用法：npm run release -- <版本号>，例如 npm run release -- 1.2.0');
    process.exitCode = 1;
    return;
  }
  const { record, file } = publishRelease(raw);
  console.log(`[release] 已发布 ${record.version}，发布时间 ${record.released_at}`);
  console.log(`[release] 发布记录：${path.relative(process.cwd(), file) || file}`);
  console.log('[release] package.json 与 package-lock.json 已同步为新版本。');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
