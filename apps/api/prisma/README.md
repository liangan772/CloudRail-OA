# 数据库迁移与种子

## 目标数据库（已确认，2026-09-26 探测）

开发库跑在宝塔服务器的 Docker 里，**已确认可达**（本机 → 服务器 TCP 35432 通）：

| 项 | 值 |
| --- | --- |
| 主机 | `82.158.228.70` |
| 端口 | `35432`（映射容器内 5432） |
| 容器 | `postgresql_enp7-postgresql_EnP7-1`（镜像 `postgres:16.3`，`restart: always`） |
| 数据目录 | `/www/dk_project/dk_app/postgresql/postgresql_EnP7/data` |
| 网络 | `baota_net`（容器 IP `172.18.0.2`） |
| 凭据 | 面板应用 `postgresql_EnP7` 的 `.env` 里，**不入库、不写入文档、不打印** |

> 安全提示：该端口目前对公网开放（`0.0.0.0:35432`），服务器系统防火墙（ufw）未启用。
> 生产上线前应把来源限制到固定 IP，或改为仅内网 / SSH 隧道访问。

#### 怎么用

1. 在仓库根目录建 `.env`（已被 `.gitignore` 忽略），把 `DATABASE_URL` 指向上面这个库：

   ```dotenv
   DATABASE_URL=postgresql://<user>:<password>@82.158.228.70:35432/<database>?schema=public&sslmode=disable
   ```

2. 然后依次执行「拿到 PostgreSQL 之后要做的三件事」。

## 迁移目录（已生成并应用，2026-09-26）

阶段 1 交付时没有可用的 PostgreSQL，当时刻意**不伪造** `migrations/`（伪造目录会让后续 `migrate deploy` 直接失败）。
数据库接通后已真实生成并应用两个迁移：

| 迁移 | 内容 |
| --- | --- |
| `20260926032105_init` | `prisma migrate dev` 生成的全量初始化 DDL（44 张表 / 41 个枚举 / 75 个索引） |
| `20260926033000_partial_indexes` | 手工补的部分索引（Prisma schema 语法表达不了，见下一节） |

`schema.prisma` 仍是唯一事实来源；`reference/schema.sql` 是离线生成的 DDL 快照，仅作评审参考。

## 从零重建一个库

```bash
# 1. 生成/应用迁移（会创建 prisma/migrations/<时间戳>_init/）
pnpm --filter @oa/api exec prisma migrate dev --name init

# 2. 执行种子数据（幂等）
pnpm db:seed

# 3. 生成 Prisma Client
pnpm db:generate
```

> 跑 Prisma 时 CWD 是 `apps/api`，而 `.env` 在仓库根目录 —— Prisma 只会自动加载
> CWD 与 `prisma/` 下的 `.env`，所以要么显式传入 `$env:DATABASE_URL`，要么把 `.env` 放到 `apps/api/`。

## Prisma schema 无法表达、必须在迁移 SQL 中手工追加的部分

Prisma 5 的 schema 语法表达不了**部分索引（partial index）**与**分区**，这些是本项目性能与合规的关键。
它们放在 `20260926033000_partial_indexes` 这个**独立迁移**里，而不是追加进 init —— 因为 init 一旦应用，
再改它的文件会让 Prisma 校验和不一致（`modified migration` 报错），后续 migrate 全部被卡住。

两个必须记住的坑：

| 坑 | 说明 |
| --- | --- |
| 列名大小写 | Prisma 未显式 `@map` 的字段，物理列名就是 **camelCase**。SQL 里必须写 `"tenantId"` / `"dueAt"` / `"isActive"`，否则 PostgreSQL 折成小写后报 `42703 column does not exist`（首次应用时就踩了这个） |
| 并发建索引 | `CREATE INDEX CONCURRENTLY` **不能在事务里执行**，而 Prisma 迁移默认整体包事务。本次作用于全新空表，普通 `CREATE INDEX` 即可；将来在**已有数据且仍在写入**的生产库上补同类索引，必须改 `CONCURRENTLY` 并在事务外执行 |

```sql
-- 已应用，完整文件见 migrations/20260926033000_partial_indexes/migration.sql
CREATE INDEX "idx_instance_nodes_voting_deadline"
  ON "instance_nodes" ("tenantId", "status", "deadline") WHERE "status" = 'VOTING';
CREATE INDEX "idx_tasks_open_due"
  ON "tasks" ("tenantId", "dueAt") WHERE "status" NOT IN ('DONE', 'CANCELLED');
CREATE UNIQUE INDEX "idx_task_one_owner"
  ON "task_assignees" ("taskId") WHERE "role" = 'OWNER' AND "isActive";
CREATE UNIQUE INDEX "idx_task_one_acceptor"
  ON "task_assignees" ("taskId") WHERE "role" = 'ACCEPTOR' AND "isActive";

-- 仍待办（阶段 6 上线前）：审计日志按月分区，见 docs/runbook.md
```

## 种子数据内容

`pnpm db:seed` 会生成（幂等，可重复执行）：

| 项 | 内容 |
| --- | --- |
| 租户 | 1 个演示租户 `demo`（云轨科技） |
| 部门树 | 3 层：云轨科技 `/1/` → 产品中心 `/1/2/` → 技术部 `/1/2/3/`，每级带部门工号 |
| 部门工号 | `D1000`（总部）、`D1001`（产品中心）、`D1003`（技术部）+ 工号成员与主责人 |
| 用户 | 9 人（含 1 名租户管理员、2 名部门负责人、6 名普通成员） |
| 角色 | 5 个：`TENANT_ADMIN` / `DEPT_MANAGER` / `VOTER` / `TASK_EXECUTOR` / `AUDITOR` |
| 权限 | 36 个权限点（与 `packages/shared/src/constants/permissions.ts` 同源，不会漂移；阶段 1 提交信息里写的 39 是笔误，已按代码实际条目更正） |
| 模板 | 2 个已发布模板：**采购申请（2 层投票 + 任务 + 上报）**、**项目立项（1 层投票 + 任务）** |
| 其它 | 单号序列（实例/任务/上报） |

演示账号统一密码：`Oa@12345678`（scrypt 哈希入库，明文不落盘）。
