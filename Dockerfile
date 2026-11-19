# ---------- 构建阶段：安装全部依赖并产出前端静态资源 ----------
FROM node:20-alpine AS builder
WORKDIR /app

# 发布版本与交付时间成对注入（Bridge / CI 传入）；未传时读取仓库 delivery.json 这一份交付记录。
ARG APP_VERSION=""
ARG APP_DELIVERY_TIME=""
ARG GIT_COMMIT=""
ENV APP_VERSION=${APP_VERSION}
ENV APP_DELIVERY_TIME=${APP_DELIVERY_TIME}
ENV GIT_COMMIT=${GIT_COMMIT}

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY delivery.json ./delivery.json
COPY web ./web
COPY server ./server
RUN npm run build

# ---------- 运行阶段：仅保留生产依赖与构建产物 ----------
FROM node:20-alpine AS runtime
WORKDIR /app

# 支持在部署时用 APP_VERSION / APP_DELIVERY_TIME 覆盖展示版本与交付时间，无需重新构建前端。
ARG APP_VERSION=""
ARG APP_DELIVERY_TIME=""
ENV APP_VERSION=${APP_VERSION}
ENV APP_DELIVERY_TIME=${APP_DELIVERY_TIME}
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY delivery.json ./delivery.json
COPY server ./server
COPY data ./data
COPY --from=builder /app/dist ./dist

RUN addgroup -S app && adduser -S -G app app && chown -R app:app /app
USER app

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "server/index.js"]
