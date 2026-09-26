import { PrismaClient } from '@prisma/client';
import { PERMISSIONS, buildPath, levelOf } from '@oa/shared';
import { hashPassword } from '../../src/common/crypto/password';
import { planPermissionPrune } from '../../src/domain/rbac/permission-sync';
import {
  DEMO_DEPARTMENTS,
  DEMO_PASSWORD,
  DEMO_TENANT,
  DEMO_USERS,
  DEMO_WORKNO_MEMBERS,
} from './data/org';
import { DEMO_ROLES, expandPermissions } from './data/roles';
import { DEFAULT_VOTE_RULE, SEED_TEMPLATES } from './data/templates';

const prisma = new PrismaClient();

async function seedTenant() {
  return prisma.tenant.upsert({
    where: { code: DEMO_TENANT.code },
    update: { name: DEMO_TENANT.name },
    create: { code: DEMO_TENANT.code, name: DEMO_TENANT.name, allowCrossLevel: false, allowAutoApprove: false },
  });
}

async function seedPermissions() {
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: { name: p.name, type: p.type, module: p.module },
      create: { code: p.code, name: p.name, type: p.type, module: p.module },
    });
  }
  return PERMISSIONS.length;
}

/**
 * 清理**孤儿权限点**：库里存在、但代码（`@oa/shared` 的 `PERMISSIONS`）里已经没有的权限。
 *
 * 为什么必须做：权限点只能由代码定义（`AdminRoleService.assertPermissionCodes` 会拒绝未知 code），
 * 所以从常量里删掉一个权限点后，库里那一行不会被任何流程清掉 —— 它会变成"幽灵"：
 * 管理后台的**权限目录**读代码常量（看不到它），**角色详情**读 DB（却能看到它）。
 * 只 upsert 不 prune 的种子会让这个偏差永久累积。
 *
 * 分类逻辑在 `src/domain/rbac/permission-sync.ts`（纯函数，有单测），这里只负责落库。
 * 关联的 `role_permissions` 由外键 `onDelete: Cascade` 自动清理；
 * 但**自定义角色**（管理员在后台建的角色）也会一并失去该权限，所以会打印受影响的角色。
 */
async function prunePermissions(): Promise<number> {
  const existing = await prisma.permission.findMany({
    select: {
      id: true,
      code: true,
      roles: { select: { role: { select: { code: true, name: true } } } },
    },
  });

  const plan = planPermissionPrune(
    PERMISSIONS.map((p) => p.code),
    existing,
  );

  if (plan.missing.length > 0) {
    console.log(`ℹ 代码新增权限点 ${plan.missing.length} 个：${plan.missing.join('、')}`);
  }
  if (plan.stale.length === 0) return 0;

  const staleIds = new Set(plan.stale.map((p) => p.id));
  const affectedRoles = new Map<string, string>();
  for (const permission of existing) {
    if (!staleIds.has(permission.id)) continue;
    for (const link of permission.roles) affectedRoles.set(link.role.code, link.role.name);
  }

  await prisma.permission.deleteMany({ where: { id: { in: [...staleIds] } } });

  console.log(`⚠ 清理孤儿权限点 ${plan.stale.length} 个：${plan.stale.map((p) => p.code).join('、')}`);
  if (affectedRoles.size > 0) {
    console.log(`  受影响角色（关联已一并移除）：${[...affectedRoles.values()].join('、')}`);
  }
  return plan.stale.length;
}

async function seedRoles(tenantId: number) {
  for (const role of DEMO_ROLES) {
    const saved = await prisma.role.upsert({
      where: { tenantId_code: { tenantId, code: role.code } },
      update: { name: role.name, dataScopeDefault: role.dataScopeDefault, isSystem: true },
      create: {
        tenantId,
        code: role.code,
        name: role.name,
        dataScopeDefault: role.dataScopeDefault,
        isSystem: true,
      },
    });

    // 幂等：先清空再按定义重建，保证权限定义变更可重复应用
    await prisma.rolePermission.deleteMany({ where: { roleId: saved.id } });
    const codes = expandPermissions(role);
    const permissions = await prisma.permission.findMany({ where: { code: { in: codes } }, select: { id: true } });
    if (permissions.length > 0) {
      await prisma.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId: saved.id, permissionId: p.id })),
        skipDuplicates: true,
      });
    }
  }
  return DEMO_ROLES.length;
}

