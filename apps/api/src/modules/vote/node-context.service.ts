import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { VoteRuleConfig } from '@oa/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';

export type Tx = Prisma.TransactionClient;

/** 投票/结论需要的节点上下文（当前层 + 投票人 + 最新票 + 规则） */
export interface NodeContext {
  instance: {
    id: number;
    tenantId: number;
    status: string;
    initiatorId: number;
    currentNodeId: number | null;
    templateVersionId: number;
    layerIndex: number;
    code: string;
    title: string;
    priority: string;
    formData: Record<string, unknown>;
  };
  node: {
    id: number;
    nodeId: number;
    status: string;
    layerIndex: number;
    round: number;
    deadline: Date | null;
    vetoLocked: boolean;
    conclusionStatus: string;
    conclusionDeadline: Date | null;
    nodeKey: string;
  };
  voters: { userId: number; weight: number; status: string }[];
  /** 只含最新票（isReplaced=false） */
  votes: { id: number; voterId: number; decision: string; weight: number; revoteSeq: number }[];
  rule: VoteRuleConfig;
  voteResult: { passed: boolean } | null;
}

/**
 * 节点上下文装载：投票、缺席标记、结论三处都要用同一份口径，
 * 所以独立成 provider，避免各写一份 include 导致字段漂移。
 */
@Injectable()
export class NodeContextService {
  constructor(private readonly prisma: PrismaService) {}

  load(tx: Tx, tenantId: number, instanceId: number): Promise<NodeContext> {
    return this.loadIn(tx, tenantId, instanceId);
  }

  /** 命令式用法（无事务时自动包一层） */
  async loadStandalone(tenantId: number, instanceId: number): Promise<NodeContext> {
    return this.prisma.$transaction((tx) => this.loadIn(tx, tenantId, instanceId));
  }

  private async loadIn(tx: Tx, tenantId: number, instanceId: number): Promise<NodeContext> {
    const instance = await tx.workflowInstance.findFirst({
      where: { id: instanceId, tenantId },
      select: {
        id: true,
        tenantId: true,
        status: true,
        initiatorId: true,
        currentNodeId: true,
        templateVersionId: true,
        layerIndex: true,
        code: true,
        title: true,
        priority: true,
        formData: true,
      },
    });
    if (!instance) throw AppError.of('SYS_NOT_FOUND');
    if (!instance.currentNodeId) throw AppError.of('SYS_NOT_FOUND', '当前没有进行中的节点');

    const node = await tx.instanceNode.findFirst({
      where: { id: instance.currentNodeId, tenantId },
      include: {
        // 投票规则挂在 WorkflowNode 上（NodeVoteRule.nodeId），不是挂在实例节点上
        node: { select: { nodeKey: true, voteRule: true } },
        voters: { select: { userId: true, weight: true, status: true }, orderBy: { userId: 'asc' } },
        votes: {
          where: { isReplaced: false },
          select: { id: true, voterId: true, decision: true, weight: true, revoteSeq: true },
        },
        voteResult: { select: { passed: true } },
      },
    });
    if (!node) throw AppError.of('SYS_NOT_FOUND', '节点不存在');
    const voteRule = node.node.voteRule;
    if (!voteRule) throw AppError.of('RULE_INVALID', '本层没有配置投票规则');

    return {
      instance: {
        id: instance.id,
        tenantId: instance.tenantId,
        status: instance.status,
        initiatorId: instance.initiatorId,
        currentNodeId: instance.currentNodeId,
        templateVersionId: instance.templateVersionId,
        layerIndex: instance.layerIndex,
        code: instance.code,
        title: instance.title,
        priority: instance.priority,
        formData: (instance.formData ?? {}) as Record<string, unknown>,
      },
      node: {
        id: node.id,
        nodeId: node.nodeId,
        status: node.status,
        layerIndex: node.layerIndex,
        round: node.round,
        deadline: node.deadline,
        vetoLocked: node.vetoLocked,
        conclusionStatus: node.conclusionStatus,
        conclusionDeadline: node.conclusionDeadline,
        nodeKey: node.node.nodeKey,
      },
      voters: node.voters.map((voter) => ({
        userId: voter.userId,
        weight: Number(voter.weight),
        status: voter.status,
      })),
      votes: node.votes.map((vote) => ({
        id: vote.id,
        voterId: vote.voterId,
        decision: vote.decision,
        weight: Number(vote.weight),
        revoteSeq: vote.revoteSeq,
      })),
      rule: toRuleConfig(voteRule),
      voteResult: node.voteResult,
    };
  }
}

/** DB 行 → 计票引擎规则配置（Decimal 转 number，枚举直通） */
export function toRuleConfig(rule: {
  passRule: string;
  passThreshold: Prisma.Decimal | null;
  rejectRule: string;
  rejectThreshold: Prisma.Decimal | null;
  abstainPolicy: string;
  timeoutPolicy: string;
  visibility: string;
  viewScope: string;
  allowAbstain: boolean;
  requireAllVote: boolean;
  revotePolicy: string;
  vetoTerminates: boolean;
  tiePolicy: string;
  conclusionMode: string;
  timeoutHours: number;
  remindIntervalHours: number;
  maxRemindRounds: number;
  conclusionTimeoutHours: number;
  quorumPolicy: string;
  minQuorum: Prisma.Decimal;
  allowMarkAbsent: boolean;
}): VoteRuleConfig {
  return {
    passRule: rule.passRule as VoteRuleConfig['passRule'],
    passThreshold: rule.passThreshold == null ? undefined : Number(rule.passThreshold),
    rejectRule: rule.rejectRule as VoteRuleConfig['rejectRule'],
    rejectThreshold: rule.rejectThreshold == null ? undefined : Number(rule.rejectThreshold),
    abstainPolicy: rule.abstainPolicy as VoteRuleConfig['abstainPolicy'],
    timeoutPolicy: rule.timeoutPolicy as VoteRuleConfig['timeoutPolicy'],
    visibility: rule.visibility as VoteRuleConfig['visibility'],
    viewScope: rule.viewScope as VoteRuleConfig['viewScope'],
    allowAbstain: rule.allowAbstain,
    requireAllVote: rule.requireAllVote,
    revotePolicy: rule.revotePolicy as VoteRuleConfig['revotePolicy'],
    vetoTerminates: rule.vetoTerminates,
    tiePolicy: rule.tiePolicy as VoteRuleConfig['tiePolicy'],
    conclusionMode: rule.conclusionMode as VoteRuleConfig['conclusionMode'],
    timeoutHours: rule.timeoutHours,
    remindIntervalHours: rule.remindIntervalHours,
    maxRemindRounds: rule.maxRemindRounds,
    conclusionTimeoutHours: rule.conclusionTimeoutHours,
    quorumPolicy: rule.quorumPolicy as VoteRuleConfig['quorumPolicy'],
    minQuorum: Number(rule.minQuorum),
    allowMarkAbsent: rule.allowMarkAbsent,
  };
}
