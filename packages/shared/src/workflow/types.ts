import {
  PASS_RULE_LABEL,
  REJECT_RULE_LABEL,
  QUORUM_POLICY_LABEL,
  TIMEOUT_POLICY_LABEL,
  TIE_POLICY_LABEL,
  type AbstainPolicy,
  type ConclusionMode,
  type PassRule,
  type QuorumPolicy,
  type RejectRule,
  type RevotePolicy,
  type TiePolicy,
  type TimeoutPolicy,
  type VoteViewScope,
  type VoteVisibility,
  type VoteDecision,
  type VoterStatus,
  type VoterType,
} from '../enums';
import type { RuleNode } from '../rule-dsl';

/** 投票人解析规则（NodeVoterRule.voterValue 的结构约束） */
export interface VoterRuleValue {
  userIds?: number[];
  roleCodes?: string[];
  deptIds?: number[];
  includeSub?: boolean;
  leaderOnly?: boolean;
  groupCodes?: string[];
  deptRef?: 'INITIATOR_DEPT' | 'PARENT_DEPT' | 'FIXED';
  primaryOnly?: boolean;
  from?: string;
  as?: VoterType;
}

/** 节点投票规则（NodeVoteRule） */
export interface VoteRuleConfig {
  passRule: PassRule;
  /** ALL 无阈值；RATIO/WEIGHTED 为 0~1；AT_LEAST_N 为整数 */
  passThreshold?: number;
  rejectRule: RejectRule;
  /** OPPOSE_OVER 为 0~1 */
  rejectThreshold?: number;
  abstainPolicy: AbstainPolicy;
  timeoutPolicy: TimeoutPolicy;
  visibility: VoteVisibility;
  viewScope: VoteViewScope;
  /** 已确认：恒为 false */
  allowAbstain: boolean;
  /** 已确认：true（池内全员必须表态） */
  requireAllVote: boolean;
  revotePolicy: RevotePolicy;
  /** 一票否决是否立即终结投票；默认 false（只锁定不予通过，仍等全员表态） */
  vetoTerminates: boolean;
  tiePolicy: TiePolicy;
  conclusionMode: ConclusionMode;
  conclusionAuthorRule?: { type: 'DEPT_WORKNO' | 'ROLE' | 'USER' | 'ESCALATION_HANDLER'; userIds?: number[]; roleCodes?: string[] };
  /** 默认 24 */
  timeoutHours: number;
  /** 默认 8 */
  remindIntervalHours: number;
  /** 默认 3 */
  maxRemindRounds: number;
  /** 默认 24 */
  conclusionTimeoutHours: number;
  quorumPolicy: QuorumPolicy;
  /** 默认 0.6 */
  minQuorum: number;
  allowMarkAbsent: boolean;
}

/** 投票池：缺席者被剔除后的真实计票基数 */
export interface VotingPool {
  /** 应投票人数 */
  expected: number;
  /** 池内人数 */
  pool: number;
  absentUserIds: number[];
  absentWeight: number;
  /** 池内权重总和 */
  totalWeight: number;
  minQuorum: number;
  quorumSatisfied: boolean;
}

export interface VoterSnapshot {
  userId: number;
  weight: number;
  status: VoterStatus;
}

/** 计票入参（纯数据，零 IO） */
export interface TallyInput {
  voters: VoterSnapshot[];
  /** 只传最新票（isReplaced=false） */
  votes: { voterId: number; decision: VoteDecision; weight: number }[];
  rule: VoteRuleConfig;
  /** 平票由上级裁定后回填 */
  tieResolvedBy?: 'ESCALATION' | 'CHAIRMAN_VOTE';
}

export interface TallyCounts {
  approve: number;
  reject: number;
  abstain: number;
}

export interface TallyResult {
  counts: TallyCounts;
  weighted: { approve: number; reject: number; total: number };
  pool: VotingPool;
  /** 有效票分母 */
  denominator: number;
  statedCount: number;
  passSatisfied: boolean;
  rejectSatisfied: boolean;
  vetoLocked: boolean;
  /** 是否平票（同意数 = 反对数）：由调用方按 tiePolicy 决定「驳回 / 上报 / 加一票」 */
  tieDetected: boolean;
  /**
   * 系统拟判定，交由人工结论确认或改判。
   * PENDING 表示投票尚未结束（还有池内成员未表态），此时不应写入 VoteResult 的最终结论。
   */
  systemDecision: 'APPROVE' | 'REJECT' | 'PENDING';
  /** 是否已可进入结论阶段（全员表态 or 否决立即终结） */
  readyForConclusion: boolean;
  reason: string;
  engineVersion: string;
}

export const TALLY_ENGINE_VERSION = 'tally-1.0.0';

/** 把投票规则翻译成人类可读文案（投票详情页的规则卡片直接用它） */
export function describeVoteRule(rule: VoteRuleConfig, pool?: VotingPool): string {
  const parts: string[] = [];
  parts.push(`池内 ${pool ? `${pool.pool}/${pool.expected}` : '全员'}必须表态（不允许弃权）`);

  const pass = PASS_RULE_LABEL[rule.passRule];
  const threshold =
    rule.passRule === 'RATIO' || rule.passRule === 'WEIGHTED'
      ? `（阈值 ${Math.round((rule.passThreshold ?? 0.6) * 100)}%）`
      : rule.passRule === 'AT_LEAST_N'
        ? `（至少 ${rule.passThreshold ?? 1} 票）`
        : '';
  parts.push(`通过：${pass}${threshold}`);

  if (rule.rejectRule !== 'NONE') {
    const rt =
      rule.rejectRule === 'OPPOSE_OVER'
        ? `（反对超过 ${Math.round((rule.rejectThreshold ?? 0.34) * 100)}%）`
        : '';
    parts.push(`否决：${REJECT_RULE_LABEL[rule.rejectRule]}${rt}`);
  }
  if (rule.tiePolicy) parts.push(`平票：${TIE_POLICY_LABEL[rule.tiePolicy]}`);
  if (rule.quorumPolicy !== 'NONE') {
    parts.push(`法定人数：${QUORUM_POLICY_LABEL[rule.quorumPolicy]}`);
  }
  parts.push(`超时：${TIMEOUT_POLICY_LABEL[rule.timeoutPolicy]}`);
  parts.push('结论须人工填写');
  return parts.join('；');
}

/** 规则命中说明（用于"为什么上报"） */
export interface RuleHitExplanation {
  ruleId?: number;
  trigger?: string;
  condition?: RuleNode;
  matched: boolean;
  detail?: string;
}
