# @oa/api · 后端

## 常用命令

```bash
pnpm --filter @oa/api dev          # 开发模式（nest start --watch）
pnpm --filter @oa/api build        # 构建到 dist/（入口 dist/main.js）
pnpm --filter @oa/api typecheck    # src / prisma seed / test 三套配置一起查
pnpm --filter @oa/api test         # 单测（不连数据库）
pnpm --filter @oa/api test:e2e     # 真实库全链路 e2e
pnpm --filter @oa/api db:cleanup   # 清理流程数据（默认预演，加 --yes 才执行）
```

### 清理流程数据

e2e 会往演示租户写流程数据，跑多了需要清一清。脚本**默认只预演**（列清单不删），确认后加 `--yes`：

```bash
pnpm --filter @oa/api db:cleanup                      # 预演：列出将被删除的数据
pnpm --filter @oa/api db:cleanup -- --yes             # 删除单号以 OA- 开头的实例及其全部关联数据
pnpm --filter @oa/api db:cleanup -- --yes --all       # 删除该租户全部流程数据
pnpm --filter @oa/api db:cleanup -- --yes --reset-sequences   # 顺带把单号序列重置为 1
```

删除范围：流程实例、实例节点、投票人快照、投票记录、计票快照、人工结论、冻结记录、任务（含参与人/检查项/依赖/日志）、上报单（含链路与记录）。
**不动**配置数据：租户、用户、部门、角色与权限、流程模板（含版本与节点配置）。
可选 `--with-notifications`（删引用被删实例单号的站内通知）、`--with-audit`（删对应审计日志）、`--tenant=<code>`、`--prefix=<前缀>`（可多次传）。

## 环境变量

根目录 `.env`（已被 gitignore）是唯一来源；`ConfigModule` 会依次读 `.env` 与 `../../.env`。
关键项：`DATABASE_URL`、`JWT_ACCESS_SECRET`、`JWT_REFRESH_SECRET`、`DEFAULT_TENANT_CODE`、`API_PORT`。

> 注意：Prisma CLI 只会自动加载**当前工作目录**与 `prisma/` 下的 `.env`。
> 在 `apps/api` 里跑 Prisma 时，请显式传 `DATABASE_URL`（或把 `.env` 放到 `apps/api/`）。

## 种子对权限点的行为

`db:seed` 是**幂等 + 对齐**，不只是"补数据"：

| 步骤 | 行为 |
| --- | --- |
| `seedPermissions` | 按 `PERMISSIONS` 逐条 **upsert**（新增的权限点入库、已有的更新名称/模块/类型） |
| `seedRoles` | 每个角色**先 `deleteMany` 再按定义重建** `role_permissions` —— 会覆盖你手工调整过的内置角色权限 |
| `prunePermissions` | 删除库里存在、但 `PERMISSIONS` 里已没有的**孤儿权限点**，并打印受影响的角色 |

`prunePermissions` 的存在理由：权限点只能由代码定义，所以从常量里删掉一个权限点后，
库里那一行不会被任何业务流程清掉。只 upsert 不 prune 会让偏差永久累积，最终表现为
**权限目录看不到它、角色详情却能看到它**。分类逻辑在 `src/domain/rbac/permission-sync.ts`（纯函数，有单测），
落库在 `prisma/seed/index.ts`；关联的 `role_permissions` 由外键 `onDelete: Cascade` 自动清理。

> 因此：**手工改过内置角色权限的话，重跑 seed 会打回种子定义**。要保留自定义配置，
> 应该新建角色而不是改内置角色。

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

> **待应用迁移**：`20260926054000_task_template_dependencies`（新增 `NodeTaskTemplate.dependsOn`）
> 是手写的增量迁移（纯加列、可空、无需回填）。数据库可达时执行一次即可：
> `pnpm --filter @oa/api db:deploy`

### 在生产服务器上跑（推荐）

数据库（Docker 里的 PostgreSQL）只在服务器本地监听，所以在服务器上跑最省事，
`DATABASE_URL` 直接用 `127.0.0.1:35432` 即可，不需要隧道、也不用对外开放端口：

```bash
cd /path/to/CloudRail-OA
pnpm install

# .env 里 DATABASE_URL=postgresql://<user>:<password>@127.0.0.1:35432/oa?schema=public&sslmode=disable
pnpm --filter @oa/api exec prisma migrate deploy   # 应用迁移（含部分索引那一条）
pnpm --filter @oa/api db:seed                      # 幂等种子（已灌过可跳过）

pnpm --filter @oa/api build
pnpm --filter @oa/api test:e2e                     # 会起 127.0.0.1:3099 的服务再跑用例
```

