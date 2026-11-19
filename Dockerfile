# ========================================================
#  ProjectFlow — Full Lifecycle Project Management
#  基础镜像走 daocloud 镜像站（服务器无法访问 Docker Hub）
# ========================================================
ARG NODE_IMAGE=docker.m.daocloud.io/library/node:22-bookworm-slim

# ---------- 依赖层 ----------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN npm config set registry https://registry.npmmirror.com
COPY package.json package-lock.json* ./
COPY scripts ./scripts
RUN npm install --no-audit --no-fund

# ---------- 构建层 ----------
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- 运行层 ----------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

# tzdata 让 TZ=Asia/Shanghai 生效；gosu 用于降权运行（Debian 无 su-exec）
RUN apt-get update && apt-get install -y --no-install-recommends tzdata gosu \
    && rm -rf /var/lib/apt/lists/* \
    && ln -snf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
    && echo 'Asia/Shanghai' > /etc/timezone

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV TZ=Asia/Shanghai
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -m nextjs

COPY --from=builder --chown=0:0 /app/node_modules ./node_modules
COPY --from=builder --chown=1001:1001 /app/.next ./.next
COPY --from=builder --chown=1001:1001 /app/public ./public
COPY --from=builder --chown=1001:1001 /app/package.json ./package.json
COPY --from=builder --chown=1001:1001 /app/next.config.ts ./next.config.ts
COPY --from=builder --chown=1001:1001 /app/db ./db
COPY --from=builder --chown=1001:1001 /app/scripts ./scripts
COPY --chown=0:0 docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
    && mkdir -p /app/db /app/uploads \
    && chown -R 1001:1001 /app/db /app/uploads \
    && chown -R 1001:1001 /app/.next

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# 以 root 启动，entrypoint 内修正挂载卷权限后降权到 nextjs
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
