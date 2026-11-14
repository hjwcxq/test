import { createApp } from './app.js';

const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '0.0.0.0';

const server = createApp().listen(port, host, () => {
  console.log(`[文思] 服务已启动：http://${host}:${port}（同时兼容 / 与 /apps/p1/ 基础路径）`);
});

function shutdown(signal) {
  console.log(`[文思] 收到 ${signal}，正在关闭服务…`);
  server.close(() => process.exit(0));
  // 兜底：若仍有连接未释放，最多等待后退出。
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