> 跑 e2e 会在演示租户写入两条流程数据（实例 + 投票 + 结论 + 上报单），属预期。
> 结束后想清理，按 `code` 前缀 `OA-` / `ES-` 删除对应记录即可。

## 目录约定

| 目录 | 职责 |
| --- | --- |
| `src/domain/**` | 纯逻辑（零 IO）：计票、状态机、结论策略、投票人解析、数据范围、规则引擎 |
| `src/modules/**` | 应用层：controller / service / dto，按聚合划分 |
| `src/infra/**` | 基础设施（Prisma 等） |
| `src/common/**` | 错误、过滤器、拦截器、管道、装饰器、请求上下文 |
| `test/e2e/**` | 真实库端到端测试与编排脚本 |

## 管理后台（`/admin/**`）

`modules/admin` 是给管理员用的读写管理台，与 `modules/org` 的分工是：

| | `org` | `admin` |
| --- | --- | --- |
| 面向 | 所有登录用户（部门/人员选择器） | 管理员 |
| 放行方式 | 数据范围守卫裁剪 | `@RequirePermissions` 权限点 |
| 能力 | 只读 | 读写 |

| 控制器 | 前缀 | 权限点 | 能力 |
| --- | --- | --- | --- |
| `AdminUserController` | `admin/users` | `USER_MANAGE` | 列表 / 详情 / 新建 / 更新 / 重置密码 / 分配角色 |
| `AdminRoleController` | `admin/roles` | `ROLE_MANAGE`（`options` 额外放行 `USER_MANAGE`） | 列表 / 详情 / 新建 / 更新 / 权限整表替换 / 删除 / 权限目录 |
| `AdminOrgController` | `admin/departments`、`admin/worknos` | `ORG_MANAGE`、`DEPT_WORKNO_MANAGE` | 部门 CRUD 与移动、工号设置、工号成员增删与主责人 |
| `AdminAuditController` | `admin/audit` | `AUDIT_READ`（导出需 `AUDIT_EXPORT`） | 列表 / 详情 / 筛选项字典 / CSV 导出 |
| `AdminOpsController` | `admin/ops` | `SYS_MONITOR`、`AUDIT_READ` | 业务概览 / 运行态 / 发件箱列表 / 人工重放 / 立即派发 |

三个实现上的注意点：

1. **权限点只能分配、不能新建**。权限点由 `packages/shared` 的 `PERMISSIONS` 定义，服务层会校验传入的 code 是否存在，
   否则库里会出现前端 `can()` 永远为 false 的"幽灵权限"。
2. **审计表主键是 BigInt**，不能直接 `JSON.stringify`，对外一律转字符串（`admin-audit.service.ts` 的 `toView`）。
3. **部门移动会重写整棵子树的物化路径**（`admin-org.service.ts#moveDepartment`），并拒绝把部门移到自己或自己的后代下。

所有写操作都在 `runInTransaction` 内调用 `DomainEventService.emit`，同事务落 `AuditLog` + `OutboxEvent`（C9）。
`DomainEventService.aggregateType` 因此扩展了 `USER / ROLE / DEPARTMENT / WORKNO / SYSTEM` 五种聚合类型。

## 实时通道与后台任务

### Socket.IO（`/ws` 命名空间）

握手时用访问令牌鉴权（`auth.token`、`Authorization: Bearer` 或 `?token=` 均可），
连接后自动加入房间：`user:{id}`、`dept:{id}`，以及该用户所属部门工号的 `workno:{工号}`
（上报是投递给工号而不是个人，见 D3）。业务事件名与房间名都在 `@oa/shared` 的 `WS_EVENTS` / `WS_ROOMS` 里，
前后端不会漂移。

### 后台任务

周期任务有四个：`outbox-dispatch`（5s）、`vote-timeout` / `conclusion-timeout` / `escalation-timeout`（各 5min）。

| 模式 | 触发条件 | 说明 |
| --- | --- | --- |
| `queue` | 配置了可用 `REDIS_URL` | 走 BullMQ（可多实例），repeatable job |
| `in-process` | 未配置或连不上 Redis | 退回进程内定时器，**功能不降级**（单机部署不需要 broker） |

```bash
GET  /jobs/status    # 当前模式、各任务周期、Outbox 积压（需 AUDIT_READ）
POST /jobs/run       # 手动触发一次：{"job":"outbox-dispatch"}（排障与联调，不依赖队列）
```

### 审计与发件箱（C9 四点式）

所有状态变更在**同一个事务**里写 `AuditLog` + `OutboxEvent`，由派发器投递到
Socket.IO 广播与站内通知（`GET /notifications`、`POST /notifications/:id/read`、`POST /notifications/read-all`）。
派发器先认领（PENDING → PROCESSING）再投递，失败按 2^n 秒退避重试，超过 5 次标 `DEAD` 供人工重放。
