# ---------- 构建阶段：安装全部依赖并产出前端静态资源 ----------
FROM node:20-alpine AS builder
WORKDIR /app

# 版本由 scripts/delivery-index.mjs 依据交付历史自动生成并写入 delivery.json；
# 部署平台如能注入 APP_VERSION / APP_DELIVERY_TIME，则优先使用注入值。
ARG APP_VERSION=""
ARG APP_DELIVERY_TIME=""
ARG GIT_COMMIT=""
ENV APP_VERSION=${APP_VERSION}
ENV APP_DELIVERY_TIME=${APP_DELIVERY_TIME}
ENV GIT_COMMIT=${GIT_COMMIT}

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY delivery.json ./delivery.json
COPY scripts ./scripts
COPY web ./web
COPY server ./server
RUN npm run build

# ---------- 运行阶段：仅保留生产依赖与构建产物 ----------
FROM node:20-alpine AS runtime
WORKDIR /app

# 运行阶段每次请求都解析当前交付记录：
# - 部署注入 APP_VERSION / APP_DELIVERY_TIME 时直接使用；
# - 否则读取构建产物 dist/version.json 中的自动版本，交付时间取容器首次启动时刻；
# - 也可设置 APP_DELIVERY_FILE 指向部署挂载的交付记录文件，替换后刷新即生效。
ARG APP_VERSION=""
ARG APP_DELIVERY_TIME=""
ENV APP_VERSION=${APP_VERSION}
ENV APP_DELIVERY_TIME=${APP_DELIVERY_TIME}
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# 直接复用构建阶段自动生成的交付记录，保证运行阶段与 dist/version.json 同源。
COPY --from=builder /app/delivery.json ./delivery.json
COPY server ./server
COPY data ./data
COPY --from=builder /app/dist ./dist

RUN addgroup -S app && adduser -S -G app app && chown -R app:app /app
USER app

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "server/index.js"]
