import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import { validateNodeGraph } from '../../domain/workflow/graph';
import type { PublishVersionInput, TemplateQuery } from './workflow-template.dto';

/** 能看到草稿/归档模板的权限（设计器与发布者） */
const DESIGN_PERMISSIONS = ['WF_DESIGN', 'WF_PUBLISH'];

@Injectable()
export class WorkflowTemplateService {
  constructor(private readonly prisma: PrismaService) {}

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
}
