-- 阶段 2 手工补丁：Prisma schema 语法表达不了的部分索引（partial index）
-- 依据 apps/api/prisma/README.md「Prisma schema 无法表达、必须在迁移 SQL 中手工追加的部分」。
--
-- 为什么用普通 CREATE INDEX 而不是 CREATE INDEX CONCURRENTLY：
--   本迁移作用于刚建好的空表，建索引是瞬时操作，不需要规避写并发；
--   而 Prisma 的迁移默认包在一个事务里执行，CONCURRENTLY 在事务中直接报错。
--   将来在**已有数据且仍在写入**的生产库上补同类索引时，必须改成 CONCURRENTLY 并在事务外执行。
--
-- 注意列名大小写：Prisma 未显式 @map 的字段，物理列名就是 camelCase（"tenantId" / "dueAt" / "isActive"），
-- 必须加双引号，否则 PostgreSQL 会把 tenantId 折成 tenantid 并报 42703 column does not exist。

-- 投票超时扫描：只索引进行中的节点，避免扫全表
CREATE INDEX "idx_instance_nodes_voting_deadline"
  ON "instance_nodes" ("tenantId", "status", "deadline")
  WHERE "status" = 'VOTING';

-- 任务逾期扫描：只索引未终结的任务
CREATE INDEX "idx_tasks_open_due"
  ON "tasks" ("tenantId", "dueAt")
  WHERE "status" NOT IN ('DONE', 'CANCELLED');

-- 每个任务恰好一个 OWNER、恰好一个 ACCEPTOR（服务层校验之外的数据库兜底）
CREATE UNIQUE INDEX "idx_task_one_owner"
  ON "task_assignees" ("taskId")
  WHERE "role" = 'OWNER' AND "isActive";

CREATE UNIQUE INDEX "idx_task_one_acceptor"
  ON "task_assignees" ("taskId")
  WHERE "role" = 'ACCEPTOR' AND "isActive";
