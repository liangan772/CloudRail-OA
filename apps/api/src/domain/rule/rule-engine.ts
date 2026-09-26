import {
  ESCALATION_TRIGGER_LABEL,
  RuleEvaluationError,
  evaluate,
  explain,
  type EscalationAcceptMode,
  type EscalationTrigger,
  type RuleNode,
  type TargetDeptRule,
  type WorkNoMissingPolicy,
} from '@oa/shared';
import type { ExplainNode } from '@oa/shared';

/**
 * 上报规则引擎（纯函数，零 IO）。
 *
 * 职责：把 `NodeEscalationRule`（触发源 + 可选条件 DSL）在给定上下文里求值，
 * 回答「这一层现在该不该上报、因为哪条规则、为什么命中」。
 *
 * 两条设计取舍：
 * 1. **没配条件的规则直接命中**——`triggerType` 本身就是触发器（例如 QUORUM_NOT_MET），
 *    条件只用于「超限 / 争议」这类需要看数据的场景；
 * 2. **规则写错不阻断流程**：求值抛错时记为 unmatched 并收进 `errors`，
 *    由调用方决定是告警还是修复。否则一条脏规则会让整个流程卡死，代价更大。
 */

export interface EscalationRuleSpec {
  id: number;
  triggerType: EscalationTrigger;
  condition: RuleNode | null;
  targetDeptRule: TargetDeptRule;
  timeout: number;
  freezeSource: boolean;
  maxLevel: number;
  acceptMode: EscalationAcceptMode;
  onMissingWorkNo: WorkNoMissingPolicy;
}

/** DSL 求值上下文（根名与 shared 的 RULE_ROOTS 白名单一致） */
export interface EscalationEvaluationContext {
  formData?: Record<string, unknown>;
  instance?: Record<string, unknown>;
  voteResult?: Record<string, unknown>;
  user?: Record<string, unknown>;
  dept?: Record<string, unknown>;
  task?: Record<string, unknown>;
  escalation?: Record<string, unknown>;
  /** 注入当前时间，便于测试与“指定日期生效”类规则 */
  now?: string;
}

export interface EscalationRuleHit {
  ruleId: number;
  triggerType: EscalationTrigger;
  triggerLabel: string;
  matched: boolean;
  /** 命中 / 未命中原因（含叶子级解释，用于"为什么上报"） */
  reason: string;
  condition: RuleNode | null;
  target: {
    targetDeptRule: TargetDeptRule;
    timeoutHours: number;
    freezeSource: boolean;
    maxLevel: number;
    acceptMode: EscalationAcceptMode;
    onMissingWorkNo: WorkNoMissingPolicy;
  };
}

export interface EscalationEvaluationResult {
  hits: EscalationRuleHit[];
  matched: EscalationRuleHit[];
  /** 规则本身有问题时的说明（不阻断流程，但必须可见） */
  errors: string[];
}

export interface EscalationEvaluationOptions {
  /**
   * 是否允许越级上报（`Tenant.allowCrossLevel`，已确认默认关闭）。
   * 关闭时，`SPECIFIC_DEPT` / `SKIP_TO_LEVEL` 这类目标规则一律视为不命中。
   */
  allowCrossLevel?: boolean;
}

/** 需要租户开关才能生效的目标部门规则（C13：不允许越级） */
const CROSS_LEVEL_TARGETS: TargetDeptRule[] = ['SPECIFIC_DEPT', 'SKIP_TO_LEVEL'];

const OP_LABEL: Record<string, string> = {
  eq: '等于',
  neq: '不等于',
  gt: '大于',
  gte: '大于等于',
  lt: '小于',
  lte: '小于等于',
  in: '属于',
  notIn: '不属于',
  contains: '包含',
  startsWith: '以…开头',
  exists: '存在',
  between: '介于',
  sizeGt: '长度大于',
  sizeLt: '长度小于',
};

