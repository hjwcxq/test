# ---------- 构建阶段：安装全部依赖并产出前端静态资源 ----------
FROM node:20-alpine AS builder
WORKDIR /app

# 应用版本唯一依据是项目自己的发布记录 .delivery-release.json，
# 不读取交付中心注入的版本变量，也不依赖 .git 历史。
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY .delivery-release.json ./.delivery-release.json
COPY server ./server
COPY web ./web
RUN npm run build

# ---------- 运行阶段：仅保留生产依赖与构建产物 ----------
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# 复用构建阶段纳入产物的发布记录，保证页面、/version.json 与镜像同源。
COPY --from=builder /app/.delivery-release.json ./.delivery-release.json
COPY server ./server
COPY data ./data
COPY --from=builder /app/dist ./dist

RUN addgroup -S app && adduser -S -G app app && chown -R app:app /app
USER app

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "server/index.js"]
