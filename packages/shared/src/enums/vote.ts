/**
 * 投票域枚举（唯一口径来自 docs/stage-0/04-domain-model-draft.md §5）
 * 每个枚举同时导出：常量对象、类型、中文标签、语义色。
 */

/** 投票人解析类型 */
export const VoterType = {
  USER: 'USER',
  ROLE: 'ROLE',
  DEPARTMENT: 'DEPARTMENT',
  VOTE_GROUP: 'VOTE_GROUP',
  DEPT_WORKNO: 'DEPT_WORKNO',
  DYNAMIC: 'DYNAMIC',
} as const;
export type VoterType = (typeof VoterType)[keyof typeof VoterType];
export const VOTER_TYPE_LABEL: Record<VoterType, string> = {
  USER: '指定人员',
  ROLE: '按角色',
  DEPARTMENT: '按部门',
  VOTE_GROUP: '投票组',
  DEPT_WORKNO: '部门工号成员',
  DYNAMIC: '表单动态指定',
};

/** 通过规则 */
export const PassRule = {
  ALL: 'ALL',
  MAJORITY: 'MAJORITY',
  RATIO: 'RATIO',
  WEIGHTED: 'WEIGHTED',
  AT_LEAST_N: 'AT_LEAST_N',
} as const;
export type PassRule = (typeof PassRule)[keyof typeof PassRule];
export const PASS_RULE_LABEL: Record<PassRule, string> = {
  ALL: '全部同意',
  MAJORITY: '多数通过（同意 > 有效票/2）',
  RATIO: '比例通过（同意/有效票 ≥ 阈值）',
  WEIGHTED: '加权通过（同意权重 ≥ 阈值）',
  AT_LEAST_N: '至少 N 票同意',
};

/** 否决规则 */
export const RejectRule = {
  ANY_VETO: 'ANY_VETO',
  OPPOSE_OVER: 'OPPOSE_OVER',
  NONE: 'NONE',
} as const;
export type RejectRule = (typeof RejectRule)[keyof typeof RejectRule];
export const REJECT_RULE_LABEL: Record<RejectRule, string> = {
  ANY_VETO: '一票否决（锁定不予通过）',
  OPPOSE_OVER: '反对超阈值即驳回',
  NONE: '否决规则不参与',
};

/** 弃权策略（本版本 allowAbstain 恒为 false，仅历史数据兼容保留） */
export const AbstainPolicy = {
  COUNT_IN_DENOMINATOR: 'COUNT_IN_DENOMINATOR',
  EXCLUDE_FROM_DENOMINATOR: 'EXCLUDE_FROM_DENOMINATOR',
  AS_APPROVE: 'AS_APPROVE',
  AS_REJECT: 'AS_REJECT',
} as const;
export type AbstainPolicy = (typeof AbstainPolicy)[keyof typeof AbstainPolicy];
export const ABSTAIN_POLICY_LABEL: Record<AbstainPolicy, string> = {
  COUNT_IN_DENOMINATOR: '弃权计入分母',
  EXCLUDE_FROM_DENOMINATOR: '弃权不计入分母',
  AS_APPROVE: '弃权视为同意',
  AS_REJECT: '弃权视为反对',
};

/** 超时策略（AUTO_APPROVE 默认禁用：与「必须表态」冲突） */
export const TimeoutPolicy = {
  REMIND_ONLY: 'REMIND_ONLY',
  AUTO_REJECT: 'AUTO_REJECT',
  ESCALATE: 'ESCALATE',
  AUTO_APPROVE: 'AUTO_APPROVE',
} as const;
export type TimeoutPolicy = (typeof TimeoutPolicy)[keyof typeof TimeoutPolicy];
export const TIMEOUT_POLICY_LABEL: Record<TimeoutPolicy, string> = {
  REMIND_ONLY: '仅催办，超轮次后上报',
  AUTO_REJECT: '未表态视为反对',
  ESCALATE: '直接上报上级部门',
  AUTO_APPROVE: '自动通过（默认禁用）',
};

/** 记名方式（与可见范围正交） */
export const VoteVisibility = {
  PUBLIC: 'PUBLIC',
  RESULT_ONLY: 'RESULT_ONLY',
  ANONYMOUS: 'ANONYMOUS',
} as const;
export type VoteVisibility = (typeof VoteVisibility)[keyof typeof VoteVisibility];
export const VOTE_VISIBILITY_LABEL: Record<VoteVisibility, string> = {
  PUBLIC: '记名（本部门可见姓名与选择）',
  RESULT_ONLY: '只展示聚合结果',
  ANONYMOUS: '匿名（只显示是否已投）',
};

