/**
 * 交付版本索引（构建前自动执行）。
 *
 * 版本号的唯一依据是「项目内成功交付顺序」：调度中心按成功交付顺序编号
 * v1、v2……，本项目每次成功交付对应一次「实现交付任务 #N」合并。
 * 因此从当前提交历史中提取任务号并去重计数，即可得到当前版本，不需要
 * 任何人在交付前手动填写版本号，也不会再出现「提前写死、上线后慢一版」。
 *
 * - 正常的合并构建：历史里已包含本次任务提交，计数即为本次版本；
 * - 开发分支构建（提交尚未产生）：从 delivery/task-N 分支名补入当前任务；
 * - 镜像构建上下文没有 .git：保留仓库中上一次构建生成的 delivery.json，
 *   由 CI/Bridge 在提交前运行 npm run build 时自动更新。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DELIVERY_FILE = path.join(root, 'delivery.json');

/** 合并提交标题形如「实现交付任务 #30 (#33)」，任务号是唯一标识。 */
export const TASK_COMMIT_PATTERN = /实现交付任务\s*#(\d+)/;

/** 部分合并方式会把 Issue 正文中的 `<!-- delivery-task:37 -->` 带进提交体。 */
export const TASK_BODY_PATTERN = /delivery-task\s*:\s*(\d+)/i;

/** 分支名形如 delivery/task-37，用于本地/PR 构建补入尚未提交的当前任务。 */
export const TASK_BRANCH_PATTERN = /^delivery\/task-(\d+)$/;

/** 从任意文本中提取全部任务号（兼容标题与提交体两种标记）。 */
export function parseTaskIds(text) {
  const ids = new Set();
  const source = String(text || '');
  for (const pattern of [TASK_COMMIT_PATTERN, TASK_BODY_PATTERN]) {
    for (const match of source.matchAll(new RegExp(pattern.source, 'g'))) {
      const id = Number(match[1]);
      if (Number.isSafeInteger(id) && id > 0) ids.add(id);
    }
  }
  return ids;
}

/** 从分支名提取当前任务号；不是交付分支时返回 0。 */
export function parseBranchTask(branch) {
  const matched = String(branch || '').trim().match(TASK_BRANCH_PATTERN);
  if (!matched) return 0;
  const id = Number(matched[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

/** 任务集合 → 交付版本号（成功交付顺序即任务去重数量）。 */
export function versionFromTaskIds(ids) {
  const unique = new Set([...ids].filter((id) => Number.isSafeInteger(id) && id > 0));
  if (!unique.size) return '';
  return `v${unique.size}`;
}

/** 取版本号首段数字，用于比较新旧；无法识别返回 -1。 */
export function versionOrdinal(version) {
  const matched = String(version || '').match(/^v(\d+)/);
  return matched ? Number(matched[1]) : -1;
}

/** 选择更新的版本号；相等时保留当前值，避免无意义抖动。 */
export function newerVersion(current, candidate) {
  if (!candidate) return current;
  if (!current) return candidate;
  return versionOrdinal(candidate) > versionOrdinal(current) ? candidate : current;
}

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/** 读取仓库已提交的交付记录版本，作为历史不可用时的兜底。 */
export function readCommittedVersion(file = DELIVERY_FILE) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return typeof parsed?.version === 'string' ? parsed.version.trim() : '';
  } catch {
    return '';
  }
}

/**
 * 计算当前交付索引。git 不可用时不抛错，返回空 taskIds 并保留已提交版本，
 * 由 writeDeliveryRecord 决定是否更新。
 */
export function computeDeliveryIndex({ cwd = root, env = process.env, file = DELIVERY_FILE } = {}) {
  const taskIds = new Set();
  let branch = '';
  let commit = '';
  let gitAvailable = false;

  try {
    // 用完整提交体：既覆盖「实现交付任务 #N」标题，也覆盖 squash 合并保留的
    // `<!-- delivery-task:N -->` Issue 标记。
    const log = git(['log', '--format=%B', 'HEAD'], cwd);
    gitAvailable = true;
    for (const id of parseTaskIds(log)) taskIds.add(id);
    try {
      branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
    } catch {
      branch = '';
    }
    try {
      commit = git(['rev-parse', 'HEAD'], cwd);
    } catch {
      commit = '';
    }
  } catch {
    gitAvailable = false;
  }

  const branchTask = parseBranchTask(branch);
  if (branchTask) taskIds.add(branchTask);

  const envTask = Number(env?.DELIVERY_TASK_ID);
  if (Number.isSafeInteger(envTask) && envTask > 0) taskIds.add(envTask);

  const computedVersion = versionFromTaskIds(taskIds);
  const committedVersion = readCommittedVersion(file);
  // 浅克隆/无 git 时 computedVersion 可能偏小，绝不能让已交付版本倒退。
  const version = newerVersion(computedVersion, committedVersion) || computedVersion || committedVersion;

  return {
    version,
    taskIds: [...taskIds].sort((a, b) => a - b),
    taskCount: taskIds.size,
    branch,
    commit,
    gitAvailable,
    computedVersion,
    committedVersion,
    source: computedVersion && version === computedVersion ? 'git-history' : 'committed-record',
  };
}

/**
 * 把解析结果写入仓库交付记录。deliveredAt 留空：
 * 交付时间由运行实例首次启动时确定（见 server/version.js），
 * 这样构建阶段不需要猜测上线时间，也不会把上一版时间带进来。
 */
export function writeDeliveryRecord(index, file = DELIVERY_FILE) {
  if (!index?.version) throw new Error('无法从交付历史解析出版本号');
  const record = { version: index.version, deliveredAt: '' };
  const next = `${JSON.stringify(record, null, 2)}\n`;
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (current !== next) fs.writeFileSync(file, next);
  return record;
}

function main() {
  const index = computeDeliveryIndex();
  if (!index.version) {
    console.error('[delivery] 无法解析交付版本：git 历史不可用且 delivery.json 缺少 version。');
    process.exitCode = 1;
    return;
  }
  const record = writeDeliveryRecord(index);
  console.log(
    `[delivery] 版本 ${record.version}（任务 ${index.taskIds.join('、') || '无'}；` +
      `${index.gitAvailable ? 'git 历史' : '已提交记录'}；分支 ${index.branch || '未知'}）`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
