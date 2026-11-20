# 文思 · 高考作文指导

上海卷、江苏卷、浙江卷高考作文题库，支持题目检索、结构化剖析、范文与点评，
以及自定义作文题目的现场剖析与示范范文生成。

## 技术栈

- 后端：Node.js 20 + Express（ESM）
- 前端：React 18 + Vite 5，静态产物由 Express 托管
- 测试：Node.js 内置 `node:test`
- 部署：根目录 `Dockerfile` 多阶段构建，服务监听 `0.0.0.0:8080`

## 快速开始

```bash
npm ci          # 安装依赖
npm run build   # 构建前端到 dist/
npm start       # 启动服务，默认 http://127.0.0.1:8080
```

开发模式：`npm run dev`。

服务同时兼容根路径 `/` 与外部基础路径 `/apps/p1/`。反向代理去除前缀但未发送
`X-Forwarded-Prefix` 时，可设置环境变量 `APP_BASE_PATH=/apps/p1`。

## 应用版本由项目自行发布和维护

应用版本**不再**根据交付任务数量、交付分支、中心任务编号或提交文案推算，
也**不读取**交付中心的数据库、聊天、交付批次、运行时中心接口或中心版本环境变量。
应用可以脱离交付中心独立构建和运行。

唯一版本依据是仓库根目录的 `.delivery-release.json`：

```json
{
  "schema": 1,
  "version": "v1.1.0",
  "released_at": "2026-11-20T17:03:38+08:00"
}
```

规则：

1. `version` 必须与 `package.json`（以及 `package-lock.json`）的版本一致。
2. `released_at` 是项目发布该版本的真实时间，使用带时区的 ISO8601 格式；
   生成后固定不变。重复构建、重新部署或进程重启都沿用同一时间。
3. 后端每次请求直接读取该文件，对外提供 `GET /version.json`（同时兼容
   `/version` 与 `/apps/p1/version.json`）。
4. 页面顶部在原位置展示「应用版本：v1.1.0 · 发布时间：2026-11-20 17:03」，
   其中发布时间取 `released_at` 的日期与时分，不是容器启动时间。
5. 发布记录缺失、JSON 损坏、`schema` 不符或字段缺失时，页面与版本接口返回
   明确的不可用提示，不回退显示旧版本，也不编造版本号或发布时间。
6. 这份记录随构建产物进入 Docker 镜像（`.dockerignore` 不得排除），
   应用运行时不需要 `.git`、中心网络或任何中心版本注入。

### 发布新版本

```bash
npm run release -- 1.2.0
```

该命令会同步更新 `package.json`、`package-lock.json` 的版本，并以当前时刻
（带本地时区）重写 `.delivery-release.json`。发布后重新构建、测试并部署即可。

校验版本同源与交付配置：

```bash
npm run lint          # 语法 + 发布记录/Dockerfile/版本来源检查
npm run check:docker  # 容器交付静态校验
```

## 测试与验收

```bash
npm test              # 单元与集成测试
npm run build         # 生产构建
npm run smoke         # 真实启动服务并做 HTTP 冒烟（业务 + 版本同源）
npm run browser-check # 可选：有 Chrome 时做浏览器端验收
```

## 目录结构

```
server/         Express 服务、题库数据、剖析与范文生成、版本解析
web/            React 前端与 Vite 配置
data/           上海卷、江苏卷、浙江卷题库数据
test/           单元与集成测试
scripts/        发布工具、静态检查、冒烟与浏览器验收
Dockerfile      多阶段构建
.delivery-release.json  应用发布记录（唯一版本依据）
```
