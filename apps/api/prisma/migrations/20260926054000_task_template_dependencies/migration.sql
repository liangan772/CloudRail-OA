-- NodeTaskTemplate.dependsOn：在模板里声明任务依赖
-- （数字 = 本层按 order 排序后第 N 条模板，字符串 = 按 title 匹配）
--
-- 纯增量、可空、无需数据回填，因此手写迁移（原计划用 migrate dev 生成，
-- 但当时数据库网络链路不可达；生成式迁移与手写迁移在 Prisma 里等价，都会记录校验和）。
--
-- 应用方式：pnpm --filter @oa/api db:deploy（即 prisma migrate deploy）

ALTER TABLE "node_task_templates" ADD COLUMN "dependsOn" JSONB;