function formatValue(value: unknown): string {
  if (value === undefined) return '未提供';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** 把可解释树压成一句中文，例如「formData.amount 大于 50000（实际 80000）」 */
export function summarizeExplain(node: ExplainNode): string {
  if (node.type === 'leaf') {
    const op = OP_LABEL[node.op] ?? node.op;
    const expected = node.op === 'exists' ? '' : ` ${formatValue(node.right)}`;
    return `${node.path} ${op}${expected}（实际 ${formatValue(node.left)}）`;
  }
  if (node.type === 'not') {
    return `非（${node.children.map(summarizeExplain).join('、')}）`;
  }
  const joiner = node.type === 'and' ? ' 且 ' : ' 或 ';
  return `（${node.children.map(summarizeExplain).join(joiner)}）`;
}

/** 补齐白名单根，避免规则里引用未提供的根导致求值异常 */
function normalizeContext(context: EscalationEvaluationContext): Record<string, unknown> {
  return {
    formData: context.formData ?? {},
    instance: context.instance ?? {},
    voteResult: context.voteResult ?? {},
    user: context.user ?? {},
    dept: context.dept ?? {},
    task: context.task ?? {},
    escalation: context.escalation ?? {},
    now: context.now ?? new Date().toISOString(),
  };
}

export function evaluateEscalationRules(
  rules: readonly EscalationRuleSpec[],
  context: EscalationEvaluationContext,
  options: EscalationEvaluationOptions = {},
): EscalationEvaluationResult {
  const ctx = normalizeContext(context);
  const hits: EscalationRuleHit[] = [];
  const errors: string[] = [];

  for (const rule of rules) {
    const triggerLabel = ESCALATION_TRIGGER_LABEL[rule.triggerType] ?? rule.triggerType;
    const target: EscalationRuleHit['target'] = {
      targetDeptRule: rule.targetDeptRule,
      timeoutHours: rule.timeout,
      freezeSource: rule.freezeSource,
      maxLevel: rule.maxLevel,
      acceptMode: rule.acceptMode,
      onMissingWorkNo: rule.onMissingWorkNo,
    };

    // 越级上报默认禁用：即使条件命中也不允许，避免"配置漏开关就绕过逐级上溯"
    if (options.allowCrossLevel === false && CROSS_LEVEL_TARGETS.includes(rule.targetDeptRule)) {
      hits.push({
        ruleId: rule.id,
        triggerType: rule.triggerType,
        triggerLabel,
        matched: false,
        reason: `目标为「${rule.targetDeptRule}」需要越级上报能力，但租户未开启（allowCrossLevel=false），已忽略`,
        condition: rule.condition,
        target,
      });
      continue;
    }

    if (!rule.condition) {
      hits.push({
        ruleId: rule.id,
        triggerType: rule.triggerType,
        triggerLabel,
        matched: true,
        reason: `触发源「${triggerLabel}」未配置条件，命中即上报`,
        condition: null,
        target,
      });
      continue;
    }

    try {
      const matched = evaluate(rule.condition, ctx);
      const detail = summarizeExplain(explain(rule.condition, ctx));
      hits.push({
        ruleId: rule.id,
        triggerType: rule.triggerType,
        triggerLabel,
        matched,
        reason: matched ? `条件命中：${detail}` : `条件未命中：${detail}`,
        condition: rule.condition,
        target,
      });
    } catch (error) {
      const message = error instanceof RuleEvaluationError ? error.message : String(error);
      errors.push(`上报规则 #${rule.id}（${triggerLabel}）求值失败：${message}`);
      hits.push({
        ruleId: rule.id,
        triggerType: rule.triggerType,
        triggerLabel,
        matched: false,
        reason: `规则不合法已跳过（不阻断流程）：${message}`,
        condition: rule.condition,
        target,
      });
    }
  }

  return { hits, matched: hits.filter((hit) => hit.matched), errors };
}