/** 可见范围（默认仅本部门；上报链上级部门可见全部） */
export const VoteViewScope = {
  DEPT_ONLY: 'DEPT_ONLY',
  TENANT: 'TENANT',
} as const;
export type VoteViewScope = (typeof VoteViewScope)[keyof typeof VoteViewScope];
export const VOTE_VIEW_SCOPE_LABEL: Record<VoteViewScope, string> = {
  DEPT_ONLY: '仅本部门可见明细',
  TENANT: '全租户可见明细',
};

/** 投票决定（不允许弃权，ABSTAIN 仅为历史数据兼容） */
export const VoteDecision = {
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  ABSTAIN: 'ABSTAIN',
} as const;
export type VoteDecision = (typeof VoteDecision)[keyof typeof VoteDecision];
export const VOTE_DECISION_LABEL: Record<VoteDecision, string> = {
  APPROVE: '同意',
  REJECT: '反对',
  ABSTAIN: '弃权（已禁用）',
};

/** 改票策略：结论形成前可反复更改 */
export const RevotePolicy = {
  NOT_ALLOWED: 'NOT_ALLOWED',
  ONCE: 'ONCE',
  UNLIMITED_BEFORE_CONCLUSION: 'UNLIMITED_BEFORE_CONCLUSION',
} as const;
export type RevotePolicy = (typeof RevotePolicy)[keyof typeof RevotePolicy];
export const REVOTE_POLICY_LABEL: Record<RevotePolicy, string> = {
  NOT_ALLOWED: '不允许改票',
  ONCE: '仅允许改一次',
  UNLIMITED_BEFORE_CONCLUSION: '结论形成前不限次数（默认）',
};

/** 平票策略（已确认：报上级组织裁定） */
export const TiePolicy = {
  ESCALATE: 'ESCALATE',
  REJECT: 'REJECT',
  CHAIRMAN_VOTE: 'CHAIRMAN_VOTE',
} as const;
export type TiePolicy = (typeof TiePolicy)[keyof typeof TiePolicy];
export const TIE_POLICY_LABEL: Record<TiePolicy, string> = {
  ESCALATE: '报上级组织裁定（默认）',
  REJECT: '平票即驳回',
  CHAIRMAN_VOTE: '主任委员追加一票',
};

/** 投票人状态（ABSENT 被排除出投票池） */
export const VoterStatus = {
  PENDING: 'PENDING',
  VOTED: 'VOTED',
  TIMEOUT: 'TIMEOUT',
  DELEGATED: 'DELEGATED',
  SKIPPED: 'SKIPPED',
  ABSENT: 'ABSENT',
} as const;
export type VoterStatus = (typeof VoterStatus)[keyof typeof VoterStatus];
export const VOTER_STATUS_LABEL: Record<VoterStatus, string> = {
  PENDING: '待表态',
  VOTED: '已表态',
  TIMEOUT: '已超时',
  DELEGATED: '已委托表态',
  SKIPPED: '已跳过',
  ABSENT: '缺席（不计票、不入池）',
};

/** 缺席来源 */
export const AbsenceSource = {
  MANUAL: 'MANUAL',
  LEAVE_SYNC: 'LEAVE_SYNC',
  DECLARED: 'DECLARED',
} as const;
export type AbsenceSource = (typeof AbsenceSource)[keyof typeof AbsenceSource];
export const ABSENCE_SOURCE_LABEL: Record<AbsenceSource, string> = {
  MANUAL: '管理员标记',
  LEAVE_SYNC: '请假区间自动命中',
  DECLARED: '本人声明',
};

/** 法定人数策略 */
export const QuorumPolicy = {
  MIN_POOL_RATIO: 'MIN_POOL_RATIO',
  NONE: 'NONE',
  MIN_POOL_N: 'MIN_POOL_N',
} as const;
export type QuorumPolicy = (typeof QuorumPolicy)[keyof typeof QuorumPolicy];
export const QUORUM_POLICY_LABEL: Record<QuorumPolicy, string> = {
  MIN_POOL_RATIO: '池内人数 ≥ 应投票人数 × 比例（默认 60%）',
  NONE: '不设下限',
  MIN_POOL_N: '池内人数 ≥ 固定人数',
};
