/** 上报域枚举（上报 = 让上级部门再跑一次同样的投票） */

export const EscalationSourceType = {
  VOTE: 'VOTE',
  TASK: 'TASK',
  INSTANCE: 'INSTANCE',
  MANUAL: 'MANUAL',
} as const;
export type EscalationSourceType = (typeof EscalationSourceType)[keyof typeof EscalationSourceType];
export const ESCALATION_SOURCE_TYPE_LABEL: Record<EscalationSourceType, string> = {
  VOTE: '投票',
  TASK: '任务',
  INSTANCE: '流程',
  MANUAL: '手动发起',
};

/** 上报触发源（9 类） */
export const EscalationTrigger = {
  MANUAL: 'MANUAL',
  TIMEOUT: 'TIMEOUT',
  TIE: 'TIE',
  REPEATED_REJECT: 'REPEATED_REJECT',
  OVER_LIMIT: 'OVER_LIMIT',
  CROSS_DEPT_DISPUTE: 'CROSS_DEPT_DISPUTE',
  INSUFFICIENT_PERMISSION: 'INSUFFICIENT_PERMISSION',
  TASK_BLOCKED: 'TASK_BLOCKED',
  TASK_OVERDUE: 'TASK_OVERDUE',
  CONCLUSION_TIMEOUT: 'CONCLUSION_TIMEOUT',
  QUORUM_NOT_MET: 'QUORUM_NOT_MET',
} as const;
export type EscalationTrigger = (typeof EscalationTrigger)[keyof typeof EscalationTrigger];
export const ESCALATION_TRIGGER_LABEL: Record<EscalationTrigger, string> = {
  MANUAL: '手动上报',
  TIMEOUT: '投票超时',
  TIE: '平票',
  REPEATED_REJECT: '连续驳回',
  OVER_LIMIT: '金额/风险超限',
  CROSS_DEPT_DISPUTE: '跨部门争议',
  INSUFFICIENT_PERMISSION: '权限不足',
  TASK_BLOCKED: '任务阻塞',
  TASK_OVERDUE: '任务逾期',
  CONCLUSION_TIMEOUT: '结论填写超时',
  QUORUM_NOT_MET: '未达法定人数',
};

/** 上报状态（上级处理 = 投票） */
export const EscalationStatus = {
  PENDING: 'PENDING',
  SUBMITTED: 'SUBMITTED',
  SIGNED: 'SIGNED',
  VOTING: 'VOTING',
  PENDING_CONCLUSION: 'PENDING_CONCLUSION',
  ADOPTED: 'ADOPTED',
  RETURNED: 'RETURNED',
  UPGRADED: 'UPGRADED',
  CLOSED: 'CLOSED',
} as const;
export type EscalationStatus = (typeof EscalationStatus)[keyof typeof EscalationStatus];
export const ESCALATION_STATUS_LABEL: Record<EscalationStatus, string> = {
  PENDING: '待提交',
  SUBMITTED: '已投递上级工号',
  SIGNED: '工号已签收',
  VOTING: '上级投票中',
  PENDING_CONCLUSION: '待上级填写结论',
  ADOPTED: '上级已采纳',
  RETURNED: '上级已退回',
  UPGRADED: '已上报更上一级',
  CLOSED: '已归档',
};

/** 目标部门解析（已确认：不允许越级） */
export const TargetDeptRule = {
  DIRECT_PARENT: 'DIRECT_PARENT',
  LEVEL_UP: 'LEVEL_UP',
  SPECIFIC_DEPT: 'SPECIFIC_DEPT',
  SKIP_TO_LEVEL: 'SKIP_TO_LEVEL',
  BY_RULE: 'BY_RULE',
} as const;
export type TargetDeptRule = (typeof TargetDeptRule)[keyof typeof TargetDeptRule];
export const TARGET_DEPT_RULE_LABEL: Record<TargetDeptRule, string> = {
  DIRECT_PARENT: '直接上级部门（默认）',
  LEVEL_UP: '逐级上溯一级',
  SPECIFIC_DEPT: '指定部门（需开启越级开关）',
  SKIP_TO_LEVEL: '跳到指定层级（需开启越级开关）',
  BY_RULE: '按规则命中',
};

/** 上报动作 */
export const EscalationAction = {
  SIGN: 'SIGN',
  START_VOTE: 'START_VOTE',
  CAST_VOTE: 'CAST_VOTE',
  SUBMIT_CONCLUSION: 'SUBMIT_CONCLUSION',
  CONTINUE: 'CONTINUE',
  RETURN: 'RETURN',
  REQUEST_MORE: 'REQUEST_MORE',
  UPGRADE: 'UPGRADE',
  FINAL_APPROVE: 'FINAL_APPROVE',
  FINAL_REJECT: 'FINAL_REJECT',
  CLOSE: 'CLOSE',
} as const;
export type EscalationAction = (typeof EscalationAction)[keyof typeof EscalationAction];
export const ESCALATION_ACTION_LABEL: Record<EscalationAction, string> = {
  SIGN: '签收',
  START_VOTE: '发起上级投票',
  CAST_VOTE: '上级投票',
  SUBMIT_CONCLUSION: '提交上级结论',
  CONTINUE: '同意继续',
  RETURN: '退回原部门',
  REQUEST_MORE: '要求补充材料',
  UPGRADE: '继续上报',
  FINAL_APPROVE: '上级终审通过',
  FINAL_REJECT: '上级终审驳回',
  CLOSE: '归档',
};

/** 上报结论回写动作 */
export const WriteBackAction = {
  CONTINUE: 'CONTINUE',
  RETURN: 'RETURN',
  REQUEST_MORE: 'REQUEST_MORE',
  FINAL_APPROVE: 'FINAL_APPROVE',
  FINAL_REJECT: 'FINAL_REJECT',
} as const;
export type WriteBackAction = (typeof WriteBackAction)[keyof typeof WriteBackAction];
export const WRITE_BACK_ACTION_LABEL: Record<WriteBackAction, string> = {
  CONTINUE: '解冻并继续执行',
  RETURN: '退回原部门重走本层',
  REQUEST_MORE: '生成补充材料任务',
  FINAL_APPROVE: '流程直接通过',
  FINAL_REJECT: '流程直接驳回',
};

/** 签收模式（默认投递即开投） */
export const EscalationAcceptMode = {
  AUTO: 'AUTO',
  GRAB: 'GRAB',
  ASSIGNED: 'ASSIGNED',
} as const;
export type EscalationAcceptMode = (typeof EscalationAcceptMode)[keyof typeof EscalationAcceptMode];
export const ESCALATION_ACCEPT_MODE_LABEL: Record<EscalationAcceptMode, string> = {
  AUTO: '投递即开投（默认）',
  GRAB: '工号成员签收后开投',
  ASSIGNED: '指定处理人',
};

/** 上级部门未配置工号的兜底策略 */
export const WorkNoMissingPolicy = {
  ESCALATE_UP: 'ESCALATE_UP',
  NOTIFY_ADMIN: 'NOTIFY_ADMIN',
  BLOCK: 'BLOCK',
} as const;
export type WorkNoMissingPolicy = (typeof WorkNoMissingPolicy)[keyof typeof WorkNoMissingPolicy];
export const WORKNO_MISSING_POLICY_LABEL: Record<WorkNoMissingPolicy, string> = {
  ESCALATE_UP: '继续上溯找有工号的部门（默认）',
  NOTIFY_ADMIN: '通知租户管理员',
  BLOCK: '阻断并报错',
};
