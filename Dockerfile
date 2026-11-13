# ---------- 构建阶段 ----------
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json tsconfig.server.json tsconfig.web.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# ---------- 运行阶段(无 node_modules, 零运行时依赖) ----------
FROM node:22-alpine
ENV NODE_ENV=production
RUN addgroup -g 10001 -S teamboard && adduser -u 10001 -S -G teamboard teamboard \
    && mkdir -p /app && chown teamboard:teamboard /app
WORKDIR /app
COPY --from=build --chown=teamboard:teamboard /src/dist ./dist
USER teamboard
# 默认监听 0.0.0.0:8787; 配置优先级: 环境变量 > /app/config.json > 内置默认值
ENV TEAMBOARD_HOST=0.0.0.0
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/ >/dev/null 2>&1 || exit 1
CMD ["node", "dist/server.js"]