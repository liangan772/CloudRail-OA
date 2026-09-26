# 03 · 技术选型与工程基线

## 1. 版本矩阵

> 原则：全部锁定小版本区间，`pnpm` 精确锁 `pnpm-lock.yaml`；不追最新，优先「生态成熟 + 可长期维护」。

### 1.1 前端

| 层 | 选型 | 版本 | 用途与理由 |
| --- | --- | --- | --- |
| 框架 | Next.js（App Router） | `14.2.x` | 用户指定；RSC + 路由组 + rewrites 做反代，免装 Nginx |
| 语言 | TypeScript | `5.4.x` | 全栈同语言，与 shared 包类型直连 |
| 样式 | Tailwind CSS | `3.4.x` | 用户指定；配合 `tailwindcss-animate` |
| 组件 | shadcn/ui（Radix UI 底座） | 按需 `radix-ui` 最新 | 无锁定依赖、源码进仓库、可深度定制 |
| 图标 | lucide-react | `0.4xx` | 用户指定 |
| 本地状态 | Zustand | `4.5.x` | 轻量，只放 UI 状态（侧栏、主题、筛选草稿） |
| 服务端状态 | TanStack Query | `5.x` | 缓存/失效/乐观更新/无限滚动 |
| 图表 | Recharts | `2.12.x` | 用户指定；投票进度、层级耗时、负载 |
| 动画 | Framer Motion | `11.x` | 用户指定；过渡与列表动效 |
| 拖拽 | dnd-kit | `6.x` | 用户指定；看板拖拽、设计器节点排序 |
| 表单 | react-hook-form + Zod resolver | `7.x` / `3.23.x` | 与 shared Zod schema 复用 |
| 虚拟列表 | TanStack Virtual | `3.x` | 长任务/审计列表 |
| 日期 | date-fns | `3.x` | 与后端时间语义一致 |
| 测试 | Vitest + Testing Library + Playwright | 最新 | 组件测试 + 端到端场景（阶段 6） |

### 1.2 后端

| 层 | 选型 | 版本 | 用途与理由 |
| --- | --- | --- | --- |
| 框架 | NestJS | `10.4.x` | 用户指定；模块化 + DI 天然贴合领域服务分层 |
| 运行时 | Node.js | `20.11.x` LTS（Docker 镜像 `node:20-alpine`） | 本机是 24.x，但 Prisma/Nest 生态在 20 LTS 最稳 |
| ORM | Prisma | `5.22.x` | 用户指定；类型安全的 schema + migrate + seed |
| 数据库 | PostgreSQL | `16-alpine` | 用户指定；JSONB 存规则与快照，物化路径查组织树 |
| 缓存/锁/限流 | Redis | `7-alpine` | 用户指定；组织树缓存、分布式锁、令牌黑名单 |
| 队列 | BullMQ | `5.x` | 用户指定；延时任务（超时/催办/上报/逾期）+ 重试 + 重复任务 |
| 实时 | Socket.IO | `4.7.x` | 用户指定；房间语义 + 自动重连 + 降级 |
| 校验 | class-validator + Zod | `0.14.x` / `3.23.x` | DTO 层 class-validator，shared 契约层 Zod（前后端同源） |
| 鉴权 | @nestjs/jwt + passport-jwt | `10.x` / `4.x` | Access 15min + Refresh 7d，jti 黑名单 |
| 密码 | argon2 | `0.41.x` | 抗 GPU 暴力破解 |
| 日志 | pino + nestjs-pino | `9.x` | JSON 结构化到 stdout，`docker logs` 可读 |
| 文档 | @nestjs/swagger | `7.4.x` | 自动生成 OpenAPI，`/docs` 可交互 |
| 邮件/IM | nodemailer + 原生 fetch Webhook | `6.x` | 邮件 + 企微/钉钉/飞书 Webhook |
| 文件 | 本地磁盘抽象 + `@aws-sdk/client-s3` | `3.x` | 开发本地磁盘，生产可切 MinIO/S3 |
| 测试 | Jest + Supertest + testcontainers | `29.x` / `7.x` / `10.x` | 单测 + 集成测试（真 PostgreSQL/Redis） |

