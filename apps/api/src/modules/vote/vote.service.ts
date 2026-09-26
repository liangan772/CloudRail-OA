import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  describeVoteRule,
  round4,
  type EscalationTrigger,
  type TallyInput,
  type VoterSnapshot,
} from '@oa/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import { voteDetailVisibility } from '../../domain/access/data-scope';
import { decideNodeProgress } from '../../domain/vote/node-progress';
import { resolveVotingPool } from '../../domain/vote/tally';
import { planConclusion } from '../../domain/workflow/conclusion-policy';
import { transitionInstance, transitionNode, type NodeEvent } from '../../domain/workflow/state-machines';
import { NodeContextService, type NodeContext, type Tx } from './node-context.service';
import { RuleEngineService } from '../rule/rule-engine.service';
import type { EscalationEvaluationResult } from '../../domain/rule/rule-engine';
import type { CastVoteBody, MarkAbsentBody, RevokeAbsentBody } from './vote.dto';

/** 池内已表态人数（VOTED / DELEGATED） */
function statedCount(voters: readonly VoterSnapshot[]): number {
  return voters.filter((voter) => voter.status === 'VOTED' || voter.status === 'DELEGATED').length;
}

@Injectable()
export class VoteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contexts: NodeContextService,
    private readonly rules: RuleEngineService,
  ) {}

  /* ---------------------------- 投票 / 改票 ---------------------------- */

  async castVote(user: AuthenticatedUser, instanceId: number, input: CastVoteBody) {
    return this.prisma.$transaction(async (tx) => {
      const ctx = await this.contexts.load(tx, user.tenantId, instanceId);
      const voter = ctx.voters.find((item) => item.userId === user.userId);
      if (!voter) throw AppError.of('VOTE_NOT_VOTER');
      if (voter.status === 'ABSENT') throw AppError.of('VOTE_ABSENT');

      const myVotes = ctx.votes
        .filter((vote) => vote.voterId === user.userId)
        .sort((a, b) => b.revoteSeq - a.revoteSeq);
      const previous = myVotes[0];
      const now = new Date();

      const guard = transitionNode(
        {
          status: ctx.node.status as never,
          isVoter: true,
          // 否决锁定不算「结论已形成」：A5 要求锁定后仍等全员表态，这些人还能投票
          conclusionFormed:
            ctx.node.status === 'PENDING_CONCLUSION' ||
            ctx.node.status === 'PASSED' ||
            ctx.node.status === 'REJECTED',
          deadlinePassed: ctx.node.deadline != null && ctx.node.deadline.getTime() < now.getTime(),
          revotePolicy: ctx.rule.revotePolicy,
          revoteCount: myVotes.length,
          conclusionDecision: input.decision,
        },
        'VOTE_CAST',
      );
      if (!guard.ok) throw AppError.fromDef(guard.error, guard.reason);

      const isRevote = guard.actions.includes('REPLACE_OLD_VOTE');
      const created = await tx.vote.create({
        data: {
          tenantId: user.tenantId,
          instanceNodeId: ctx.node.id,
          voterId: user.userId,
          decision: input.decision,
          comment: input.comment ?? null,
          weight: new Prisma.Decimal(voter.weight),
          revoteSeq: isRevote && previous ? previous.revoteSeq + 1 : 1,
        },
        select: { id: true, revoteSeq: true },
      });
      if (isRevote && previous) {
        await tx.vote.update({
          where: { id: previous.id },
          data: { isReplaced: true, replacedById: created.id },
        });
      }

      await tx.instanceNodeVoter.update({
        where: { instanceNodeId_userId: { instanceNodeId: ctx.node.id, userId: user.userId } },
        data: { status: 'VOTED', votedAt: now },
      });

      const applied = await this.recomputeAndApply(tx, ctx, user);

      return {
        instanceId,
        nodeId: ctx.node.id,
        decision: input.decision,
        isRevote,
        revoteSeq: created.revoteSeq,
        nodeStatus: applied.nodeStatus,
        vetoLocked: applied.vetoLocked,
        conclusionStatus: applied.conclusionStatus,
        progress: applied.progress,
        systemDecision: applied.systemDecision,
        appliedEvents: applied.appliedEvents,
        reason: applied.reason,
        escalation: applied.escalation,
      };
    });
  }

  /* ------------------------------ 缺席标记 ------------------------------ */

  async markAbsent(user: AuthenticatedUser, instanceId: number, input: MarkAbsentBody) {
    return this.prisma.$transaction(async (tx) => {
      const ctx = await this.contexts.load(tx, user.tenantId, instanceId);
      const targets = new Set(input.userIds);

      // 先在内存里模拟"标记缺席后"的投票池，用它算守卫需要的两个标志位
      const simulated: VoterSnapshot[] = ctx.voters.map((voter) => ({
        userId: voter.userId,
        weight: voter.weight,
        status: targets.has(voter.userId) ? 'ABSENT' : (voter.status as VoterSnapshot['status']),
      }));
      const pool = resolveVotingPool(simulated, ctx.rule.minQuorum, ctx.rule.quorumPolicy);
      const allStatedAfterAbsent = pool.pool > 0 && statedCount(simulated) >= pool.pool;

      const guard = transitionNode(
        {
          status: ctx.node.status as never,
          canMarkAbsent: user.permissions.includes('VOTE_MARK_ABSENT'),
          absentReasonProvided: input.reason.trim().length > 0,
          conclusionFormed: ctx.node.status !== 'VOTING',
          hasActiveDelegation: false, // 委托投票在阶段 3 落地
          absentBreaksQuorum: !pool.quorumSatisfied,
          allStatedAfterAbsent,
        },
        'MARK_ABSENT',
      );
      if (!guard.ok) throw AppError.fromDef(guard.error, guard.reason);

      const absentWeight = ctx.voters
        .filter((voter) => targets.has(voter.userId))
        .reduce((sum, voter) => sum + voter.weight, 0);

      await tx.instanceNodeVoter.updateMany({
        where: { instanceNodeId: ctx.node.id, userId: { in: [...targets] } },
        data: {
          status: 'ABSENT',
          absentAt: new Date(),
          absentById: user.userId,
          absentReason: input.reason,
          absentSource: input.source,
          excludedWeight: new Prisma.Decimal(absentWeight),
        },
      });

      const applied = await this.recomputeAndApply(tx, ctx, user, guard.status as string);

      return {
        instanceId,
        nodeId: ctx.node.id,
        absentUserIds: [...targets],
        nodeStatus: applied.nodeStatus,
        progress: applied.progress,
        appliedEvents: applied.appliedEvents,
        reason: guard.reason,
      };
    });
  }

  async revokeAbsent(user: AuthenticatedUser, instanceId: number, targetUserId: number, input: RevokeAbsentBody) {
    return this.prisma.$transaction(async (tx) => {
      const ctx = await this.contexts.load(tx, user.tenantId, instanceId);
      const target = ctx.voters.find((voter) => voter.userId === targetUserId);
      if (!target) throw AppError.of('SYS_NOT_FOUND', '该用户不是本层投票人');

      const guard = transitionNode(
        {
          status: ctx.node.status as never,
          canMarkAbsent: user.permissions.includes('VOTE_MARK_ABSENT'),
          conclusionFormed: ctx.node.status !== 'VOTING',
          absentReasonProvided: true,
        },
        'REVOKE_ABSENT',
      );
      if (!guard.ok) throw AppError.fromDef(guard.error, guard.reason);

      await tx.instanceNodeVoter.update({
        where: { instanceNodeId_userId: { instanceNodeId: ctx.node.id, userId: targetUserId } },
        data: {
          status: 'PENDING',
          absentAt: null,
          absentById: null,
          absentReason: null,
          absentSource: null,
          excludedWeight: null,
        },
      });

      const applied = await this.recomputeAndApply(tx, ctx, user, guard.status as string);

      return {
        instanceId,
        nodeId: ctx.node.id,
        restoredUserId: targetUserId,
        revokedReason: input.reason ?? null,
        nodeStatus: applied.nodeStatus,
        progress: applied.progress,
        appliedEvents: applied.appliedEvents,
      };
    });
  }

  /* ------------------------------ 进度查询 ------------------------------ */

  async getProgress(user: AuthenticatedUser, instanceId: number) {
    const ctx = await this.contexts.loadStandalone(user.tenantId, instanceId);
    const decisionByVoter = new Map(ctx.votes.map((vote) => [vote.voterId, vote.decision]));

    const voterUsers = await this.prisma.user.findMany({
      where: { id: { in: ctx.voters.map((voter) => voter.userId) } },
      select: {
        id: true,
        name: true,
        departments: { select: { isPrimary: true, departmentId: true } },
      },
    });
    const deptOf = new Map(
      voterUsers.map((item) => [
        item.id,
        (item.departments.find((d) => d.isPrimary) ?? item.departments[0])?.departmentId ?? null,
      ]),
    );
    const nameOf = new Map(voterUsers.map((item) => [item.id, item.name]));

    const snapshot: VoterSnapshot[] = ctx.voters.map((voter) => ({
      userId: voter.userId,
      weight: voter.weight,
      status: voter.status as VoterSnapshot['status'],
    }));
    const pool = resolveVotingPool(snapshot, ctx.rule.minQuorum, ctx.rule.quorumPolicy);
    const stated = ctx.voters.filter((voter) => voter.status === 'VOTED' || voter.status === 'DELEGATED');
    const approve = stated.filter((voter) => decisionByVoter.get(voter.userId) === 'APPROVE').length;
    const reject = stated.filter((voter) => decisionByVoter.get(voter.userId) === 'REJECT').length;

    // B1/B2/B3：本部门（含兼职）与上报链上级可见明细；其余只给聚合计数
    const details = ctx.voters
      .filter((voter) => voteDetailVisibility(user, deptOf.get(voter.userId) ?? null) === 'DETAIL')
      .map((voter) => ({
        userId: voter.userId,
        name: nameOf.get(voter.userId) ?? null,
        weight: round4(voter.weight),
        status: voter.status,
        decision: decisionByVoter.get(voter.userId) ?? null,
      }));

    const myVoter = ctx.voters.find((voter) => voter.userId === user.userId);

    return {
      instanceId,
      nodeId: ctx.node.id,
      nodeKey: ctx.node.nodeKey,
      layerIndex: ctx.node.layerIndex,
      nodeStatus: ctx.node.status,
      deadline: ctx.node.deadline,
      vetoLocked: ctx.node.vetoLocked,
      conclusionStatus: ctx.node.conclusionStatus,
      rule: describeVoteRule(ctx.rule, pool),
      progress: {
        expected: pool.expected,
        pool: pool.pool,
        absent: pool.absentUserIds.length,
        stated: stated.length,
        approve,
        reject,
        minQuorum: pool.minQuorum,
        quorumSatisfied: pool.quorumSatisfied,
      },
      myVote: myVoter
        ? { status: myVoter.status, decision: decisionByVoter.get(myVoter.userId) ?? null }
        : null,
      /** 明细数组：跨部门时为空（前端只看聚合计数），本部门可见姓名与选择 */
      details,
      detailsVisible: details.length > 0,
    };
  }

  /* -------------------------------- 内部 -------------------------------- */

  /**
   * 重新计票并施加节点事件。`forcedStatus` 用于缺席标记这类「守卫已算出目标状态」的场景。
   */
  private async recomputeAndApply(
    tx: Tx,
    ctx: NodeContext,
    user: AuthenticatedUser,
    forcedStatus?: string,
  ): Promise<{
    nodeStatus: string;
    vetoLocked: boolean;
    conclusionStatus: string;
    progress: {
      expected: number;
      pool: number;
      stated: number;
      approve: number;
      reject: number;
      quorumSatisfied: boolean;
    };
    systemDecision: string;
    appliedEvents: NodeEvent[];
    reason: string;
    escalation: { matched: EscalationEvaluationResult['matched']; errors: string[] } | null;
  }> {
    const [voters, votes] = await Promise.all([
      tx.instanceNodeVoter.findMany({
        where: { instanceNodeId: ctx.node.id },
        select: { userId: true, weight: true, status: true },
      }),
      tx.vote.findMany({
        where: { instanceNodeId: ctx.node.id, isReplaced: false },
        select: { voterId: true, decision: true, weight: true },
      }),
    ]);

    const input: TallyInput = {
      voters: voters.map((voter) => ({
        userId: voter.userId,
        weight: Number(voter.weight),
        status: voter.status as VoterSnapshot['status'],
      })),
      votes: votes.map((vote) => ({
        voterId: vote.voterId,
        decision: vote.decision as 'APPROVE' | 'REJECT' | 'ABSTAIN',
        weight: Number(vote.weight),
      })),
      rule: ctx.rule,
    };
    const decision = decideNodeProgress(input);
    const { tally } = decision;

    /**
     * 上报条件优先于正常结论：本层即将进入结论阶段时，先跑节点上的上报规则
     * （如「金额超 5 万自动上报」）。命中就上报，不写拟判定结论 ——
     * 否则会出现"既出了结论又上报"的双份口径。
     */
    const wouldEnterConclusion =
      decision.events.includes('VETO_TERMINATE') || (decision.allStated && decision.readyForConclusion);
    let escalationResult: EscalationEvaluationResult | null = null;

    if (wouldEnterConclusion) {
      /**
       * 只有"看数据条件"的触发源在出结论这一刻适用。
       * `QUORUM_NOT_MET` / `TASK_OVERDUE` / `TIMEOUT` / 结论超时这类由各自场景或定时任务触发，
       * 放到这里会因为没有条件而每次结论都误判上报。
       */
      const applicableTriggers: EscalationTrigger[] = [
        'OVER_LIMIT',
        'CROSS_DEPT_DISPUTE',
        'INSUFFICIENT_PERMISSION',
        'MANUAL',
        'REPEATED_REJECT',
      ];
      if (tally.tieDetected) applicableTriggers.push('TIE');

      escalationResult = await this.rules.checkForNode(tx, {
        tenantId: ctx.instance.tenantId,
        nodeId: ctx.node.nodeId,
        instance: {
          id: ctx.instance.id,
          code: ctx.instance.code,
          title: ctx.instance.title,
          status: ctx.instance.status,
          layerIndex: ctx.node.layerIndex,
          priority: ctx.instance.priority,
        },
        formData: ctx.instance.formData,
        actor: { userId: user.userId },
        triggers: applicableTriggers,
        voteResult: {
          approve: tally.counts.approve,
          reject: tally.counts.reject,
          denominator: tally.denominator,
          passed: tally.systemDecision === 'APPROVE',
          tie: tally.tieDetected,
        },
      });

      if (escalationResult.matched.length > 0) {
        const transition = transitionNode({ status: ctx.node.status as never }, 'ESCALATE');
        if (!transition.ok) throw AppError.fromDef(transition.error, transition.reason);

        const triggers = escalationResult.matched.map((hit) => ({
          ruleId: hit.ruleId,
          triggerType: hit.triggerType,
          triggerLabel: hit.triggerLabel,
          reason: hit.reason,
          target: hit.target,
        }));

        await tx.instanceNode.update({
          where: { id: ctx.node.id },
          data: {
            status: transition.status as never,
            // 上报单实体与冻结在阶段 3 的 EscalationEngine 落地；这里先把命中依据落进 result，避免丢信息
            result: { escalationPending: { triggers, decidedAt: new Date().toISOString() } } as unknown as Prisma.InputJsonValue,
          },
        });

        /**
         * 只把**节点**标成 ESCALATED，实例状态先不动。
         *
         * 实例转 ESCALATED 的语义是"流程正在上报中"，而 `Escalation` 实体、流程冻结与通知
         * 要到阶段 3 的 EscalationEngine 才落地。提前改实例状态会造出"实例说在上报、
         * 却查不到上报单"的中间态；命中依据已写进 `node.result.escalationPending`，
         * 阶段 3 建单时接上即可（届时这里换成 ESCALATE 事件 + 建单 + 冻结）。
         */

        return {
          nodeStatus: transition.status as string,
          vetoLocked: decision.vetoLocked || ctx.node.vetoLocked,
          conclusionStatus: ctx.node.conclusionStatus,
          progress: {
            expected: tally.pool.expected,
            pool: tally.pool.pool,
            stated: statedCount(input.voters),
            approve: tally.counts.approve,
            reject: tally.counts.reject,
            quorumSatisfied: tally.pool.quorumSatisfied,
          },
          systemDecision: tally.systemDecision,
          appliedEvents: ['ESCALATE'],
          reason: `命中上报规则，本层待上报：${triggers
            .map((trigger) => `${trigger.triggerLabel}（${trigger.reason}）`)
            .join('；')}`,
          escalation: { matched: escalationResult.matched, errors: escalationResult.errors },
        };
      }
    }

    let status = forcedStatus ?? ctx.node.status;
    let vetoLocked = ctx.node.vetoLocked;
    let conclusionStatus = ctx.node.conclusionStatus;
    const appliedEvents: NodeEvent[] = [];

    for (const event of decision.events) {
      const transition = transitionNode(
        {
          status: status as never,
          vetoLocked: decision.vetoLocked,
          vetoTerminates: ctx.rule.vetoTerminates,
          hasUnstatedVoters: !decision.allStated,
        },
        event,
      );
      if (!transition.ok) {
        // 计票与状态机口径不一致属于实现缺陷，直接暴露而不是静默跳过
        throw AppError.fromDef(transition.error, `节点事件 ${event} 被拒绝：${transition.reason}`);
      }
      status = transition.status;
      appliedEvents.push(event);
      if (event === 'VETO_LOCK' || event === 'VETO_TERMINATE') vetoLocked = true;
    }

    const enteredConclusion =
      appliedEvents.includes('ALL_STATED') || appliedEvents.includes('VETO_TERMINATE');
    if (enteredConclusion) {
      const plan = planConclusion(ctx.rule.conclusionMode, decision.tally);
      if (plan.ok) {
        conclusionStatus = plan.conclusionStatus;
        const resultPayload = {
          approveCount: decision.tally.counts.approve,
          rejectCount: decision.tally.counts.reject,
          abstainCount: decision.tally.counts.abstain,
          weightedScore: new Prisma.Decimal(decision.tally.weighted.approve),
          denominator: decision.tally.denominator,
          passed: decision.tally.systemDecision === 'APPROVE',
          isProvisional: true,
          snapshot: decision.tally as unknown as Prisma.InputJsonValue,
          ruleSnapshot: ctx.rule as unknown as Prisma.InputJsonValue,
        };
        await tx.voteResult.upsert({
          where: { instanceNodeId: ctx.node.id },
          create: {
            tenantId: ctx.instance.tenantId,
            instanceNodeId: ctx.node.id,
            ...resultPayload,
          },
          update: resultPayload,
        });
      }
    }

    await tx.instanceNode.update({
      where: { id: ctx.node.id },
      data: {
        status: status as never,
        vetoLocked,
        ...(enteredConclusion
          ? {
              conclusionStatus: conclusionStatus as never,
              conclusionDeadline:
                conclusionStatus === 'PENDING'
                  ? new Date(Date.now() + ctx.rule.conclusionTimeoutHours * 3600_000)
                  : null,
            }
          : {}),
      },
    });

    /**
     * 因法定人数不足上报时同样**只标节点**，实例状态留给阶段 3 的 EscalationEngine：
     * 它建出 Escalation 单、写冻结记录、通知上级工号之后再改实例状态，语义才完整。
     */

    return {
      nodeStatus: status,
      vetoLocked,
      conclusionStatus,
      progress: {
        expected: decision.tally.pool.expected,
        pool: decision.tally.pool.pool,
        stated: statedCount(input.voters),
        approve: decision.tally.counts.approve,
        reject: decision.tally.counts.reject,
        quorumSatisfied: decision.tally.pool.quorumSatisfied,
      },
      systemDecision: decision.tally.systemDecision,
      appliedEvents,
      reason: decision.reason,
      // 未命中时也要把规则自身的错误带出去（脏规则不能静默消失）
      escalation: escalationResult ? { matched: escalationResult.matched, errors: escalationResult.errors } : null,
    };
  }
}
