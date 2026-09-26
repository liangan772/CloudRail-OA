# 单机部署取向（C8）：镜像大一点没关系，构建简单、行为可预期更重要。
# 构建上下文是仓库根目录：docker build -f apps/api/Dockerfile .
FROM node:20-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
# Prisma Client 必须在构建期生成（运行期没有 schema 也能起，但没有 client 就跑不了）
RUN pnpm --filter @oa/api exec prisma generate
RUN pnpm --filter @oa/shared build && pnpm --filter @oa/api build

FROM node:20-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3001
# 启动前先跑迁移（幂等），再起服务；migrate deploy 不会改动已应用的迁移
CMD ["sh", "-c", "pnpm --filter @oa/api db:deploy && node apps/api/dist/main.js"]
