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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];

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
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const entry = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
        else entry.resolve(message.result);
      }
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
    await send('Page.navigate', { url: `${base}/apps/p1/` });

    await check('浏览器：/apps/p1/ 首页加载出 3 张真题卡片', async () => {
      await waitFor("document.querySelectorAll('a.prompt-card').length === 3", '题目卡片');
      const text = await evaluate('document.body.innerText');
      for (const year of ['2022', '2023', '2024']) assert.ok(text.includes(year), `首页应含 ${year}`);
      assert.ok(text.includes('上海卷高考作文真题'));
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
      await waitFor("document.querySelectorAll('a.prompt-card').length === 3", '恢复题目列表');
    });

    await check('浏览器：进入 2024 真题详情，查看立意与提纲', async () => {
      await evaluate(
        "Array.from(document.querySelectorAll('a.prompt-card')).find(a=>a.textContent.includes('认可度')).click(); true"
      );
      await waitFor("document.body.innerText.includes('立意角度分层')", '详情页');
      const text = await evaluate('document.body.innerText');
      for (const needle of ['题目原文', '审题要点', '关键词拆解', '结构框架', '素材方向', '常见偏题误区与升格建议', '高度切题']) {
        assert.ok(text.includes(needle), `详情应含「${needle}」`);
      }
      assert.ok((await evaluate("document.querySelectorAll('.angle-card').length")) >= 3);
      assert.ok((await evaluate("document.querySelectorAll('.outline-row').length")) >= 4);
    });

    await check('浏览器：返回首页并进入自定义剖析页，字数统计与示例可见', async () => {
      await evaluate("location.hash='#/'; true");
      await waitFor("document.body.innerText.includes('上海卷高考作文真题')", '返回首页');
      await evaluate("location.hash='#/analyze'; true");
      await waitFor("!!document.querySelector('#topic-input')", '剖析页');
      const text = await evaluate('document.body.innerText');
      for (const needle of ['示例一键填充', '开始剖析', '2000 字', '清空']) {
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
        "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('开始剖析')).click(); true"
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
        "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('开始剖析')).click(); true"
      );
      await waitFor("!!document.querySelector('.field-error')", '校验提示');
      const message = await evaluate("document.querySelector('.field-error').innerText");
      assert.match(message, /不能为空/);
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
        "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='开始剖析').click(); true"
      );
      await waitFor("location.hash.includes('/result')", '跳转到结果页');
      await waitFor("document.body.innerText.includes('分段提纲')", '结果页内容');
      const text = await evaluate('document.body.innerText');
      for (const needle of ['思辨关系类', '核心概念', '限制条件', '立意方向', '分段提纲', '写作建议', '风险提示']) {
        assert.ok(text.includes(needle), `结果页应含「${needle}」`);
      }
      assert.ok((await evaluate("document.querySelectorAll('.angle-card').length")) >= 3);
      assert.ok((await evaluate("document.querySelectorAll('.outline-row').length")) >= 4);
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
        "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('开始剖析')).click(); true"
      );
      await waitFor("document.body.innerText.includes('重试剖析')", '错误态与重试按钮');
      const text = await evaluate('document.body.innerText');
      assert.ok(text.includes('剖析失败') && text.includes('网络连接失败'), '错误态应给出明确文案');
      await evaluate('window.fetch = window.__origFetch; true');
      await evaluate('location.reload(); true');
      await waitFor("!!document.querySelector('#topic-input')", '恢复后页面可用');
    });

    await check('浏览器：375px 手机窄屏与 1280px 桌面宽度均无横向溢出', async () => {
      for (const [width, height, mobile] of [[375, 800, true], [1280, 900, false]]) {
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
          for (const needle of ['上海卷高考作文真题', '2022', '2023', '2024', '开始自定义剖析']) {
            assert.ok(dom.includes(needle), `首页 DOM 应含「${needle}」`);
          }
        });
        await check('浏览器：/apps/p1/ 前缀下 hash 路由均可渲染且不白屏', async () => {
          const routes = [
            [`${base}/apps/p1/`, ['上海卷高考作文真题', '认可度', '发问与结论']],
            [`${base}/apps/p1/#/prompts/shanghai-2024`, ['认可度 · 解题思路全解', '立意角度分层', '结构框架', '常见偏题误区与升格建议']],
            [`${base}/apps/p1/#/analyze`, ['作文题目', '示例一键填充', '开始剖析']],
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
