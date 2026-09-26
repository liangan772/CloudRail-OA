import { PrismaClient } from '@prisma/client';
import { PERMISSIONS, buildPath, levelOf } from '@oa/shared';
import { hashPassword } from '../../src/common/crypto/password';
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
  const depts = await seedDepartments(tenant.id);
  const users = await seedUsers(tenant.id, depts);
  const workNoCount = await seedWorkNoMembers(tenant.id, depts, users);
  const templateCount = await seedTemplates(tenant.id);
  const sequenceCount = await seedSequences(tenant.id);

  console.log('✔ 种子数据完成');
  console.table([
    { 项: '租户', 数量: 1 },
    { 项: '权限点', 数量: permissionCount },
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
