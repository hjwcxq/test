/**
 * 浏览器端验收：真实启动服务并用 Chrome 无头模式验证。
 *
 * 覆盖：根路径与 /apps/p1/ 首页渲染、2024 真题详情（立意与提纲）、
 * 自定义题目页、空输入校验、提交后剖析结果、一键复制反馈与内容、
 * 手机窄屏无横向溢出。若环境没有 Chrome，则执行真实 HTTP 层降级校验
 * （不是空命令占位），并明确打印已验证范围。
 */
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultToText } from '../web/src/exportText.js';
import { resolveVersion } from '../server/version.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const expectedVersion = resolveVersion(process.env);

/** 浏览器工具本身不可用（与应用缺陷无关）时，允许降级到真实 HTTP 校验。 */
class BrowserInfraError extends Error {}

function findChrome() {
  // 允许显式关闭浏览器通道，用于在无 GUI/无 Chrome 的环境验证降级路径。
  if (process.env.BROWSER_CHECK_DISABLE_CHROME === '1') return null;
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
  for (const name of ['google-chrome', 'chromium', 'chromium-browser']) {
    const found = spawnSync('which', [name], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  return null;
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

async function startServer() {
  const port = await freePort();
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i += 1) {
    if (child.exitCode !== null) throw new Error('服务进程提前退出');
    try {
      if ((await fetch(`${base}/health`)).ok) return { child, base };
    } catch {
      // 继续等待
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill('SIGTERM');
  throw new Error('服务未能在限定时间内启动');
}

async function stop(child) {
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function check(label, fn) {
  await fn();
  results.push(`  ✓ ${label}`);
}

function dumpDom(chrome, url) {
  try {
    return execFileSync(
      chrome,
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--virtual-time-budget=9000',
        '--dump-dom',
        url,
      ],
      { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], timeout: 45000 }
    );
  } catch (error) {
    throw new BrowserInfraError(`Chrome --dump-dom 执行失败：${error.message}`);
  }
}

/** 无 Chrome 时的降级：仍做真实 HTTP 校验，不使用空命令冒充验证。 */
async function httpFallback(base) {
  await check('降级验证：健康检查与两个基础路径首页均为 200 HTML', async () => {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).healthy, true);
    for (const url of [`${base}/`, `${base}/apps/p1/`]) {
      const r = await fetch(url);
      assert.equal(r.status, 200, `${url} 应为 200`);
      assert.match(r.headers.get('content-type') || '', /text\/html/);
      assert.match(await r.text(), /<div id="root"><\/div>/);
    }
  });
  await check('降级验证：/apps/p1/ 前缀下剖析接口正常与异常入参', async () => {
    const ok = await fetch(`${base}/apps/p1/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: '一个人乐意去探索陌生世界，仅仅是因为好奇心吗？' }),
    });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.ok(body.angles.length >= 3 && body.outline.length >= 4);
    assert.ok(body.essay?.body, '降级验证应返回配套范文');
    assert.ok(body.review?.intention && body.review?.structure && body.review?.highlight);
    const bad = await fetch(`${base}/apps/p1/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: '   ' }),
    });
    assert.equal(bad.status, 400);
  });
}

