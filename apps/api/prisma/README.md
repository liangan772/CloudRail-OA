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

## 为什么目录里没有 `migrations/`

生成 `migrations/` 需要真实数据库 + shadow database 才能真正产出 `migrations/<时间戳>_xxx/migration.sql`，
而阶段 1 交付时该库还不可达（开发机未安装 Docker、宝塔服务器尚未确认）。

因此这里刻意**不伪造**迁移目录，避免后续 `prisma migrate deploy` 因目录不合法而失败。

当前提供的替代产物：

| 文件 | 说明 |
| --- | --- |
| `schema.prisma` | 唯一的 schema 事实来源，`prisma validate` 已通过 |
| `reference/schema.sql` | 用 `prisma migrate diff --from-empty --to-schema-datamodel` 离线生成的完整 DDL（44 张表 / 41 个枚举 / 75 个索引），仅作评审与建库参考 |

## 拿到 PostgreSQL 之后要做的三件事

```bash
# 1. 生成真实迁移（会创建 prisma/migrations/<时间戳>_init/）
pnpm --filter @oa/api exec prisma migrate dev --name init

# 2. 执行种子数据
pnpm db:seed

# 3. 生成 Prisma Client
pnpm db:generate
```

## Prisma schema 无法表达、必须在迁移 SQL 中手工追加的部分

Prisma 5 的 schema 语法表达不了**部分索引（partial index）**与**分区**，这些是本项目性能与合规的关键，
必须在 `migrate dev` 生成迁移后，手工在 `migration.sql` 末尾追加以下语句（阶段 2 执行）：

```sql
-- 投票超时扫描：只索引进行中的节点
CREATE INDEX CONCURRENTLY idx_instance_nodes_voting_deadline
  ON instance_nodes (tenant_id, status, deadline)
  WHERE status = 'VOTING';

-- 任务逾期扫描：只索引未终结的任务
CREATE INDEX CONCURRENTLY idx_tasks_open_due
  ON tasks (tenant_id, due_at)
  WHERE status NOT IN ('DONE', 'CANCELLED');

-- 每个任务恰好一个 OWNER、恰好一个 ACCEPTOR（服务层校验之外的数据库兜底）
CREATE UNIQUE INDEX idx_task_one_owner
  ON task_assignees (task_id) WHERE role = 'OWNER' AND is_active;
CREATE UNIQUE INDEX idx_task_one_acceptor
  ON task_assignees (task_id) WHERE role = 'ACCEPTOR' AND is_active;

-- 审计日志按月分区（先建分区父表结构，再挂接子分区；阶段 6 上线前执行）
-- 见 docs/runbook.md（阶段 6 产出）
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
| 权限 | 39 个权限点（与 `packages/shared/src/constants/permissions.ts` 同源，不会漂移） |
| 模板 | 2 个已发布模板：**采购申请（2 层投票 + 任务 + 上报）**、**项目立项（1 层投票 + 任务）** |
| 其它 | 单号序列（实例/任务/上报） |

演示账号统一密码：`Oa@12345678`（scrypt 哈希入库，明文不落盘）。