async function seedDepartments(tenantId: number) {
  const byCode = new Map<string, { id: number; path: string; level: number }>();
  for (const dept of DEMO_DEPARTMENTS) {
    const parent = dept.parentCode ? byCode.get(dept.parentCode) : undefined;
    const existing = await prisma.department.findFirst({ where: { tenantId, code: dept.code } });

    let id: number;
    if (existing) {
      id = existing.id;
      await prisma.department.update({
        where: { id },
        data: { name: dept.name, parentId: parent?.id ?? null, workNo: dept.workNo, sort: dept.sort },
      });
    } else {
      const created = await prisma.department.create({
        data: {
          tenantId,
          name: dept.name,
          parentId: parent?.id ?? null,
          path: '/',
          level: 0,
          code: dept.code,
          workNo: dept.workNo,
          sort: dept.sort,
        },
      });
      id = created.id;
    }

    // 物化路径：父路径 + 自身 id，level 由路径深度推导
    const path = buildPath(parent?.path ?? '/', id);
    const level = levelOf(path);
    await prisma.department.update({ where: { id }, data: { path, level } });
    byCode.set(dept.code, { id, path, level });
  }
  return byCode;
}

async function seedUsers(tenantId: number, depts: Map<string, { id: number; path: string; level: number }>) {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const userIdByEmail = new Map<string, number>();

  for (const user of DEMO_USERS) {
    const saved = await prisma.user.upsert({
      where: { tenantId_email: { tenantId, email: user.email } },
      update: { name: user.name, phone: user.phone },
      create: {
        tenantId,
        email: user.email,
        name: user.name,
        phone: user.phone,
        passwordHash,
        status: 'ACTIVE',
      },
    });
    userIdByEmail.set(user.email, saved.id);

    const dept = depts.get(user.deptCode);
    if (dept) {
      await prisma.userDepartment.upsert({
        where: { userId_departmentId: { userId: saved.id, departmentId: dept.id } },
        update: { isPrimary: true, isLeader: user.isLeader, title: user.title },
        create: {
          tenantId,
          userId: saved.id,
          departmentId: dept.id,
          isPrimary: true,
          isLeader: user.isLeader,
          title: user.title,
        },
      });

      // 部门负责人回填到 Department.managerId（用于默认结论填写人兜底）
      if (user.isLeader) {
        await prisma.department.update({ where: { id: dept.id }, data: { managerId: saved.id } });
      }
    }

    for (const roleCode of user.roleCodes) {
      const role = await prisma.role.findUnique({ where: { tenantId_code: { tenantId, code: roleCode } } });
      if (!role) continue;
      const scopeType = role.dataScopeDefault === 'TENANT' ? 'TENANT' : 'DEPT';
      const scopeId = role.dataScopeDefault === 'TENANT' ? null : (dept?.id ?? null);
      const existing = await prisma.userRole.findFirst({
        where: { userId: saved.id, roleId: role.id, scopeType, scopeId },
      });
      if (!existing) {
        await prisma.userRole.create({
          data: { tenantId, userId: saved.id, roleId: role.id, scopeType, scopeId },
        });
      }
    }
  }
  return userIdByEmail;
}

async function seedWorkNoMembers(
  tenantId: number,
  depts: Map<string, { id: number; path: string; level: number }>,
  users: Map<string, number>,
) {
  const deptByWorkNo = new Map<string, number>();
  for (const dept of DEMO_DEPARTMENTS) {
    const saved = depts.get(dept.code);
    if (saved) deptByWorkNo.set(dept.workNo, saved.id);
  }

  for (const member of DEMO_WORKNO_MEMBERS) {
    const departmentId = deptByWorkNo.get(member.workNo);
    const userId = users.get(member.email);
    if (!departmentId || !userId) continue;
    await prisma.departmentWorkNoMember.upsert({
      where: { departmentId_userId: { departmentId, userId } },
      update: { isPrimary: member.isPrimary, receiveNotify: true },
      create: { tenantId, departmentId, userId, isPrimary: member.isPrimary, receiveNotify: true },
    });
  }
  return DEMO_WORKNO_MEMBERS.length;
}

