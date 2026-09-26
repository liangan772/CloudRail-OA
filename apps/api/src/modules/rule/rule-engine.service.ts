import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { EscalationTrigger, RuleNode } from '@oa/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  evaluateEscalationRules,
  type EscalationEvaluationResult,
  type EscalationRuleSpec,
} from '../../domain/rule/rule-engine';

export interface EscalationCheckInput {
  tenantId: number;
  /** `WorkflowNode.id`（配置侧节点），不是实例节点 */
  nodeId: number;
  instance: {
    id: number;
    code: string;
    title: string;
    status: string;
    layerIndex: number;
    priority: string;
  };
  formData: Record<string, unknown>;
  actor: { userId: number };
  voteResult?: {
    approve: number;
    reject: number;
    denominator: number;
    passed: boolean;
    tie: boolean;
  };
  dept?: { id: number | null; workNo: string | null; level: number | null; path: string | null };
  /** 当前场景适用的触发源白名单（不传则不做场景过滤） */
  triggers?: EscalationTrigger[];
}

/**
 * 上报规则引擎接线：从库里取本节点的 `NodeEscalationRule`，交给纯函数求值。
 *
 * 同时管住一件事：**越级上报默认禁用**（`Tenant.allowCrossLevel=false`，已确认规则 C13），
 * 目标为「指定部门 / 指定层级」的规则即使条件命中也不会生效，只能沿直接上级逐级上溯。
 */
@Injectable()
export class RuleEngineService {
  constructor(private readonly prisma: PrismaService) {}

  async checkForNode(
    tx: Prisma.TransactionClient,
    input: EscalationCheckInput,
  ): Promise<EscalationEvaluationResult & { ruleCount: number; allowCrossLevel: boolean }> {
    const [rows, tenant] = await Promise.all([
      tx.nodeEscalationRule.findMany({
        where: { nodeId: input.nodeId, tenantId: input.tenantId },
        orderBy: { id: 'asc' },
      }),
      tx.tenant.findFirst({
        where: { id: input.tenantId },
        select: { allowCrossLevel: true },
      }),
    ]);

    const specs: EscalationRuleSpec[] = rows.map((row) => ({
      id: row.id,
      triggerType: row.triggerType,
      condition: (row.condition ?? null) as RuleNode | null,
      targetDeptRule: row.targetDeptRule,
      timeout: row.timeout,
      freezeSource: row.freezeSource,
      maxLevel: row.maxLevel,
      acceptMode: row.acceptMode,
      onMissingWorkNo: row.onMissingWorkNo,
    }));

    const allowCrossLevel = tenant?.allowCrossLevel ?? false;
    const result = evaluateEscalationRules(
      specs,
      {
        formData: input.formData,
        instance: input.instance,
        voteResult: input.voteResult ?? {},
        user: { userId: input.actor.userId },
        dept: input.dept ?? {},
      },
      { allowCrossLevel, applicableTriggers: input.triggers },
    );

    return { ...result, ruleCount: specs.length, allowCrossLevel };
  }
}
