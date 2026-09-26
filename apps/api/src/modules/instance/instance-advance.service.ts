import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import { validateNodeGraph } from '../../domain/workflow/graph';
import { transitionInstance, transitionNode } from '../../domain/workflow/state-machines';
import { resolveVoters } from '../../domain/vote/voter-resolution';
import type { NodeContext, Tx } from '../vote/node-context.service';
import { VoterDirectoryService } from './voter-directory.service';

/**
 * 层级推进：本层出结论后，要么开下一层，要么给流程定局并归档。
 *
 * 抽成独立 provider 的原因：结论接口与阶段 3 的「任务完成推动下一层」都要走同一段逻辑，
 * 复制两份必然漂移（比如一处记得回写 currentNodeId、另一处忘了）。
 */
@Injectable()
export class InstanceAdvanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly directory: VoterDirectoryService,
  ) {}

  async advance(
    tx: Tx,
    ctx: NodeContext,
    user: AuthenticatedUser,
    nodeStatus: 'PASSED' | 'REJECTED',
  ): Promise<{
    instanceStatus: string;
    finalStatus: string | null;
    nextNode: { id: number; layerIndex: number; voters: number } | null;
    summary: string;
  }> {
    const nextNode = nodeStatus === 'PASSED' ? await this.openNextLayer(tx, ctx, user) : null;
    const hasNextLayer = nextNode != null;

    const transition = transitionInstance(
      { status: ctx.instance.status as never, hasNextLayer, escalationTriggered: false },
      nodeStatus === 'PASSED' ? 'NODE_PASSED' : 'NODE_REJECTED',
    );
    if (!transition.ok) throw AppError.fromDef(transition.error, transition.reason);

    let instanceStatus = transition.status;
    const finalStatus = transition.status;

    // 已确认规则 C2：最后一层通过 → APPROVED、任一层驳回 → REJECTED，随后归档关闭
    if (instanceStatus === 'APPROVED' || instanceStatus === 'REJECTED') {
      const close = transitionInstance({ status: instanceStatus as never }, 'CLOSE');
      if (!close.ok) throw AppError.fromDef(close.error, close.reason);
      instanceStatus = close.status;
      await tx.workflowInstance.update({
        where: { id: ctx.instance.id },
        data: { status: close.status as never, endedAt: new Date() },
      });
    } else {
      await tx.workflowInstance.update({
        where: { id: ctx.instance.id },
        data: {
          status: instanceStatus as never,
          ...(nextNode ? { currentNodeId: nextNode.id, layerIndex: nextNode.layerIndex } : {}),
        },
      });
    }

    return {
      instanceStatus,
      finalStatus,
      nextNode,
      summary: hasNextLayer
        ? '本层通过，已开启下一层投票'
        : `本层${finalStatus === 'APPROVED' ? '通过' : '驳回'}，流程已归档`,
    };
  }

  /** 开启下一层：解析投票人 → 建 InstanceNode + 快照 → OPEN 到 VOTING */
  private async openNextLayer(
    tx: Tx,
    ctx: NodeContext,
    user: AuthenticatedUser,
  ): Promise<{ id: number; layerIndex: number; voters: number } | null> {
    const version = await tx.workflowVersion.findFirst({
      where: { id: ctx.instance.templateVersionId },
      include: {
        nodes: {
          orderBy: { order: 'asc' },
          include: { voterRules: { orderBy: { order: 'asc' } }, voteRule: true },
        },
        edges: true,
      },
    });
    if (!version) return null;

    const keyById = new Map(version.nodes.map((node) => [node.id, node.nodeKey]));
    const graph = validateNodeGraph(
      version.nodes.map((node) => ({
        nodeKey: node.nodeKey,
        type: node.type,
        layerIndex: node.layerIndex,
        name: node.name,
      })),
      version.edges.map((edge) => ({
        from: keyById.get(edge.fromNodeId) ?? '',
        to: keyById.get(edge.toNodeId) ?? '',
      })),
    );
    if (!graph.ok) throw AppError.fromDef(graph.error, `节点图不合法：${graph.reasons.join('；')}`);

    const voteKeys = graph.topologicalOrder.filter(
      (key) => version.nodes.find((node) => node.nodeKey === key)?.type === 'VOTE',
    );
    const currentIndex = voteKeys.indexOf(ctx.node.nodeKey);
    const nextKey = currentIndex >= 0 ? voteKeys[currentIndex + 1] : undefined;
    if (!nextKey) return null;

    const nextNodeDef = version.nodes.find((node) => node.nodeKey === nextKey);
    if (!nextNodeDef) return null;

    const instance = await tx.workflowInstance.findFirst({
      where: { id: ctx.instance.id },
      select: { formData: true },
    });
    const initiator = await tx.user.findFirst({
      where: { id: ctx.instance.initiatorId },
      select: { departments: { select: { isPrimary: true, departmentId: true } } },
    });
    const initiatorDeptId =
      (initiator?.departments.find((d) => d.isPrimary) ?? initiator?.departments[0])?.departmentId ?? null;

    const baseDirectory = await this.directory.load(user, initiatorDeptId);
    const resolution = resolveVoters(
      nextNodeDef.voterRules.map((rule) => ({
        id: rule.id,
        voterType: rule.voterType,
        voterValue: (rule.voterValue ?? {}) as Record<string, unknown>,
        weight: Number(rule.weight),
        isRequired: rule.isRequired,
        order: rule.order,
      })),
      baseDirectory,
      (instance?.formData ?? {}) as Record<string, unknown>,
    );
    if (resolution.voters.length === 0) {
      throw AppError.of(
        'NODE_VOTER_EMPTY',
        `下一层「${nextNodeDef.name}」没有解析出投票人：${resolution.notes.join('；')}`,
      );
    }

    const open = transitionNode(
      { status: 'PENDING', isFirstLayer: false, prevNodeDone: true, voterCount: resolution.voters.length },
      'OPEN',
    );
    if (!open.ok) throw AppError.fromDef(open.error, open.reason);

    const now = new Date();
    const layerIndex = nextNodeDef.layerIndex ?? ctx.node.layerIndex + 1;
    const created = await tx.instanceNode.create({
      data: {
        tenantId: ctx.instance.tenantId,
        instanceId: ctx.instance.id,
        nodeId: nextNodeDef.id,
        type: nextNodeDef.type,
        status: open.status,
        layerIndex,
        round: 1,
        startedAt: now,
        deadline: new Date(now.getTime() + (nextNodeDef.voteRule?.timeoutHours ?? 24) * 3600_000),
        conclusionStatus: 'NOT_REQUIRED',
      },
      select: { id: true },
    });

    await tx.instanceNodeVoter.createMany({
      data: resolution.voters.map((voter) => ({
        tenantId: ctx.instance.tenantId,
        instanceNodeId: created.id,
        userId: voter.userId,
        weight: new Prisma.Decimal(voter.weight),
        status: 'PENDING' as const,
        sourceRuleId: voter.sourceRuleId,
        sourceReason: voter.sourceReason,
      })),
    });

    return { id: created.id, layerIndex, voters: resolution.voters.length };
  }
}
