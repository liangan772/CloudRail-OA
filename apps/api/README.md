# @oa/api · 后端

## 常用命令

```bash
pnpm --filter @oa/api dev          # 开发模式（nest start --watch）
pnpm --filter @oa/api build        # 构建到 dist/（入口 dist/main.js）
pnpm --filter @oa/api typecheck    # src / prisma seed / test 三套配置一起查
pnpm --filter @oa/api test         # 单测（不连数据库）
pnpm --filter @oa/api test:e2e     # 真实库全链路 e2e
```

## 环境变量

根目录 `.env`（已被 gitignore）是唯一来源；`ConfigModule` 会依次读 `.env` 与 `../../.env`。
关键项：`DATABASE_URL`、`JWT_ACCESS_SECRET`、`JWT_REFRESH_SECRET`、`DEFAULT_TENANT_CODE`、`API_PORT`。

> 注意：Prisma CLI 只会自动加载**当前工作目录**与 `prisma/` 下的 `.env`。
> 在 `apps/api` 里跑 Prisma 时，请显式传 `DATABASE_URL`（或把 `.env` 放到 `apps/api/`）。

## 单测 vs e2e

| | 单测（`test`） | e2e（`test:e2e`） |
| --- | --- | --- |
| 是否需要数据库 | 不需要（假仓储 / 内存替身） | 需要，且已迁移 + 已 seed |
| 运行位置 | `src/**/*.spec.ts` | `test/e2e/**/*.e2e-spec.ts` |
| 打谁 | 直接调用领域函数与 service | **外部真实服务进程**（`E2E_BASE_URL`，默认 `http://127.0.0.1:3099`） |

e2e 由 `test/e2e/run.mjs` 编排：若目标地址已有服务在跑就直接复用，
否则用当前环境变量启动 `dist/main.js`、等 `/health` 就绪、跑完再收掉自己起的进程。
所以跑 e2e 前请先 `build`。

> 为什么不在 jest 进程里 in-process 启动应用：本机环境下 Prisma 在 jest 内连接不稳定
> （表现为指向本地临时端口的 `ECONNREFUSED`），而"起真实服务再打"更接近联调语义。

### 跑一次真实库 e2e

```powershell
# 1. 让 DATABASE_URL 指向可达的库（例：宝塔服务器上的 PostgreSQL，已迁移 + 已 seed）
$env:DATABASE_URL = "postgresql://<user>:<password>@<host>:35432/oa?schema=public&sslmode=disable"

# 2. 构建后运行（会写入演示流程数据：两条实例 + 投票 + 结论）
pnpm --filter @oa/api build
pnpm --filter @oa/api test:e2e
```

全链路覆盖：登录 → 组织/工号 → 模板 → 发起（真库解析并快照投票人）→ 全员表态 →
人工结论 → 开启下一层 → 跨部门可见性（B1/B2）→ 定局停留态 → 金额超限条件上报。

## 目录约定

| 目录 | 职责 |
| --- | --- |
| `src/domain/**` | 纯逻辑（零 IO）：计票、状态机、结论策略、投票人解析、数据范围、规则引擎 |
| `src/modules/**` | 应用层：controller / service / dto，按聚合划分 |
| `src/infra/**` | 基础设施（Prisma 等） |
| `src/common/**` | 错误、过滤器、拦截器、管道、装饰器、请求上下文 |
| `test/e2e/**` | 真实库端到端测试与编排脚本 |
