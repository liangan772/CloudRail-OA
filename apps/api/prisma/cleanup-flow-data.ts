/**
 * 清理**流程数据**（实例 / 节点 / 投票 / 计票快照 / 结论 / 任务 / 上报 / 冻结记录）。
 *
 * 默认保留：租户、用户、部门、角色与权限、流程模板（含版本与节点配置）、单号序列。
 * 因为模板与组织是"配置"，流程数据是"业务记录"，清业务不该动配置。
 *
 * 用法：
 *   pnpm --filter @oa/api db:cleanup              # 预演：只统计将要删除的数据，不动库
 *   pnpm --filter @oa/api db:cleanup -- --yes     # 真正执行
 *
 * 选项：
 *   --yes                 确认执行（不加则为预演，这是默认且安全的行为）
 *   --all                 删除该租户**全部**流程数据（默认只删单号以 OA- 开头的实例）
 *   --prefix=OA-          自定义实例单号前缀（可多次传，例如 --prefix=OA- --prefix=ES-）
 *   --tenant=demo         租户 code（默认读 DEFAULT_TENANT_CODE，再兜底 demo）
 *   --reset-sequences     顺带把该租户的单号序列重置为 1
 *   --with-notifications  顺带删除引用了被删实例单号的站内通知
 *   --with-audit          顺带删除被删实体的审计日志（按 targetType + targetId 命中）
 *
 * 注意：只删除"挂在被删实例上"的任务与上报；独立任务（instanceId 为空）不会被碰。
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface Options {
  yes: boolean;
  all: boolean;
  prefixes: string[];
  tenantCode: string;
  resetSequences: boolean;
  withNotifications: boolean;
  withAudit: boolean;
}

function parseArgs(argv: string[]): Options {
  const prefixes: string[] = [];
  let tenantCode = process.env.DEFAULT_TENANT_CODE ?? 'demo';

  for (const arg of argv) {
    if (arg === '--yes') continue;
    if (arg.startsWith('--prefix=')) prefixes.push(arg.slice('--prefix='.length));
    if (arg.startsWith('--tenant=')) tenantCode = arg.slice('--tenant='.length);
  }

  return {
    yes: argv.includes('--yes'),
    all: argv.includes('--all'),
    prefixes: prefixes.length > 0 ? prefixes : ['OA-'],
    tenantCode,
    resetSequences: argv.includes('--reset-sequences'),
    withNotifications: argv.includes('--with-notifications'),
    withAudit: argv.includes('--with-audit'),
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const tenant = await prisma.tenant.findFirst({
    where: { code: options.tenantCode },
    select: { id: true, code: true, name: true },
  });
  if (!tenant) {
    console.error(`✖ 找不到租户 code=${options.tenantCode}`);
    process.exit(1);
  }

  // ---- 1. 圈定要删的实例 ----
  const instances = await prisma.workflowInstance.findMany({
    where: {
      tenantId: tenant.id,
      ...(options.all ? {} : { OR: options.prefixes.map((prefix) => ({ code: { startsWith: prefix } })) }),
    },
    select: { id: true, code: true, title: true, status: true },
    orderBy: { id: 'asc' },
  });
  const instanceIds = instances.map((item) => item.id);

  console.log(
    `▶ 租户 ${tenant.code}（${tenant.name}）｜模式：${options.all ? '全部流程数据' : `单号前缀 ${options.prefixes.join(', ')}`}`,
  );
  console.log(`  命中实例 ${instances.length} 个${instances.length > 0 ? `：${instances.map((i) => i.code).join(', ')}` : ''}`);

  if (instanceIds.length === 0) {
    console.log('✔ 没有需要清理的数据');
    return;
  }

  // ---- 2. 统计（预演与执行都先算一遍，便于对照）----
  const allInstanceIdsInTenant = (
    await prisma.workflowInstance.findMany({ where: { tenantId: tenant.id }, select: { id: true } })
  ).map((item) => item.id);
  void allInstanceIdsInTenant;

  const nodes = await prisma.instanceNode.findMany({
    where: { instanceId: { in: instanceIds } },
    select: { id: true },
  });
  const nodeIds = nodes.map((item) => item.id);

  const tasks = await prisma.task.findMany({
    where: { instanceId: { in: instanceIds } },
    select: { id: true },
  });
  const taskIds = tasks.map((item) => item.id);

  const escalations = await prisma.escalation.findMany({
    where: { instanceId: { in: instanceIds } },
    select: { id: true },
  });
  const escalationIds = escalations.map((item) => item.id);

  const counts = {
    流程实例: instances.length,
    实例节点: nodeIds.length,
    投票人快照: await prisma.instanceNodeVoter.count({ where: { instanceNodeId: { in: nodeIds } } }),
    投票记录: await prisma.vote.count({ where: { instanceNodeId: { in: nodeIds } } }),
    计票快照: await prisma.voteResult.count({ where: { instanceNodeId: { in: nodeIds } } }),
    人工结论: await prisma.voteConclusion.count({ where: { instanceNodeId: { in: nodeIds } } }),
    冻结记录: await prisma.instanceSuspension.count({ where: { instanceId: { in: instanceIds } } }),
    任务: taskIds.length,
    任务参与人: await prisma.taskAssignee.count({ where: { taskId: { in: taskIds } } }),
    任务检查项: await prisma.taskChecklist.count({ where: { taskId: { in: taskIds } } }),
    任务依赖: await prisma.taskDependency.count({
      where: { OR: [{ taskId: { in: taskIds } }, { dependsOnTaskId: { in: taskIds } }] },
    }),
    任务日志: await prisma.taskLog.count({ where: { taskId: { in: taskIds } } }),
    上报单: escalationIds.length,
    上报链路: await prisma.escalationChain.count({ where: { escalationId: { in: escalationIds } } }),
    上报记录: await prisma.escalationRecord.count({ where: { escalationId: { in: escalationIds } } }),
  };

  console.table(
    Object.entries(counts).map(([项, 数量]) => ({ 项, 数量 })),
  );

  if (!options.yes) {
    console.log('ℹ 这是预演（不会改动任何数据）。确认无误后加 --yes 执行，例如：');
    console.log('  pnpm --filter @oa/api db:cleanup -- --yes' + (options.all ? ' --all' : ''));
    return;
  }

  // ---- 3. 执行删除 ----
  // 顺序：先删子表，再删父表。任务与上报的实例外键是 SetNull、通知与审计没有外键，
  // 所以都不依赖级联，必须显式删（否则会留下孤儿数据）。
  const deleted = await prisma.$transaction(
    async (tx) => {
      const escalationRecords = await tx.escalationRecord.deleteMany({
        where: { escalationId: { in: escalationIds } },
      });
      const escalationChains = await tx.escalationChain.deleteMany({
        where: { escalationId: { in: escalationIds } },
      });
      const escalationRows = await tx.escalation.deleteMany({ where: { id: { in: escalationIds } } });
      const suspensions = await tx.instanceSuspension.deleteMany({ where: { instanceId: { in: instanceIds } } });

      const logs = await tx.taskLog.deleteMany({ where: { taskId: { in: taskIds } } });
      const checklists = await tx.taskChecklist.deleteMany({ where: { taskId: { in: taskIds } } });
      const dependencies = await tx.taskDependency.deleteMany({
        where: { OR: [{ taskId: { in: taskIds } }, { dependsOnTaskId: { in: taskIds } }] },
      });
      const assignees = await tx.taskAssignee.deleteMany({ where: { taskId: { in: taskIds } } });
      const taskRows = await tx.task.deleteMany({ where: { id: { in: taskIds } } });

      const conclusions = await tx.voteConclusion.deleteMany({ where: { instanceNodeId: { in: nodeIds } } });
      const results = await tx.voteResult.deleteMany({ where: { instanceNodeId: { in: nodeIds } } });
      const votes = await tx.vote.deleteMany({ where: { instanceNodeId: { in: nodeIds } } });
      const voters = await tx.instanceNodeVoter.deleteMany({ where: { instanceNodeId: { in: nodeIds } } });
      const nodeRows = await tx.instanceNode.deleteMany({ where: { id: { in: nodeIds } } });
      const instanceRows = await tx.workflowInstance.deleteMany({ where: { id: { in: instanceIds } } });

      let notifications = { count: 0 };
      if (options.withNotifications) {
        notifications = await tx.notification.deleteMany({
          where: {
            tenantId: tenant.id,
            OR: instances.map((instance) => ({ link: { contains: instance.code } })),
          },
        });
      }

      let auditLogs = { count: 0 };
      if (options.withAudit) {
        auditLogs = await tx.auditLog.deleteMany({
          where: {
            tenantId: tenant.id,
            OR: [
              { targetType: 'WorkflowInstance', targetId: { in: instanceIds.map(String) } },
              { targetType: 'InstanceNode', targetId: { in: nodeIds.map(String) } },
              { targetType: 'Task', targetId: { in: taskIds.map(String) } },
              { targetType: 'Escalation', targetId: { in: escalationIds.map(String) } },
            ],
          },
        });
      }

      let sequences = { count: 0 };
      if (options.resetSequences) {
        sequences = await tx.numberSequence.updateMany({
          where: { tenantId: tenant.id },
          data: { nextValue: 1 },
        });
      }

      return {
        流程实例: instanceRows.count,
        实例节点: nodeRows.count,
        投票人快照: voters.count,
        投票记录: votes.count,
        计票快照: results.count,
        人工结论: conclusions.count,
        冻结记录: suspensions.count,
        任务: taskRows.count,
        任务参与人: assignees.count,
        任务检查项: checklists.count,
        任务依赖: dependencies.count,
        任务日志: logs.count,
        上报单: escalationRows.count,
        上报链路: escalationChains.count,
        上报记录: escalationRecords.count,
        站内通知: notifications.count,
        审计日志: auditLogs.count,
        重置单号序列: sequences.count,
      };
    },
    // 清理是批量删除，给足超时（远端库 + 多表删除）
    { maxWait: 10_000, timeout: 120_000 },
  );

  console.log('✔ 清理完成，实际删除：');
  console.table(
    Object.entries(deleted)
      .filter(([, 数量]) => 数量 > 0 || 数量 === 0)
      .map(([项, 数量]) => ({ 项, 数量 })),
  );

  const remaining = await prisma.workflowInstance.count({ where: { tenantId: tenant.id } });
  console.log(`剩余流程实例：${remaining} 个`);
  console.log('保留未动：租户 / 用户 / 部门 / 角色与权限 / 流程模板 / 独立任务');
}

main()
  .catch((error) => {
    console.error('✖ 清理失败：', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
