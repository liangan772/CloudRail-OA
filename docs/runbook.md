# 运维手册（阶段 6）

## 1. 部署形态

单机一台 + 一个 compose（约束 C8），四个服务：`web`（3000）、`api`（3001）、`postgres`、`redis`。
不引入 Nginx / K8s / Prometheus；需要 HTTPS 时用可选 `tls` profile 的 Caddy。

## 2. 首次部署

```bash
git clone https://github.com/liangan772/CloudRail-OA.git
cd CloudRail-OA

cp .env.example .env
# 必须改：POSTGRES_PASSWORD、JWT_ACCESS_SECRET、JWT_REFRESH_SECRET（各 64 字节随机串）
# 建议改：CORS_ORIGINS（前端域名）、DEFAULT_TENANT_CODE

# 启动前自检：这三项留空会被 compose 直接拒绝（有意为之，避免弱口令上线）
grep -E '^(POSTGRES_PASSWORD|JWT_ACCESS_SECRET|JWT_REFRESH_SECRET)=.+' .env \
  || echo '✖ 上面三项必须填写'

# 生成随机密钥（各跑一次）
openssl rand -hex 32

# ⚠️ 必须显式 --env-file .env：compose 的变量替换读的是「项目目录下的 .env」，
#    而项目目录默认是 compose 文件所在目录（docker/），不是仓库根目录
docker compose --env-file .env -f docker/docker-compose.prod.yml up -d --build
# 需要自动 HTTPS：
#   OA_DOMAIN=oa.example.com ACME_EMAIL=you@example.com \
#   docker compose --env-file .env -f docker/docker-compose.prod.yml --profile tls up -d

# 首次灌种子（幂等，可重复执行）
# ⚠️ 这一步作用于 **compose 自带的 postgres 容器**（服务名 postgres / 容器名 oa-postgres），
#    与你之前在别处（例如宝塔面板里的 PostgreSQL 应用）灌过的种子互不相干——那是另一套库。
#    只跑迁移不跑这一步，登录会返回 AUTH_INVALID_CREDENTIALS（detail 为"租户不存在或已停用"）。
docker compose --env-file .env -f docker/docker-compose.prod.yml exec api pnpm db:seed

# 若上面报 "tsx: not found"（Prisma 的 seed 包装器在某些环境找不到 tsx），直接跑脚本：
# docker compose --env-file .env -f docker/docker-compose.prod.yml exec api \
#   pnpm --filter @oa/api exec tsx prisma/seed/index.ts

# 验证种子是否落库（期望 tenants=1 / users=9）
docker compose --env-file .env -f docker/docker-compose.prod.yml exec postgres \
  psql -U oa -d oa -c 'select (select count(*) from tenants) tenants, (select count(*) from users) users;'
```

`api` 容器启动时会先跑 `prisma migrate deploy` 再起服务，所以迁移不需要手工执行。
生产建议把 `API_BIND` / `WEB_BIND` 设成 `127.0.0.1`，只让 Caddy（或你现有的反代）对外。

容器名固定，便于运维脚本与排障：`oa-api` / `oa-web` / `oa-postgres` / `oa-redis`。
若用宝塔自带的 Nginx 做反代（这台机器上已有），可以不起 Caddy：
域名 → `127.0.0.1:3000`，另外把 `/api` 与 `/ws` 反代到 `127.0.0.1:3001`（`/ws` 需要 upgrade 头）。

## 3. 日常检查

| 检查 | 命令 / 位置 | 期望 |
| --- | --- | --- |
| 存活 | `curl -s localhost:3001/health` | `status=ok`、`dependencies.database=up` |
| 指标 | `curl -s localhost:3001/metrics` | Prometheus 文本（不部署采集器） |
| 日志 | `docker compose -f docker/docker-compose.prod.yml logs -f api` | pino 结构化日志 |
| 后台任务模式 | `GET /jobs/status`（需 AUDIT_READ） | `mode=queue`（有 Redis）或 `in-process` |
| 事件积压 | 同上 `outbox.pending` | 常态 0；持续增长说明派发器卡住 |
| 队列手动补跑 | `POST /jobs/run {"job":"outbox-dispatch"}` | 排障用，不依赖定时器 |

`redis` 不可用时系统**不降级功能**：后台任务自动退回进程内定时器（5s/5min 周期），
只是失去多实例安全与集中可观测性。

## 4. 备份与恢复

```bash
# 备份（容器在跑就用容器里的 pg_dump，产物在 docker/backups/）
pnpm backup

# 恢复（破坏性，必须显式 --yes）
pnpm restore docker/backups/oa-20260926120000.dump --yes
```

建议加一条计划任务（面板计划任务或 crontab）：`0 3 * * * cd /path/to/repo && pnpm backup`，
与 `.env` 里的 `BACKUP_CRON` 保持一致口径。

## 5. 上线前必做：审计日志按月分区

审计日志保留 3 年，单表会很大。分区必须在**有数据前**做（转换已有表要停机重建），
所以放在上线前执行，命令如下（把 `<当月>` 换成实际上线月份，例如 `2026_10`）：