async function seedTemplates(tenantId: number) {
  for (const tpl of SEED_TEMPLATES) {
    const template = await prisma.workflowTemplate.upsert({
      where: { tenantId_code: { tenantId, code: tpl.code } },
      update: { name: tpl.name, category: tpl.category, description: tpl.description, formSchema: tpl.formSchema, status: 'PUBLISHED' },
      create: {
        tenantId,
        code: tpl.code,
        name: tpl.name,
        category: tpl.category,
        description: tpl.description,
        formSchema: tpl.formSchema,
        status: 'PUBLISHED',
        deadlineMode: 'CALENDAR_DAY',
      },
    });

    const version = await prisma.workflowVersion.upsert({
      where: { templateId_version: { templateId: template.id, version: 1 } },
      update: {},
      create: {
        tenantId,
        templateId: template.id,
        version: 1,
        config: { seeded: true },
        publishedAt: new Date(),
        isLocked: true,
        changelog: '种子数据初始版本',
      },
    });

    if (!template.currentVersionId) {
      await prisma.workflowTemplate.update({
        where: { id: template.id },
        data: { currentVersionId: version.id },
      });
    }

    // 幂等：节点删除会级联清理 voterRules / voteRule / taskTemplates / escalationRules / edges
    await prisma.workflowNode.deleteMany({ where: { versionId: version.id } });

    const nodeIdByKey = new Map<string, number>();
    for (const node of tpl.nodes) {
      const created = await prisma.workflowNode.create({
        data: {
          tenantId,
          versionId: version.id,
          type: node.type,
          name: node.name,
          order: node.order,
          nodeKey: node.nodeKey,
          layerIndex: node.layerIndex ?? null,
          config: (node.config ?? {}) as object,
        },
      });
      nodeIdByKey.set(node.nodeKey, created.id);

      for (const [index, vr] of (node.voterRules ?? []).entries()) {
        await prisma.nodeVoterRule.create({
          data: {
            tenantId,
            nodeId: created.id,
            voterType: vr.voterType,
            voterValue: vr.voterValue,
            weight: vr.weight ?? 1,
            order: index,
          },
        });
      }

      if (node.voteRule) {
        const rule = { ...DEFAULT_VOTE_RULE, ...node.voteRule } as Record<string, unknown>;
        await prisma.nodeVoteRule.create({
          data: {
            tenantId,
            nodeId: created.id,
            passRule: rule.passRule as never,
            passThreshold: (rule.passThreshold ?? null) as never,
            rejectRule: rule.rejectRule as never,
            rejectThreshold: (rule.rejectThreshold ?? null) as never,
            abstainPolicy: rule.abstainPolicy as never,
            timeoutPolicy: rule.timeoutPolicy as never,
            visibility: rule.visibility as never,
            viewScope: rule.viewScope as never,
            allowAbstain: Boolean(rule.allowAbstain),
            requireAllVote: Boolean(rule.requireAllVote),
            revotePolicy: rule.revotePolicy as never,
            vetoTerminates: Boolean(rule.vetoTerminates),
            tiePolicy: rule.tiePolicy as never,
            conclusionMode: rule.conclusionMode as never,
            conclusionAuthorRule: (rule.conclusionAuthorRule ?? null) as never,
            timeoutHours: Number(rule.timeoutHours),
            remindIntervalHours: Number(rule.remindIntervalHours),
            maxRemindRounds: Number(rule.maxRemindRounds),
            conclusionTimeoutHours: Number(rule.conclusionTimeoutHours),
            quorumPolicy: rule.quorumPolicy as never,
            minQuorum: Number(rule.minQuorum),
            allowMarkAbsent: Boolean(rule.allowMarkAbsent),
          },
        });
      }

      for (const [index, task] of (node.taskTemplates ?? []).entries()) {
        await prisma.nodeTaskTemplate.create({
          data: {
            tenantId,
            nodeId: created.id,
            title: task.title,
            assigneeRule: task.assigneeRule,
            priority: (task.priority ?? 'NORMAL') as never,
            dueOffset: task.dueOffset ?? 24,
            checklist: (task.checklist ?? []) as object,
            triggerOn: task.triggerOn ?? 'PASS',
            order: index,
          },
        });
      }

      for (const esc of node.escalationRules ?? []) {
        await prisma.nodeEscalationRule.create({
          data: {
            tenantId,
            nodeId: created.id,
            triggerType: esc.triggerType as never,
            condition: (esc.condition ?? null) as never,
            targetDeptRule: (esc.targetDeptRule ?? 'DIRECT_PARENT') as never,
            timeout: esc.timeout ?? 48,
            freezeSource: esc.freezeSource ?? true,
            acceptMode: (esc.acceptMode ?? 'AUTO') as never,
            onMissingWorkNo: (esc.onMissingWorkNo ?? 'ESCALATE_UP') as never,
            maxLevel: esc.maxLevel ?? 5,
          },
        });
      }
    }

    for (const edge of tpl.edges) {
      const fromId = nodeIdByKey.get(edge.from);
      const toId = nodeIdByKey.get(edge.to);
      if (!fromId || !toId) continue;
      await prisma.workflowEdge.create({
        data: {
          tenantId,
          versionId: version.id,
          fromNodeId: fromId,
          toNodeId: toId,
          condition: (edge.condition ?? null) as never,
          priority: edge.priority ?? 0,
          label: edge.label ?? null,
        },
      });
    }
  }
  return SEED_TEMPLATES.length;
}