### 1.3 工程与部署

| 项 | 选型 | 版本 | 说明 |
| --- | --- | --- | --- |
| 包管理 | pnpm workspace | `9.x` | 硬链接省磁盘，workspace 协议引用 shared |
| 构建编排 | Turborepo | `2.x` | 任务图 + 远程缓存（可选） |
| 代码规范 | ESLint + Prettier | `8.x` / `3.x` | 统一 `@oa/eslint-config` |
| Git 钩子 | husky + lint-staged | `9.x` / `15.x` | pre-commit 校验 |
| 提交规范 | commitlint（Conventional） | `19.x` | 便于生成 CHANGELOG |
| 容器 | Docker + Compose v2 | 24+ / v2.24+ | dev 只起 pg+redis；prod 4 服务 |
| 反向代理 / TLS | Caddy（`caddy:2-alpine`）或托管平台 | 2.x | 自动 HTTPS，替代 Nginx 配置 |
| CI | GitHub Actions | — | `typecheck + lint + test + build`（可选，不依赖） |

## 2. 为什么用 monorepo（全 TypeScript）

| 收益 | 具体体现 |
| --- | --- |
| 类型不漂移 | `packages/shared` 里 `VoteDecision`、`NodeVoteRule`、`RuleDSL`、Zod schema 前后端同一份；改枚举编译期就报错 |
| 契约即代码 | DTO 由 shared Zod schema 反向生成 Swagger 注解，OpenAPI 与实现不会脱节 |
| 规则 DSL 单点实现 | 求值器核心逻辑（无 IO 的纯函数）在 shared，前端「规则试算」与后端「真实求值」用同一实现，避免语义分歧 |
| 一次性重构 | 改状态机枚举 → 前端状态标签/颜色映射同一次 PR 完成 |
| 一套工具链 | 一个 `pnpm typecheck` 覆盖三包 |

## 3. monorepo 目录结构（提案 → 阶段 1 落地）

