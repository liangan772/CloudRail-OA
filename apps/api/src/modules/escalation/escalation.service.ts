import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type EscalationAcceptMode,
  type EscalationTrigger,
  type TargetDeptRule,
  type WorkNoMissingPolicy,
  type WriteBackAction,
} from '@oa/shared';
import { WS_EVENTS, WS_ROOMS } from '@oa/shared';
import { DomainEventService } from '../../infra/events/domain-event.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import { resolveEscalationTarget } from '../../domain/escalation/target-resolver';
import { transitionEscalation, writeBackFromOpinion } from '../../domain/escalation/state-machine';
import { transitionInstance, transitionNode } from '../../domain/workflow/state-machines';
import { NumberingService } from '../common/numbering.service';

type Tx = Prisma.TransactionClient;

/** 规则里解析出的上报处理参数（来自 NodeEscalationRule） */
export interface EscalationRuleParams {
  targetDeptRule: TargetDeptRule;
  timeoutHours: number;
  freezeSource: boolean;
  maxLevel: number;
  acceptMode: EscalationAcceptMode;
  onMissingWorkNo: WorkNoMissingPolicy;
  targetDeptIds?: number[];
}

export interface CreateEscalationInput {
  tenantId: number;
  instanceId: number;
  /** 触发上报的实例节点（来源层） */
  sourceNodeId: number;
  requestedBy: number;
  triggerType: EscalationTrigger;
  reason: string;
  rule: EscalationRuleParams;
}

export interface EscalationCreated {
  escalationId: number;
  code: string;
  status: string;
  level: number;
  triggerType: EscalationTrigger;
  fromDeptId: number;
  fromWorkNo: string | null;
  toDeptId: number;
  toWorkNo: string | null;
  /** AUTO 模式下的上级投票节点 */
  upwardNodeId: number | null;
  upwardVoterCount: number;
  frozen: boolean;
  hops: { deptId: number; workNo: string | null; note: string }[];
  reason: string;
}

export type EscalationOpinion = 'CONTINUE' | 'RETURN' | 'REQUEST_MORE' | 'FINAL_APPROVE' | 'FINAL_REJECT';

export interface SubmitEscalationConclusionInput {
  opinion: EscalationOpinion;
  content: string;
}

/**
 * 上报引擎（EscalationEngine）。
 *
 * 已确认口径：
 * - C3/D7：上报即冻结原流程（写 `InstanceSuspension`，实例转 `ESCALATED`，计时暂停）
 * - D3/D4：投递到**上级部门的工号**，工号成员即该级投票人
 * - D6/D7：上级处理 = **再跑一次同样的投票**（复用同一套 `InstanceNode` + VoteEngine）
 * - D9：平票 / 僵局 / 结论超时 → 沿组织树再上溯一级，直到 maxLevel
 * - D2/C13：只能走直接上级，越级由纯解析器拦下
 * - D8：不通过默认 `RETURN`；终审才直接定局，不做单人裁定
 */
