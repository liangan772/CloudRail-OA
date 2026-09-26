import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import { submitConclusion as buildConclusion } from '../../domain/workflow/conclusion-policy';
import { InstanceAdvanceService } from '../instance/instance-advance.service';
import { NodeContextService, type NodeContext, type Tx } from './node-context.service';
import type { SubmitConclusionBody } from './vote.dto';

/** 节点规则里的结论填写人规则（`NodeVoteRule.conclusionAuthorRule`） */
interface ConclusionAuthorRule {
  type?: 'DEPT_WORKNO' | 'ROLE' | 'USER' | 'ESCALATION_HANDLER';
  deptRef?: 'INITIATOR_DEPT' | 'PARENT_DEPT' | 'FIXED';
  roleCodes?: string[];
  userIds?: number[];
  primaryOnly?: boolean;
}

@Injectable()
export class ConclusionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contexts: NodeContextService,
    private readonly advance: InstanceAdvanceService,
  ) {}

  /**
   * 提交人工结论。
   *
   * 门槛（任一不满足即拒绝）：
   * 1. 节点必须处于 `PENDING_CONCLUSION`（池内全员表态后才可能出现）；
   * 2. 操作人必须是结论文档的合法填写人（A11：默认本部门工号主责人，无工号回退部门负责人）；
   * 3. 改判系统拟判定必须填理由，且具备 `NODE_CONCLUDE_OVERRIDE` 权限。
   */
  async submitConclusion(user: AuthenticatedUser, instanceId: number, input: SubmitConclusionBody) {
    return this.prisma.$transaction(async (tx) => {
      const ctx = await this.contexts.load(tx, user.tenantId, instanceId);
      if (ctx.node.status !== 'PENDING_CONCLUSION') {
        throw AppError.of('NODE_INVALID_TRANSITION', `当前节点状态为 ${ctx.node.status}，不能填写结论`);
      }
      if (!ctx.voteResult) throw AppError.of('SYS_INTERNAL_ERROR', '缺少计票结果快照，无法结论');

      const authors = await this.resolveAuthors(tx, ctx);
      if (!authors.includes(user.userId)) {
        throw AppError.of('VOTE_CONCLUSION_AUTHOR_REQUIRED', '你不是本层结论填写人');
      }

      const systemDecision = ctx.voteResult.passed ? ('APPROVE' as const) : ('REJECT' as const);
      const built = buildConclusion({
        mode: ctx.rule.conclusionMode,
        systemDecision,
        decision: input.decision,
        content: input.content,
        overrideReason: input.overrideReason,
        authorId: user.userId,
      });
      if (!built.ok) throw AppError.fromDef(built.error, built.reason);
      if (built.isOverride && !user.permissions.includes('NODE_CONCLUDE_OVERRIDE')) {
        throw AppError.of('PERM_DENIED', '改判系统判定需要 NODE_CONCLUDE_OVERRIDE 权限');
      }

      await tx.voteConclusion.create({
        data: {
          tenantId: user.tenantId,
          instanceNodeId: ctx.node.id,
          round: ctx.node.round,
          authorId: user.userId,
          decision: built.conclusion.decision,
          systemDecision: built.conclusion.systemDecision,
          isOverride: built.conclusion.isOverride,
          overrideReason: built.conclusion.overrideReason ?? null,
          content: built.conclusion.content,
          attachments: (input.attachments ?? []) as unknown as Prisma.InputJsonValue,
          source: built.conclusion.source,
        },
      });

      await tx.voteResult.update({
        where: { instanceNodeId: ctx.node.id },
        data: {
          passed: built.conclusion.decision === 'APPROVE',
          isProvisional: false,
          decidedBy: user.userId,
          decidedAt: new Date(),
        },
      });

      await tx.instanceNode.update({
        where: { id: ctx.node.id },
        data: { status: built.nodeStatus, endedAt: new Date(), conclusionStatus: 'SUBMITTED' },
      });

      // 节点落到 PASSED / REJECTED 后由推进服务决定开下一层还是给流程定局
      const advanced = await this.advance.advance(tx, ctx, user, built.nodeStatus);

      // 本层通过后应派的任务数：任务实体由阶段 3 的 TaskEngine 创建，
      // 这里只如实报告"有几条待派"，不落半成品任务（避免没有 OWNER/ACCEPTOR 的脏数据）
      const pendingTaskTemplates =
        built.nodeStatus === 'PASSED'
          ? await tx.nodeTaskTemplate.count({ where: { nodeId: ctx.node.nodeId, triggerOn: 'PASS' } })
          : 0;

      return {
        instanceId,
        nodeId: ctx.node.id,
        nodeStatus: built.nodeStatus,
        instanceStatus: advanced.instanceStatus,
        finalStatus: advanced.finalStatus,
        nextNode: advanced.nextNode,
        conclusion: built.conclusion,
        isOverride: built.isOverride,
        summary: advanced.summary,
        pendingTaskTemplates,
      };
    });
  }

  /**
   * 结论填写人解析。
   *
   * A11 口径：**本部门工号主责人**；工号没有主责人就退回任一工号成员；
   * 整个部门都没配工号才回退到部门负责人。这样"谁填结论"不依赖临时指派。
   */
  private async resolveAuthors(tx: Tx, ctx: NodeContext): Promise<number[]> {
    const rule = await tx.nodeVoteRule.findFirst({
      where: { nodeId: ctx.node.nodeId },
      select: { conclusionAuthorRule: true },
    });
    const authorRule = (rule?.conclusionAuthorRule ?? null) as ConclusionAuthorRule | null;

    if (authorRule?.type === 'USER') return authorRule.userIds ?? [];

    const initiator = await tx.user.findFirst({
      where: { id: ctx.instance.initiatorId },
      select: {
        departments: {
          select: {
            isPrimary: true,
            departmentId: true,
            department: { select: { parentId: true, managerId: true } },
          },
        },
      },
    });
    const primary = initiator?.departments.find((d) => d.isPrimary) ?? initiator?.departments[0];
    const initiatorDeptId = primary?.departmentId ?? null;
    const parentDeptId = primary?.department.parentId ?? null;

    if (authorRule?.type === 'ROLE' && (authorRule.roleCodes?.length ?? 0) > 0) {
      const users = await tx.user.findMany({
        where: {
          tenantId: ctx.instance.tenantId,
          status: 'ACTIVE',
          roles: { some: { role: { code: { in: authorRule.roleCodes } } } },
          ...(initiatorDeptId != null ? { departments: { some: { departmentId: initiatorDeptId } } } : {}),
        },
        select: { id: true },
      });
      return users.map((item) => item.id);
    }

    // 默认（含 DEPT_WORKNO、未配置、ESCAPATION_HANDLER 之外的未知类型）：发起人所在部门工号
    const targetDeptId = authorRule?.deptRef === 'PARENT_DEPT' ? parentDeptId : initiatorDeptId;
    if (targetDeptId != null) {
      const members = await tx.departmentWorkNoMember.findMany({
        where: { departmentId: targetDeptId, status: 'ACTIVE' },
        orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }],
        select: { userId: true, isPrimary: true },
      });
      const primaryMembers = members.filter((member) => member.isPrimary);
      if (primaryMembers.length > 0) return primaryMembers.map((member) => member.userId);
      if (members.length > 0) return members.map((member) => member.userId);

      const dept = await tx.department.findFirst({
        where: { id: targetDeptId },
        select: { managerId: true },
      });
      if (dept?.managerId != null) return [dept.managerId];
    }

    if (primary?.department.managerId != null) return [primary.department.managerId];
    return [];
  }
}