```
oa/
├ apps/
│   ├ api/                                  # NestJS 后端
│   │   ├ prisma/
│   │   │   ├ schema.prisma                 # 阶段 1 交付
│   │   │   ├ migrations/
│   │   │   └ seed/
│   │   │       ├ seed.ts
│   │   │       ├ data/org.ts               # 部门树 + 用户
│   │   │       ├ data/roles.ts             # 角色 + 权限
│   │   │       └ data/templates.ts         # 示例模板（2 层投票 + 任务 + 上报）
│   │   ├ src/
│   │   │   ├ main.ts                       # bootstrap + Swagger + pino + 全局管道/过滤器
│   │   │   ├ app.module.ts
│   │   │   ├ common/                       # 横切关注点
│   │   │   │   ├ decorators/               # @CurrentUser @RequirePermissions @DataScope @Audit
│   │   │   │   ├ filters/                  # 统一异常 → { code, message, data, traceId }
│   │   │   │   ├ interceptors/             # 统一响应封装 + traceId + 耗时
│   │   │   │   ├ guards/                   # JwtAuthGuard / PermissionGuard / DataScopeGuard
│   │   │   │   ├ pipes/                    # ZodValidationPipe
│   │   │   │   └ errors/                   # AUTH_* PERM_* VOTE_* NODE_* TASK_* ESC_* RULE_* 错误码表
│   │   │   ├ infra/                        # 基础设施层
│   │   │   │   ├ prisma/                   # PrismaService + 软删除/租户/范围扩展
│   │   │   │   ├ redis/                    # RedisService + LockService + 限流
│   │   │   │   ├ queue/                    # BullMQ 连接、队列注册、生产者
│   │   │   │   ├ storage/                  # StoragePort + LocalStorage + S3Storage
│   │   │   │   ├ notification/             # 渠道适配器：站内/邮件/短信/IM Webhook
│   │   │   │   └ outbox/                   # OutboxService + 派发器 + 消费幂等
│   │   │   ├ domain/                       # 领域层（纯逻辑，无 IO）
│   │   │   │   ├ workflow/                 # 模板版本、节点图校验
│   │   │   │   ├ vote/                     # VoteEngine（纯函数计票）+ 类型
│   │   │   │   ├ node/                     # NodeStateMachine 转移表 + guards/actions
│   │   │   │   ├ task/                     # TaskEngine 状态机 + 分配算法
│   │   │   │   ├ escalation/               # EscalationEngine 目标解析 + 状态机
│   │   │   │   └ rule/                     # RuleEngine JSON DSL 求值器
│   │   │   ├ modules/                      # 应用层（按聚合划分的 Nest 模块）
│   │   │   │   ├ auth/  org/  user/  rbac/
│   │   │   │   ├ workflow-template/  instance/  vote/
│   │   │   │   ├ task/  escalation/  stats/  audit/  notification/
│   │   │   │   └ (每个模块内 controller / service / dto / repository / listeners)
│   │   │   ├ gateway/                      # Socket.IO Gateway + 事件契约 + 房间管理
│   │   │   ├ jobs/                         # BullMQ Worker：投票超时/任务逾期/上报超时/催办/outbox
│   │   │   └ health/                       # /health /metrics
│   │   ├ test/                             # e2e（Supertest）与 testcontainers 装置
│   │   └ Dockerfile                        # 多阶段构建 → 生产镜像
│   └ web/                                  # Next.js 前端
│       ├ src/app/                          # App Router（见 02 文档 §2.1）
│       ├ src/components/
│       │   ├ ui/                           # shadcn/ui 基础组件
│       │   ├ business/                     # 业务组件（StatusBadge/VoteProgressBar/...）
│       │   └ layout/                       # Sidebar / Topbar / NotificationDrawer
│       ├ src/features/                     # 按域组织：api hooks + store + 类型再导出
│       │   └ auth/ vote/ instance/ task/ escalation/ template/ org/ stats/ notification/
│       ├ src/lib/                          # api-client（refresh 队列）、query-client、socket、utils、permissions
│       ├ src/hooks/                        # usePermissions / useRealtime / useTheme / useDebounce
│       ├ src/styles/                       # globals.css + design tokens
│       ├ public/
│       └ Dockerfile
├ packages/
│   ├ shared/                               # 前后端共享（阶段 1 交付）
│   │   ├ src/enums/                        # 全部枚举 + 中文标签 + 语义色映射
│   │   ├ src/dto/                          # Zod schema（请求/响应）
│   │   ├ src/rule-dsl/                     # DSL 类型 + 求值器 + 校验器（纯函数，前后端共用）
│   │   ├ src/workflow/                     # 节点图类型、计票类型、人类可读规则文案
│   │   ├ src/constants/                    # 权限点、错误码、状态颜色、WebSocket 事件名
│   │   └ src/utils/                        # 分页、日期、树、加权计算
│   ├ tsconfig/                             # 共享 tsconfig 预设
│   ├ eslint-config/
│   └ ui/                                   # (可选) 跨端共享展示组件，阶段 4 决定是否启用
├ docker/
│   ├ docker-compose.dev.yml                # 仅 postgres + redis
│   ├ docker-compose.prod.yml               # web + api + postgres + redis (+ caddy 可选 profile)
│   ├ Caddyfile                             # 可选 HTTPS 反代
│   └ postgres/init/                        # 初始化扩展/时区
├ scripts/
│   ├ setup.mjs                             # pnpm setup：装依赖 + 起 dev 容器 + migrate + seed
│   ├ backup.mjs / restore.mjs              # pg_dump / pg_restore
│   └ wait-for.mjs                          # 等待 db/redis 就绪
├ docs/
│   ├ stage-0/                              # 本阶段
│   ├ api.md                                # 阶段 6 联调文档
│   └ runbook.md                            # 阶段 6 运维手册
├ .env.example
├ .npmrc
├ .nvmrc                                   # 20.11.1
├ package.json                              # workspace 根，engines 锁 node
├ pnpm-workspace.yaml
├ turbo.json
└ ROADMAP.md
```

