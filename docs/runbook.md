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

docker compose -f docker/docker-compose.prod.yml up -d --build
# 需要自动 HTTPS：
#   OA_DOMAIN=oa.example.com ACME_EMAIL=you@example.com \
#   docker compose -f docker/docker-compose.prod.yml --profile tls up -d

# 首次灌种子（幂等，可重复执行）
docker compose -f docker/docker-compose.prod.yml exec api pnpm db:seed
```

`api` 容器启动时会先跑 `prisma migrate deploy` 再起服务，所以迁移不需要手工执行。
生产建议把 `API_BIND` / `WEB_BIND` 设成 `127.0.0.1`，只让 Caddy（或你现有的反代）对外。

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
| `P1001 Can't reach database server` | 网络/端口不通 | 确认 PG 在跑、端口与防火墙；容器内用服务名 `postgres` |
| `P1017 Server has closed the connection` | 连接被中途重置（代理/VPN/中间设备） | 换直连或 SSH 隧道；本机开发常见于代理软件 |
| `Transaction already closed` | 事务超时 | 项目已用 `runInTransaction`（30s）；若仍出现说明单事务语句过多，需要拆分 |
| `404` 且代码明明写了 | 跑的是旧 `dist` | **先 build 再跑**（`nest build`），typecheck 不代表产物是新的 |
| 页面能开但数据不刷 | 前端 `/api` rewrite 目标不对 | 检查 `NEXT_PUBLIC_API_BASE_URL`；容器内应指向 `http://api:3001` |
| 迁移未应用 | 手工迁移文件没跑 | `pnpm --filter @oa/api db:deploy` |

## 7. 数据清理

e2e 或联调会在演示租户留下流程数据（单号 `OA-` / `ES-`）。清理：

```bash
pnpm --filter @oa/api db:cleanup               # 预演，只列清单
pnpm --filter @oa/api db:cleanup -- --yes      # 执行
```

只删业务记录，不动组织/用户/角色/模板/单号序列（要重置序列加 `--reset-sequences`）。
