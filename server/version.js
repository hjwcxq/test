/**
 * 交付版本与交付时间解析（运行时单一来源）。
 *
 * 版本号不再由构建前手写的常量决定，而是取「当前实际运行实例」的交付记录：
 * 1. 部署注入的完整记录（APP_VERSION + APP_DELIVERY_TIME 等环境变量）；
 * 2. 部署挂载的交付记录文件（APP_DELIVERY_FILE / 标准挂载路径）；
 * 3. 构建产物 dist/version.json（由 npm run build 依据交付历史自动生成）；
 * 4. 开发环境兜底：仓库 delivery.json（生产环境默认不启用，避免展示过期版本）。
 *
 * 版本取所有来源中「最新」的一个：旧的环境变量或旧的挂载文件不会把页面拉回上一版。
 * 交付时间必须与版本配对：记录自带时间时使用记录时间；没有时间时使用本运行实例
 * 首次启动的时间（容器启动即本次上线，精确到分钟），绝不借用上一版的时间。
 *
 * 版本与时间都拿不到时返回空值，页面显示「版本信息获取中/获取失败」，
 * 不回退展示任何过期版本号。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST_VERSION_PATH = path.resolve(here, '../dist/version.json');

/** 仓库根目录的交付记录文件（构建阶段由 scripts/delivery-index.mjs 自动生成）。 */
export const DELIVERY_META_PATH = path.resolve(here, '../delivery.json');

/**
 * 部署平台可能使用的版本环境变量名，按优先级从高到低。
 * 注意：提交哈希（GIT_COMMIT 等）只是构建元数据，不是交付版本，不能作为版本号展示。
 */
export const VERSION_ENV_KEYS = [
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
];

/** 交付时间可能使用的环境变量名，按优先级从高到低。 */
export const DELIVERY_TIME_ENV_KEYS = [
  'APP_DELIVERY_TIME',
  'DELIVERY_TIME',
  'DELIVERED_AT',
  'APP_DELIVERED_AT',
  'DEPLOYED_AT',
  'RELEASE_TIME',
];

/**
 * 部署时挂载的交付记录文件路径环境变量。部署方可在不重建镜像的前提下
 * 把本次交付记录挂载到镜像内，并设置这些变量指向它。
 */
export const DELIVERY_FILE_ENV_KEYS = [
  'APP_DELIVERY_FILE',
  'DELIVERY_META_FILE',
  'DELIVERY_FILE',
  'DEPLOYMENT_META_FILE',
  'APP_VERSION_FILE',
];

/**
 * 部署平台常见的交付记录挂载位置（未显式配置环境变量时探测）。
 * 只读取存在的文件；旧记录不会覆盖更新的构建版本（见 resolveDeliveryInfo）。
 */
export const STANDARD_DELIVERY_FILES = [
  '/run/delivery/delivery.json',
  '/run/delivery.json',
  '/delivery/delivery.json',
  '/etc/delivery.json',
  '/app/.delivery/delivery.json',
];

const pad2 = (value) => String(value).padStart(2, '0');

/** 当前时刻格式化为 UTC 的「YYYY-MM-DD HH:MM」，与调度中心的交付时间口径一致。 */
export function formatDeliveryTimestamp(date = new Date()) {
  return (
    `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ` +
    `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`
  );
}

/**
 * 读取交付记录（默认 delivery.json）：版本号与交付时间必须来自同一份文件。
 * 文件缺失或格式非法时返回 null，由调用方展示明确的未知状态。
 */
export function readDeliveryMeta(file = DELIVERY_META_PATH) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return { version: parsed.version, deliveredAt: parsed.deliveredAt };
  } catch {
    return null;
  }
}

const repositoryDeliveryMeta = readDeliveryMeta();

/**
 * 兜底记录：唯一来源是仓库交付记录 delivery.json（由构建脚本自动生成）。
 * 仅用于构建阶段与开发环境，不作为生产环境的过期版本回退。
 */
export const DELIVERY_VERSION = normalizeVersion(repositoryDeliveryMeta?.version);
export const DELIVERY_TIME = normalizeDeliveryTime(repositoryDeliveryMeta?.deliveredAt);

/** 读取构建阶段产出的 dist/version.json；不存在时返回 null。 */
export function readBuildInfo() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DIST_VERSION_PATH, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 规范化为 `vX`：去掉已有前缀，过滤不安全字符（版本号会写进内联脚本），
 * 空值返回空字符串。
 */