## 4. 运行拓扑与端口

### 4.1 开发环境

```
开发者机器
├ docker compose -f docker/docker-compose.dev.yml up -d
│   ├ postgres  127.0.0.1:5432   (volume: oa-pgdata-dev)
│   └ redis     127.0.0.1:6379   (volume: oa-redis-dev)
├ pnpm --filter @oa/api dev    → http://localhost:3001  (/docs 是 Swagger, /ws 是 Socket.IO)
└ pnpm --filter @oa/web dev    → http://localhost:3000  (rewrites /api → 3001)
```

一条命令：`pnpm setup && pnpm dev`（`setup` 负责依赖 + 容器 + 迁移 + 种子）。

### 4.2 生产环境（单机）

```
宿主机
└ docker compose -f docker/docker-compose.prod.yml up -d
    ├ web       :3000   仅内网暴露（或由 caddy 前置 443）
    ├ api       :3001   仅内网暴露
    ├ postgres  :5432   volume oa-pgdata
    └ redis     :6379   volume oa-redis
    ├ volumes: oa-uploads（附件）、oa-backups（每日 dump）
    └ (profile=tls) caddy :80/:443 → 自动 HTTPS，反代 web 与 /api、/ws
```

不引入 Nginx / K8s / Prometheus。API 与 Web 均为无状态容器，为将来横向扩展留路径。

## 5. 环境变量清单（草案）

| 变量 | 示例 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | `development` / `production` | — |
| `API_PORT` | `3001` | 后端端口 |
| `DATABASE_URL` | `postgresql://oa:oa@localhost:5432/oa?schema=public` | Prisma |
| `REDIS_URL` | `redis://localhost:6379` | 缓存/锁/队列 |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | 随机 64 字节 | 生产必须替换 |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | `15m` / `7d` | — |
| `STORAGE_DRIVER` | `local` / `s3` | 附件存储 |
| `STORAGE_LOCAL_DIR` | `/data/uploads` | local 驱动目录（挂 volume） |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` | — | s3 驱动 |
| `MAIL_*`、`SMS_*`、`WECOM_WEBHOOK`、`DINGTALK_WEBHOOK`、`FEISHU_WEBHOOK` | — | 通知渠道；未配置则自动降级为仅站内通知 |
| `CORS_ORIGINS` | `http://localhost:3000` | — |
| `LOG_LEVEL` | `info` / `debug` | pino |
| `DEFAULT_TENANT_CODE` | `demo` | 单租户场景的默认租户 |
| `TZ` | `Asia/Shanghai` | 容器时区 |
| `SEED_ON_START` | `true`（首次） | 生产首次启动自动 seed，之后置 false |
| `BACKUP_CRON` | `0 3 * * *` | 每日备份 |

共享方式：根 `.env` 给 docker compose；`apps/api/.env` 与 `apps/web/.env.local` 由 `scripts/setup.mjs` 从 `.env.example` 派生，避免手抄漏项。

## 6. 质量基线