async function runCdp(chrome, base, cdpPort, profile) {
  const browser = spawn(
    chrome,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profile}`,
      '--remote-allow-origins=*',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let ws;
  try {
    let version = null;
    for (let i = 0; i < 100; i += 1) {
      try {
        const r = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
        if (r.ok) { version = await r.json(); break; }
      } catch {
        // 继续等待
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (!version) throw new BrowserInfraError('Chrome DevTools 端点未就绪');

    let page;
    try {
      const created = await fetch(
        `http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(`${base}/apps/p1/`)}`,
        { method: 'PUT' }
      );
      page = await created.json();
      if (!page.webSocketDebuggerUrl) throw new Error('响应缺少 webSocketDebuggerUrl');
    } catch (error) {
      throw new BrowserInfraError(`无法创建浏览器页面：${error.message}`);
    }

    try {
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = () => reject(new Error('CDP WebSocket 连接失败'));
        setTimeout(() => reject(new Error('CDP WebSocket 连接超时')), 12000);
      });
    } catch (error) {
      throw new BrowserInfraError(error.message);
    }

    let nextId = 0;
    const pending = new Map();
    let eventHandler = null;
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const entry = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
        else entry.resolve(message.result);
        return;
      }
      if (message.method && eventHandler) eventHandler(message);
    };
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error(`CDP 超时：${method}`));
          }
        }, 15000);
      });
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text + ' ' + (result.exceptionDetails.exception?.description || ''));
      }
      return result.result.value;
    };
    const waitFor = async (expression, label, timeout = 15000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        try {
          if (await evaluate(expression)) return;
        } catch {
          // 继续等待
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      throw new Error(`浏览器等待超时：${label}`);
    };

    await send('Page.enable');
    await send('Runtime.enable');

    // ---- 请求拦截：把地区题库接口挂起，模拟真实的慢加载 / 加载失败场景 ----
    const pausedRequests = [];
    let releasePaused = false;
    let requestMode = 'hold';

    const enableRequestBlocking = async (patterns, mode = 'hold') => {
      pausedRequests.length = 0;
      releasePaused = false;
      requestMode = mode;
      eventHandler = (message) => {
        if (message.method !== 'Fetch.requestPaused') return;
        const { requestId } = message.params;
        if (requestMode === 'fail') {
          send('Fetch.failRequest', { requestId, errorReason: 'Failed' }).catch(() => {});
          return;
        }
        if (releasePaused) {
          send('Fetch.continueRequest', { requestId }).catch(() => {});
        } else {
          pausedRequests.push(requestId);
        }
      };
      await send('Fetch.enable', { patterns });
    };

    const continuePausedRequests = async () => {
      releasePaused = true;
      const ids = pausedRequests.splice(0);
      for (const requestId of ids) {
        await send('Fetch.continueRequest', { requestId }).catch(() => {});
      }
      // 给仍在途的暂停事件留出自动放行的时间，再关闭拦截。
      await new Promise((resolve) => setTimeout(resolve, 250));
      await send('Fetch.disable').catch(() => {});
      eventHandler = null;
    };

    const stopRequestBlocking = async () => {
      eventHandler = null;
      await send('Fetch.disable').catch(() => {});
    };

    const clickBrowseLibrary = async () => {
      const clicked = await evaluate(`
        (() => {
          const target = Array.from(document.querySelectorAll('button'))
            .find((btn) => btn.textContent.trim() === '浏览真题题库');
          if (!target) return false;
          target.click();
          return true;
        })()
      `);
      assert.equal(clicked, true, '首页应存在「浏览真题题库」按钮');
      await new Promise((resolve) => setTimeout(resolve, 250));
    };

    const clickRegionCard = async (name) => {
      const clicked = await evaluate(`
        (() => {
          const card = Array.from(document.querySelectorAll('.region-overview-card'))
            .find((el) => el.querySelector('.region-name')?.textContent.trim() === ${JSON.stringify(name)});
          if (!card) return false;
          card.click();
          return true;
        })()
      `);
      assert.equal(clicked, true, `首页应有「${name}」地区入口`);
    };

    const assertEssayRendered = async (label) => {
      const essay = await evaluate(`
        (() => {
          const section = document.querySelector('.essay-section');
          if (!section) return null;
          return {
            title: section.querySelector('.essay-title')?.innerText || '',
            body: section.querySelector('.essay-body')?.innerText || '',
            paragraphs: section.querySelectorAll('.essay-body p').length,
            comment: section.querySelector('.essay-comment')?.innerText || '',
            disclaimer: section.querySelector('.essay-disclaimer')?.innerText || '',
          };
        })()
      `);
      assert.ok(essay, `${label}应渲染范文板块`);
      assert.ok(essay.title.trim().length >= 2, `${label}范文应有标题`);
      assert.ok(essay.body.trim().length > 300, `${label}范文正文应完整可读，实际 ${essay.body.trim().length} 字`);
      assert.ok(essay.paragraphs >= 4, `${label}范文至少应有 4 个自然段`);
      assert.ok(essay.comment.includes('范文点评'), `${label}应有独立点评区域`);
      assert.ok(essay.comment.trim().length > 40, `${label}点评内容不应为空`);
      assert.ok(essay.disclaimer.includes('范文仅供学习参考'), `${label}应有学习参考声明`);
      return essay;
    };

    await send('Page.navigate', { url: `${base}/apps/p1/` });

    await check('浏览器：/apps/p1/ 首页加载出 9 张真题卡片与三个地区入口', async () => {
      await waitFor("document.querySelectorAll('a.prompt-card').length === 9", '九道真题卡片');
      const text = await evaluate('document.body.innerText');
      for (const year of ['2022', '2023', '2024']) assert.ok(text.includes(year), `首页应含 ${year}`);
      for (const name of ['上海', '江苏', '浙江']) {
        assert.ok(
          await evaluate(
            `Array.from(document.querySelectorAll('.region-name')).some(el => el.textContent.trim() === ${JSON.stringify(name)})`
          ),
          `首页应有独立的「${name}」地区标签`
        );
      }
      assert.ok(text.includes('真题题库'));
    });

    await check('浏览器：首页作文题目输入框加高、宽度自适应、长文可滚动且不遮挡按钮', async () => {
      await waitFor("!!document.querySelector('#home-topic-input')", '首页作文题目输入框');
      const metrics = await evaluate(`
        (() => {
          const ta = document.querySelector('#home-topic-input');
          const card = ta.closest('.input-card');
          const actions = document.querySelector('.quick-analyze .form-actions');
          const taRect = ta.getBoundingClientRect();
          const cardRect = card.getBoundingClientRect();
          const actionsRect = actions.getBoundingClientRect();
          const style = getComputedStyle(ta);
          return {
            rows: ta.rows,
            width: taRect.width,
            height: taRect.height,
            cardWidth: cardRect.width,
            taBottom: taRect.bottom,
            actionsTop: actionsRect.top,
            overflowY: style.overflowY,
            docScrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
          };
        })()
      `);
      assert.ok(metrics.rows >= 10, `默认可见行数应与「再剖析一道题」同标准，实际 rows=${metrics.rows}`);
      assert.ok(metrics.height >= 300, `默认高度应明显增加，实际 ${metrics.height}px`);
      assert.ok(metrics.width > 0 && metrics.width <= metrics.cardWidth + 1, '输入框宽度应随卡片自适应且不溢出');
      assert.equal(metrics.overflowY, 'auto', '内容较多时应在框内滚动');
      assert.ok(metrics.actionsTop >= metrics.taBottom, '输入框不应遮挡下方提交按钮');
      assert.ok(metrics.docScrollWidth <= metrics.innerWidth + 1, '输入框不应造成横向溢出');

      const longText = '长题目内容'.repeat(240);
      const longMetrics = await evaluate(`
        (() => {
          const ta = document.querySelector('#home-topic-input');
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          setter.call(ta, ${JSON.stringify(longText)});
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          const counter = document.querySelector('.quick-analyze .counter').innerText.trim();
          const result = { counter, scrollHeight: ta.scrollHeight, clientHeight: ta.clientHeight };
          setter.call(ta, '');
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          return result;
        })()
      `);
      assert.ok(longMetrics.counter.includes(`${longText.length} / 2000`), `长文计数应正确，实际「${longMetrics.counter}」`);
      assert.ok(longMetrics.scrollHeight > longMetrics.clientHeight, '长文应可在框内滚动查看而不是撑破布局');
    });

    await check('浏览器：页面顶部固定展示「当前版本：vX」，刷新一致且桌面/窄屏不遮挡内容', async () => {
      const readVersion = () =>
        evaluate(`
          (() => {
            const el = document.querySelector('[data-testid="app-version"]');
            if (!el) return null;
            const rect = el.getBoundingClientRect();
            const headerRect = document.querySelector('.site-header').getBoundingClientRect();
            const mainRect = document.querySelector('.main-content').getBoundingClientRect();
            const style = getComputedStyle(el);
            const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return {
              text: el.innerText.trim(),
              visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
              children: el.children.length,
              hitSelf: hit === el || el.contains(hit),
              left: rect.left,
              right: rect.right,
              bottom: rect.bottom,
              headerBottom: headerRect.bottom,
              mainTop: mainRect.top,
              innerWidth: window.innerWidth,
            };
          })()
        `);
      const assertLayout = (info, label) => {
        assert.ok(info && info.visible, `${label}版本号应可见`);
        assert.match(info.text, /当前版本[:：]\s*v/, `${label}应显示「当前版本：vX」，实际「${info?.text}」`);
        assert.equal(info.children, 0, `${label}版本号节点内不应嵌套元素，避免命中测试落到子元素`);
        assert.ok(info.hitSelf, `${label}版本号中心点被其他元素遮挡`);
        assert.ok(info.left >= -1 && info.right <= info.innerWidth + 1, `${label}版本号横向溢出：${JSON.stringify(info)}`);
        assert.ok(info.bottom <= info.mainTop + 1, `${label}版本号不应覆盖主要内容区域`);
      };

      const first = await readVersion();
      assertLayout(first, '桌面端');
      assert.equal(
        first.text,
        `当前版本：${expectedVersion}`,
        `当前交付版本应为 ${expectedVersion}，实际「${first?.text}」`
      );
      assert.ok(
        await evaluate("document.querySelector('[data-testid=\"app-version\"]').closest('.app-version-bar') !== null"),
        '版本号应固定在页面顶部的版本栏内'
      );
      const injectedVersion = await evaluate('window.__APP_VERSION__');
      assert.ok(
        injectedVersion && first.text.includes(injectedVersion),
        `版本号文本应与注入版本一致：文本「${first.text}」，注入「${injectedVersion}」`
      );

      await evaluate('location.reload(); true');
      await waitFor("!!document.querySelector('[data-testid=\"app-version\"]')", '刷新后的版本号');
      const refreshed = await readVersion();
      assert.equal(refreshed.text, first.text, '刷新页面后版本号应保持一致');
      assertLayout(refreshed, '刷新后');

      for (const [width, height, mobile] of [[375, 800, true], [1024, 900, false]]) {
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
        await new Promise((resolve) => setTimeout(resolve, 400));
        const info = await readVersion();
        assertLayout(info, `${width}px `);
        assert.equal(info.text, first.text, `${width}px 下版本号应与桌面端一致`);
        const overflow = await evaluate(
          '({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })'
        );
        assert.ok(
          overflow.scrollWidth <= overflow.innerWidth + 1,
          `${width}px 下版本号导致横向溢出：${JSON.stringify(overflow)}`
        );
      }
      await send('Emulation.clearDeviceMetricsOverride').catch(() => {});
    });

    // 验收方可能在脚本执行完成前就检查元素；版本号必须由服务端直接输出到首屏 HTML。
    await check('浏览器：禁用脚本后版本号仍在首屏可见（不依赖前端渲染）', async () => {
      await send('Emulation.setScriptExecutionDisabled', { value: true });
      try {
        await send('Page.navigate', { url: `${base}/apps/p1/` });
        await waitFor(
          "document.readyState === 'complete' && !!document.querySelector('[data-testid=\"app-version\"]')",
          '无脚本首屏版本号'
        );
        const info = await evaluate(`
          (() => {
            const el = document.querySelector('[data-testid="app-version"]');
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return {
              text: el.innerText.trim(),
              visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
              right: rect.right,
              innerWidth: window.innerWidth,
            };
          })()
        `);
        assert.ok(info.visible, '无脚本时版本号也应可见');
        assert.match(info.text, /当前版本[:：]\s*v/, `无脚本时应显示「当前版本：vX」，实际「${info.text}」`);
        assert.ok(info.right <= info.innerWidth + 1, '无脚本时版本号不应横向溢出');
      } finally {
        await send('Emulation.setScriptExecutionDisabled', { value: false });
        await send('Page.navigate', { url: `${base}/apps/p1/` });
        await waitFor("document.querySelectorAll('a.prompt-card').length === 9", '恢复脚本后的首页');
      }
    });

    await check('浏览器：首页关键文案各自只有一个可见文本节点，避免定位歧义', async () => {
      const counts = await evaluate(`
        (() => {
          const wanted = ['真题题库', '自定义剖析', '写作指导', '范文与点评', '上海', '江苏', '浙江', '2022'];
          const nodes = Array.from(document.querySelectorAll('a, button, span, p, h1, h2, h3, div'));
          return wanted.map((text) => ({
            text,
            count: nodes.filter((el) => el.textContent.trim() === text && el.offsetParent !== null).length,
          }));
        })()
      `);
      for (const item of counts) {
        assert.equal(item.count, 1, `首页「${item.text}」应恰好有一个可见文本节点，实际 ${item.count}`);
      }
    });

    await check('浏览器：卡片与页脚均不含年份来源说明，卡片核心内容完整', async () => {
      const cards = await evaluate(`
        Array.from(document.querySelectorAll('a.prompt-card')).map(card => card.innerText)
      `);
      assert.equal(cards.length, 9, '三套题库共 9 张卡片');
      for (const card of cards) {
        assert.ok(!/内置\s*20\d{2}/.test(card), '卡片不应出现「内置 20XX」来源说明');
        assert.match(card, /\d{4}/, '卡片应保留年份');
        assert.ok(/上海卷|新课标I卷/.test(card), '卡片应保留地区或试卷标签');
        assert.match(card, /查看解题/, '卡片应保留解题入口');
      }
      const footer = await evaluate("document.querySelector('.site-footer').innerText");
      assert.ok(!footer.includes('内置 2022—2024'), '页脚不应出现年份来源说明');
      assert.ok(!/内置\s*20\d{2}/.test(footer), '页脚不应出现任何「内置 20XX」说明');
      assert.ok(footer.includes('把一道题目，拆成可落笔的思路'), '页脚品牌标语应保留');
    });

    await check('浏览器：点击「浏览真题题库」不会离开首页，题库仍然可见', async () => {
      const clicked = await evaluate(`
        (() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const target = buttons.find((btn) => btn.textContent.trim() === '浏览真题题库');
          if (!target) return false;
          target.click();
          return true;
        })()
      `);
      assert.equal(clicked, true, '首页应存在「浏览真题题库」按钮');
      await new Promise((resolve) => setTimeout(resolve, 600));
      const state = await evaluate(`
        ({
          hash: window.location.hash,
          text: document.body.innerText,
          cards: document.querySelectorAll('a.prompt-card').length,
        })
      `);
      assert.equal(state.hash, '', '点击浏览题库不应修改 hash 路由');
      assert.ok(!state.text.includes('页面不存在'), '不应渲染「页面不存在」');
      assert.ok(state.text.includes('真题题库'), '题库标题应仍然可见');
      assert.equal(state.cards, 9, '题库卡片应仍然存在');
    });

    await check('浏览器：关键词检索无结果时给出明确空状态提示', async () => {
      await evaluate(`
        (() => {
          const input = document.querySelector('.search-box input');
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(input, 'zzz-no-such-prompt');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        })()
      `);
      await waitFor("document.body.innerText.includes('没有找到匹配的题目')", '空状态');
      assert.equal(await evaluate("document.querySelectorAll('a.prompt-card').length"), 0);
      await evaluate(
        "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('清除筛选条件')).click(); true"
      );
      await waitFor("document.querySelectorAll('a.prompt-card').length === 9", '恢复题目列表');
    });

    await check('浏览器：点击江苏地区入口进入江苏真题，按年份筛选与关键词检索', async () => {
      await evaluate(
        "Array.from(document.querySelectorAll('.region-overview-card')).find(a=>a.querySelector('.region-name').textContent.trim()==='江苏').click(); true"
      );
      await waitFor("document.body.innerText.includes('江苏真题') || document.body.innerText.includes('审题立意与写作提示')", '江苏入口跳转');
      assert.ok((await evaluate('document.body.innerText')).includes('江苏'));

      await evaluate("location.hash='#/'; true");
      await waitFor("document.querySelectorAll('a.prompt-card').length === 9", '返回九题首页');

      let text = await evaluate('document.body.innerText');
      for (const needle of ['本手、妙手、俗手', '故事的力量', '答案与问题', '新课标I卷']) {
        assert.ok(text.includes(needle), `江苏题库应含「${needle}」`);
      }

      await evaluate(
        "Array.from(document.querySelectorAll('.year-filters button')).find(b=>b.textContent.trim()==='2022').click(); true"
      );
      await waitFor("document.querySelectorAll('a.prompt-card').length === 3", '2022 筛选出三地区各一题');
      text = await evaluate(
        "Array.from(document.querySelectorAll('a.prompt-card')).map(a=>a.innerText).join('\\n')"
      );
      assert.ok(text.includes('本手') && !text.includes('故事的力量'), '2022 筛选应只显示 2022 年题');

      const setSearch = async (value) => {
        await evaluate(`
          (() => {
            const input = document.querySelector('.search-box input');
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(input, ${JSON.stringify(value)});
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          })()
        `);
      };

      await setSearch('本手');
      await waitFor("document.querySelectorAll('a.prompt-card').length === 2", '搜索本手');
      text = await evaluate(
        "Array.from(document.querySelectorAll('a.prompt-card')).map(a=>a.innerText).join('\\n')"
      );
      assert.ok(text.includes('本手、妙手、俗手') && text.includes('2022'), '搜索「本手」应命中 2022 年江苏题');

      await setSearch('故事');
      await waitFor(
        "document.querySelectorAll('a.prompt-card').length === 0 && document.body.innerText.includes('没有找到匹配的题目')",
        '年份与关键词共同筛选出现空状态'
      );
      await evaluate(
        "Array.from(document.querySelectorAll('.year-filters button')).find(b=>b.textContent.trim()==='全部年份').click(); true"
      );
      await waitFor("document.querySelectorAll('a.prompt-card').length === 2", '搜索故事');
      text = await evaluate(
        "Array.from(document.querySelectorAll('a.prompt-card')).map(a=>a.innerText).join('\\n')"
      );
      assert.ok(text.includes('故事的力量') && text.includes('2023'), '搜索「故事」应命中 2023 年题');

      await setSearch('人工智能');
      await waitFor("document.querySelectorAll('a.prompt-card').length === 2", '搜索人工智能');
      text = await evaluate(
        "Array.from(document.querySelectorAll('a.prompt-card')).map(a=>a.innerText).join('\\n')"
      );
      assert.ok(text.includes('答案与问题') && text.includes('2024'), '搜索「人工智能」应命中 2024 年题');
    });

    await check('浏览器：江苏真题详情完整展示材料、要求、审题立意、写作提示与来源', async () => {
      await evaluate("location.hash='#/prompts/jiangsu-2024'; true");
      await waitFor("document.body.innerText.includes('审题立意与写作提示')", '江苏详情页');
      const text = await evaluate('document.body.innerText');
      for (const needle of [
        '题目材料',
        '写作要求',
        '审题立意',
        '写作提示',
        '来源',
        '越来越多的问题能很快得到答案',
        '不少于800字',
        '2024年普通高等学校招生全国统一考试',
        '新课标I卷',
        '精彩范文',
        '范文点评',
        '范文仅供学习参考',
      ]) {
        assert.ok(text.includes(needle), `江苏详情应含「${needle}」`);
      }
      assert.ok((await evaluate("document.querySelectorAll('.outline-row').length")) >= 2);
      assert.ok((await evaluate("document.querySelectorAll('.number-list li').length")) >= 2);
      assert.ok((await evaluate("document.querySelectorAll('.essay-section .essay-body p').length")) >= 4);
      assert.ok(await evaluate("!!document.querySelector('.essay-section .essay-title')"));
      const materialText = await evaluate("document.querySelector('.material-text').innerText");
      assert.ok(
        materialText.includes('越来越多的问题能很快得到答案') && materialText.includes('以上材料引发了你怎样的联想和思考'),
        '长材料应完整展示，不能被截断'
      );
      assert.equal(
        await evaluate("(() => { const el = document.querySelector('.material-text'); return el.scrollHeight > el.clientHeight + 1; })()"),
        false,
        '材料区域不应出现内容裁切'
      );
    });

    await check('浏览器：点击浙江地区入口，进入该地区最新真题', async () => {
      await evaluate("location.hash='#/'; true");
      await waitFor("document.body.innerText.includes('真题题库')", '返回首页');

      const text = await evaluate('document.body.innerText');
      for (const needle of ['创新时代的青年担当', '故事的力量', '答案与问题', '浙江卷', '新课标I卷']) {
        assert.ok(text.includes(needle), `浙江题库应含「${needle}」`);
      }
      // 地区内卡片按年份从近到远排列
      const cards = await evaluate(
        "Array.from(document.querySelectorAll('#region-zhejiang a.prompt-card')).map(a => a.innerText)"
      );
      assert.equal(cards.length, 3, '浙江应有 3 张卡片');
      assert.ok(cards[0].includes('2024') && cards[1].includes('2023') && cards[2].includes('2022'), '浙江卡片应按年份从近到远排列');

      await evaluate(
        "Array.from(document.querySelectorAll('.region-overview-card')).find(a=>a.querySelector('.region-name').textContent.trim()==='浙江').click(); true"
      );
      await waitFor("document.body.innerText.includes('审题立意与写作指导')", '浙江真题详情');
      assert.ok((await evaluate('document.body.innerText')).includes('答案与问题'));
    });

    await check('浏览器：浙江真题详情完整展示材料、要求与全部写作指导字段', async () => {
      await evaluate("location.hash='#/prompts/zhejiang-2024'; true");
      await waitFor("document.body.innerText.includes('审题立意与写作指导')", '浙江详情页');
      const text = await evaluate('document.body.innerText');
      for (const needle of [
        '作文材料',
        '写作要求',
        '审题立意',
        '关键词拆解',
        '立意方向',
        '结构提纲',
        '素材与表达建议',
        '常见误区',
        '评分关注点',
        '来源与核验',
        '人工智能',
        '不少于800字',
        '2024年普通高等学校招生全国统一考试',
        '精彩范文',
        '范文点评',
        '范文仅供学习参考',
      ]) {
        assert.ok(text.includes(needle), `浙江详情应含「${needle}」`);
      }
      assert.ok((await evaluate("document.querySelectorAll('.angle-card').length")) >= 3);
      assert.ok((await evaluate("document.querySelectorAll('.outline-row').length")) >= 4);
      assert.ok((await evaluate("document.querySelectorAll('.mini-card').length")) >= 4);
      assert.ok((await evaluate("document.querySelectorAll('.essay-section .essay-body p').length")) >= 4);

      await evaluate("location.hash='#/prompts/zhejiang-2022'; true");
      await waitFor("document.body.innerText.includes('创新时代的青年担当')", '浙江 2022 直达');
      const old = await evaluate('document.body.innerText');
      assert.ok(old.includes('徐枫灿') && old.includes('浙江卷'), '浙江 2022 直达详情应完整');
    });

    await check('浏览器：不存在的江苏题目 id 与非法年份参数均显示友好提示', async () => {
      await evaluate("location.hash='#/prompts/jiangsu-9999'; true");
      await waitFor("document.body.innerText.includes('未找到该题目')", '不存在 id 提示');
      let text = await evaluate('document.body.innerText');
      assert.ok(text.includes('解题内容加载失败') && text.includes('返回题目库'));

      await evaluate("location.hash='#/?year=2021'; true");
      await waitFor("document.body.innerText.includes('年份参数无效')", '非法年份提示');
      text = await evaluate('document.body.innerText');
      assert.ok(text.includes('全部年份') && text.includes('真题题库'), '非法年份后应回退到全部年份');
      await waitFor("document.querySelectorAll('a.prompt-card').length === 9", '非法年份不隐藏题目');

      await evaluate("location.hash='#/'; location.reload(); true");
      await waitFor("document.body.innerText.includes('真题题库')", '返回真题题库');
    });

    await check('浏览器：进入 2024 真题详情，查看立意与提纲', async () => {
      await evaluate(
        "Array.from(document.querySelectorAll('a.prompt-card')).find(a=>a.textContent.includes('认可度')).click(); true"
      );
      await waitFor("document.body.innerText.includes('立意角度分层')", '详情页');
      const text = await evaluate('document.body.innerText');
      for (const needle of [
        '题目原文',
        '审题要点',
        '关键词拆解',
        '结构框架',
        '素材方向',
        '常见偏题误区与升格建议',
        '高度切题',
        '精彩范文',
        '范文点评',
        '范文仅供学习参考',
      ]) {
        assert.ok(text.includes(needle), `详情应含「${needle}」`);
      }
      assert.ok((await evaluate("document.querySelectorAll('.angle-card').length")) >= 3);
      assert.ok((await evaluate("document.querySelectorAll('.outline-row').length")) >= 4);
      assert.ok((await evaluate("document.querySelectorAll('.essay-section .essay-body p').length")) >= 4);
      const essayTitle = await evaluate("document.querySelector('.essay-section .essay-title').innerText");
      assert.ok(essayTitle.length >= 2, '范文应有标题');

      // 切换内置题目后，范文标题与正文应同步更新，不能残留上一篇内容。
      await evaluate("location.hash='#/prompts/shanghai-2023'; true");
      await waitFor("document.body.innerText.includes('好奇心与探索陌生世界')", '切换到 2023 真题');
      const nextTitle = await evaluate("document.querySelector('.essay-section .essay-title').innerText");
      assert.notEqual(nextTitle, essayTitle, '切换题目后范文标题应更新');
      const nextBody = await evaluate("document.querySelector('.essay-section .essay-body').innerText");
      assert.ok(nextBody.includes('好奇心'), '切换题目后范文内容应对应新题目');
      assert.ok(!nextBody.includes('认可度'), '切换题目后不应残留上一题范文');
    });

    await check('浏览器：返回首页并进入自定义剖析页，字数统计与示例可见', async () => {
      await evaluate("location.hash='#/'; true");
      await waitFor("document.body.innerText.includes('真题题库')", '返回首页');
      await evaluate("location.hash='#/analyze'; true");
      await waitFor("!!document.querySelector('#topic-input')", '剖析页');
      const text = await evaluate('document.body.innerText');
      for (const needle of ['示例一键填充', '开始分析', '2000 字', '清空']) {
        assert.ok(text.includes(needle), `剖析页应含「${needle}」`);
      }
    });

    await check('浏览器：示例一键填充后字数统计更新', async () => {
      await evaluate("document.querySelector('.example-chips .chip').click(); true");
      await waitFor("document.querySelector('#topic-input').value.length > 20", '示例填充');
      const text = await evaluate('document.body.innerText');
      assert.match(text, /\/ 2000 字/);
    });

    await check('浏览器：超过 2000 字输入被拦截并提示', async () => {
      await evaluate(`
        (() => {
          const ta = document.querySelector('#topic-input');
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          setter.call(ta, '好'.repeat(2001));
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        })()
      `);
      await evaluate(
        "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('开始分析')).click(); true"
      );
      await waitFor("!!document.querySelector('.field-error')", '超长校验');
      const message = await evaluate("document.querySelector('.field-error').innerText");
      assert.match(message, /不能超过 2000 字/);
    });

    await check('浏览器：空题目提交出现中文校验提示', async () => {
      await evaluate(`
        (() => {
          const ta = document.querySelector('#topic-input');
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          setter.call(ta, '   ');
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        })()
      `);
      await evaluate(
        "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('开始分析')).click(); true"
      );
      await waitFor("!!document.querySelector('.field-error')", '校验提示');
      const message = await evaluate("document.querySelector('.field-error').innerText");
      assert.match(message, /请输入作文题目/);
    });

    await check('浏览器：示例填充后提交，剖析结果含题型 / 概念 / ≥3 立意 / 分段提纲', async () => {
      await evaluate(`
        (() => {
          const ta = document.querySelector('#topic-input');
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          setter.call(ta, '一个人乐意去探索陌生世界，仅仅是因为好奇心吗？请写一篇文章，谈谈你对这个问题的认识和思考。');
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        })()
      `);
      assert.ok((await evaluate("document.querySelector('#topic-input').value.length")) > 10);
      await evaluate(
        "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='开始分析').click(); true"
      );
      await waitFor("location.hash.includes('/result')", '跳转到结果页', 120000);
      await waitFor("document.body.innerText.includes('分段提纲')", '结果页内容', 20000);
      const text = await evaluate('document.body.innerText');
      for (const needle of ['思辨关系类', '核心概念', '限制条件', '立意角度', '结构思路', '范文', '范文点评', '写作建议', '风险提示']) {
        assert.ok(text.includes(needle), `结果页应含「${needle}」`);
      }
      assert.ok((await evaluate("document.querySelectorAll('.angle-card').length")) >= 3);
      assert.ok((await evaluate("document.querySelectorAll('.outline-row').length")) >= 4);
      assert.ok((await evaluate("document.querySelectorAll('[data-testid=\"custom-essay\"]').length")) >= 1);
      const customEssay = await evaluate("document.querySelector('[data-testid=\"custom-essay\"]').innerText");
      assert.ok(customEssay.includes('好奇心'), '自定义范文应回应题目关键词');
      assert.ok(customEssay.length >= 600, '自定义范文应为完整成篇内容');
      const customReview = await evaluate("document.querySelector('[data-testid=\"custom-essay-review\"]').innerText");
      for (const label of ['立意', '结构', '亮点']) {
        assert.ok(customReview.includes(label), `范文点评应含「${label}」`);
      }
    });

    await check('浏览器：结果页「再剖析一道题」输入框默认加高、随卡片自适应且不遮挡按钮', async () => {
      await waitFor("!!document.querySelector('#result-topic-input')", '结果页再剖析输入框');
      const metrics = await evaluate(`
        (() => {
          const ta = document.querySelector('#result-topic-input');
          const card = ta.closest('.input-card');
          const button = card.querySelector('[data-testid="analyze-button"]');
          const taRect = ta.getBoundingClientRect();
          const cardRect = card.getBoundingClientRect();
          const btnRect = button.getBoundingClientRect();
          return {
            rows: ta.rows,
            height: taRect.height,
            width: taRect.width,
            cardWidth: cardRect.width,
            bottom: taRect.bottom,
            buttonTop: btnRect.top,
            role: ta.tagName.toLowerCase(),
          };
        })()
      `);
      assert.equal(metrics.role, 'textarea', '题目输入应仍是多行 textarea');
      assert.ok(metrics.rows >= 10, `默认可见行数应明显增加，实际 rows=${metrics.rows}`);
      assert.ok(metrics.height >= 300, `默认高度应明显增大，实际 ${metrics.height}px`);
      assert.ok(metrics.width <= metrics.cardWidth, `输入框不应超出卡片，实际 ${metrics.width}/${metrics.cardWidth}`);
      assert.ok(
        metrics.width >= metrics.cardWidth - 60,
        `输入框宽度应随卡片自适应，实际 ${metrics.width}/${metrics.cardWidth}`
      );
      assert.ok(
        metrics.bottom <= metrics.buttonTop,
        '输入框不应遮挡「开始分析」按钮'
      );

      // 窄屏与桌面下都应随卡片自适应，且不产生横向溢出。
      for (const width of [375, 1024]) {
        await send('Emulation.setDeviceMetricsOverride', {
          width,
          height: 900,
          deviceScaleFactor: 1,
          mobile: width < 600,
        });
        await new Promise((resolve) => setTimeout(resolve, 400));
        const layout = await evaluate(`
          (() => {
            const ta = document.querySelector('#result-topic-input');
            const card = ta.closest('.input-card');
            const button = card.querySelector('[data-testid="analyze-button"]');
            const taRect = ta.getBoundingClientRect();
            const cardRect = card.getBoundingClientRect();
            return {
              width: taRect.width,
              cardWidth: cardRect.width,
              height: taRect.height,
              bottom: taRect.bottom,
              buttonTop: button.getBoundingClientRect().top,
              pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
            };
          })()
        `);
        assert.ok(layout.pageOverflow <= 1, `${width}px 下页面横向溢出：${layout.pageOverflow}px`);
        assert.ok(layout.width <= layout.cardWidth, `${width}px 下输入框超出卡片`);
        assert.ok(
          layout.width >= layout.cardWidth - 60,
          `${width}px 下输入框宽度未随卡片自适应：${layout.width}/${layout.cardWidth}`
        );
        assert.ok(layout.height >= 300, `${width}px 下输入框高度不足：${layout.height}px`);
        assert.ok(layout.bottom <= layout.buttonTop, `${width}px 下输入框遮挡「开始分析」按钮`);
      }
      await send('Emulation.clearDeviceMetricsOverride').catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    await check('浏览器：结果页输入接近 2000 字时字数统计正常且输入框不溢出', async () => {
      await evaluate(`
        (() => {
          const ta = document.querySelector('#result-topic-input');
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          setter.call(ta, '题'.repeat(1995));
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        })()
      `);
      await waitFor("document.querySelector('.counter').innerText.includes('1995')", '接近上限的字数统计');
      const state = await evaluate(`
        (() => {
          const ta = document.querySelector('#result-topic-input');
          const card = ta.closest('.input-card');
          return {
            counter: document.querySelector('.counter').innerText,
            warn: !!card.querySelector('.field-warn'),
            error: !!card.querySelector('.field-error'),
            overflowX: ta.scrollWidth - ta.clientWidth,
            pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
            height: ta.getBoundingClientRect().height,
          };
        })()
      `);
      assert.match(state.counter, /1995 \/ 2000 字/, '应保留 2000 字上限计数');
      assert.ok(!state.warn, '未超上限不应出现超长警告');
      assert.ok(!state.error, '未超上限不应出现校验错误');
      assert.ok(state.overflowX <= 1, `长文本不应横向溢出，实际 ${state.overflowX}px`);
      assert.ok(state.height >= 300, `长文本下输入框高度应保持，实际 ${state.height}px`);
    });

    await check('浏览器：结果页换题重新生成时先显示范文加载态，更新后不残留上一题范文', async () => {
      // 人为延迟接口，确保能观察到「正在生成范文…」加载态。
      await evaluate(`
        window.__BC_ORIG_FETCH = window.fetch;
        window.fetch = (...args) => new Promise((resolve, reject) => {
          setTimeout(() => window.__BC_ORIG_FETCH(...args).then(resolve, reject), 1200);
        });
        true
      `);

      const fillResultTopic = async (value) => {
        await evaluate(`
          (() => {
            const ta = document.querySelector('[data-testid="custom-topic-input"]');
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
            setter.call(ta, ${JSON.stringify(value)});
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          })()
        `);
        await evaluate("document.querySelector('[data-testid=\"analyze-button\"]').click(); true");
      };

      await fillResultTopic('星火码头的去留应如何权衡？');
      await waitFor("document.body.innerText.includes('正在生成范文…')", '范文加载态', 30000);
      assert.equal(
        await evaluate("document.querySelectorAll('[data-testid=\"custom-essay\"]').length"),
        0,
        '加载期间不应展示旧范文或空白占位'
      );
      await waitFor(
        "document.body.innerText.includes('星火码头') && !!document.querySelector('[data-testid=\"custom-essay\"]')",
        '第一题范文出现',
        120000
      );
      assert.ok(!(await evaluate('document.body.innerText')).includes('正在生成范文…'), '范文出现后加载态应消失');

      await fillResultTopic('青禾书院的传统手工艺如何传承？');
      await waitFor(
        "document.querySelector('[data-testid=\"custom-essay\"]')?.innerText.includes('青禾书院')",
        '第二题范文更新',
        120000
      );
      const updatedText = await evaluate('document.body.innerText');
      assert.ok(updatedText.includes('青禾书院'));
      assert.ok(!updatedText.includes('星火码头'), '新题目生成后不应残留上一题范文');

      await evaluate('window.fetch = window.__BC_ORIG_FETCH; true');
    });

    let clipboardGranted = false;
    try {
      await send('Browser.grantPermissions', {
        origin: base,
        permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
      });
      clipboardGranted = true;
    } catch {
      clipboardGranted = false;
    }

    await check('浏览器：一键复制给出反馈，导出文本含立意与提纲', async () => {
      await evaluate("document.querySelector('.copy-btn').click(); true");
      await new Promise((resolve) => setTimeout(resolve, 700));
      const feedback = await evaluate("document.querySelector('.copy-btn').innerText");
      assert.ok(/已复制|复制失败/.test(feedback), '复制按钮必须给出反馈');
      if (clipboardGranted) {
        assert.match(feedback, /已复制/);
        const copied = await evaluate('navigator.clipboard.readText()');
        assert.ok(copied.includes('立意方向') && copied.includes('分段提纲'), '复制内容应含立意与提纲');
      }
      // 导出文本生成逻辑本身也做一次独立校验
      const exported = resultToText({
        topic: '测试题目',
        questionType: { name: '思辨关系类', summary: '', reason: '' },
        coreConcepts: [{ term: '好奇心', role: '题眼概念', explanation: '说明' }],
        constraints: ['约束'],
        angles: [{ title: '立意一', level: '基础', fit: '切题', description: '描述' }],
        outline: [{ section: '开头', function: '破题', ratio: '10%', guidance: '提示' }],
        materials: [], writingTips: [], risks: [], engine: 'local',
      });
      assert.ok(exported.includes('立意方向') && exported.includes('分段提纲'));
    });

    await check('浏览器：接口/网络失败时展示可重试错误态而非白屏', async () => {
      await evaluate("location.hash='#/analyze'; true");
      await waitFor("!!document.querySelector('#topic-input')", '重新进入剖析页');
      await evaluate(`
        (() => {
          const ta = document.querySelector('#topic-input');
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          setter.call(ta, '一个人乐意去探索陌生世界，仅仅是因为好奇心吗？');
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          window.__origFetch = window.fetch;
          window.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
          return true;
        })()
      `);
      await evaluate(
        "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('开始分析')).click(); true"
      );
      await waitFor("document.body.innerText.includes('重试剖析')", '错误态与重试按钮');
      const text = await evaluate('document.body.innerText');
      assert.ok(text.includes('剖析失败') && text.includes('网络连接失败'), '错误态应给出明确文案');
      await evaluate('window.fetch = window.__origFetch; true');
      await evaluate('location.reload(); true');
      await waitFor("!!document.querySelector('#topic-input')", '恢复后页面可用');
    });

    await check('浏览器：375px 手机窄屏与 1024px 桌面宽度均无横向溢出', async () => {
      for (const [width, height, mobile] of [[375, 800, true], [1024, 900, false]]) {
        await send('Emulation.setDeviceMetricsOverride', {
          width,
          height,
          deviceScaleFactor: 1,
          mobile,
        });
        await new Promise((resolve) => setTimeout(resolve, 400));
        const layout = await evaluate(
          '({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })'
        );
        assert.ok(
          layout.scrollWidth <= layout.innerWidth + 1,
          `${width}px 下页面横向溢出：${JSON.stringify(layout)}`
        );
      }
    });

    await check('浏览器：375px / 1024px 下江苏真题详情无横向溢出', async () => {
      await evaluate("location.hash='#/prompts/jiangsu-2022'; true");
      await waitFor("document.body.innerText.includes('审题立意与写作提示')", '江苏详情页');
      for (const [width, height] of [[375, 800], [1024, 900]]) {
        await send('Emulation.setDeviceMetricsOverride', {
          width,
          height,
          deviceScaleFactor: 1,
          mobile: width < 600,
        });
        await new Promise((resolve) => setTimeout(resolve, 400));
        const layout = await evaluate(
          '({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })'
        );
        assert.ok(
          layout.scrollWidth <= layout.innerWidth + 1,
          `${width}px 下江苏详情横向溢出：${JSON.stringify(layout)}`
        );
      }
    });

    await check('浏览器：375px / 1024px 下浙江真题详情无横向溢出', async () => {
      await evaluate("location.hash='#/prompts/zhejiang-2024'; true");
      await waitFor("document.body.innerText.includes('评分关注点')", '浙江详情页');
      for (const [width, height] of [[375, 800], [1024, 900]]) {
        await send('Emulation.setDeviceMetricsOverride', {
          width,
          height,
          deviceScaleFactor: 1,
          mobile: width < 600,
        });
        await new Promise((resolve) => setTimeout(resolve, 400));
        const layout = await evaluate(
          '({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })'
        );
        assert.ok(
          layout.scrollWidth <= layout.innerWidth + 1,
          `${width}px 下浙江详情横向溢出：${JSON.stringify(layout)}`
        );
      }
    });

    await check('浏览器：375px / 1024px 下上海真题范文详情无横向溢出', async () => {
      await evaluate("location.hash='#/prompts/shanghai-2024'; true");
      await waitFor("document.body.innerText.includes('精彩范文')", '上海范文详情');
      for (const [width, height] of [[375, 800], [1024, 900]]) {
        await send('Emulation.setDeviceMetricsOverride', {
          width,
          height,
          deviceScaleFactor: 1,
          mobile: width < 600,
        });
        await new Promise((resolve) => setTimeout(resolve, 400));
        const layout = await evaluate(
          '({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })'
        );
        assert.ok(
          layout.scrollWidth <= layout.innerWidth + 1,
          `${width}px 下上海详情横向溢出：${JSON.stringify(layout)}`
        );
      }
      assert.ok((await evaluate("document.querySelectorAll('.essay-section .essay-body p').length")) >= 4);
    });

    await check('浏览器：键盘 Enter 可激活江苏地区入口', async () => {
      await evaluate("location.hash='#/'; true");
      await waitFor("document.body.innerText.includes('真题题库')", '返回首页');
      await evaluate(
        "(() => { const a = Array.from(document.querySelectorAll('.region-overview-card')).find(x=>x.querySelector('.region-name').textContent.trim()==='江苏'); a.focus(); return document.activeElement === a; })()"
      );
      await send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        key: 'Enter',
        code: 'Enter',
        text: '\r',
        unmodifiedText: '\r',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      });
      await send('Input.dispatchKeyEvent', {
        type: 'char',
        key: 'Enter',
        code: 'Enter',
        text: '\r',
        unmodifiedText: '\r',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      });
      await send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      });
      await waitFor("document.body.innerText.includes('审题立意与写作提示')", '键盘激活江苏入口');
      assert.ok((await evaluate('document.body.innerText')).includes('江苏'));
    });

    await check('浏览器：江苏详情可直接切换到浙江详情并看到范文点评入口', async () => {
      await evaluate("location.hash='#/prompts/jiangsu-2024'; true");
      await waitFor("document.body.innerText.includes('审题立意与写作提示')", '江苏详情页');
      await evaluate(
        "Array.from(document.querySelectorAll('.detail-nav-btn')).find(b=>b.textContent.trim()==='浙江').click(); true"
      );
      await waitFor("document.body.innerText.includes('审题立意与写作指导')", '浙江详情页');
      const counts = await evaluate(`
        (() => {
          const nodes = Array.from(document.querySelectorAll('a, button, span, p, h1, h2, h3, div'));
          return ['范文', '点评'].map((text) => ({
            text,
            count: nodes.filter((el) => el.textContent.trim() === text && el.offsetParent !== null).length,
          }));
        })()
      `);
      for (const item of counts) {
        assert.equal(item.count, 1, `浙江详情「${item.text}」应可见且唯一`);
      }
      assert.ok((await evaluate('document.body.innerText')).includes('精彩范文'));
    });

    await check('浏览器：首页空题目提交提示「请输入作文题目」且不发请求', async () => {
      await evaluate("location.hash='#/'; true");
      await waitFor("!!document.querySelector('#home-topic-input')", '首页自定义题目输入框');
      await evaluate("document.querySelector('#home-topic-input').value = ''; true");
      await evaluate(
        "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='开始分析').click(); true"
      );
      await waitFor("!!document.querySelector('.field-error')", '首页空题目校验');
      const message = await evaluate("document.querySelector('.field-error').innerText");
      assert.ok(message.includes('请输入作文题目'), '应提示请输入作文题目');
    });

    await check('浏览器：首页输入合成题目「关于坚持与变通」可生成剖析结果', async () => {
      await evaluate(`
        (() => {
          const ta = document.querySelector('#home-topic-input');
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          setter.call(ta, '关于坚持与变通');
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        })()
      `);
      await evaluate(
        "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='开始分析').click(); true"
      );
      await waitFor("location.hash.includes('/result')", '首页剖析结果页', 120000);
      await waitFor("document.body.innerText.includes('分段提纲')", '首页剖析结果内容', 20000);
      const text = await evaluate('document.body.innerText');
      for (const needle of ['关于坚持与变通', '核心概念', '立意方向', '分段提纲']) {
        assert.ok(text.includes(needle), `首页剖析结果应含「${needle}」`);
      }
    });

    await check('浏览器：点击「上海」地区标签进入详情，首屏可见写作指导 / 范文 / 点评入口', async () => {
      await evaluate("location.hash='#/'; true");
      await waitFor("document.querySelectorAll('.region-name').length === 3", '三地区入口');
      await new Promise((resolve) => setTimeout(resolve, 300));
      await evaluate(
        "Array.from(document.querySelectorAll('.region-name')).find(el=>el.textContent.trim()==='上海').closest('a').click(); true"
      );
      await waitFor("document.body.innerText.includes('立意角度分层')", '上海真题详情');
      const visible = await evaluate(`
        (() => {
          const wanted = ['上海', '江苏', '浙江', '写作指导', '范文', '点评'];
          const nodes = Array.from(document.querySelectorAll('a, button, span, p, h1, h2, h3, div'));
          return wanted.map((text) => ({
            text,
            count: nodes.filter((el) => el.textContent.trim() === text && el.offsetParent !== null).length,
          }));
        })()
      `);
      for (const item of visible) {
        assert.equal(item.count, 1, `详情页「${item.text}」应恰好有一个可见文本节点，实际 ${item.count}`);
      }
    });

    await check('浏览器：题库加载失败展示错误提示与重试入口，重试后恢复九题', async () => {
      await evaluate("location.hash='#/analyze'; true");
      await waitFor("!!document.querySelector('#topic-input')", '剖析页');
      await evaluate(`
        (() => {
          window.__origFetch = window.fetch;
          window.fetch = (...args) => Promise.reject(new TypeError('Failed to fetch'));
          location.hash = '#/';
          return true;
        })()
      `);
      await waitFor("document.body.innerText.includes('真题题库加载失败')", '题库加载失败提示');
      let text = await evaluate('document.body.innerText');
      assert.ok(text.includes('重新加载'), '应提供重试入口');
      assert.equal(await evaluate("document.querySelectorAll('a.prompt-card').length"), 0);

      await evaluate('window.fetch = window.__origFetch; true');
      await evaluate(
        "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='重新加载').click(); true"
      );
      await waitFor("document.querySelectorAll('a.prompt-card').length === 9", '重试后恢复九题');
      text = await evaluate('document.body.innerText');
      assert.ok(text.includes('真题题库') && text.includes('上海') && text.includes('江苏') && text.includes('浙江'));
    });

    await check('浏览器回归（正常）：从「浏览真题题库」进入，点击江苏、浙江均到达真实详情', async () => {
      await send('Emulation.clearDeviceMetricsOverride').catch(() => {});
      await send('Page.navigate', { url: `${base}/apps/p1/` });
      await waitFor("document.querySelectorAll('a.prompt-card').length === 9", '首页九题');

      await clickBrowseLibrary();
      assert.equal(await evaluate('window.location.hash'), '', '点击浏览题库不应改变路由');

      await clickRegionCard('江苏');
      await waitFor("document.body.innerText.includes('审题立意与写作提示')", '江苏真题详情');
      let text = await evaluate('document.body.innerText');
      assert.ok(text.includes('答案与问题'), '江苏入口应进入该地区最近一年真题');
      await assertEssayRendered('江苏');

      await evaluate("location.hash='#/'; true");
      await waitFor("document.querySelectorAll('a.prompt-card').length === 9", '返回首页');
      await clickBrowseLibrary();
      await clickRegionCard('浙江');
      await waitFor("document.body.innerText.includes('审题立意与写作指导')", '浙江真题详情');
      text = await evaluate('document.body.innerText');
      assert.ok(text.includes('答案与问题'), '浙江入口应进入该地区最近一年真题');
      await assertEssayRendered('浙江');
    });

    await check('浏览器回归（慢加载）：阻塞江苏接口时，入口首屏 href 稳定并在释放后到达真实详情', async () => {
      await enableRequestBlocking([
        { urlPattern: '*/api/jiangsu/prompts*', requestStage: 'Request' },
        { urlPattern: '*/api/zhejiang/prompts*', requestStage: 'Request' },
      ]);
      await send('Page.navigate', { url: `${base}/apps/p1/` });

      // 地区接口被挂起时，首页仍应渲染三个地区入口，且 href 不能退化成 #/。
      await waitFor("document.querySelectorAll('.region-overview-card').length === 3", '首屏地区入口');
      await waitFor("document.body.innerText.includes('正在载入真题题库')", '首页加载态');
      const jiangsuHref = await evaluate(`
        Array.from(document.querySelectorAll('.region-overview-card'))
          .find((el) => el.querySelector('.region-name')?.textContent.trim() === '江苏')
          ?.getAttribute('href') || ''
      `);
      assert.ok(jiangsuHref.includes('/region/jiangsu'), `江苏入口首屏 href 应指向稳定地区路由，实际「${jiangsuHref}」`);

      await clickBrowseLibrary();
      assert.equal(await evaluate('window.location.hash'), '', '点击浏览题库不应改变路由');
      await clickRegionCard('江苏');
      await waitFor("window.location.hash === '#/region/jiangsu'", '江苏地区加载路由');
      let text = await evaluate('document.body.innerText');
      assert.ok(text.includes('正在载入江苏真题'), '接口未返回时应展示可靠加载态');
      assert.ok(!text.includes('页面不存在'), '不能跳到不存在的页面');
      assert.ok(!text.includes('历年真题'), '加载态下不应退回首页题库');

      await continuePausedRequests();
      await waitFor("document.body.innerText.includes('审题立意与写作提示')", '释放请求后的江苏详情', 20000);
      text = await evaluate('document.body.innerText');
      assert.ok(text.includes('答案与问题'), '释放请求后应进入江苏 2024 真题');
      const jiangsuEssay = await assertEssayRendered('慢加载后的江苏');

      // 题目切换：从地区列表真实点击 2022 年题目，范文与点评应随之更新。
      await evaluate("location.hash='#/'; true");
      await waitFor("document.querySelectorAll('#region-jiangsu a.prompt-card').length === 3", '江苏地区题目列表');
      await evaluate(`
        (() => {
          const card = Array.from(document.querySelectorAll('#region-jiangsu a.prompt-card'))
            .find((el) => el.textContent.includes('本手'));
          if (!card) return false;
          card.click();
          return true;
        })()
      `);
      await waitFor("document.body.innerText.includes('本手、妙手、俗手')", '切换江苏 2022 真题');
      const switchedEssay = await assertEssayRendered('切换后的江苏 2022');
      assert.notEqual(switchedEssay.title, jiangsuEssay.title, '切换题目后范文标题应更新');
      assert.notEqual(switchedEssay.body, jiangsuEssay.body, '切换题目后范文正文应更新');
    });

    await check('浏览器回归（慢加载）：阻塞浙江接口时，点击浙江进入加载态并在释放后展示范文点评', async () => {
      await enableRequestBlocking([
        { urlPattern: '*/api/zhejiang/prompts*', requestStage: 'Request' },
      ]);
      await send('Page.navigate', { url: `${base}/apps/p1/` });
      await waitFor("document.querySelectorAll('.region-overview-card').length === 3", '首屏地区入口');
      await waitFor("document.body.innerText.includes('正在载入真题题库')", '首页加载态');

      const zhejiangHref = await evaluate(`
        Array.from(document.querySelectorAll('.region-overview-card'))
          .find((el) => el.querySelector('.region-name')?.textContent.trim() === '浙江')
          ?.getAttribute('href') || ''
      `);
      assert.ok(zhejiangHref.includes('/region/zhejiang'), `浙江入口首屏 href 应指向稳定地区路由，实际「${zhejiangHref}」`);

      await clickBrowseLibrary();
      await clickRegionCard('浙江');
      await waitFor("window.location.hash === '#/region/zhejiang'", '浙江地区加载路由');
      let text = await evaluate('document.body.innerText');
      assert.ok(text.includes('正在载入浙江真题'), '接口未返回时应展示可靠加载态');
      assert.ok(!text.includes('页面不存在'), '不能跳到不存在的页面');
      assert.ok(!text.includes('历年真题'), '加载态下不应退回首页题库');

      await continuePausedRequests();
      await waitFor("document.body.innerText.includes('审题立意与写作指导')", '释放请求后的浙江详情', 20000);
      text = await evaluate('document.body.innerText');
      assert.ok(text.includes('答案与问题'), '释放请求后应进入浙江 2024 真题');
      const zhejiangEssay = await assertEssayRendered('慢加载后的浙江');

      await evaluate("location.hash='#/'; true");
      await waitFor("document.querySelectorAll('#region-zhejiang a.prompt-card').length === 3", '浙江地区题目列表');
      await evaluate(`
        (() => {
          const card = Array.from(document.querySelectorAll('#region-zhejiang a.prompt-card'))
            .find((el) => el.textContent.includes('创新时代的青年担当'));
          if (!card) return false;
          card.click();
          return true;
        })()
      `);
      await waitFor("document.body.innerText.includes('创新时代的青年担当')", '切换浙江 2022 真题');
      const switched = await assertEssayRendered('切换后的浙江 2022');
      assert.notEqual(switched.title, zhejiangEssay.title, '切换浙江题目后范文标题应更新');
      assert.notEqual(switched.body, zhejiangEssay.body, '切换浙江题目后范文正文应更新');
    });

    await check('浏览器回归（失败）：地区接口真实失败时展示错误与重试，重试后到达详情', async () => {
      await enableRequestBlocking(
        [{ urlPattern: '*/api/jiangsu/prompts*', requestStage: 'Request' }],
        'fail'
      );
      await send('Page.navigate', { url: `${base}/apps/p1/` });
      await waitFor("document.querySelectorAll('.region-overview-card').length === 3", '失败场景地区入口');

      await clickBrowseLibrary();
      await clickRegionCard('江苏');
      await waitFor("document.body.innerText.includes('江苏真题加载失败')", '江苏地区加载失败提示');
      let text = await evaluate('document.body.innerText');
      assert.ok(text.includes('重新加载'), '地区加载失败应提供重试入口');
      assert.ok(!text.includes('页面不存在'), '地区加载失败不应跳到不存在页面');
      assert.ok(text.includes('返回题目库'), '地区加载失败应保留返回题目库入口');

      await stopRequestBlocking();
      await evaluate(
        "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='重新加载').click(); true"
      );
      await waitFor("document.body.innerText.includes('审题立意与写作提示')", '重试后江苏详情', 20000);
      text = await evaluate('document.body.innerText');
      assert.ok(text.includes('答案与问题'), '重试成功后应进入江苏 2024 真题');
      await assertEssayRendered('失败重试后的江苏');
    });

    await check('浏览器回归：按验收快照逐步重放 7 个场景', async () => {
      await send('Page.navigate', { url: `${base}/apps/p1/` });
      await waitFor("document.querySelectorAll('a.prompt-card').length === 9", '快照首页九题');

      // 场景 1 / 6：首页真题题库非空，三个地区可见。
      let text = await evaluate('document.body.innerText');
      for (const needle of ['真题题库', '上海', '江苏', '浙江']) {
        assert.ok(text.includes(needle), `场景 1 首页应含「${needle}」`);
      }

      // 场景 4：年份来源说明消失，但年份标签必须是可见元素而非隐藏 option。
      assert.ok(!/内置\s*20\d{2}/.test(text), '场景 4 不应出现「内置 20XX」来源说明');
      const yearState = await evaluate(`
        (() => {
          const chips = Array.from(document.querySelectorAll('.year-filters button'))
            .filter((el) => el.offsetParent !== null)
            .map((el) => el.textContent.trim());
          const seals = Array.from(document.querySelectorAll('a.prompt-card .year-seal'))
            .filter((el) => el.offsetParent !== null)
            .map((el) => el.textContent.trim());
          const hiddenOptions = document.querySelectorAll('option').length;
          return { chips, seals, hiddenOptions };
        })()
      `);
      for (const year of ['2022', '2023', '2024']) {
        assert.ok(yearState.chips.includes(year), `场景 4 年份筛选「${year}」应可见`);
        assert.ok(
          yearState.seals.some((seal) => seal.includes(year)),
          `场景 4 应有可见的 ${year} 年标签`
        );
      }
      assert.equal(yearState.hiddenOptions, 0, '场景 4 年份不应依赖隐藏 option');

      // 场景 2：点击「上海」进入详情，写作指导 / 范文 / 点评均可识别。
      await clickRegionCard('上海');
      await waitFor("document.body.innerText.includes('立意角度分层')", '场景 2 上海详情');
      let visible = await evaluate(`
        (() => {
          const nodes = Array.from(document.querySelectorAll('a, button, span, p, h1, h2, h3, div'));
          return ['写作指导', '范文', '点评'].map((label) => ({
            label,
            count: nodes.filter((el) => el.textContent.trim() === label && el.offsetParent !== null).length,
          }));
        })()
      `);
      for (const item of visible) {
        assert.equal(item.count, 1, `场景 2 详情页「${item.label}」应可见且唯一`);
      }
      await assertEssayRendered('场景 2 上海');

      // 场景 3：点击江苏看到范文，再切到浙江看到点评。
      await evaluate("location.hash='#/'; true");
      await waitFor("document.querySelectorAll('.region-overview-card').length === 3", '场景 3 返回首页');
      await clickRegionCard('江苏');
      await waitFor("document.body.innerText.includes('审题立意与写作提示')", '场景 3 江苏详情');
      await assertEssayRendered('场景 3 江苏');
      await evaluate(
        "Array.from(document.querySelectorAll('.detail-nav-btn')).find(b=>b.textContent.trim()==='浙江').click(); true"
      );
      await waitFor("document.body.innerText.includes('审题立意与写作指导')", '场景 3 浙江详情');
      text = await evaluate('document.body.innerText');
      assert.ok(text.includes('范文点评'), '场景 3 浙江详情应有点评区域');
      assert.ok(
        await evaluate("!!document.querySelector('#essay-comment')"),
        '场景 3 点评应有可定位区域'
      );

      // 场景 7：从首页点击浙江入口可直接看到范文。
      await evaluate("location.hash='#/'; true");
      await waitFor("document.querySelectorAll('.region-overview-card').length === 3", '场景 7 返回首页');
      await clickRegionCard('浙江');
      await waitFor("document.body.innerText.includes('审题立意与写作指导')", '场景 7 浙江详情');
      await assertEssayRendered('场景 7 浙江');

      // 场景 5：空 textarea 可提交并显示提示，且不发起剖析请求。
      await evaluate("location.hash='#/'; true");
      await waitFor("!!document.querySelector('#home-topic-input')", '场景 5 首页输入框');
      await evaluate(`
        (() => {
          const ta = document.querySelector('#home-topic-input');
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          setter.call(ta, '');
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          window.__origFetchForEmpty = window.fetch;
          window.__analyzeCalls = [];
          window.fetch = (...args) => {
            window.__analyzeCalls.push(String(args[0]));
            return window.__origFetchForEmpty.apply(window, args);
          };
          return true;
        })()
      `);
      await evaluate(
        "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='开始分析').click(); true"
      );
      await waitFor("document.body.innerText.includes('请输入作文题目')", '场景 5 空题目提示');
      const calls = await evaluate('window.__analyzeCalls');
      assert.ok(
        !calls.some((url) => url.includes('/api/analyze')),
        `场景 5 空题目不应发起剖析请求，实际请求：${JSON.stringify(calls)}`
      );
      await evaluate('window.fetch = window.__origFetchForEmpty; true');
    });

    await check('浏览器验收：自定义剖析范文 / 点评 / 换题 / 空输入 / 加载态 / 题库回归', async () => {
      const fillCustom = async (value) => {
        await evaluate(`
          (() => {
            const ta = document.querySelector('[data-testid="custom-topic-input"]');
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
            setter.call(ta, ${JSON.stringify(value)});
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          })()
        `);
      };
      const submitCustom = async () => {
        await evaluate("document.querySelector('[data-testid=\"analyze-button\"]').click(); true");
      };
      const openAnalyze = async () => {
        await send('Page.navigate', { url: `${base}/apps/p1/` });
        await waitFor("!!document.querySelector('.main-nav')", '首页导航');
        await evaluate(
          "Array.from(document.querySelectorAll('.main-nav a')).find(a=>a.textContent.trim()==='自定义剖析').click(); true"
        );
        await waitFor("!!document.querySelector('[data-testid=\"custom-topic-input\"]')", '自定义剖析页');
      };

      // 1 / 2：保留立意角度、结构思路，新增范文与三方面点评。
      await openAnalyze();
      await fillCustom('人工智能让生活更便利还是更疏远？');
      await submitCustom();
      await waitFor("document.body.innerText.includes('正在生成范文…')", '范文加载态', 30000);
      assert.equal(
        await evaluate("document.querySelectorAll('[data-testid=\"custom-essay\"]').length"),
        0,
        '加载期间不应出现范文容器'
      );
      await waitFor("!!document.querySelector('[data-testid=\"custom-essay\"]')", 'AI 题范文出现', 120000);
      const aiText = await evaluate('document.body.innerText');
      for (const needle of ['立意角度', '结构思路', '范文', '示范范文，仅供学习参考']) {
        assert.ok(aiText.includes(needle), `应含「${needle}」`);
      }
      const aiEssay = await evaluate("document.querySelector('[data-testid=\"custom-essay\"]').innerText");
      assert.ok(aiEssay.includes('人工智能'), 'AI 题范文应包含题目关键词');
      const aiReview = await evaluate("document.querySelector('[data-testid=\"custom-essay-review\"]').innerText");
      for (const label of ['立意', '结构', '亮点']) {
        assert.ok(aiReview.includes(label), `点评应含「${label}」`);
      }

      // 3：换题后内容同步更新，不残留上一题。
      await fillCustom('星火码头的去留应如何权衡？');
      await submitCustom();
      await waitFor(
        "document.querySelector('[data-testid=\"custom-essay\"]')?.innerText.includes('星火码头')",
        '星火码头范文',
        120000
      );
      await fillCustom('青禾书院的传统手工艺如何传承？');
      await submitCustom();
      await waitFor(
        "document.querySelector('[data-testid=\"custom-essay\"]')?.innerText.includes('青禾书院')",
        '青禾书院范文',
        120000
      );
      assert.ok(!(await evaluate('document.body.innerText')).includes('星火码头'), '不应残留上一题范文');

      // 4：纯空白输入提示「请输入作文题目」，不出现范文。
      await openAnalyze();
      await fillCustom('   ');
      await submitCustom();
      await waitFor("!!document.querySelector('[data-testid=\"topic-error\"]')", '空题目提示');
      assert.match(
        await evaluate("document.querySelector('[data-testid=\"topic-error\"]').innerText"),
        /请输入作文题目/
      );
      assert.equal(
        await evaluate("document.querySelectorAll('[data-testid=\"custom-essay\"]').length"),
        0,
        '空题目不应出现范文'
      );

      // 5：加载态先出现、范文出现后消失。
      await fillCustom('城市老街区改造应保留记忆还是引入新业态？');
      await submitCustom();
      await waitFor("document.body.innerText.includes('正在生成范文…')", '有效题目加载态', 30000);
      assert.equal(
        await evaluate("document.querySelectorAll('[data-testid=\"custom-essay\"]').length"),
        0,
        '加载期间不应展示空白占位范文'
      );
      await waitFor("!!document.querySelector('[data-testid=\"custom-essay\"]')", '老街区范文出现', 120000);
      assert.ok(
        !(await evaluate('document.body.innerText')).includes('正在生成范文…'),
        '范文出现后加载态应消失'
      );

      // 6：切回真题题库，内置题目、写作指导与范文正常。
      await evaluate(
        "Array.from(document.querySelectorAll('.main-nav a')).find(a=>a.textContent.trim()==='真题题库').click(); true"
      );
      await waitFor("document.body.innerText.includes('好奇心与探索陌生世界')", '题库内置真题');
      await evaluate(`
        Array.from(document.querySelectorAll('a.prompt-card'))
          .find(a => a.innerText.includes('好奇心与探索陌生世界')).click(); true
      `);
      await waitFor("document.body.innerText.includes('写作指导')", '内置题目写作指导');
      const detailText = await evaluate('document.body.innerText');
      assert.ok(detailText.includes('范文'), '内置题目应有范文');
    });

  } finally {
    if (ws) ws.close();
    browser.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => browser.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {
      // 忽略临时目录清理失败，不影响验收结果
    }
  }
}

async function main() {
  const chrome = findChrome();
  const { child, base } = await startServer();
  let mode = chrome ? 'Chrome 无头模式 + CDP 交互' : 'HTTP 降级校验';
  try {
    if (!chrome) {
      console.log('[browser] 未检测到 Chrome，执行 HTTP 层降级验证（非占位）：');
      await httpFallback(base);
    } else {
      try {
        await check('浏览器：根路径 / 首页渲染真题题库', async () => {
          const dom = dumpDom(chrome, `${base}/`);
          for (const needle of ['真题题库', '上海', '江苏', '浙江', '2022', '2023', '2024', '开始自定义剖析']) {
            assert.ok(dom.includes(needle), `首页 DOM 应含「${needle}」`);
          }
        });
        await check('浏览器：页脚不再显示「内置 2022—2024」年份来源说明', async () => {
          const dom = dumpDom(chrome, `${base}/`);
          assert.ok(!dom.includes('内置 2022—2024'), '页脚不应再出现年份来源说明');
          assert.ok(!/内置\s*20\d{2}\s*[-—~至]\s*20\d{2}/.test(dom), '页脚不应出现任何「内置 20XX-20XX」说明');
          assert.ok(dom.includes('把一道题目，拆成可落笔的思路'), '页脚品牌标语应保留');
        });
        await check('浏览器：/apps/p1/ 前缀下 hash 路由均可渲染且不白屏', async () => {
          const routes = [
            [`${base}/apps/p1/`, ['真题题库', '认可度', '发问与结论', '江苏', '浙江']],
            [`${base}/apps/p1/#/prompts/shanghai-2024`, ['认可度 · 解题思路全解', '立意角度分层', '结构框架', '常见偏题误区与升格建议']],
            [`${base}/apps/p1/#/prompts/jiangsu-2022`, ['本手、妙手、俗手 · 审题立意与写作提示', '题目材料', '写作要求', '审题立意', '写作提示', '来源']],
            [`${base}/apps/p1/#/analyze`, ['作文题目', '示例一键填充', '开始分析']],
            [`${base}/apps/p1/#/result`, ['还没有剖析结果', '去剖析题目']],
          ];
          for (const [url, needles] of routes) {
            const dom = dumpDom(chrome, url);
            assert.ok(dom.length > 1000, `${url} 不应白屏`);
            for (const needle of needles) assert.ok(dom.includes(needle), `${url} DOM 应含「${needle}」`);
          }
        });

        const cdpPort = await freePort();
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wensi-chrome-'));
        await runCdp(chrome, base, cdpPort, profile);
      } catch (error) {
        if (!(error instanceof BrowserInfraError)) throw error;
        console.log(`[browser] 浏览器工具不可用，改用真实 HTTP 层降级验证：${error.message}`);
        results.length = 0;
        mode = 'HTTP 降级校验（浏览器工具不可用）';
        await httpFallback(base);
      }
    }

    console.log(`[browser] 浏览器端验收通过（${mode}）：`);
    for (const line of results) console.log(line);
    console.log(`[browser] 共 ${results.length} 项检查。`);
  } finally {
    await stop(child);
  }
}

main().catch((error) => {
  for (const line of results) console.log(line);
  console.error('[browser] 浏览器验收失败：', error.message);
  if (error.stack) console.error(error.stack);
  process.exitCode = 1;
});
