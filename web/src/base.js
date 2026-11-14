/**
 * 基础路径探测。
 *
 * 服务端会把 X-Forwarded-Prefix / APP_BASE_PATH / 请求路径推断出的基础路径
 * 注入到 index.html 的 window.__APP_BASE_PATH__；若产物未经服务端注入
 * （例如直接用静态服务器打开），则回退到浏览器地址栏自行探测。
 * 这样同一份构建产物在根路径与 /apps/p1/ 下都能拼出正确的 API 地址。
 */

const injected = typeof window !== 'undefined' ? window.__APP_BASE_PATH__ : undefined;

function normalize(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let base = raw.trim().split(',')[0].trim().replace(/\/+$/, '');
  if (!base) return '';
  if (!base.startsWith('/')) base = `/${base}`;
  return base === '/' ? '' : base;
}

function detectFromLocation() {
  if (typeof window === 'undefined') return '';
  const pathname = window.location.pathname || '';
  const marker = '/apps/p1';
  const index = pathname.indexOf(marker);
  if (index !== -1) return pathname.slice(0, index + marker.length);
  // 兼容任意 X-Forwarded-Prefix 场景：形如 /apps/<任意段>/ 挂载
  const generic = pathname.match(/^(\/apps\/[^/]+)(?:\/|$)/);
  return generic ? generic[1] : '';
}

export const BASE_PATH =
  injected && injected !== '__APP_BASE_PATH__' ? normalize(injected) : detectFromLocation();

/** 把以 / 开头的 API 路径拼成可直接 fetch 的地址。 */
export function apiUrl(path) {
  return `${BASE_PATH}${path}`;
}
