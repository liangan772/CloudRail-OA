import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import { validateNodeGraph } from '../../domain/workflow/graph';
import { DomainEventService } from '../../infra/events/domain-event.service';
import type { PublishVersionInput, TemplateQuery } from './workflow-template.dto';
import type { CreateVersionInput, SaveGraphInput } from './workflow-graph.dto';

/** 能看到草稿/归档模板的权限（设计器与发布者） */
const DESIGN_PERMISSIONS = ['WF_DESIGN', 'WF_PUBLISH'];

@Injectable()
export class WorkflowTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventService,
  ) {}

  async listTemplates(user: AuthenticatedUser, query: TemplateQuery) {
    const canSeeDrafts = user.permissions.some((code) => DESIGN_PERMISSIONS.includes(code));
    const where: Prisma.WorkflowTemplateWhereInput = {
      tenantId: user.tenantId,
      ...(query.status ? { status: query.status } : canSeeDrafts ? {} : { status: 'PUBLISHED' }),
      ...(query.keyword ? { name: { contains: query.keyword, mode: 'insensitive' } } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.workflowTemplate.findMany({
        where,
        orderBy: { id: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          name: true,
          code: true,
          category: true,
          status: true,
          icon: true,
          description: true,
          currentVersionId: true,
          deadlineMode: true,
          updatedAt: true,
          versions: {
            orderBy: { version: 'desc' },
            take: 1,
            select: { id: true, version: true, publishedAt: true, isLocked: true },
          },
          _count: { select: { instances: true, versions: true } },
        },
      }),
      this.prisma.workflowTemplate.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        code: row.code,
        category: row.category,
        status: row.status,
        icon: row.icon,
        description: row.description,
        deadlineMode: row.deadlineMode,
        currentVersionId: row.currentVersionId,
        latestVersion: row.versions[0] ?? null,
        versionCount: row._count.versions,
        instanceCount: row._count.instances,
        updatedAt: row.updatedAt,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** 模板详情：返回全部版本及其节点/边/投票规则，供设计器与详情页只读渲染 */
  async getTemplate(user: AuthenticatedUser, templateId: number) {
    const template = await this.prisma.workflowTemplate.findFirst({
      where: { id: templateId, tenantId: user.tenantId },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          include: {
            nodes: {
              orderBy: { order: 'asc' },
              include: {
                voteRule: true,
                voterRules: { orderBy: { order: 'asc' } },
                taskTemplates: true,
                escRules: true,
              },
            },
            edges: { orderBy: [{ fromNodeId: 'asc' }, { priority: 'asc' }] },
          },
        },
      },
    });
    if (!template) throw AppError.of('SYS_NOT_FOUND');

    return {
      id: template.id,
      name: template.name,
      code: template.code,
      category: template.category,
      status: template.status,
      icon: template.icon,
      description: template.description,
      formSchema: template.formSchema,
      deadlineMode: template.deadlineMode,
      currentVersionId: template.currentVersionId,
      versions: template.versions.map((version) => ({
        id: version.id,
        version: version.version,
        publishedAt: version.publishedAt,
        publishedBy: version.publishedBy,
        isLocked: version.isLocked,
        changelog: version.changelog,
        nodes: version.nodes,
        edges: version.edges,
      })),
    };
  }

  /**
   * 发布模板版本。
   *
   * 发布门槛（任一不满足即拒绝，避免脏模板进入生产）：
   * 1. 节点图合法（`validateNodeGraph`：单 START / 有 END / 无孤岛 / 无死路 / 无环 / 全可达 / 层号唯一）；
   * 2. 每个 VOTE 节点都要有投票规则（`NodeVoteRule`）与至少一条投票人规则（`NodeVoterRule`）。
   */
  async publishVersion(user: AuthenticatedUser, templateId: number, input: PublishVersionInput) {
    const template = await this.prisma.workflowTemplate.findFirst({
      where: { id: templateId, tenantId: user.tenantId },
      select: { id: true, name: true, currentVersionId: true },
    });
    if (!template) throw AppError.of('SYS_NOT_FOUND');

    const version = await this.prisma.workflowVersion.findFirst({
      where: {
        tenantId: user.tenantId,
        templateId: template.id,
        ...(input.versionId ? { id: input.versionId } : {}),
      },
      orderBy: { version: 'desc' },
      include: {
        nodes: {
          orderBy: { order: 'asc' },
          include: { voteRule: { select: { id: true } }, voterRules: { select: { id: true } } },
        },
        edges: { select: { fromNodeId: true, toNodeId: true } },
      },
    });
    if (!version) throw AppError.of('SYS_NOT_FOUND');
    if (version.publishedAt) {
      throw AppError.of('SYS_VALIDATION_FAILED', `版本 v${version.version} 已于 ${version.publishedAt.toISOString()} 发布，不能重复发布`);
    }

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
    if (!graph.ok) {
      throw AppError.fromDef(graph.error, `节点图不合法：${graph.reasons.join('；')}`);
    }

    const problems: string[] = [];
    for (const node of version.nodes) {
      if (node.type !== 'VOTE') continue;
      if (!node.voteRule) problems.push(`投票层「${node.name}」缺少投票规则（通过/否决/超时/法定人数）`);
      if (node.voterRules.length === 0) problems.push(`投票层「${node.name}」缺少投票人规则`);
    }
    if (problems.length > 0) throw AppError.of('RULE_INVALID', problems.join('；'));

    const publishedAt = new Date();
    const result = await this.prisma.runInTransaction(async (tx) => {
      const published = await tx.workflowVersion.update({
        where: { id: version.id },
        data: {
          publishedAt,
          publishedBy: user.userId,
          isLocked: true,
          ...(input.changelog ? { changelog: input.changelog } : {}),
        },
        select: { id: true, version: true, publishedAt: true, isLocked: true },
      });

      // 发布后锁死旧版本（保留 publishedAt 作为历史），模板指向当前版本
      await tx.workflowTemplate.update({
        where: { id: template.id },
        data: { status: 'PUBLISHED', currentVersionId: version.id },
      });

      return published;
    });

    return {
      templateId: template.id,
      templateName: template.name,
      versionId: result.id,
      version: result.version,
      publishedAt: result.publishedAt,
      isLocked: result.isLocked,
      nodeCount: version.nodes.length,
      edgeCount: version.edges.length,
      voteLayers: graph.voteLayers,
      topologicalOrder: graph.topologicalOrder,
    };
  }

  /**
   * 从既有版本克隆出一个新的草稿版本（设计器的起点）。
   *
   * 为什么是"克隆"而不是直接改：已发布版本必须锁死（实例要可复现），
   * 所以编辑总是发生在新的草稿上，改坏了也不影响线上。
   */
  async createVersion(user: AuthenticatedUser, templateId: number, input: CreateVersionInput) {
    const template = await this.prisma.workflowTemplate.findFirst({
      where: { id: templateId, tenantId: user.tenantId },
      select: { id: true, name: true },
    });
    if (!template) throw AppError.of('SYS_NOT_FOUND');

    const source = await this.prisma.workflowVersion.findFirst({
      where: {
        tenantId: user.tenantId,
        templateId,
        ...(input.fromVersionId ? { id: input.fromVersionId } : {}),
      },
      orderBy: { version: 'desc' },
      include: {
        nodes: {
          orderBy: { order: 'asc' },
          include: { voteRule: true, voterRules: { orderBy: { order: 'asc' } } },
        },
        edges: true,
      },
    });
    if (!source) throw AppError.of('SYS_NOT_FOUND', '没有可克隆的版本');

    const latest = await this.prisma.workflowVersion.findFirst({
      where: { templateId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    const created = await this.prisma.runInTransaction(async (tx) => {
      const version = await tx.workflowVersion.create({
        data: {
          tenantId: user.tenantId,
          templateId,
          version: nextVersion,
          changelog: `从 v${source.version} 克隆`,
        },
        select: { id: true, version: true },
      });

      const idByKey = new Map<string, number>();
      for (const node of source.nodes) {
        const copy = await tx.workflowNode.create({
          data: {
            tenantId: user.tenantId,
            versionId: version.id,
            type: node.type,
            name: node.name,
            order: node.order,
            layerIndex: node.layerIndex,
            nodeKey: node.nodeKey,
            config: (node.config ?? {}) as Prisma.InputJsonValue,
          },
          select: { id: true },
        });
        idByKey.set(node.nodeKey, copy.id);

        if (node.voteRule) {
          const { id: _id, tenantId: _tenantId, nodeId: _nodeId, createdAt: _createdAt, updatedAt: _updatedAt, conclusionAuthorRule, ...rule } = node.voteRule;
          await tx.nodeVoteRule.create({
            data: {
              ...rule,
              tenantId: user.tenantId,
              nodeId: copy.id,
              conclusionAuthorRule: (conclusionAuthorRule ?? undefined) as Prisma.InputJsonValue | undefined,
            },
          });
        }
        if (node.voterRules.length > 0) {
          await tx.nodeVoterRule.createMany({
            data: node.voterRules.map((rule) => ({
              tenantId: user.tenantId,
              nodeId: copy.id,
              voterType: rule.voterType,
              voterValue: rule.voterValue as Prisma.InputJsonValue,
              weight: rule.weight,
              isRequired: rule.isRequired,
              order: rule.order,
            })),
          });
        }
      }

      for (const edge of source.edges) {
        const fromNodeId = idByKey.get(source.nodes.find((node) => node.id === edge.fromNodeId)?.nodeKey ?? '');
        const toNodeId = idByKey.get(source.nodes.find((node) => node.id === edge.toNodeId)?.nodeKey ?? '');
        if (!fromNodeId || !toNodeId) continue;
        await tx.workflowEdge.create({
          data: {
            tenantId: user.tenantId,
            versionId: version.id,
            fromNodeId,
            toNodeId,
            priority: edge.priority,
            label: edge.label,
            condition: (edge.condition ?? undefined) as Prisma.InputJsonValue | undefined,
          },
        });
      }

      return version;
    });

    return { templateId, versionId: created.id, version: created.version, clonedFrom: source.version };
  }

  /** 设计器的在线校验：只检查不落库，返回全部问题 */
  validateGraphPayload(input: SaveGraphInput): { ok: boolean; problems: string[]; voteLayers: number[] } {
    const problems: string[] = [];
    const graph = validateNodeGraph(
      input.nodes.map((node) => ({ nodeKey: node.nodeKey, type: node.type, layerIndex: node.layerIndex, name: node.name })),
      input.edges.map((edge) => ({ from: edge.from, to: edge.to })),
    );
    if (!graph.ok) problems.push(...graph.reasons);

    for (const node of input.nodes) {
      if (node.type !== 'VOTE') continue;
      if (!node.voteRule) problems.push(`投票层「${node.name}」缺少投票规则`);
      if (!node.voterRules || node.voterRules.length === 0) problems.push(`投票层「${node.name}」缺少投票人规则`);
    }

    return { ok: problems.length === 0, problems, voteLayers: graph.ok ? graph.voteLayers : [] };
  }

  /** 保存整图：先校验，再在**一个事务**里整图替换（不会出现改一半的中间态） */
  async saveGraph(user: AuthenticatedUser, versionId: number, input: SaveGraphInput) {
    const version = await this.prisma.workflowVersion.findFirst({
      where: { id: versionId, tenantId: user.tenantId },
      select: { id: true, templateId: true, version: true, publishedAt: true, isLocked: true },
    });
    if (!version) throw AppError.of('SYS_NOT_FOUND');
    if (version.publishedAt || version.isLocked) {
      throw AppError.of('SYS_VALIDATION_FAILED', `v${version.version} 已发布并锁定，请先克隆出新版本再编辑`);
    }

    const validation = this.validateGraphPayload(input);
    if (!validation.ok) {
      throw AppError.of('WF_NODE_GRAPH_INVALID', validation.problems.join('；'));
    }

    const stats = await this.prisma.runInTransaction(async (tx) => {
      // 先删边再删节点：边的外键指向节点，顺序反了会被约束拦下
      await tx.workflowEdge.deleteMany({ where: { versionId } });
      await tx.workflowNode.deleteMany({ where: { versionId } });

      const idByKey = new Map<string, number>();
      for (const node of input.nodes) {
        const created = await tx.workflowNode.create({
          data: {
            tenantId: user.tenantId,
            versionId,
            type: node.type,
            name: node.name,
            order: node.order,
            layerIndex: node.layerIndex ?? null,
            nodeKey: node.nodeKey,
            config: (node.config ?? {}) as Prisma.InputJsonValue,
          },
          select: { id: true },
        });
        idByKey.set(node.nodeKey, created.id);

        if (node.type === 'VOTE') {
          if (!node.voteRule) throw AppError.of('RULE_INVALID', `投票层「${node.name}」缺少投票规则`);
          await tx.nodeVoteRule.create({
            data: {
              tenantId: user.tenantId,
              nodeId: created.id,
              passRule: node.voteRule.passRule,
              passThreshold: node.voteRule.passThreshold ?? null,
              rejectRule: node.voteRule.rejectRule,
              rejectThreshold: node.voteRule.rejectThreshold ?? null,
              abstainPolicy: node.voteRule.abstainPolicy,
              timeoutPolicy: node.voteRule.timeoutPolicy,
              visibility: node.voteRule.visibility,
              viewScope: node.voteRule.viewScope,
              allowAbstain: false,
              requireAllVote: node.voteRule.requireAllVote,
              revotePolicy: node.voteRule.revotePolicy,
              vetoTerminates: node.voteRule.vetoTerminates,
              tiePolicy: node.voteRule.tiePolicy,
              conclusionMode: node.voteRule.conclusionMode,
              conclusionAuthorRule: (node.voteRule.conclusionAuthorRule ?? undefined) as Prisma.InputJsonValue | undefined,
              timeoutHours: node.voteRule.timeoutHours,
              remindIntervalHours: node.voteRule.remindIntervalHours,
              maxRemindRounds: node.voteRule.maxRemindRounds,
              conclusionTimeoutHours: node.voteRule.conclusionTimeoutHours,
              quorumPolicy: node.voteRule.quorumPolicy,
              minQuorum: node.voteRule.minQuorum,
              allowMarkAbsent: node.voteRule.allowMarkAbsent,
            },
          });
          if (node.voterRules && node.voterRules.length > 0) {
            await tx.nodeVoterRule.createMany({
              data: node.voterRules.map((rule) => ({
                tenantId: user.tenantId,
                nodeId: created.id,
                voterType: rule.voterType,
                voterValue: rule.voterValue as Prisma.InputJsonValue,
                weight: rule.weight,
                isRequired: rule.isRequired,
                order: rule.order,
              })),
            });
          }
        }
      }

      let edgeCount = 0;
      for (const edge of input.edges) {
        const fromNodeId = idByKey.get(edge.from);
        const toNodeId = idByKey.get(edge.to);
        if (!fromNodeId || !toNodeId) continue;
        await tx.workflowEdge.create({
          data: {
            tenantId: user.tenantId,
            versionId,
            fromNodeId,
            toNodeId,
            priority: edge.priority,
            label: edge.label ?? null,
            condition: (edge.condition ?? undefined) as Prisma.InputJsonValue | undefined,
          },
        });
        edgeCount += 1;
      }

      await this.events.emit(tx, {
        tenantId: user.tenantId,
        eventType: 'workflow.version_saved',
        aggregateType: 'INSTANCE',
        aggregateId: versionId,
        payload: { versionId, nodes: input.nodes.length, edges: edgeCount },
        audit: {
          actorId: user.userId,
          action: 'WF_VERSION_SAVE',
          targetType: 'WorkflowVersion',
          targetId: versionId,
          after: { nodes: input.nodes.length, edges: edgeCount },
        },
      });

      return { nodeCount: input.nodes.length, edgeCount };
    });

    return { versionId, templateId: version.templateId, version: version.version, ...stats, voteLayers: validation.voteLayers };
  }

  /** 读取某个版本的整图（设计器加载用，含草稿） */
  async getGraph(user: AuthenticatedUser, versionId: number) {
    const version = await this.prisma.workflowVersion.findFirst({
      where: { id: versionId, tenantId: user.tenantId },
      include: {
        template: { select: { id: true, name: true } },
        nodes: {
          orderBy: { order: 'asc' },
          include: { voteRule: true, voterRules: { orderBy: { order: 'asc' } } },
        },
        edges: { orderBy: [{ fromNodeId: 'asc' }, { priority: 'asc' }] },
      },
    });
    if (!version) throw AppError.of('SYS_NOT_FOUND');

    const keyById = new Map(version.nodes.map((node) => [node.id, node.nodeKey]));
    return {
      versionId: version.id,
      templateId: version.templateId,
      templateName: version.template.name,
      version: version.version,
      publishedAt: version.publishedAt,
      isLocked: version.isLocked,
      nodes: version.nodes.map((node) => ({
        nodeKey: node.nodeKey,
        type: node.type,
        name: node.name,
        order: node.order,
        layerIndex: node.layerIndex,
        config: node.config,
        voteRule: node.voteRule,
        voterRules: node.voterRules,
      })),
      edges: version.edges.map((edge) => ({
        from: keyById.get(edge.fromNodeId) ?? '',
        to: keyById.get(edge.toNodeId) ?? '',
        priority: edge.priority,
        label: edge.label,
        condition: edge.condition,
      })),
    };
  }
}
