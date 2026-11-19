/**
 * 当前应用版本。
 *
 * 服务端会在返回 index.html 时把部署版本注入 window.__APP_VERSION__；
 * 若产物被静态服务器直接托管（未经服务端注入），回退到构建期注入的
 * `__APP_VERSION__`（由 vite.config.js 的 define 提供）。
 * 页面只负责展示，版本号不在此硬编码。
 */
function normalize(raw) {
  if (typeof raw !== 'string') return '';
  let value = raw.trim();
  if (!value || value === '__APP_VERSION__') return '';
  value = value.replace(/^[vV]\s*/, '').trim();
  value = value
    .replace(/[^0-9A-Za-z._+~-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  if (!value) return '';
  return `v${value}`;
}

const runtimeVersion = typeof window !== 'undefined' ? window.__APP_VERSION__ : '';
const buildVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';

export const APP_VERSION = normalize(runtimeVersion) || normalize(buildVersion) || 'v0.0.0-dev';
export const APP_VERSION_SOURCE = normalize(runtimeVersion) ? 'runtime' : 'build';