| 门禁 | 命令 | 覆盖 |
| --- | --- | --- |
| 类型 | `pnpm -w typecheck` | 三个包全量 `tsc --noEmit` |
| Lint | `pnpm -w lint` | ESLint（含 import 顺序、no-floating-promises） |
| 格式 | `pnpm -w format:check` | Prettier |
| 单测 | `pnpm -w test` | Jest（api 领域层）、Vitest（web 组件） |
| 集成 | `pnpm --filter @oa/api test:e2e` | Supertest + testcontainers 真库 |
| 构建 | `pnpm -w build` | turbo 依赖图构建 |
| 提交 | husky pre-commit | lint-staged + 受影响包 typecheck |

## 7. NestJS 模块划分与依赖注入设计（输出要求 #4）

分层：`Controller`（API 层）→ `Service`（应用层，事务边界）→ `Domain`（领域层，纯逻辑）→ `Infra`（Prisma/Redis/BullMQ/Storage）。

### 7.1 模块依赖关系

```
InfraModule (global)         Prisma / Redis / Queue / Storage / Logger / Outbox
    ↑
DomainModule (pure)          VoteEngine / NodeStateMachine / TaskEngine / EscalationEngine / RuleEngine
    ↑                         （无 Nest 依赖，仅被 Service 组合调用；核心为纯函数，可独立单测）
    ↑
AuthModule  OrgModule  RbacModule  UserModule
    ↑
WorkflowTemplateModule → InstanceModule → VoteModule
                              ↓
                        TaskModule → EscalationModule
                              ↓
                NotificationModule  AuditModule  GatewayModule  StatsModule
```

依赖方向约束（用 ESLint `import/no-restricted-paths` 强制）：

