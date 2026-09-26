import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { WS_EVENTS, WS_ROOMS } from '@oa/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import { DomainEventService } from '../../infra/events/domain-event.service';
import { transitionNode } from '../../domain/workflow/state-machines';
import { AuthService } from '../auth/auth.service';
import { EscalationService } from '../escalation/escalation.service';

type Tx = Prisma.TransactionClient;

export interface TimeoutScanResult {
  scanned: number;
  changed: number;
  details: string[];
}

/**
 * 超时扫描（定时任务的业务内容）。
 *
 * 三类扫描对应已确认的口径：
 * - 投票超时（A7）：催办 3 轮（默认 8h 一轮）→ 仍未全员表态则上报；**禁止超时自动通过**
 * - 结论填写超时：上报上级部门裁定，避免流程卡死
 * - 上报超时（D9）：签收 / 投票僵局 / 结论超时都逐级上溯一级
 */
@Injectable()
export class TimeoutService {
  private readonly logger = new Logger(TimeoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventService,
    private readonly escalations: EscalationService,
    private readonly auth: AuthService,
  ) {}

  /** 投票超时：按节点规则走催办或上报 */
  async scanVoteTimeouts(tenantId: number, limit = 100): Promise<TimeoutScanResult> {
    const nodes = await this.prisma.instanceNode.findMany({
      where: { tenantId, status: 'VOTING', deadline: { lt: new Date() } },
      take: limit,
      orderBy: { id: 'asc' },
      include: {
        node: { select: { voteRule: { select: { timeoutPolicy: true, remindIntervalHours: true, maxRemindRounds: true } } } },
        // 催办轮次按"池内未表态者已收到几次催办"计，取最大值即本节点的轮次
        voters: { select: { remindCount: true } },
      },
    });

    const details: string[] = [];
    for (const node of nodes) {
      const rule = node.node.voteRule;
      await this.prisma.runInTransaction(async (tx) => {
        const hit = transitionNode({ status: 'VOTING', hasUnstatedVoters: true }, 'DEADLINE_HIT');
        if (!hit.ok) throw AppError.fromDef(hit.error, hit.reason);
        await tx.instanceNode.update({
          where: { id: node.id },
          data: { status: hit.status, deadline: null },
        });

        const policy = transitionNode(
          {
            status: 'TIMEOUT',
            timeoutPolicy: (rule?.timeoutPolicy ?? 'REMIND_ONLY') as never,
            remindCount: node.voters.reduce((max, voter) => Math.max(max, voter.remindCount), 0),
            maxRemindRounds: rule?.maxRemindRounds ?? 3,
            allowAutoApprove: false,
          },
          'APPLY_POLICY',
        );
        if (!policy.ok) throw AppError.fromDef(policy.error, policy.reason);

        const isRemind = policy.status === 'VOTING';
        const remindIntervalHours = rule?.remindIntervalHours ?? 8;
        await tx.instanceNode.update({
          where: { id: node.id },
          data: {
            status: policy.status,
            ...(isRemind ? { deadline: new Date(Date.now() + remindIntervalHours * 3600_000) } : {}),
          },
        });
        if (isRemind) {
          // 记录本轮催办：池内未表态的人各 +1，作为下一轮判断"是否超轮次"的依据
          await tx.instanceNodeVoter.updateMany({
            where: { instanceNodeId: node.id, status: 'PENDING' },
            data: { remindCount: { increment: 1 }, remindedAt: new Date() },
          });
        }
        await this.events.emit(tx, {
          tenantId,
          eventType: isRemind ? WS_EVENTS.NODE_TIMEOUT : WS_EVENTS.NODE_ESCALATED,
          aggregateType: 'NODE',
          aggregateId: node.id,
          payload: { instanceId: node.instanceId, policy: rule?.timeoutPolicy ?? 'REMIND_ONLY', status: policy.status },
          rooms: [WS_ROOMS.instance(node.instanceId)],
          audit: { action: 'VOTE_TIMEOUT', targetType: 'InstanceNode', targetId: node.id, after: { status: policy.status } },
        });
        details.push(`节点 ${node.id} → ${policy.status}`);
      });
    }

    return { scanned: nodes.length, changed: details.length, details };
  }

  /** 结论填写超时 → 上报上级部门裁定 */
  async scanConclusionTimeouts(tenantId: number, limit = 100): Promise<TimeoutScanResult> {
    const nodes = await this.prisma.instanceNode.findMany({
      where: { tenantId, status: 'PENDING_CONCLUSION', conclusionDeadline: { lt: new Date() } },
      take: limit,
      orderBy: { id: 'asc' },
    });

    const details: string[] = [];
    for (const node of nodes) {
      await this.prisma.runInTransaction(async (tx) => {
        const transition = transitionNode({ status: 'PENDING_CONCLUSION' }, 'CONCLUSION_TIMEOUT');
        if (!transition.ok) throw AppError.fromDef(transition.error, transition.reason);
        await tx.instanceNode.update({
          where: { id: node.id },
          data: { status: transition.status, conclusionStatus: 'TIMEOUT' },
        });
        await this.events.emit(tx, {
          tenantId,
          eventType: WS_EVENTS.NODE_ESCALATED,
          aggregateType: 'NODE',
          aggregateId: node.id,
          payload: { instanceId: node.instanceId, reason: '结论填写超时' },
          rooms: [WS_ROOMS.instance(node.instanceId)],
          audit: { action: 'CONCLUSION_TIMEOUT', targetType: 'InstanceNode', targetId: node.id },
        });
        details.push(`节点 ${node.id} 结论超时 → ESCALATED`);
      });
    }

    return { scanned: nodes.length, changed: details.length, details };
  }

  /** 上报超时 → 逐级上溯（签收 / 投票僵局 / 结论超时） */
  async scanEscalationTimeouts(tenantId: number, limit = 100): Promise<TimeoutScanResult> {
    const escalations = await this.prisma.escalation.findMany({
      where: {
        tenantId,
        status: { in: ['SUBMITTED', 'SIGNED', 'VOTING', 'PENDING_CONCLUSION'] },
        deadline: { lt: new Date() },
      },
      take: limit,
      orderBy: { id: 'asc' },
      select: { id: true, status: true, requestedBy: true, level: true },
    });

    const details: string[] = [];
    for (const escalation of escalations) {
      try {
        // 上溯需要"操作人"：用发起该上报的人作为系统代操作者，审计仍可追溯
        const actor: AuthenticatedUser = await this.auth.buildAuthenticatedUser(escalation.requestedBy, tenantId);
        const result = await this.escalations.upgrade(
          actor,
          escalation.id,
          `上报超时（原状态 ${escalation.status}，层级 L${escalation.level}）自动上溯`,
        );
        details.push(`上报 ${escalation.id} → L${result.level}`);
      } catch (error) {
        // 已达最高层级等情况：记录但不阻断其它上报的处理
        this.logger.warn(
          `上报 ${escalation.id} 自动上溯失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return { scanned: escalations.length, changed: details.length, details };
  }
}