@Injectable()
export class EscalationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly events: DomainEventService,
  ) {}

  /** 建上报单：解析目标 → 建单 → 冻结原流程 → （AUTO）创建上级投票节点并开投 */
  async create(tx: Tx, input: CreateEscalationInput): Promise<EscalationCreated> {
    const [instance, sourceNode, departments, tenant] = await Promise.all([
      tx.workflowInstance.findFirst({
        where: { id: input.instanceId, tenantId: input.tenantId },
        select: { id: true, status: true, currentNodeId: true, layerIndex: true, initiatorId: true },
      }),
      tx.instanceNode.findFirst({
        where: { id: input.sourceNodeId, tenantId: input.tenantId },
        select: { id: true, nodeId: true, layerIndex: true, status: true },
      }),
      tx.department.findMany({
        where: { tenantId: input.tenantId },
        select: { id: true, parentId: true, path: true, level: true, workNo: true, managerId: true },
      }),
      tx.tenant.findFirst({ where: { id: input.tenantId }, select: { allowCrossLevel: true } }),
    ]);
    if (!instance) throw AppError.of('SYS_NOT_FOUND', '流程实例不存在');
    if (!sourceNode) throw AppError.of('SYS_NOT_FOUND', '触发的节点不存在');

    const initiatorDept = await this.primaryDeptOf(tx, instance.initiatorId);
    if (!initiatorDept) throw AppError.of('SYS_NOT_FOUND', '发起人没有所属部门，无法解析上报目标');

    const resolved = resolveEscalationTarget({
      rule: input.rule.targetDeptRule,
      targetDeptIds: input.rule.targetDeptIds,
      fromDeptId: initiatorDept.id,
      currentLevel: 0,
      maxLevel: input.rule.maxLevel,
      allowCrossLevel: tenant?.allowCrossLevel ?? false,
      onMissingWorkNo: input.rule.onMissingWorkNo,
      departments,
    });
    if (!resolved.ok) throw AppError.fromDef(resolved.error, resolved.reason);

    const now = new Date();
    const code = await this.numbering.next(tx, input.tenantId, 'ESCALATION');
    const escalation = await tx.escalation.create({
      data: {
        tenantId: input.tenantId,
        code,
        sourceType: 'VOTE',
        sourceId: sourceNode.id,
        instanceId: instance.id,
        fromDeptId: initiatorDept.id,
        toDeptId: resolved.target.toDeptId,
        fromWorkNo: initiatorDept.workNo,
        toWorkNo: resolved.target.toWorkNo,
        reason: input.reason,
        status: 'SUBMITTED',
        level: 1,
        triggerType: input.triggerType,
        targetRule: input.rule.targetDeptRule,
        requestedBy: input.requestedBy,
        deadline: new Date(now.getTime() + input.rule.timeoutHours * 3600_000),
        frozenInstanceStatus: instance.status as never,
        maxLevel: input.rule.maxLevel,
      },
      select: { id: true, code: true, status: true },
    });

    const chain = await tx.escalationChain.create({
      data: {
        tenantId: input.tenantId,
        escalationId: escalation.id,
        level: 1,
        deptId: resolved.target.toDeptId,
        workNo: resolved.target.toWorkNo,
        status: 'SUBMITTED',
        deadline: new Date(now.getTime() + input.rule.timeoutHours * 3600_000),
      },
      select: { id: true },
    });

    // 冻结原流程：上报期间继续投票会产生两套互相冲突的结论（D7）
    if (input.rule.freezeSource) {
      await tx.instanceSuspension.create({
        data: {
          tenantId: input.tenantId,
          instanceId: instance.id,
          escalationId: escalation.id,
          frozenStatus: instance.status as never,
          frozenNodeId: instance.currentNodeId,
        },
      });
    }
    const escalate = transitionInstance(
      { status: instance.status as never, escalationTriggered: true },
      'ESCALATE',
    );
    if (!escalate.ok) throw AppError.fromDef(escalate.error, escalate.reason);
    await tx.workflowInstance.update({
      where: { id: instance.id },
      data: { status: escalate.status, suspendedFrom: instance.status as never },
    });

    // 上级处理方式：默认投递即开投（D6：上级跑一次同样的投票，无单人裁定）
    let upwardNodeId: number | null = null;
    let upwardVoterCount = 0;
    let status: string = escalation.status;
    if (input.rule.acceptMode === 'AUTO' && resolved.target.toWorkNo) {
      const started = await this.openUpwardVote(tx, {
        tenantId: input.tenantId,
        instanceId: instance.id,
        sourceNodeId: sourceNode.id,
        sourceNodeKey: sourceNode.nodeId,
        escalationId: escalation.id,
        chainId: chain.id,
        toDeptId: resolved.target.toDeptId,
        timeoutHours: input.rule.timeoutHours,
        level: 1,
      });
      upwardNodeId = started.nodeId;
      upwardVoterCount = started.voterCount;
      status = 'VOTING';
    }

    // 通知目标工号全部成员（D3：投递给工号，不是个人）
    const targetMembers = await tx.departmentWorkNoMember.findMany({
      where: { tenantId: input.tenantId, departmentId: resolved.target.toDeptId, status: 'ACTIVE' },
      select: { userId: true },
    });
    await this.events.emit(tx, {
      tenantId: input.tenantId,
      eventType: WS_EVENTS.ESCALATION_CREATED,
      aggregateType: 'ESCALATION',
      aggregateId: escalation.id,
      payload: {
        code: escalation.code,
        toWorkNo: resolved.target.toWorkNo,
        level: 1,
        triggerType: input.triggerType,
        instanceId: instance.id,
        status,
      },
      rooms: [
        WS_ROOMS.instance(instance.id),
        ...(resolved.target.toWorkNo ? [WS_ROOMS.workno(resolved.target.toWorkNo)] : []),
      ],
      notifications: targetMembers.map((member) => ({
        userId: member.userId,
        type: 'ESCALATION_CREATED' as const,
        title: `新上报待受理：${escalation.code}`,
        content: input.reason,
        link: `/escalations/${escalation.id}`,
      })),
      audit: {
        actorId: input.requestedBy,
        action: 'ESCALATION_CREATE',
        targetType: 'Escalation',
        targetId: escalation.id,
        after: {
          triggerType: input.triggerType,
          fromWorkNo: initiatorDept.workNo,
          toWorkNo: resolved.target.toWorkNo,
          hops: resolved.target.hops,
        },
      },
    });

    return {
      escalationId: escalation.id,
      code: escalation.code,
      status,
      level: 1,
      triggerType: input.triggerType,
      fromDeptId: initiatorDept.id,
      fromWorkNo: initiatorDept.workNo,
      toDeptId: resolved.target.toDeptId,
      toWorkNo: resolved.target.toWorkNo,
      upwardNodeId,
      upwardVoterCount,
      frozen: input.rule.freezeSource,
      hops: resolved.target.hops,
      reason: resolved.target.reason,
    };
  }

  /**
   * 上级结论回写原流程（D8）。
   *
   * 注意"上级结论"本身也是**人工结论**：会为上级投票节点写一条 `VoteConclusion`，
   * 并把该节点按状态机推到 DONE —— 这样上级那一步在数据上依然是一次完整投票，而不是特殊通道。
   */
  async submitConclusion(user: AuthenticatedUser, escalationId: number, input: SubmitEscalationConclusionInput) {
    return this.prisma.runInTransaction(async (tx) => {
      const escalation = await tx.escalation.findFirst({
        where: { id: escalationId, tenantId: user.tenantId },
        select: {
          id: true,
          status: true,
          level: true,
          instanceId: true,
          sourceId: true,
          upwardInstanceNodeId: true,
          frozenInstanceStatus: true,
          toDeptId: true,
          requestedBy: true,
        },
      });
      if (!escalation) throw AppError.of('SYS_NOT_FOUND');
      if (escalation.status !== 'PENDING_CONCLUSION') {
        throw AppError.of('ESC_INVALID_TRANSITION', `上报状态为 ${escalation.status}，当前不能填写上级结论`);
      }
      if (!escalation.instanceId) throw AppError.of('SYS_NOT_FOUND', '该上报没有关联流程');

      const chain = await tx.escalationChain.findFirst({
        where: { escalationId, level: escalation.level },
        select: { id: true, deptId: true, workNo: true, status: true },
      });
      if (!chain) throw AppError.of('SYS_NOT_FOUND', '上报链路缺少当前层级');

      // 结论填写人：目标工号成员（D4/D5：工号成员即该级投票人，主责人默认填结论）
      const isWorkNoMember = await tx.departmentWorkNoMember.findFirst({
        where: { departmentId: chain.deptId, userId: user.userId, status: 'ACTIVE' },
        select: { isPrimary: true },
      });
      if (!isWorkNoMember) {
        throw AppError.of('PERM_DENIED', '你不是该上报目标工号的成员，不能填写上级结论');
      }

      const writeBackAction = writeBackFromOpinion(input.opinion);
      if (!writeBackAction) throw AppError.of('SYS_VALIDATION_FAILED', `未知上级意见：${input.opinion}`);

      const concluded = transitionEscalation(
        { status: escalation.status as never, writeBackAction },
        'SUBMIT_CONCLUSION',
      );
      if (!concluded.ok) throw AppError.fromDef(concluded.error, concluded.reason);
      const written = transitionEscalation(
        { status: concluded.status, writeBackAction },
        'WRITE_BACK',
      );
      if (!written.ok) throw AppError.fromDef(written.error, written.reason);

      const now = new Date();

      // 1) 收尾上级投票节点：写人工结论 → PASSED/REJECTED → DONE
      if (escalation.upwardInstanceNodeId) {
        await this.finalizeUpwardNode(tx, escalation.upwardInstanceNodeId, user, input, writeBackAction);
      }

      // 2) 解冻原流程，并按回写动作恢复到对应状态
      const suspension = await tx.instanceSuspension.findFirst({
        where: { instanceId: escalation.instanceId, escalationId, resumedAt: null },
        select: { id: true },
      });
      if (suspension) {
        await tx.instanceSuspension.update({
          where: { id: suspension.id },
          data: { resumedAt: now, resumeAction: writeBackAction },
        });
      }

      const sourceNode = await tx.instanceNode.findFirst({
        where: { id: escalation.sourceId },
        select: { id: true, nodeId: true, layerIndex: true, status: true, round: true },
      });

      let instanceStatus: string;
      if (writeBackAction === 'FINAL_APPROVE' || writeBackAction === 'FINAL_REJECT') {
        const finalize = transitionInstance(
          { status: 'ESCALATED', escalationOpinion: writeBackAction },
          writeBackAction === 'FINAL_APPROVE' ? 'FINAL_APPROVE' : 'FINAL_REJECT',
        );
        if (!finalize.ok) throw AppError.fromDef(finalize.error, finalize.reason);
        instanceStatus = finalize.status;
        await tx.workflowInstance.update({
          where: { id: escalation.instanceId },
          data: { status: finalize.status as never, endedAt: now },
        });
        if (escalation.upwardInstanceNodeId) {
          await tx.instanceNode.update({
            where: { id: escalation.upwardInstanceNodeId },
            data: { status: 'DONE' },
          });
        }
      } else {
        const resume = transitionInstance({ status: 'ESCALATED', escalationOpinion: 'CONTINUE' }, 'RESUME');
        if (!resume.ok) throw AppError.fromDef(resume.error, resume.reason);
        instanceStatus = resume.status;
        await tx.workflowInstance.update({
          where: { id: escalation.instanceId },
          data: {
            status: resume.status,
            ...(sourceNode ? { currentNodeId: sourceNode.id, layerIndex: sourceNode.layerIndex } : {}),
          },
        });

        // 3) 回到原层重开投票（CONTINUE / RETURN / REQUEST_MORE 都要让原层重新可用）
        if (sourceNode) {
          const reopen = transitionNode({ status: sourceNode.status as never }, 'RESUME');
          if (!reopen.ok) throw AppError.fromDef(reopen.error, reopen.reason);
          const isReturn = writeBackAction === 'RETURN';
          const nextRound = isReturn
            ? await this.nextRoundFor(tx, escalation.instanceId!, sourceNode.nodeId)
            : sourceNode.round;
          await tx.instanceNode.update({
            where: { id: sourceNode.id },
            data: {
              status: reopen.status,
              round: nextRound,
              deadline: new Date(now.getTime() + 24 * 3600_000),
              conclusionStatus: 'NOT_REQUIRED',
              conclusionDeadline: null,
              ...(isReturn ? { vetoLocked: false } : {}),
            },
          });
          if (isReturn) {
            // 退回 = 重走本层：历史票保留但作废，投票人回到待表态
            await tx.vote.updateMany({
              where: { instanceNodeId: sourceNode.id, isReplaced: false },
              data: { isReplaced: true },
            });
            await tx.instanceNodeVoter.updateMany({
              where: { instanceNodeId: sourceNode.id, status: { in: ['VOTED', 'DELEGATED'] } },
              data: { status: 'PENDING', votedAt: null },
            });
            await tx.voteResult.deleteMany({ where: { instanceNodeId: sourceNode.id } });
          }
        }
      }

      // 4) 上报单与链路归档
      await tx.escalation.update({
        where: { id: escalation.id },
        data: {
          status: written.status,
          handledBy: user.userId,
          handledAt: now,
          finalOpinion: input.content,
          writeBackAction,
          result: input.opinion,
        },
      });
      await tx.escalationChain.update({
        where: { id: chain.id },
        data: {
          status: written.status,
          actionType: writeBackAction as never,
          comment: input.content,
          handledAt: now,
        },
      });
      await tx.escalationRecord.create({
        data: {
          tenantId: user.tenantId,
          escalationId: escalation.id,
          actorId: user.userId,
          action: writeBackAction as never,
          fromStatus: escalation.status as never,
          toStatus: written.status as never,
          comment: input.content,
        },
      });

      await this.events.emit(tx, {
        tenantId: user.tenantId,
        eventType: WS_EVENTS.ESCALATION_HANDLED,
        aggregateType: 'ESCALATION',
        aggregateId: escalation.id,
        payload: {
          instanceId: escalation.instanceId,
          writeBackAction,
          instanceStatus,
          escalationStatus: written.status,
        },
        rooms: [
          WS_ROOMS.instance(escalation.instanceId),
          ...(chain.workNo ? [WS_ROOMS.workno(chain.workNo)] : []),
        ],
        notifications: [
          {
            userId: escalation.requestedBy,
            type: 'ESCALATION_HANDLED' as const,
            title: `上级已处理你的上报：${writeBackAction}`,
            content: input.content,
            link: `/instances/${escalation.instanceId}`,
          },
        ],
        audit: {
          actorId: user.userId,
          action: `ESCALATION_${writeBackAction}`,
          targetType: 'Escalation',
          targetId: escalation.id,
          after: { writeBackAction, instanceStatus },
        },
      });

      return {
        escalationId: escalation.id,
        escalationStatus: written.status,
        writeBackAction,
        instanceId: escalation.instanceId,
        instanceStatus,
        summary: written.reason,
      };
    });
  }

  /** 继续上报上一级（D9）：平票 / 僵局 / 结论超时后的逐级上溯 */
  async upgrade(user: AuthenticatedUser, escalationId: number, reason: string) {
    return this.prisma.runInTransaction(async (tx) => {
      const escalation = await tx.escalation.findFirst({
        where: { id: escalationId, tenantId: user.tenantId },
        select: {
          id: true,
          status: true,
          level: true,
          instanceId: true,
          sourceId: true,
          maxLevel: true,
          targetRule: true,
          upwardInstanceNodeId: true,
        },
      });
      if (!escalation) throw AppError.of('SYS_NOT_FOUND');
      if (escalation.status === 'CLOSED') throw AppError.of('ESC_INVALID_TRANSITION', '已归档的上报不能再上溯');
      if (!escalation.instanceId) throw AppError.of('SYS_NOT_FOUND', '该上报没有关联流程');

      const chain = await tx.escalationChain.findFirst({
        where: { escalationId, level: escalation.level },
        select: { id: true, deptId: true },
      });
      if (!chain) throw AppError.of('SYS_NOT_FOUND', '上报链路缺少当前层级');

      const [departments, tenant] = await Promise.all([
        tx.department.findMany({
          where: { tenantId: user.tenantId },
          select: { id: true, parentId: true, path: true, level: true, workNo: true, managerId: true },
        }),
        tx.tenant.findFirst({ where: { id: user.tenantId }, select: { allowCrossLevel: true } }),
      ]);

      const resolved = resolveEscalationTarget({
        rule: escalation.targetRule,
        fromDeptId: chain.deptId,
        currentToDeptId: chain.deptId,
        currentLevel: escalation.level,
        maxLevel: escalation.maxLevel,
        allowCrossLevel: tenant?.allowCrossLevel ?? false,
        onMissingWorkNo: 'ESCALATE_UP',
        departments,
      });
      if (!resolved.ok) throw AppError.fromDef(resolved.error, resolved.reason);

      const now = new Date();

      // 旧层收尾：链路置 CLOSED，旧上级投票节点作废（SKIPPED → DONE）
      await tx.escalationChain.update({
        where: { id: chain.id },
        data: { status: 'CLOSED', actionType: 'UPGRADE', comment: reason, handledAt: now },
      });
      if (escalation.upwardInstanceNodeId) {
        // 旧上级投票节点不再使用：直接置 DONE（它可能处于 VOTING / PENDING_CONCLUSION / 已超时，
        // 因此不走 SKIP 事件，避免为了状态机形式而伪造跳过原因）
        await tx.instanceNode.update({
          where: { id: escalation.upwardInstanceNodeId },
          data: { status: 'DONE', endedAt: now },
        });
      }

      const nextLevel = escalation.level + 1;
      const newChain = await tx.escalationChain.create({
        data: {
          tenantId: user.tenantId,
          escalationId,
          level: nextLevel,
          deptId: resolved.target.toDeptId,
          workNo: resolved.target.toWorkNo,
          status: 'SUBMITTED',
          deadline: new Date(now.getTime() + 48 * 3600_000),
        },
        select: { id: true },
      });

      const sourceNode = await tx.instanceNode.findFirst({
        where: { id: escalation.sourceId },
        select: { id: true, nodeId: true },
      });
      if (!sourceNode) throw AppError.of('SYS_NOT_FOUND', '来源节点不存在');

      const started = await this.openUpwardVote(tx, {
        tenantId: user.tenantId,
        instanceId: escalation.instanceId,
        sourceNodeId: sourceNode.id,
        sourceNodeKey: sourceNode.nodeId,
        escalationId,
        chainId: newChain.id,
        toDeptId: resolved.target.toDeptId,
        timeoutHours: 48,
        level: nextLevel,
      });

      await tx.escalation.update({
        where: { id: escalationId },
        data: {
          status: 'VOTING',
          level: nextLevel,
          toDeptId: resolved.target.toDeptId,
          toWorkNo: resolved.target.toWorkNo,
          upwardInstanceNodeId: started.nodeId,
          deadline: new Date(now.getTime() + 48 * 3600_000),
        },
      });
      await tx.escalationRecord.create({
        data: {
          tenantId: user.tenantId,
          escalationId,
          actorId: user.userId,
          action: 'UPGRADE',
          fromStatus: escalation.status as never,
          toStatus: 'VOTING',
          comment: reason,
        },
      });

      return {
        escalationId,
        level: nextLevel,
        toDeptId: resolved.target.toDeptId,
        toWorkNo: resolved.target.toWorkNo,
        upwardNodeId: started.nodeId,
        upwardVoterCount: started.voterCount,
        summary: resolved.target.reason,
      };
    });
  }

  /* -------------------------------- 内部 -------------------------------- */

  /** 上报列表：`mine` = 我所在工号待处理的；`all` = 我数据范围内的 */
  async list(user: AuthenticatedUser, query: { scope: 'mine' | 'all'; status?: string; instanceId?: number; keyword?: string; page: number; pageSize: number }) {
    const myWorkNos =
      query.scope === 'mine' ? await this.workNoesOf(user.tenantId, user.userId) : [];

    const where: Prisma.EscalationWhereInput = {
      tenantId: user.tenantId,
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.instanceId ? { instanceId: query.instanceId } : {}),
      ...(query.keyword
        ? {
            OR: [
              { code: { contains: query.keyword, mode: 'insensitive' } },
              { reason: { contains: query.keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.scope === 'mine'
        ? { chains: { some: { workNo: { in: myWorkNos }, status: { not: 'CLOSED' } } } }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.escalation.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          code: true,
          status: true,
          level: true,
          triggerType: true,
          fromWorkNo: true,
          toWorkNo: true,
          toDeptId: true,
          reason: true,
          createdAt: true,
          deadline: true,
          instanceId: true,
          instance: { select: { code: true, title: true, status: true } },
        },
      }),
      this.prisma.escalation.count({ where }),
    ]);

    return { items: rows, total, page: query.page, pageSize: query.pageSize };
  }

  /** 上报详情：含逐级链路与处理记录（"为什么上报、交到谁、怎么处理的"一页看完） */
  async detail(user: AuthenticatedUser, escalationId: number) {
    const escalation = await this.prisma.escalation.findFirst({
      where: { id: escalationId, tenantId: user.tenantId },
      include: {
        instance: {
          select: {
            id: true,
            code: true,
            title: true,
            status: true,
            layerIndex: true,
            suspendedFrom: true,
          },
        },
        chains: {
          orderBy: { level: 'asc' },
          include: { escalation: false },
        },
        records: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!escalation) throw AppError.of('SYS_NOT_FOUND');

    const nodeIds = [
      escalation.upwardInstanceNodeId,
      ...escalation.chains.map((chain) => chain.instanceNodeId),
    ].filter((id): id is number => id != null);

    const nodes = nodeIds.length
      ? await this.prisma.instanceNode.findMany({
          where: { id: { in: [...new Set(nodeIds)] } },
          select: {
            id: true,
            status: true,
            layerIndex: true,
            deadline: true,
            escalationId: true,
            voteResult: { select: { passed: true, isProvisional: true, approveCount: true, rejectCount: true } },
            voters: { select: { userId: true, status: true, sourceReason: true } },
          },
        })
      : [];

    return {
      ...escalation,
      upwardNodes: nodes,
      /** 目标部门是否有工号成员可处理（前端据此提示"该工号暂无成员"） */
      canBeHandled: nodes.some((node) => node.voters.length > 0),
    };
  }

  /** 我作为成员的所有部门工号 */
  private async workNoesOf(tenantId: number, userId: number): Promise<string[]> {
    const memberships = await this.prisma.departmentWorkNoMember.findMany({
      where: { tenantId, userId, status: 'ACTIVE' },
      select: { department: { select: { workNo: true } } },
    });
    return memberships.map((item) => item.department.workNo).filter((code): code is string => code != null);
  }

  /** 工号成员即该级投票人：建上级投票节点（复用来源层的投票规则）并开投 */
  private async openUpwardVote(
    tx: Tx,
    params: {
      tenantId: number;
      instanceId: number;
      sourceNodeId: number;
      sourceNodeKey: number;
      escalationId: number;
      chainId: number;
      toDeptId: number;
      timeoutHours: number;
      level: number;
    },
  ): Promise<{ nodeId: number; voterCount: number }> {
    const members = await tx.departmentWorkNoMember.findMany({
      where: { departmentId: params.toDeptId, status: 'ACTIVE' },
      orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }],
      select: { userId: true, isPrimary: true },
    });
    if (members.length === 0) {
      throw AppError.of('ESC_WORKNO_MISSING', `目标部门 ${params.toDeptId} 的工号没有配置任何成员`);
    }

    const maxLayer = await tx.instanceNode.aggregate({
      where: { instanceId: params.instanceId },
      _max: { layerIndex: true },
    });
    const layerIndex = (maxLayer._max.layerIndex ?? 0) + 1;
    const rule = await tx.nodeVoteRule.findFirst({
      where: { nodeId: params.sourceNodeKey },
      select: { timeoutHours: true, conclusionTimeoutHours: true },
    });
    const timeoutHours = rule?.timeoutHours ?? params.timeoutHours;
    const now = new Date();

    /**
     * `InstanceNode` 的唯一键是 `(instanceId, nodeId, round)`。
     * 上级投票复用来源层的 `WorkflowNode`（D7：同样的投票规则），所以 nodeId 相同，
     * round 必须取"该节点在本实例内的下一个轮次"，否则撞唯一约束。
     */
    const round = await this.nextRoundFor(tx, params.instanceId, params.sourceNodeKey);

    const node = await tx.instanceNode.create({
      data: {
        tenantId: params.tenantId,
        instanceId: params.instanceId,
        nodeId: params.sourceNodeKey,
        type: 'VOTE',
        status: 'VOTING',
        layerIndex,
        round,
        startedAt: now,
        deadline: new Date(now.getTime() + timeoutHours * 3600_000),
        escalationId: params.escalationId,
        conclusionStatus: 'NOT_REQUIRED',
      },
      select: { id: true },
    });

    await tx.instanceNodeVoter.createMany({
      data: members.map((member) => ({
        tenantId: params.tenantId,
        instanceNodeId: node.id,
        userId: member.userId,
        weight: new Prisma.Decimal(1),
        status: 'PENDING' as const,
        sourceReason: `上级部门工号成员（上报 L${params.level}）${member.isPrimary ? '，主责人' : ''}`.slice(0, 255),
      })),
    });

    await tx.escalation.update({
      where: { id: params.escalationId },
      data: { status: 'VOTING', upwardInstanceNodeId: node.id },
    });
    await tx.escalationChain.update({
      where: { id: params.chainId },
      data: { status: 'VOTING', instanceNodeId: node.id },
    });
    await tx.workflowInstance.update({
      where: { id: params.instanceId },
      data: { currentNodeId: node.id, layerIndex },
    });

    return { nodeId: node.id, voterCount: members.length };
  }

  /** 上级结论落地：给上级投票节点写人工结论，并按状态机推到 DONE */
  private async finalizeUpwardNode(
    tx: Tx,
    nodeId: number,
    user: AuthenticatedUser,
    input: SubmitEscalationConclusionInput,
    writeBackAction: WriteBackAction,
  ): Promise<void> {
    const node = await tx.instanceNode.findFirst({
      where: { id: nodeId },
      select: { id: true, round: true, status: true, voteResult: { select: { passed: true } } },
    });
    if (!node) return;

    const decision = writeBackAction === 'FINAL_APPROVE' || writeBackAction === 'CONTINUE' ? 'APPROVE' : 'REJECT';
    const systemDecision = node.voteResult?.passed ? 'APPROVE' : 'REJECT';

    await tx.voteConclusion.create({
      data: {
        tenantId: user.tenantId,
        instanceNodeId: node.id,
        round: node.round,
        authorId: user.userId,
        decision,
        systemDecision,
        isOverride: decision !== systemDecision,
        overrideReason: decision !== systemDecision ? input.content : null,
        content: input.content,
        source: 'MANUAL',
      },
    });
    await tx.voteResult.updateMany({
      where: { instanceNodeId: node.id },
      data: { passed: decision === 'APPROVE', isProvisional: false, decidedBy: user.userId, decidedAt: new Date() },
    });

    const concluded = transitionNode(
      { status: 'PENDING_CONCLUSION', canConclude: true, conclusionDecision: decision },
      'SUBMIT_CONCLUSION',
    );
    if (concluded.ok) {
      await tx.instanceNode.update({
        where: { id: node.id },
        data: { status: concluded.status, endedAt: new Date(), conclusionStatus: 'SUBMITTED' },
      });
    }
  }

  /** 该节点在本实例内的下一个轮次（唯一键是 instanceId + nodeId + round） */
  private async nextRoundFor(tx: Tx, instanceId: number, nodeId: number): Promise<number> {
    const maxRound = await tx.instanceNode.aggregate({
      where: { instanceId, nodeId },
      _max: { round: true },
    });
    return (maxRound._max.round ?? 0) + 1;
  }

  private async primaryDeptOf(
    tx: Tx,
    userId: number,
  ): Promise<{ id: number; workNo: string | null; path: string } | null> {
    const user = await tx.user.findFirst({
      where: { id: userId },
      select: {
        departments: {
          select: { isPrimary: true, department: { select: { id: true, workNo: true, path: true } } },
        },
      },
    });
    const primary = user?.departments.find((item) => item.isPrimary) ?? user?.departments[0];
    return primary?.department ?? null;
  }
}