export function normalizeVersion(raw) {
  if (raw === undefined || raw === null) return '';
  let value = String(raw).trim();
  if (!value || value === '__APP_VERSION__' || value === '版本信息未知') return '';
  value = value.replace(/^[vV]\s*/, '').trim();
  value = value
    .replace(/[^0-9A-Za-z._+~-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  if (!value) return '';
  return `v${value}`;
}

/** 仅从环境变量解析版本，供构建阶段与运行阶段共用。 */
export function envVersion(env = process.env) {
  for (const key of VERSION_ENV_KEYS) {
    const normalized = normalizeVersion(env?.[key]);
    if (normalized) return normalized;
  }
  return '';
}

/** 仅从环境变量解析交付时间。 */
export function envDeliveryTime(env = process.env) {
  for (const key of DELIVERY_TIME_ENV_KEYS) {
    const normalized = normalizeDeliveryTime(env?.[key]);
    if (normalized) return normalized;
  }
  return '';
}

/** 解析显式配置的交付记录文件路径；未配置返回 null。 */
export function explicitDeliveryFilePath(env = process.env) {
  for (const key of DELIVERY_FILE_ENV_KEYS) {
    const raw = env?.[key];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (value) return path.resolve(value);
  }
  return null;
}

/** 兼容旧接口：优先返回显式配置的路径，否则返回仓库交付记录路径。 */
export function resolveDeliveryMetaPath(env = process.env) {
  return explicitDeliveryFilePath(env) || DELIVERY_META_PATH;
}

/**
 * 读取部署时挂载的交付记录：显式配置优先；否则探测常见挂载位置。
 * 每次调用都重新读文件，部署方替换记录后无需重启即可让页面跟随新版本。
 */
export function readDeploymentMeta(env = process.env) {
  const explicit = explicitDeliveryFilePath(env);
  if (explicit) return readDeliveryMeta(explicit);

  for (const file of STANDARD_DELIVERY_FILES) {
    if (file === DELIVERY_META_PATH) continue;
    if (!fs.existsSync(file)) continue;
    const meta = readDeliveryMeta(file);
    if (meta) return meta;
  }
  return null;
}

/**
 * 规范化为「YYYY-MM-DD HH:MM」：只保留交付时刻的日期与时分。
 * 支持 `2026-11-19 10:34`、`2026-11-19T10:34`、ISO 时间戳等写法；
 * 无法识别（或会写进 HTML 的危险字符）时返回空字符串，由调用方回退。
 */
export function normalizeDeliveryTime(raw) {
  if (raw === undefined || raw === null) return '';
  const value = String(raw).trim();
  if (!value || value === '__APP_DELIVERY_TIME__') return '';
  const matched = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T\s](\d{1,2}):(\d{1,2})/);
  if (!matched) return '';
  const [, year, month, day, hour, minute] = matched;
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  const hourNumber = Number(hour);
  const minuteNumber = Number(minute);
  if (
    monthNumber < 1 ||
    monthNumber > 12 ||
    dayNumber < 1 ||
    dayNumber > 31 ||
    hourNumber > 23 ||
    minuteNumber > 59
  ) {
    return '';
  }
  return `${year}-${pad2(monthNumber)}-${pad2(dayNumber)} ${pad2(hourNumber)}:${pad2(minuteNumber)}`;
}

/** 版本号首段数字；无法识别返回 -1。只用于比较新旧，不参与展示。 */
export function versionOrdinal(version) {
  const matched = String(version || '').match(/^v(\d+)/);
  return matched ? Number(matched[1]) : -1;
}

const startedAtCache = new Map();

/**
 * 本运行实例的首次启动时间（UTC，精确到分钟）。
 *
 * 容器每次部署都会启动新的实例，启动时刻就是本次交付上线的时刻；
 * 写入临时目录后在进程/容器重启时复用，避免同一版本刷新后时间漂移。
 * 文件名带上版本与构建时间，新镜像不会读到上一版的时间。
 * 测试或部署方可用 APP_STARTED_AT 直接指定，或用 DELIVERY_STARTED_AT_FILE 指定文件。
 */
export function runtimeStartedAt(buildInfo = readBuildInfo(), env = process.env) {
  const explicit = normalizeDeliveryTime(env?.APP_STARTED_AT || env?.DELIVERY_STARTED_AT);
  if (explicit) return explicit;

  const version = normalizeVersion(buildInfo?.version) || 'unknown';
  const stamp = String(buildInfo?.builtAt || buildInfo?.commit || 'no-build');
  const key = `${version}|${stamp}`;
  if (startedAtCache.has(key)) return startedAtCache.get(key);

  const hash = createHash('sha256').update(key).digest('hex').slice(0, 16);
  const file =
    env?.DELIVERY_STARTED_AT_FILE ||
    path.join(os.tmpdir(), 'wensi-delivery-runtime', `${hash}.json`);

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const saved = normalizeDeliveryTime(parsed?.deliveredAt);
    if (saved && parsed?.key === key) {
      startedAtCache.set(key, saved);
      return saved;
    }
  } catch {
    // 首次启动或文件不可读：下面重新记录。
  }

  const deliveredAt = formatDeliveryTimestamp(new Date());
  startedAtCache.set(key, deliveredAt);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, `${JSON.stringify({ key, deliveredAt, startedAt: new Date().toISOString() })}\n`, {
      mode: 0o600,
    });
  } catch {
    // 临时目录不可写时仅进程内缓存，不影响页面展示。
  }
  return deliveredAt;
}

