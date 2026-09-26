import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import { submitConclusion as buildConclusion } from '../../domain/workflow/conclusion-policy';
import { WS_EVENTS, WS_ROOMS } from '@oa/shared';
import { DomainEventService } from '../../infra/events/domain-event.service';
import { InstanceAdvanceService } from '../instance/instance-advance.service';
import { TaskService } from '../task/task.service';
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
    private readonly tasks: TaskService,
    private readonly events: DomainEventService,
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
    return this.prisma.runInTransaction(async (tx) => {
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

      /**
       * C1/C3：本层通过 → 先按模板派任务 → **任务全部完成才推动下一层**。
       * 若本层没有任务模板，则维持原来的行为直接推进（不派任务就没有可等的）。
       */
      const created =
        built.nodeStatus === 'PASSED'
          ? await this.tasks.createFromNodeTemplates(tx, {
              tenantId: user.tenantId,
              instanceId: ctx.instance.id,
              instanceNodeId: ctx.node.id,
              workflowNodeId: ctx.node.nodeId,
              creatorId: user.userId,
              initiatorId: ctx.instance.initiatorId,
            })
          : { taskIds: [] as number[], skipped: [] as { title: string; reason: string }[], openTasks: 0 };

      const heldByTasks = built.nodeStatus === 'PASSED' && created.taskIds.length > 0;
      const advanced = heldByTasks
        ? {
            instanceStatus: ctx.instance.status,
            finalStatus: ctx.instance.status,
            nextNode: null,
            summary: `本层通过，已派发 ${created.taskIds.length} 个任务，任务全部完成后自动进入下一层`,
          }
        : await this.advance.advance(tx, ctx, user, built.nodeStatus);

      await this.events.emit(tx, {
        tenantId: user.tenantId,
        eventType: built.nodeStatus === 'PASSED' ? WS_EVENTS.NODE_PASSED : WS_EVENTS.NODE_REJECTED,
        aggregateType: 'NODE',
        aggregateId: ctx.node.id,
        payload: {
          instanceId: ctx.instance.id,
          instanceStatus: advanced.instanceStatus,
          heldByTasks,
          tasksCreated: created.taskIds.length,
        },
        rooms: [WS_ROOMS.instance(ctx.instance.id)],
        notifications:
          heldByTasks || advanced.finalStatus === null
            ? []
            : [
                {
                  userId: ctx.instance.initiatorId,
                  type: 'INSTANCE_FINISHED' as const,
                  title: `流程${advanced.finalStatus === 'APPROVED' ? '通过' : '驳回'}：${ctx.instance.title}`,
                  content: advanced.summary,
                  link: `/instances/${ctx.instance.id}`,
                },
              ],
        audit: {
          actorId: user.userId,
          action: 'NODE_CONCLUDE',
          targetType: 'InstanceNode',
          targetId: ctx.node.id,
          after: { decision: built.conclusion.decision, isOverride: built.isOverride },
        },
      });

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
        /** 本层派出的任务数（0 表示该层没有任务模板，已直接推进） */
        tasksCreated: created.taskIds.length,
        /** 解析不出负责人/验收人而被跳过的模板（不阻断流程，但要让调用方看见） */
        tasksSkipped: created.skipped,
        heldByTasks,
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
