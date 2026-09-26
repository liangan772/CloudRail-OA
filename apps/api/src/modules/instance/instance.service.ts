import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { round4, type CreateInstanceInput } from '@oa/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import { assertVisibleWithPath, resolveScope, type ScopePredicate } from '../../domain/access/data-scope';
import { userScopeWhere } from '../../domain/access/scope-query';
import { validateFormData } from '../../domain/workflow/form';
import { validateNodeGraph } from '../../domain/workflow/graph';
import { transitionInstance, transitionNode, type InstanceAction, type NodeAction } from '../../domain/workflow/state-machines';
import { resolveVoters, type VoterDirectory } from '../../domain/vote/voter-resolution';
import type { InstanceListQuery } from './instance.dto';
import { VoterDirectoryService } from './voter-directory.service';
import { NumberingService } from '../common/numbering.service';

@Injectable()
export class InstanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly directory: VoterDirectoryService,
    private readonly numbering: NumberingService,
  ) {}

  private scopeOf(user: AuthenticatedUser): ScopePredicate {
    const resolved = resolveScope(user);
    if (!resolved.ok) throw AppError.fromDef(resolved.error, resolved.reason);
    return resolved.predicate;
  }

  /**
   * 发起流程：模板已发布 → 表单校验 → 节点图校验 → 解析首层投票人 → 建实例与首层节点。
   *
   * 状态不直接写死：实例状态与节点状态都由状态机（§6.1 SUBMIT / §6.2 OPEN）算出来，
   * 并把副作用清单一起返回，阶段 3 接 Outbox/WS 后按这份清单投递。
   */
  async createInstance(user: AuthenticatedUser, input: CreateInstanceInput) {
    const template = await this.prisma.workflowTemplate.findFirst({
      where: { id: input.templateId, tenantId: user.tenantId },
      select: {
        id: true,
        name: true,
        status: true,
        currentVersionId: true,
        formSchema: true,
        deadlineMode: true,
      },
    });
    if (!template) throw AppError.of('SYS_NOT_FOUND');
    if (template.status === 'ARCHIVED') throw AppError.of('WF_VERSION_NOT_PUBLISHED', '模板已归档，不能发起');
    if (!template.currentVersionId) throw AppError.of('WF_VERSION_NOT_PUBLISHED', '模板没有已发布版本');

    const version = await this.prisma.workflowVersion.findFirst({
      where: { id: template.currentVersionId, tenantId: user.tenantId, publishedAt: { not: null } },
      include: {
        nodes: {
          orderBy: { order: 'asc' },
          include: { voterRules: { orderBy: { order: 'asc' } }, voteRule: true },
        },
        edges: true,
      },
    });
    if (!version) throw AppError.of('WF_VERSION_NOT_PUBLISHED', '模板当前版本不是已发布状态');

    const formCheck = validateFormData(template.formSchema, input.formData);
    if (!formCheck.ok) throw AppError.fromDef(formCheck.error, formCheck.reasons.join('；'));

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

    // 首层 = 拓扑顺序里第一个投票层（不是"order 最小"，避免设计器把 order 排乱）
    const firstVoteKey = graph.topologicalOrder.find(
      (key) => version.nodes.find((node) => node.nodeKey === key)?.type === 'VOTE',
    );
    const firstNode = version.nodes.find((node) => node.nodeKey === firstVoteKey);
    if (!firstNode) throw AppError.of('WF_NODE_GRAPH_INVALID', '模板没有投票层，无法发起');

    const directory = await this.directory.load(user, user.primaryDeptId);
    const resolution = resolveVoters(
      firstNode.voterRules.map((rule) => ({
        id: rule.id,
        voterType: rule.voterType,
        voterValue: (rule.voterValue ?? {}) as Record<string, unknown>,
        weight: Number(rule.weight),
        isRequired: rule.isRequired,
        order: rule.order,
      })),
      directory,
      input.formData,
    );
    if (resolution.voters.length === 0) {
      throw AppError.of(
        'NODE_VOTER_EMPTY',
        `首层「${firstNode.name}」没有解析出任何投票人：${resolution.notes.join('；') || '请检查投票人规则'}`,
      );
    }

    const submit = transitionInstance(
      { status: 'DRAFT', templatePublished: true, formValid: true, canCreate: true },
      'SUBMIT',
    );
    if (!submit.ok) throw AppError.fromDef(submit.error, submit.reason);

    const open = transitionNode(
      { status: 'PENDING', isFirstLayer: true, voterCount: resolution.voters.length },
      'OPEN',
    );
    if (!open.ok) throw AppError.fromDef(open.error, open.reason);

    const now = new Date();
    const timeoutHours = firstNode.voteRule?.timeoutHours ?? 24;
    const deadline = new Date(now.getTime() + timeoutHours * 3600_000);
    const layerIndex = firstNode.layerIndex ?? 1;

    const created = await this.prisma.runInTransaction(async (tx) => {
      const code = await this.numbering.next(tx, user.tenantId, 'INSTANCE');

      const instance = await tx.workflowInstance.create({
        data: {
          tenantId: user.tenantId,
          code,
          templateId: template.id,
          templateVersionId: version.id,
          initiatorId: user.userId,
          title: input.title,
          summary: input.summary ?? null,
          formData: input.formData as Prisma.InputJsonValue,
          status: submit.status,
          priority: input.priority,
          layerIndex,
          startedAt: now,
        },
        select: { id: true, code: true, status: true, title: true, createdAt: true },
      });

      const node = await tx.instanceNode.create({
        data: {
          tenantId: user.tenantId,
          instanceId: instance.id,
          nodeId: firstNode.id,
          type: firstNode.type,
          status: open.status,
          layerIndex,
          round: 1,
          startedAt: now,
          deadline,
          // 结论只在「池内全员表态」后才需要填写（ALL_STATED 会置为 PENDING）
          conclusionStatus: 'NOT_REQUIRED',
        },
        select: { id: true, status: true, deadline: true },
      });

      await tx.instanceNodeVoter.createMany({
        data: resolution.voters.map((voter) => ({
          tenantId: user.tenantId,
          instanceNodeId: node.id,
          userId: voter.userId,
          weight: new Prisma.Decimal(voter.weight),
          status: 'PENDING' as const,
          sourceRuleId: voter.sourceRuleId,
          sourceReason: voter.sourceReason,
        })),
      });

      await tx.workflowInstance.update({
        where: { id: instance.id },
        data: { currentNodeId: node.id },
      });

      return { instance, node };
    });

    const actions: (InstanceAction | NodeAction)[] = [...submit.actions, ...open.actions];

    return {
      instanceId: created.instance.id,
      code: created.instance.code,
      status: created.instance.status,
      title: created.instance.title,
      createdAt: created.instance.createdAt,
      node: {
        id: created.node.id,
        layerIndex,
        status: created.node.status,
        deadline: created.node.deadline,
      },
      voters: resolution.voters.map((voter) => ({
        userId: voter.userId,
        weight: voter.weight,
        isRequired: voter.isRequired,
        sourceReason: voter.sourceReason,
      })),
      voterNotes: resolution.notes,
      /** 副作用清单（阶段 3 接 Outbox/WS 后据此投递通知与超时任务） */
      actions,
      reason: `${submit.reason}；${open.reason}`,
    };
  }

  /** 我发起 / 我范围内 / 全租户（仍受数据范围约束）的流程列表 */
  async listInstances(user: AuthenticatedUser, query: InstanceListQuery) {
    const predicate = this.scopeOf(user);

    // WorkflowInstance 只有 initiatorId（没有指向 User 的关系字段），
    // 所以「按发起人部门过滤」先算出范围内的用户 id，再作为 in 条件。
    const initiatorFilter: Prisma.WorkflowInstanceWhereInput =
      query.scope === 'mine'
        ? { initiatorId: user.userId }
        : await this.initiatorScopeFilter(user, predicate);

    const where: Prisma.WorkflowInstanceWhereInput = {
      tenantId: user.tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.templateId ? { templateId: query.templateId } : {}),
      ...(query.keyword ? { title: { contains: query.keyword, mode: 'insensitive' } } : {}),
      ...initiatorFilter,
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.workflowInstance.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          code: true,
          initiatorId: true,
          title: true,
          summary: true,
          status: true,
          priority: true,
          layerIndex: true,
          startedAt: true,
          endedAt: true,
          createdAt: true,
          template: { select: { id: true, name: true, category: true } },
          _count: { select: { nodes: true, tasks: true, escalations: true } },
        },
      }),
      this.prisma.workflowInstance.count({ where }),
    ]);

    const initiatorIds = [...new Set(rows.map((row) => row.initiatorId))];
    const initiators = await this.prisma.user.findMany({
      where: { id: { in: initiatorIds } },
      select: { id: true, name: true },
    });
    const initiatorById = new Map(initiators.map((item) => [item.id, item]));

    return {
      items: rows.map((row) => ({
        id: row.id,
        code: row.code,
        title: row.title,
        summary: row.summary,
        status: row.status,
        priority: row.priority,
        layerIndex: row.layerIndex,
        initiator: initiatorById.get(row.initiatorId) ?? { id: row.initiatorId, name: null },
        template: row.template,
        counts: row._count,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        createdAt: row.createdAt,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * 流程详情。可见性三选一：我发起的 / 我是某一层的投票人 / 发起人部门在我数据范围内（越权按 404 语义）。
   */
  async getInstance(user: AuthenticatedUser, instanceId: number) {
    const instance = await this.prisma.workflowInstance.findFirst({
      where: { id: instanceId, tenantId: user.tenantId },
      include: {
        template: { select: { id: true, name: true, category: true, code: true } },
        nodes: {
          orderBy: [{ layerIndex: 'asc' }, { round: 'asc' }],
          include: {
            node: { select: { nodeKey: true, name: true, type: true } },
            voters: {
              select: {
                userId: true,
                weight: true,
                status: true,
                votedAt: true,
                sourceReason: true,
                absentReason: true,
                user: { select: { name: true } },
              },
            },
            voteResult: true,
            conclusions: {
              orderBy: { round: 'desc' },
              select: {
                round: true,
                decision: true,
                systemDecision: true,
                isOverride: true,
                overrideReason: true,
                content: true,
                source: true,
                authorId: true,
                createdAt: true,
              },
            },
          },
        },
        escalations: {
          select: {
            id: true,
            triggerType: true,
            status: true,
            fromWorkNo: true,
            toWorkNo: true,
            level: true,
            createdAt: true,
          },
        },
      },
    });
    if (!instance) throw AppError.of('SYS_NOT_FOUND');

    const initiator = await this.prisma.user.findFirst({
      where: { id: instance.initiatorId },
      select: {
        id: true,
        name: true,
        email: true,
        departments: {
          select: { isPrimary: true, department: { select: { id: true, name: true, path: true } } },
        },
      },
    });
    if (!initiator) throw AppError.of('SYS_NOT_FOUND', '发起人不存在');
    const primaryDept =
      initiator.departments.find((item) => item.isPrimary) ?? initiator.departments[0];

    const isInitiator = instance.initiatorId === user.userId;
    const isVoter = instance.nodes.some((node) => node.voters.some((voter) => voter.userId === user.userId));

    if (!isInitiator && !isVoter) {
      const visible = assertVisibleWithPath(user, {
        tenantId: instance.tenantId,
        ownerId: instance.initiatorId,
        deptId: primaryDept?.department.id ?? null,
        deptPath: primaryDept?.department.path ?? null,
      });
      if (!visible.ok) throw AppError.fromDef(visible.error, visible.reason);
    }

    return {
      id: instance.id,
      code: instance.code,
      title: instance.title,
      summary: instance.summary,
      status: instance.status,
      priority: instance.priority,
      layerIndex: instance.layerIndex,
      currentNodeId: instance.currentNodeId,
      /** 上报冻结前的状态（解冻时恢复它；非冻结状态下为 null） */
      suspendedFrom: instance.suspendedFrom,
      formData: instance.formData,
      template: instance.template,
      initiator: {
        id: initiator.id,
        name: initiator.name,
        email: initiator.email,
        department: primaryDept?.department.name ?? null,
      },
      nodes: instance.nodes.map((node) => ({
        id: node.id,
        nodeKey: node.node.nodeKey,
        name: node.node.name,
        type: node.node.type,
        status: node.status,
        layerIndex: node.layerIndex,
        round: node.round,
        deadline: node.deadline,
        vetoLocked: node.vetoLocked,
        conclusionStatus: node.conclusionStatus,
        voteResult: node.voteResult,
        conclusions: node.conclusions,
        voters: node.voters.map((voter) => ({
          userId: voter.userId,
          name: voter.user.name,
          weight: round4(Number(voter.weight)),
          status: voter.status,
          votedAt: voter.votedAt,
          sourceReason: voter.sourceReason,
          absentReason: voter.absentReason,
        })),
        progress: {
          expected: node.voters.length,
          pool: node.voters.filter((v) => v.status !== 'ABSENT').length,
          stated: node.voters.filter((v) => v.status === 'VOTED' || v.status === 'DELEGATED').length,
          absent: node.voters.filter((v) => v.status === 'ABSENT').length,
        },
        /**
         * 命中上报规则但上报单尚未创建时的命中依据（阶段 3 建单后此字段会被正式的上报记录取代）。
         * 放在节点上而不是实例上，是为了与"实例状态暂不改变"保持一致。
         */
        pendingEscalation:
          (node.result as { escalationPending?: unknown } | null)?.escalationPending ?? null,
      })),
      escalations: instance.escalations,
      startedAt: instance.startedAt,
      endedAt: instance.endedAt,
      createdAt: instance.createdAt,
    };
  }

  /**
   * 把数据范围作用到「发起人」维度：先解析出范围内的用户 id，再作为 `initiatorId IN (...)`
   * 条件使用（WorkflowInstance 没有指向 User 的关系字段，无法直接按关系过滤）。
   */
  private async initiatorScopeFilter(
    user: AuthenticatedUser,
    predicate: ScopePredicate,
  ): Promise<Prisma.WorkflowInstanceWhereInput> {
    const users = await this.prisma.user.findMany({
      where: { tenantId: user.tenantId, ...(userScopeWhere(predicate, user) as Prisma.UserWhereInput) },
      select: { id: true },
    });
    return { initiatorId: { in: users.map((item) => item.id) } };
  }

}
