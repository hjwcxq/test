/**
 * 运行期冒烟：真实启动 `node server/index.js`（与 Dockerfile CMD 一致），
 * 通过 HTTP 验证健康检查、根路径与 /apps/p1/ 基础路径、静态资源、
 * 题目库接口、剖析接口正常与异常入参。任何一项失败即非零退出。
 */
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveVersion } from '../server/version.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
let serverStderr = '';
const expectedVersion = resolveVersion(process.env);

function check(label, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      results.push(`  ✓ ${label}`);
    })
    .catch((error) => {
      results.push(`  ✗ ${label}`);
      throw error;
    });
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
  for (let i = 0; i < 80; i += 1) {
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

async function main() {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (chunk) => { serverStderr += chunk.toString(); });
  child.stdout.on('data', () => {});

  try {
    await waitForHealth(base, child);

    await check('GET /health 返回 200、健康状态与当前版本', async () => {
      const r = await fetch(`${base}/health`);
      assert.equal(r.status, 200);
      const body = await r.json();
      assert.equal(body.status, 'ok');
      assert.equal(body.healthy, true);
      assert.match(body.version, /^v[0-9A-Za-z]/, '健康检查应返回版本号');
      assert.equal(body.version, expectedVersion, '健康检查版本应与构建/部署配置一致');
    });

    await check('页面注入当前版本且刷新后保持一致，不出现占位旧版本', async () => {
      const versions = [];
      for (const url of [`${base}/`, `${base}/apps/p1/`, `${base}/`]) {
        const r = await fetch(url);
        assert.equal(r.status, 200);
        const html = await r.text();
        const matched = html.match(/window\.__APP_VERSION__ = "([^"]*)";/);
        assert.ok(matched, `${url} 应注入 window.__APP_VERSION__`);
        assert.ok(matched[1], `${url} 版本号不能为空`);
        assert.ok(!matched[1].includes('__APP_VERSION__'), `${url} 不应残留占位符`);
        assert.equal(matched[1], expectedVersion, `${url} 版本应与构建/部署记录一致`);
        // 版本号必须直接出现在首屏 HTML 中（无需等待前端脚本），验收定位才稳定。
        assert.ok(
          html.includes('data-testid="app-version"'),
          `${url} 首屏 HTML 应包含 data-testid="app-version"`
        );
        assert.ok(html.includes('当前版本：'), `${url} 首屏 HTML 应包含「当前版本」文案`);
        assert.ok(
          html.includes(`当前版本：${expectedVersion}</span>`),
          `${url} 首屏版本号文本应与部署版本一致`
        );
        assert.ok(!/当前版本[:：]\s*v7/.test(html), `${url} 不应再展示 v7 等旧版本`);
        const versionNode = html.match(/<span[^>]*data-testid="app-version"[^>]*>([\s\S]*?)<\/span>/);
        assert.ok(versionNode, `${url} 应能定位版本号节点`);
        assert.ok(
          !/<[a-zA-Z]/.test(versionNode[1]),
          `${url} 版本号节点内应为纯文本，避免命中测试落到子元素`
        );
        assert.ok(!html.includes('__APP_VERSION_TEXT__'), `${url} 不应残留版本文本占位符`);
        assert.equal(
          (html.match(/data-testid="app-version"/g) || []).length,
          1,
          `${url} 版本号节点必须唯一，避免定位歧义`
        );
        versions.push(matched[1]);
      }
      assert.equal(new Set(versions).size, 1, '根路径、/apps/p1/ 与刷新后的版本必须一致');
    });

    await check('构建产物 version.json 存在且版本可追溯', async () => {
      const file = path.join(root, 'dist/version.json');
      assert.ok(fs.existsSync(file), 'dist/version.json 应由构建阶段产出');
      const info = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.match(info.version, /^v[0-9A-Za-z]/, 'version.json 应包含有效版本');
      assert.ok(info.builtAt, 'version.json 应记录构建时间');
    });

    await check('GET /apps/p1/health 返回 200', async () => {
      assert.equal((await fetch(`${base}/apps/p1/health`)).status, 200);
    });

    await check('GET / 返回 200 HTML 首页（含挂载点）', async () => {
      const r = await fetch(`${base}/`);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type') || '', /text\/html/);
      const html = await r.text();
      assert.match(html, /<div id="root"><\/div>/);
      assert.match(html, /window\.__APP_BASE_PATH__ = "";/);
    });

    await check('GET /apps/p1/ 返回 200 HTML 且注入基础路径', async () => {
      const r = await fetch(`${base}/apps/p1/`);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type') || '', /text\/html/);
      const html = await r.text();
      assert.match(html, /window\.__APP_BASE_PATH__ = "\/apps\/p1";/);
    });

    await check('GET /apps/p1 重定向到 /apps/p1/ 且能打开首页', async () => {
      const r = await fetch(`${base}/apps/p1`);
      assert.equal(r.status, 200);
      assert.match(await r.text(), /<div id="root"><\/div>/);
    });

    await check('X-Forwarded-Prefix 注入基础路径', async () => {
      const r = await fetch(`${base}/`, { headers: { 'X-Forwarded-Prefix': '/apps/p1' } });
      assert.equal(r.status, 200);
      assert.match(await r.text(), /window\.__APP_BASE_PATH__ = "\/apps\/p1";/);
    });

    await check('静态资源在根路径与 /apps/p1/ 下均无 404', async () => {
      const indexHtml = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
      const assets = [...indexHtml.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)].map((m) => m[1]);
      assert.ok(assets.length >= 2, '构建产物应包含 JS 与 CSS 资源');
      for (const asset of assets) {
        const relative = asset.replace(/^\.\//, '');
        for (const url of [`${base}/${relative}`, `${base}/apps/p1/${relative}`]) {
          const r = await fetch(url);
          assert.equal(r.status, 200, `${url} 应返回 200`);
          assert.ok((await r.text()).length > 100, `${url} 内容不应为空`);
        }
      }
    });

    await check('SPA 子路径刷新返回首页 HTML，未知 API 返回 JSON 404', async () => {
      const page = await fetch(`${base}/some/deep/route`, { headers: { Accept: 'text/html' } });
      assert.equal(page.status, 200);
      assert.match(page.headers.get('content-type') || '', /text\/html/);
      const api = await fetch(`${base}/api/does-not-exist`, { headers: { Accept: 'application/json' } });
      assert.equal(api.status, 404);
      assert.ok((await api.json()).error.message);
    });

    await check('GET /api/prompts 返回 2022/2023/2024 三年完整数据', async () => {
      for (const prefix of ['', '/apps/p1']) {
        const r = await fetch(`${base}${prefix}/api/prompts`);
        assert.equal(r.status, 200);
        const items = await r.json();
        assert.deepEqual(items.map((p) => p.year), [2022, 2023, 2024]);
        for (const p of items) {
          assert.ok(p.original && p.overview && p.conceptRelations);
          assert.ok(p.reviewPoints.length >= 2 && p.keywords.length >= 2);
          assert.ok(p.angles.length >= 3 && p.structure.sections.length >= 4);
          assert.ok(p.materials.length >= 2 && p.pitfalls.length >= 2);
        }
      }
    });

    await check('题目库支持 year / keyword 检索', async () => {
      const byYear = await (await fetch(`${base}/api/prompts?year=2023`)).json();
      assert.equal(byYear.length, 1);
      assert.equal(byYear[0].year, 2023);
      const byKeyword = await (await fetch(`${base}/api/prompts?keyword=${encodeURIComponent('认可度')}`)).json();
      assert.equal(byKeyword[0].year, 2024);
      const empty = await (await fetch(`${base}/api/prompts?keyword=zzz-not-exist`)).json();
      assert.deepEqual(empty, []);
    });

    await check('GET /api/prompts/:id 详情正常，不存在返回 404', async () => {
      const ok = await fetch(`${base}/api/prompts/shanghai-2024`);
      assert.equal(ok.status, 200);
      assert.equal((await ok.json()).title, '认可度');
      const missing = await fetch(`${base}/api/prompts/not-exist`);
      assert.equal(missing.status, 404);
      assert.ok((await missing.json()).error.code);
    });

    await check('GET /api/jiangsu/prompts 返回江苏 2022/2023/2024 三年数据（根路径与前缀）', async () => {
      for (const prefix of ['', '/apps/p1']) {
        const r = await fetch(`${base}${prefix}/api/jiangsu/prompts`);
        assert.equal(r.status, 200);
        const items = await r.json();
        assert.deepEqual(items.map((p) => p.year), [2022, 2023, 2024]);
        for (const p of items) {
          assert.equal(p.province, '江苏');
          assert.equal(p.paper, '新课标I卷');
          assert.ok(p.material && p.requirements && p.concept && p.source);
          assert.ok(p.reviewPoints.length >= 2 && p.writingTips.length >= 2);
        }
      }
    });

    await check('江苏题库年份筛选严格一致，关键词命中对应年份', async () => {
      for (const year of [2022, 2023, 2024]) {
        const items = await (await fetch(`${base}/api/jiangsu/prompts?year=${year}`)).json();
        assert.equal(items.length, 1);
        assert.equal(items[0].year, year);
      }
      for (const [keyword, year] of [['本手', 2022], ['故事', 2023], ['人工智能', 2024]]) {
        const items = await (
          await fetch(`${base}/api/jiangsu/prompts?keyword=${encodeURIComponent(keyword)}`)
        ).json();
        assert.equal(items.length, 1, `关键词「${keyword}」应只命中 1 条`);
        assert.equal(items[0].year, year);
      }
    });

    await check('非法年份参数返回 400，江苏题目详情可读，不存在 id 返回 404', async () => {
      const invalid = await fetch(`${base}/api/jiangsu/prompts?year=2021`);
      assert.equal(invalid.status, 400);
      assert.equal((await invalid.json()).error.code, 'INVALID_YEAR');

      const detail = await fetch(`${base}/apps/p1/api/prompts/jiangsu-2022`);
      assert.equal(detail.status, 200);
      const body = await detail.json();
      assert.equal(body.title, '本手、妙手、俗手');
      assert.ok(body.material.includes('本手') && body.source.includes('2022'));

      const missing = await fetch(`${base}/api/prompts/jiangsu-9999`);
      assert.equal(missing.status, 404);
      assert.equal((await missing.json()).error.code, 'PROMPT_NOT_FOUND');
    });

    await check('GET /api/zhejiang/prompts 返回浙江 2022/2023/2024 三年数据（根路径与前缀）', async () => {
      for (const prefix of ['', '/apps/p1']) {
        const r = await fetch(`${base}${prefix}/api/zhejiang/prompts`);
        assert.equal(r.status, 200);
        const items = await r.json();
        assert.deepEqual(items.map((p) => p.year), [2022, 2023, 2024]);
        for (const p of items) {
          assert.equal(p.province, '浙江');
          assert.ok(p.paper === '浙江卷' || p.paper === '新课标I卷');
          assert.ok(p.material && p.requirements && p.concept && p.source);
          assert.ok(p.keywords.length >= 3 && p.angles.length >= 3);
          assert.ok(p.structure.sections.length >= 4);
          assert.ok(p.materials.length >= 2 && p.writingTips.length >= 2);
          assert.ok(p.pitfalls.length >= 2 && p.scoringPoints.length >= 3);
        }
      }
    });

    await check('浙江题库年份筛选严格一致，关键词命中对应年份', async () => {
      for (const year of [2022, 2023, 2024]) {
        const items = await (await fetch(`${base}/api/zhejiang/prompts?year=${year}`)).json();
        assert.equal(items.length, 1);
        assert.equal(items[0].year, year);
      }
      for (const [keyword, year] of [['徐枫灿', 2022], ['好的故事', 2023], ['人工智能', 2024]]) {
        const items = await (
          await fetch(`${base}/api/zhejiang/prompts?keyword=${encodeURIComponent(keyword)}`)
        ).json();
        assert.equal(items.length, 1, `关键词「${keyword}」应只命中 1 条`);
        assert.equal(items[0].year, year);
      }
    });

    await check('浙江题目详情可读（含全部指导字段），不存在 id 返回 404', async () => {
      for (const url of ['/api/prompts/zhejiang-2022', '/apps/p1/api/prompts/zhejiang-2024']) {
        const r = await fetch(`${base}${url}`);
        assert.equal(r.status, 200);
        const body = await r.json();
        assert.equal(body.province, '浙江');
        assert.ok(body.material && body.requirements && body.concept);
        assert.ok(body.keywords.length >= 3 && body.angles.length >= 3);
        assert.ok(body.structure.sections.length >= 4 && body.materials.length >= 2);
        assert.ok(body.pitfalls.length >= 2 && body.scoringPoints.length >= 3);
        assert.ok(body.source.includes(String(body.year)) && body.source.includes('浙江'));
      }
      const missing = await fetch(`${base}/api/prompts/zhejiang-9999`);
      assert.equal(missing.status, 404);
      assert.equal((await missing.json()).error.code, 'PROMPT_NOT_FOUND');
    });

    await check('九道内置题均返回完整范文与四维点评，自定义剖析返回配套范文', async () => {
      const ids = [
        'shanghai-2022',
        'shanghai-2023',
        'shanghai-2024',
        'jiangsu-2022',
        'jiangsu-2023',
        'jiangsu-2024',
        'zhejiang-2022',
        'zhejiang-2023',
        'zhejiang-2024',
      ];
      for (const id of ids) {
        const r = await fetch(`${base}/apps/p1/api/prompts/${id}`);
        assert.equal(r.status, 200, `${id} 详情应返回 200`);
        const body = await r.json();
        assert.ok(body.essayTitle && body.essayBody, `${id} 缺少范文`);
        assert.ok([...body.essayBody.replace(/\s/g, '')].length >= 800, `${id} 范文字数不足`);
        assert.equal(body.essayBody.split(/\n\s*\n/).filter(Boolean).length >= 4, true);
        for (const field of ['intention', 'structure', 'language', 'takeaway']) {
          assert.ok(body.essayComment?.[field], `${id} 缺少 ${field} 点评`);
        }
        assert.match(body.essayDisclaimer, /范文仅供学习参考/);
      }

      const analyzed = await fetch(`${base}/apps/p1/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: '好奇心与探索' }),
      });
      assert.equal(analyzed.status, 200);
      const result = await analyzed.json();
      assert.ok(result.angles.length >= 3 && result.outline.length >= 4, '应保留原有立意与结构');
      assert.ok(result.essay?.body, '自定义剖析应返回范文');
      const customChars = Array.from(result.essay.body.replace(/\s/g, '')).length;
      assert.ok(customChars >= 600 && customChars <= 1200, `自定义范文 ${customChars} 字超出范围`);
      assert.match(result.essay.body, /好奇心|探索/, '范文应回应题目关键词');
      assert.match(result.essay.disclaimer, /示范范文，仅供学习参考/);
      for (const field of ['intention', 'structure', 'highlight']) {
        assert.ok(result.review?.[field], `自定义点评缺少 ${field}`);
      }
    });

    const validTopic = '一个人乐意去探索陌生世界，仅仅是因为好奇心吗？';

    await check('POST /api/analyze 合法题目（根路径与前缀）返回 200 且字段完整', async () => {
      for (const prefix of ['', '/apps/p1']) {
        const r = await fetch(`${base}${prefix}/api/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic: validTopic }),
        });
        assert.equal(r.status, 200);
        const body = await r.json();
        assert.equal(body.questionType.name, '思辨关系类');
        assert.ok(body.coreConcepts.length >= 2);
        assert.ok(body.constraints.length >= 3);
        assert.ok(body.angles.length >= 3);
        assert.ok(body.outline.length >= 4);
        assert.ok(body.materials.length >= 2);
        assert.ok(body.writingTips.length >= 3 && body.risks.length >= 3);
        assert.ok(body.essay?.body, '应返回配套范文');
        assert.ok(body.review?.intention && body.review?.structure && body.review?.highlight);
        for (const a of body.angles) assert.ok(a.title && a.level && a.fit && a.description);
        for (const s of body.outline) assert.ok(s.section && s.function && s.ratio && s.guidance);
      }
    });

    await check('POST /api/analyze 空题目 / 纯空白 / 超长 / 非 JSON 均返回 400', async () => {
      const post = (body, contentType = 'application/json') =>
        fetch(`${base}/apps/p1/api/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': contentType },
          body,
        });

      for (const body of ['', '   \n\t ', JSON.stringify({ topic: '' }), JSON.stringify({}), '{oops']) {
        const r = await post(body);
        assert.equal(r.status, 400, `body=${body.slice(0, 20)} 应返回 400`);
        const payload = await r.json();
        assert.ok(payload.error.code && /[\u4e00-\u9fa5]/.test(payload.error.message));
      }

      const tooLong = await post(JSON.stringify({ topic: '好'.repeat(2001) }));
      assert.equal(tooLong.status, 400);
      assert.equal((await tooLong.json()).error.code, 'TOPIC_TOO_LONG');

      const plain = await post('hello', 'text/plain');
      assert.equal(plain.status, 400);
    });

    console.log('[smoke] 运行期 HTTP 冒烟全部通过（真实启动 node server/index.js）：');
    for (const line of results) console.log(line);
    console.log(`[smoke] 共 ${results.length} 项检查，端口 ${port}（等价于容器 8080）。`);
  } finally {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}

main().catch((error) => {
  for (const line of results) console.log(line);
  console.error('[smoke] 冒烟失败：', error.message);
  if (serverStderr.trim()) console.error('[smoke] 服务端 stderr：', serverStderr.trim().slice(0, 1000));
  if (error.stack) console.error(error.stack);
  process.exitCode = 1;
});
