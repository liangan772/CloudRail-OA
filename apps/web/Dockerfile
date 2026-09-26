FROM node:20-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
# ⚠️ Next 的 rewrites() 在 `next build` 时求值并写进 .next/routes-manifest.json，
# 所以这个地址必须在**构建期**就给定（运行期再设无效）：
# 容器内后端是服务名 api，不是 localhost——否则浏览器同源 /api/* 会被转发到 web 自己。
ARG NEXT_PUBLIC_API_BASE_URL=http://api:3001
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
RUN pnpm --filter @oa/shared build && pnpm --filter @oa/web build

FROM node:20-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3000
CMD ["pnpm", "--filter", "@oa/web", "start"]
