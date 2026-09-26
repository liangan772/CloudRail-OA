# 单机部署取向（C8）：镜像大一点没关系，构建简单、行为可预期更重要。
# 构建上下文是仓库根目录：docker build -f apps/api/Dockerfile .
#
# 用 Debian slim 而不是 alpine：Prisma 的查询引擎依赖 libssl，alpine 的 musl 环境
# 需要额外匹配 binaryTarget（且历史上坑很多）。slim 上引擎开箱可用，
# 另外显式装 openssl 与 ca-certificates（后者给外发 HTTPS 用，比如 IM Webhook）。
FROM node:20-slim AS build
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
# 国内服务器拉 Prisma 引擎慢的话，构建时传镜像源：
#   docker compose ... build --build-arg PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma
ARG PRISMA_ENGINES_MIRROR=""
ENV PRISMA_ENGINES_MIRROR=${PRISMA_ENGINES_MIRROR}
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY . .
# 种子数据必须真的进到镜像里。.dockerignore 里若出现未锚定的 `data` 规则，
# 这里会第一个失败——总比等到部署时 db:seed 报 "Cannot find module './data/org'" 好。
RUN test -f apps/api/prisma/seed/data/org.ts \
  && test -f apps/api/prisma/seed/data/roles.ts \
  && test -f apps/api/prisma/seed/data/templates.ts \
  || (echo '✖ apps/api/prisma/seed/data 缺失：检查 .dockerignore 是否误伤了 data 目录' >&2; exit 1)
RUN pnpm install --frozen-lockfile
# Prisma Client 必须在构建期生成（运行期没有 schema 也能起，但没有 client 就跑不了）
RUN pnpm --filter @oa/api exec prisma generate
RUN pnpm --filter @oa/shared build && pnpm --filter @oa/api build

FROM node:20-slim AS runtime
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3001
# 启动前先跑迁移（幂等），再起服务；migrate deploy 不会改动已应用的迁移
CMD ["sh", "-c", "pnpm --filter @oa/api db:deploy && node apps/api/dist/main.js"]