```sql
BEGIN;

-- 1) 重命名旧表，按主键结构建分区父表
ALTER TABLE audit_logs RENAME TO audit_logs_legacy;

CREATE TABLE audit_logs (
  LIKE audit_logs_legacy INCLUDING DEFAULTS INCLUDING CONSTRAINTS
) PARTITION BY RANGE ("createdAt");

-- 2) 建当月与下月分区
CREATE TABLE audit_logs_<当月> PARTITION OF audit_logs
  FOR VALUES FROM ('<当月-01>') TO ('<次月-01>');
CREATE TABLE audit_logs_<次月> PARTITION OF audit_logs
  FOR VALUES FROM ('<次月-01>') TO ('<再下月-01>');

-- 3) 回灌历史数据并重建索引（索引名与 schema 里的保持一致）
INSERT INTO audit_logs SELECT * FROM audit_logs_legacy;
CREATE INDEX "audit_logs_tenantId_targetType_targetId_createdAt_idx"
  ON audit_logs ("tenantId", "targetType", "targetId", "createdAt");
CREATE INDEX "audit_logs_tenantId_actorId_createdAt_idx"
  ON audit_logs ("tenantId", "actorId", "createdAt");

DROP TABLE audit_logs_legacy;
COMMIT;
```

之后按月建分区（建议放进计划任务）：

```sql
CREATE TABLE IF NOT EXISTS audit_logs_<YYYY_MM> PARTITION OF audit_logs
  FOR VALUES FROM ('<YYYY-MM-01>') TO ('<下月-01>');
```

## 6. 常见故障

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `P1000 Authentication failed ... for "xxx"` | **改过 `POSTGRES_USER/PASSWORD/DB`**：PostgreSQL 镜像只在数据目录为空时按这些变量初始化一次，之后改 `.env` 不会新增用户/改密码，只会让 api 拿着新凭据连旧库 | 要么把 `.env` 改回与数据卷一致（`exec postgres psql -U <旧用户> -d <旧库> -c '\du'` 可查）；要么删卷重建（`down` → `docker volume rm <项目名>_oa-pgdata` → `up -d`，**会清空数据**）。想保留数据只换口令：进容器 `ALTER USER ... PASSWORD '...'` |
| `P1001 Can't reach database server` | 网络/端口不通 | 确认 PG 在跑、端口与防火墙；容器内用服务名 `postgres` |
| `P1017 Server has closed the connection` | 连接被中途重置（代理/VPN/中间设备） | 换直连或 SSH 隧道；本机开发常见于代理软件 |
| `Transaction already closed` | 事务超时 | 项目已用 `runInTransaction`（30s）；若仍出现说明单事务语句过多，需要拆分 |
| `404` 且代码明明写了 | 跑的是旧 `dist` | **先 build 再跑**（`nest build`），typecheck 不代表产物是新的 |
| 页面能开但数据不刷 | 前端 `/api` rewrite 目标不对 | 检查 `NEXT_PUBLIC_API_BASE_URL`；容器内应指向 `http://api:3001` |
| 页面能开但报"请求失败"、web 日志里是连 `127.0.0.1:3001` | rewrite 目标是**构建期**烘焙进 `.next/routes-manifest.json` 的，只在运行期设环境变量无效 | 改 `docker/docker-compose.prod.yml` 的 `web.build.args` 后**重建**（`up -d --build web`）。校验：`docker compose ... exec web node -e "console.log(require('/app/apps/web/.next/routes-manifest.json').rewrites)"` 应看到 `http://api:3001` |
| 迁移未应用 | 手工迁移文件没跑 | `pnpm --filter @oa/api db:deploy` |

## 7. 数据清理

e2e 或联调会在演示租户留下流程数据（单号 `OA-` / `ES-`）。清理：

```bash
pnpm --filter @oa/api db:cleanup               # 预演，只列清单
pnpm --filter @oa/api db:cleanup -- --yes      # 执行
```

只删业务记录，不动组织/用户/角色/模板/单号序列（要重置序列加 `--reset-sequences`）。

## 8. 卸载 / 彻底清理

按需要选清理深度，**从 ① 往下逐级加重**：

```bash
cd CloudRail-OA

# ① 停并删除容器（数据卷保留：之后想回来还能原样起）
docker compose --env-file .env -f docker/docker-compose.prod.yml down

# ② 连数据一起删（不可恢复：oa-pgdata / oa-redis / oa-uploads / caddy 卷都会被删除）
docker compose --env-file .env -f docker/docker-compose.prod.yml down -v
#    想确认卷名：docker volume ls | grep -i oa

# ③ 删镜像（compose 构建出来的名字形如 docker-api / docker-web）
docker images | grep -E 'docker-(api|web)'
docker rmi <上一步列出的镜像 ID>

# ④ 删项目目录（先把 docker/backups 里要留的备份移出去）
ls docker/backups
cd .. && rm -rf CloudRail-OA
```

宝塔面板侧需要手工做的两件事：

- 删除站点与反向代理（网站 → 对应域名 → 删除）
- 启用了 `tls` profile 的话，Caddy 容器随 ①② 一起清掉，证书数据在 `oa-caddy-data` 卷里

**最容易漏掉的一点**：如果之前复用了宝塔面板里的 PostgreSQL 应用（容器 `postgresql_enp7-...`，端口 `35432`）
当开发库，那套**不属于本 compose**，卸载本项目不会动它。它默认对公网开放（`0.0.0.0:35432`），
不再使用时建议一并停掉，或至少把来源收窄到固定 IP。

收尾自检：

```bash
docker ps | grep oa-                       # 不应再有 oa-* 容器
docker volume ls | grep -i oa              # 走完 ② 后应无 pgdata/redis/uploads 卷
ss -tlnp | grep -E '3000|3001'             # 端口应已释放
```
