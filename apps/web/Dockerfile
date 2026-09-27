# 构建上下文是仓库根目录：docker build -f apps/web/Dockerfile .
#
# ⚠️ 内存：8G 机器上构建期容易把整机打穿（表现为无响应 / SSH 卡死）。
# 这里的措施（都是「降低峰值」而非「改变行为」）：
#   1. install 的并发子进程压到 1（--child-concurrency=1），削掉构建期最大的内存/IO 峰值
#   2. 显式给 Node 堆封顶，避免 next build 的 webpack 进程失控膨胀
#   3. 串行构建 shared → web，不给 turbo 并发叠加内存的机会
#   4. next.config.mjs 里把构建 worker 数压到 2（见 experimental.cpus）
# 但**根治手段在运维侧**：不要用 `up -d --build` 并行构建 api+web，
# 改成串行 build —— 见 docs/runbook.md §2/§3。
FROM node:20-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
# 构建期堆上限（MB）。给 next build 的 webpack 编译用，防止失控膨胀。
ARG BUILD_NODE_HEAP_MB=1536
ENV NODE_OPTIONS="--max-old-space-size=${BUILD_NODE_HEAP_MB}"
COPY . .
RUN pnpm install --frozen-lockfile --child-concurrency=1
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
# 运行期堆上限。⚠️ 必须**小于** compose 里的 mem_limit（默认 1024m），
# 否则 Node 以为自己有更多堆、实际被 cgroup 卡住，反而更容易被 OOM kill。
ENV NODE_OPTIONS="--max-old-space-size=768"
COPY --from=build /app /app
EXPOSE 3000
CMD ["pnpm", "--filter", "@oa/web", "start"]