/**
 * 构建阶段解析交付记录：环境变量注入优先，否则读取构建脚本刚生成的 delivery.json。
 * 构建阶段不读取 dist 里的旧 version.json，避免上一次构建结果干扰。
 */
export function resolveBuildDeliveryInfo(env = process.env, meta = readDeliveryMeta()) {
  const injectedVersion = envVersion(env);
  const injectedTime = envDeliveryTime(env);
  const metaVersion = normalizeVersion(meta?.version);
  const metaTime = normalizeDeliveryTime(meta?.deliveredAt);

  if (injectedVersion) {
    const deliveredAt =
      injectedTime || (injectedVersion === metaVersion ? metaTime : '');
    return { version: injectedVersion, deliveredAt, source: 'env' };
  }
  return { version: metaVersion, deliveredAt: metaTime, source: 'repository' };
}

/**
 * 解析当前应展示的交付记录。
 *
 * 所有来源按「版本新旧」择优，而不是简单按优先级回退：遗留的旧环境变量、
 * 旧挂载文件或旧构建产物都不会把页面拉回上一版。版本与时间始终成对：
 * 记录没有时间时使用本实例启动时间，绝不与新版本拼上一版的时间。
 */
export function resolveDeliveryInfo(
  env = process.env,
  buildInfo = readBuildInfo(),
  meta = readDeliveryMeta()
) {
  const injectedVersion = envVersion(env);
  const injectedTime = envDeliveryTime(env);
  const deploymentMeta = readDeploymentMeta(env);
  const deploymentVersion = normalizeVersion(deploymentMeta?.version);
  const deploymentTime = normalizeDeliveryTime(deploymentMeta?.deliveredAt);
  const builtVersion = normalizeVersion(buildInfo?.version);
  const builtTime = normalizeDeliveryTime(buildInfo?.deliveredAt);
  const repoVersion = normalizeVersion(meta?.version);
  const repoTime = normalizeDeliveryTime(meta?.deliveredAt);

  const allowRepository =
    env?.NODE_ENV !== 'production' || env?.ALLOW_DELIVERY_JSON_FALLBACK === '1';

  const candidates = [];
  if (injectedVersion) {
    candidates.push({ version: injectedVersion, deliveredAt: injectedTime, source: 'env' });
  }
  if (deploymentVersion) {
    candidates.push({ version: deploymentVersion, deliveredAt: deploymentTime, source: 'deployment' });
  }
  if (builtVersion) {
    candidates.push({ version: builtVersion, deliveredAt: builtTime, source: 'build' });
  }
  if (!candidates.length && allowRepository && repoVersion) {
    candidates.push({ version: repoVersion, deliveredAt: repoTime, source: 'repository' });
  }

  if (!candidates.length) {
    return { version: '', deliveredAt: '', source: 'missing' };
  }

  // 取最新版本；同等版本保留先出现的高优先级来源。
  let chosen = candidates[0];
  for (const candidate of candidates.slice(1)) {
    if (versionOrdinal(candidate.version) > versionOrdinal(chosen.version)) chosen = candidate;
  }

  // 交付时间与本实例版本配对：记录无时间时用容器首次启动时间。
  // 启动时间文件按「最终展示的版本 + 构建时间」隔离，避免新版本借用旧版本的时间。
  const deliveredAt =
    chosen.deliveredAt || runtimeStartedAt({ ...(buildInfo || {}), version: chosen.version }, env);
  return { version: chosen.version, deliveredAt, source: chosen.source };
}

/** 解析当前应展示的版本号（与交付时间同源）。 */
export function resolveVersion(env = process.env, buildInfo = readBuildInfo(), meta) {
  return resolveDeliveryInfo(env, buildInfo, meta).version;
}

/** 解析当前应展示的交付时间（与版本号同源）。 */
export function resolveDeliveryTime(env = process.env, buildInfo = readBuildInfo(), meta) {
  return resolveDeliveryInfo(env, buildInfo, meta).deliveredAt;
}

/**
 * 生成页面顶部展示文案：版本号 + 交付时间（日期 + 时分）。
 * 版本未知时显示可识别的「版本信息获取中」，不使用任何上一版旧值。
 */
export function formatVersionLabel(version, deliveryTime) {
  const versionText = normalizeVersion(version);
  const timeText = normalizeDeliveryTime(deliveryTime);
  if (!versionText) return '版本信息获取中…';
  if (timeText) return `当前版本：${versionText} · 交付时间：${timeText}`;
  return `当前版本：${versionText} · 交付时间获取失败`;
}
