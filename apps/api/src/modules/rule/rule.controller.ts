import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { resolveVotingPool } from '../../domain/vote/tally';
import { NodeContextService } from '../vote/node-context.service';
import { RuleEngineService } from './rule-engine.service';

@ApiTags('rule')
@Controller('instances/:id')
export class RuleController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contexts: NodeContextService,
    private readonly rules: RuleEngineService,
  ) {}

  /**
   * 上报规则试算：把「本层现在会不会上报、因为哪条规则、为什么」摊开给前端与排障用。
   * 只读，不改任何状态。
   */
  @Get('escalation-preview')
  @RequirePermissions('ESC_READ')
  @ApiOperation({ summary: '本层上报规则试算（含命中原因与越级开关状态）' })
  async preview(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    const ctx = await this.contexts.loadStandalone(user.tenantId, id);

    const pool = resolveVotingPool(
      ctx.voters.map((voter) => ({
        userId: voter.userId,
        weight: voter.weight,
        status: voter.status as 'PENDING' | 'VOTED' | 'ABSENT',
      })),
      ctx.rule.minQuorum,
      ctx.rule.quorumPolicy,
    );

    const instance = await this.prisma.workflowInstance.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true, code: true, title: true, status: true, layerIndex: true, priority: true, formData: true },
    });

    const initiator = await this.prisma.user.findFirst({
      where: { id: ctx.instance.initiatorId },
      select: {
        departments: {
          select: {
            isPrimary: true,
            department: { select: { id: true, workNo: true, level: true, path: true } },
          },
        },
      },
    });
    const primary =
      (initiator?.departments.find((item) => item.isPrimary) ?? initiator?.departments[0])?.department ?? null;

    const approve = ctx.votes.filter((vote) => vote.decision === 'APPROVE').length;
    const reject = ctx.votes.filter((vote) => vote.decision === 'REJECT').length;

    const result = await this.rules.checkForNode(this.prisma, {
      tenantId: user.tenantId,
      nodeId: ctx.node.nodeId,
      instance: {
        id: instance?.id ?? id,
        code: instance?.code ?? '',
        title: instance?.title ?? '',
        status: instance?.status ?? ctx.instance.status,
        layerIndex: ctx.node.layerIndex,
        priority: instance?.priority ?? 'NORMAL',
      },
      formData: (instance?.formData ?? {}) as Record<string, unknown>,
      actor: { userId: user.userId },
      voteResult: {
        approve,
        reject,
        denominator: pool.pool,
        passed: approve > reject,
        tie: approve === reject && approve > 0,
      },
      dept: primary
        ? { id: primary.id, workNo: primary.workNo, level: primary.level, path: primary.path }
        : { id: null, workNo: null, level: null, path: null },
    });

    return {
      instanceId: id,
      nodeId: ctx.node.id,
      nodeKey: ctx.node.nodeKey,
      layerIndex: ctx.node.layerIndex,
      nodeStatus: ctx.node.status,
      ruleCount: result.ruleCount,
      allowCrossLevel: result.allowCrossLevel,
      /** 命中项（会实际上报的那些） */
      matched: result.matched,
      /** 全部规则及其命中/未命中原因，便于排障与前端灰显 */
      hits: result.hits,
      errors: result.errors,
    };
  }
}
