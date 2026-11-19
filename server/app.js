import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIRED_YEARS, loadJiangsuPrompts, loadPrompts, loadZhejiangPrompts } from './data.js';
import { analyzeTopic } from './llm.js';
import { EssayGenerationError } from './essay.js';
import { MAX_TOPIC_LENGTH } from './analyzer.js';
import { normalizeVersion, resolveVersion } from './version.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DIST_DIR = path.resolve(here, '../dist');
const INDEX_PATH = path.join(DIST_DIR, 'index.html');
const BASE_PLACEHOLDER = '"__APP_BASE_PATH__"';
const VERSION_PLACEHOLDER = '"__APP_VERSION__"';
const API_PREFIXES = ['/api', '/apps/p1/api'];

function searchableText(prompt) {
  return [
    prompt.title,
    prompt.region,
    String(prompt.year),
    prompt.original,
    prompt.overview,
    prompt.conceptRelations,
    ...(prompt.tags || []),
    ...(prompt.reviewPoints || []),
    ...(prompt.keywords || []).map((k) => k.term),
    ...(prompt.angles || []).map((a) => a.title),
  ]
    .join(' ')
    .toLowerCase();
}

function jiangsuSearchableText(prompt) {
  return [
    prompt.title,
    prompt.province,
    prompt.paper,
    String(prompt.year),
    prompt.material,
    prompt.requirements,
    prompt.concept,
    prompt.source,
    ...(prompt.tags || []),
    ...(prompt.reviewPoints || []),
    ...(prompt.writingTips || []),
  ]
    .join(' ')
    .toLowerCase();
}

function zhejiangSearchableText(prompt) {
  return [
    prompt.title,
    prompt.province,
    prompt.paper,
    String(prompt.year),
    prompt.material,
    prompt.requirements,
    prompt.concept,
    prompt.source,
    ...(prompt.tags || []),
    ...(prompt.reviewPoints || []),
    ...(prompt.writingTips || []),
    ...(prompt.keywords || []).map((k) => `${k.term} ${k.analysis}`),
    ...(prompt.angles || []).map((a) => `${a.title} ${a.description}`),
    ...(prompt.scoringPoints || []),
  ]
    .join(' ')
    .toLowerCase();
}

const YEAR_ERROR = {
  error: {
    code: 'INVALID_YEAR',
    message: '年份参数无效，仅支持 2022、2023 或 2024 年。',
  },
};

/**
 * 解析 year 查询参数：缺省 / 空字符串表示不筛选；非四位数字或不在支持范围时
 * 返回 invalid 标记。调用方据此返回友好的 400，而不是静默返回空列表。
 */
function parseYearFilter(value) {
  if (value === undefined) return { active: false, year: null };
  const raw = String(value).trim();
  if (raw === '') return { active: false, year: null };
  if (!/^\d{4}$/.test(raw)) return { active: true, year: null, invalid: true };
  const year = Number(raw);
  if (!REQUIRED_YEARS.includes(year)) return { active: true, year: null, invalid: true };
  return { active: true, year };
}

/**
 * 规范化基础路径：只保留安全字符，去掉尾斜杠。
 * 支持反向代理常见的 X-Forwarded-Prefix 与 APP_BASE_PATH 环境变量。
 */
export function normalizeBase(raw) {
  if (!raw) return '';
  let base = String(raw).split(',')[0].trim();
  if (!base) return '';
  if (!base.startsWith('/')) base = `/${base}`;
  base = base.replace(/\/+$/, '');
  if (!/^\/[A-Za-z0-9_\-/]*$/.test(base)) return '';
  return base === '/' ? '' : base;
}

/** 按 请求头 > 环境变量 > 请求路径 的优先级推断基础路径。 */
export function resolveBase(req) {
  const fromHeader = normalizeBase(req.get('X-Forwarded-Prefix'));
  if (fromHeader) return fromHeader;
  const fromEnv = normalizeBase(process.env.APP_BASE_PATH);
  if (fromEnv) return fromEnv;
  const url = req.originalUrl || req.url || '';
  return /\/apps\/p1(?:\/|$)/.test(url) ? '/apps/p1' : '';
}