| 层 | 允许依赖 | 禁止依赖 |
| --- | --- | --- |
| `domain/**` | 仅 `@oa/shared` | 任何 Nest 装饰器、Prisma、Redis（保证可纯函数单测） |
| `infra/**` | domain 类型 | modules/**（基础设施不知道业务模块） |
| `modules/**` | domain、infra、shared | 其他模块的 `repository`（跨模块只能调对方 `service`） |
| `gateway/**` | shared 事件契约 | 业务 service（只做广播，不读库） |

### 7.2 关键注入与事务策略

| 关注点 | 设计 |
| --- | --- |
| 事务边界 | `PrismaService.runInTransaction()` 由 **应用层 Service** 开启；一个用例一个事务，`OutboxEvent` 与业务写入同事务 |
| 分布式锁 | `LockService.withLock('instance:{id}')` 包裹计票与状态流转，防止并发投票导致重复推进 |
| 领域服务注册 | `domain` 内的引擎以 `useFactory` 注册为纯类（不注入 Prisma），由 Service 传参调用 |
| 事件 | 业务 Service 只写 `OutboxEvent`；`OutboxDispatcher` 在事务提交后投递到 BullMQ 或直接广播 |
| 请求上下文 | `AsyncLocalStorage` 保存 `{ tenantId, userId, roleIds, scope, traceId, ip, ua }`；Prisma 扩展自动注入 `tenantId` |
| 横切 | 全局 `ValidationPipe`（class-validator）+ `ZodValidationPipe`（shared schema）+ 全局异常过滤器 + 响应拦截器 + `AuditInterceptor` |
| 可测试性 | 引擎纯函数 → 单测无 DB；Service → 用 testcontainers 起真 PostgreSQL 做集成测试 |

### 7.3 领域引擎的对外契约（阶段 2/3 实现）

| 引擎 | 纯函数签名（示意） | 说明 |
| --- | --- | --- |
| `VoteEngine` | `tally(input: TallyInput): TallyResult` | 输入票集合 + 规则 + 投票人集合，输出计数/加权分/判定/快照；**零 IO** |
| `NodeStateMachine` | `next(state, event, ctx): TransitionResult` | 返回下一状态 + 需执行的副作用列表（创建任务/创建下一层/创建上报），由 Service 执行 |
| `TaskEngine` | `resolveAssignees(ctx) / next(state, event) / isUnblocked(task, deps)` | 分配算法与任务状态机 |
| `EscalationEngine` | `resolveTargetDept(ctx) / next(state, event)` | 直接上级 / 逐级 / 越级 / 指定部门 四种解析 |
| `RuleEngine` | `evaluate(rule: RuleNode, ctx: RuleContext): boolean / explain()` | JSON DSL 求值 + `explain()` 返回命中路径用于「为什么上报」解释 |

## 8. 环境风险与对策（已实测）

| 编号 | 风险 | 实测情况 | 对策 |
| --- | --- | --- | --- |
| R1 | 本机 Node 24 高于 LTS 目标 | `node -v` = v24.12.0 | 阶段 1 加 `.nvmrc`（20.11.1）+ `engines` 警告；容器内固定 `node:20-alpine`；若 24 下 Prisma 报错则提示用户切换或全程用 Docker 跑 |
| R2 | Docker 未安装 | `docker` 命令不存在 | 阶段 1 的 `pnpm setup` 需容错：检测不到 Docker 时打印指引并允许使用「已有本地 PostgreSQL/Redis」模式；阶段 6 部署验收需要用户安装 Docker Desktop（或提供云托管替代） |
| R3 | 沙箱内 pnpm 不可用 | `pnpm -v` 报 `canonicalizing the --dir argument: C:\Users\liangan 拒绝访问`（当前会话的目录访问限制），但 `corepack 0.34.5`、`npm 11.6.2` 正常 | 阶段 1 首步用 `corepack enable && corepack prepare pnpm@9 --activate`；若仍受限，则改用 `npm` 安装依赖并把 `pnpm` 相关脚本同时提供 npm 等价命令，或在用户本机终端（非沙箱）执行 |
| R4 | 网络受限，依赖下载可能失败 | 本次会话网络受限 | 阶段 1 需要下载依赖时，会向你发起一次联网授权（`require_escalated`），仅申请必要的包管理/镜像域名 |
| R5 | 中文路径与文件写入 | 仓库路径含中文 `Documents\ChatGPT\OA`（无空格） | 已实测可正常写入；脚本统一用绝对路径 + `-LiteralPath` 风格，避免编码问题 |
| R6 | 单机部署下的队列与 API 同进程风险 | — | 阶段 3 用 `WORKER_MODE` 环境变量控制：`all`（单进程同时跑 API 与 Worker，默认，适合单机）/ `api` / `worker`（未来拆分） |

## 9. 与用户约束的对账

| 用户要求 | 是否满足 | 说明 |
| --- | --- | --- |
| Next.js 14 + TS + Tailwind + shadcn/ui + Lucide | ✅ | §1.1 |
| Zustand + TanStack Query | ✅ | §1.1 |
| Recharts + Framer Motion + dnd-kit | ✅ | §1.1 |
| NestJS + Prisma + PostgreSQL 16 | ✅ | §1.2 |
| Redis + BullMQ | ✅ | §1.2 |
| Socket.IO 或 SSE | ✅ | 主用 Socket.IO，另留只读 SSE 进度端点 |
| 本地磁盘 / MinIO / S3 | ✅ | `STORAGE_DRIVER` 切换，`StoragePort` 抽象 |
| JWT + RBAC + 数据权限 | ✅ | §7.1 §7.2 与 02 文档 §5 |
| class-validator + Zod | ✅ | DTO 用 class-validator，契约用 Zod |
| Swagger | ✅ | `/docs` |
| Jest + Supertest | ✅ | 另加 testcontainers 做真库集成测试 |
| Docker Compose 单机 4 服务 | ✅ | §4.2，`web/api/postgres/redis`（+可选 caddy profile） |
| monorepo + Turborepo + packages/shared | ✅ | §2 §3 |
| 开发一条命令、生产一台机器 | ✅ | `pnpm setup && pnpm dev`；`docker compose -f ... up -d` |
| 不引入 K8s/Nginx/Prometheus | ✅ | §4.2；仅保留 `/metrics` 端点（不部署采集器） |