async function seedSequences(tenantId: number) {
  const types = ['INSTANCE', 'TASK', 'ESCALATION'];
  for (const type of types) {
    await prisma.numberSequence.upsert({
      where: { tenantId_type_period: { tenantId, type, period: 'GLOBAL' } },
      update: {},
      create: { tenantId, type, period: 'GLOBAL', nextValue: 1 },
    });
  }
  return types.length;
}

async function main() {
  console.log('▶ 开始写入种子数据…');

  const tenant = await seedTenant();
  const permissionCount = await seedPermissions();
  const roleCount = await seedRoles(tenant.id);
  // 放在 seedRoles 之后：内置角色此时已按代码定义重建完毕，prune 只需处理自定义角色上的残留
  const prunedPermissionCount = await prunePermissions();
  const depts = await seedDepartments(tenant.id);
  const users = await seedUsers(tenant.id, depts);
  const workNoCount = await seedWorkNoMembers(tenant.id, depts, users);
  const templateCount = await seedTemplates(tenant.id);
  const sequenceCount = await seedSequences(tenant.id);

  console.log('✔ 种子数据完成');
  console.table([
    { 项: '租户', 数量: 1 },
    { 项: '权限点', 数量: permissionCount },
    { 项: '清理孤儿权限点', 数量: prunedPermissionCount },
    { 项: '角色', 数量: roleCount },
    { 项: '部门', 数量: DEMO_DEPARTMENTS.length },
    { 项: '用户', 数量: DEMO_USERS.length },
    { 项: '部门工号成员', 数量: workNoCount },
    { 项: '流程模板', 数量: templateCount },
    { 项: '单号序列', 数量: sequenceCount },
  ]);
  console.log(`\n演示账号（统一密码 ${DEMO_PASSWORD}）：`);
  console.log('  管理员   admin@cloudrail.dev    （张伟 / 总经理）');
  console.log('  部门负责人 lijing@cloudrail.dev  （李静 / 产品中心总监）');
  console.log('  技术部   wangqiang@cloudrail.dev（王强 / 技术部经理）');
  console.log('  投票人   liuyang@cloudrail.dev  （刘洋）');
}

main()
  .catch((error) => {
    console.error('✘ 种子数据失败：', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