/**
 * 把基础路径与版本号注入前端模板。
 * 用 JSON.stringify 安全地写进内联脚本，避免引号 / 脚本注入。
 */
export function renderIndexHtml(template, { basePath = '', version = '' } = {}) {
  return String(template)
    .replace(BASE_PLACEHOLDER, JSON.stringify(basePath))
    .replace(VERSION_PLACEHOLDER, JSON.stringify(version));
}

function serveIndex(req, res, version, status = 200) {
  let html;
  try {
    html = fs.readFileSync(INDEX_PATH, 'utf8');
  } catch {
    return res
      .status(503)
      .type('html')
      .send(
        '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>前端资源尚未构建</title></head>' +
          '<body><h1>前端资源尚未构建</h1><p>请先执行 npm run build，再启动服务。</p></body></html>'
      );
  }
  const rendered = renderIndexHtml(html, { basePath: resolveBase(req), version });
  return res.status(status).type('html').send(rendered);
}

function health(version) {
  return (_req, res) =>
    res.status(200).json({
      status: 'ok',
      healthy: true,
      service: 'wensi-essay-guide',
      version,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
}

/** API 路由（会被同时挂载到 /api 与 /apps/p1/api）。 */
export function createApiRouter(
  prompts,
  jiangsuPrompts = [],
  zhejiangPrompts = [],
  options = {}
) {
  const router = express.Router();

  function filterList(items, req, res, buildHaystack) {
    const parsedYear = parseYearFilter(req.query.year);
    if (parsedYear.invalid) {
      res.status(400).json(YEAR_ERROR);
      return null;
    }

    let result = items;
    if (parsedYear.active) result = result.filter((p) => p.year === parsedYear.year);

    const keyword = typeof req.query.keyword === 'string' ? req.query.keyword.trim() : '';
    if (keyword) {
      const needle = keyword.toLowerCase();
      result = result.filter((p) => buildHaystack(p).includes(needle));
    }
    return result;
  }

  // 上海卷题目库：保持原有返回结构与排序，支持 year / keyword 查询。
  router.get('/prompts', (req, res) => {
    const items = filterList(prompts, req, res, searchableText);
    if (!items) return undefined;
    return res.json(items);
  });

  // 江苏高考作文题库：独立数据集，不覆盖上海卷；支持 year / keyword 查询。
  router.get('/jiangsu/prompts', (req, res) => {
    const items = filterList(jiangsuPrompts, req, res, jiangsuSearchableText);
    if (!items) return undefined;
    return res.json(items);
  });

  // 浙江高考作文题库：独立数据集，不覆盖上海卷与江苏题库；支持 year / keyword 查询。
  router.get('/zhejiang/prompts', (req, res) => {
    const items = filterList(zhejiangPrompts, req, res, zhejiangSearchableText);
    if (!items) return undefined;
    return res.json(items);
  });

  // 单题详情：三套题库统一按 id 查找，不存在返回结构化 404。
  router.get('/prompts/:id', (req, res) => {
    const item = [...prompts, ...jiangsuPrompts, ...zhejiangPrompts].find((p) => p.id === req.params.id);
    if (!item) {
      return res.status(404).json({
        error: {
          code: 'PROMPT_NOT_FOUND',
          message: '未找到该题目，请检查题目编号或返回题目库重新选择。',
        },
      });
    }
    return res.json(item);
  });

  // 自定义题目剖析：空 / 纯空白 / 超长 / 非 JSON 均返回 400 结构化错误体。
  router.post('/analyze', async (req, res, next) => {
    try {
      const body = req.body;
      const raw = body && typeof body === 'object' && !Array.isArray(body) ? body.topic : undefined;

      if (typeof raw !== 'string' || raw.trim().length === 0) {
        return res.status(400).json({
          error: {
            code: 'EMPTY_TOPIC',
            message: '请输入作文题目',
          },
        });
      }

      const topic = raw.trim();
      if (topic.length > MAX_TOPIC_LENGTH) {
        return res.status(400).json({
          error: {
            code: 'TOPIC_TOO_LONG',
            message: `题目不能超过 ${MAX_TOPIC_LENGTH} 字，当前 ${topic.length} 字，请精简后重试。`,
          },
        });
      }

      let result;
      try {
        result = await analyzeTopic(topic, { essayGenerator: options.essayGenerator });
      } catch (error) {
        if (error instanceof EssayGenerationError) {
          return res.status(503).json({
            error: {
              code: error.code || 'ESSAY_GENERATION_FAILED',
              message: '范文生成失败，请稍后点击重试。',
              retryable: true,
            },
          });
        }
        throw error;
      }
      return res.json(result);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

/** 构建 Express 应用。options.prompts 可注入数据，便于测试。 */
export function createApp(options = {}) {
  // 启动时即校验三套题目数据：结构缺失或占位文本会直接抛错，不启动服务。
  const prompts = options.prompts || loadPrompts();
  const jiangsuPrompts = options.jiangsuPrompts || loadJiangsuPrompts();
  const zhejiangPrompts = options.zhejiangPrompts || loadZhejiangPrompts();
  // 版本优先取部署注入的环境变量 / 构建产物；测试可显式传 options.version 覆盖。
  const version = normalizeVersion(options.version) || resolveVersion();
  const app = express();
  app.disable('x-powered-by');

  // 请求体大小限制：防止超大输入，也保证超长题目能进入业务校验而非直接 413。
  app.use(express.json({ limit: '128kb', strict: true }));

  const api = createApiRouter(prompts, jiangsuPrompts, zhejiangPrompts, {
    essayGenerator: options.essayGenerator,
  });
  const apiNotFound = (_req, res) =>
    res.status(404).json({
      error: { code: 'API_NOT_FOUND', message: '接口不存在，请检查请求路径后重试。' },
    });

  app.get('/health', health(version));
  app.get('/apps/p1/health', health(version));

  for (const prefix of API_PREFIXES) {
    app.use(prefix, api);
    app.use(prefix, apiNotFound);
  }

  // 无尾斜杠的 /apps/p1 精确重定向到 /apps/p1/，保证相对静态资源路径解析正确。
  // 用精确字符串判断而非 Express 路由，避免非严格路由下 /apps/p1/ 被误判造成重定向循环。
  app.use((req, res, next) => {
    const pathname = (req.originalUrl || req.url || '').split('?')[0];
    if (pathname === '/apps/p1') return res.redirect(302, '/apps/p1/');
    return next();
  });

  // 显式首页路由放在静态托管之前，保证 index.html 一定经过基础路径注入。
  const indexHandler = (req, res) => serveIndex(req, res, version);
  app.get(['/', '/apps/p1/', '/index.html', '/apps/p1/index.html'], indexHandler);

  const staticOptions = {
    index: false,
    fallthrough: true,
    maxAge: '1h',
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  };
  // 同一份构建产物同时挂在根路径与 /apps/p1/ 下。
  app.use('/apps/p1', express.static(DIST_DIR, staticOptions));
  app.use(express.static(DIST_DIR, staticOptions));

  // SPA 回退：HTML 请求返回前端 index.html（支持 /apps/p1/ 下刷新子页面），其余返回 JSON 404。
  app.use((req, res) => {
    if (req.method === 'GET' && req.accepts('html') && !req.path.startsWith('/api')) {
      return serveIndex(req, res, version);
    }
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: '请求的资源不存在，请检查地址后重试。' },
    });
  });

  // 统一错误处理：JSON 解析失败 / 请求体过大都降级为 400，绝不返回 500。
  app.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    if (error && (error.type === 'entity.parse.failed' || (error instanceof SyntaxError && error.status === 400))) {
      return res.status(400).json({
        error: { code: 'INVALID_JSON', message: '请求体不是合法的 JSON 格式，请检查后重试。' },
      });
    }
    if (error && (error.type === 'entity.too.large' || error.status === 413)) {
      return res.status(400).json({
        error: { code: 'PAYLOAD_TOO_LARGE', message: '请求内容过长，请精简题目后重试。' },
      });
    }
    console.error('[server] 未处理异常:', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试。' },
    });
  });

  return app;
}
