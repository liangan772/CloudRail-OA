/** 流程域枚举 */

/** 节点类型 */
export const WorkflowNodeType = {
  START: 'START',
  VOTE: 'VOTE',
  TASK: 'TASK',
  ESCALATION: 'ESCALATION',
  CONDITION: 'CONDITION',
  END: 'END',
} as const;
export type WorkflowNodeType = (typeof WorkflowNodeType)[keyof typeof WorkflowNodeType];
export const WORKFLOW_NODE_TYPE_LABEL: Record<WorkflowNodeType, string> = {
  START: '开始',
  VOTE: '投票层',
  TASK: '任务',
  ESCALATION: '上报',
  CONDITION: '条件分支',
  END: '结束',
};

/** 模板状态 */
export const TemplateStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type TemplateStatus = (typeof TemplateStatus)[keyof typeof TemplateStatus];
export const TEMPLATE_STATUS_LABEL: Record<TemplateStatus, string> = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  ARCHIVED: '已归档',
};

/** 流程实例状态 */
export const InstanceStatus = {
  DRAFT: 'DRAFT',
  VOTING: 'VOTING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  ESCALATED: 'ESCALATED',
  SUSPENDED: 'SUSPENDED',
  CLOSED: 'CLOSED',
} as const;
export type InstanceStatus = (typeof InstanceStatus)[keyof typeof InstanceStatus];
export const INSTANCE_STATUS_LABEL: Record<InstanceStatus, string> = {
  DRAFT: '草稿',
  VOTING: '投票中',
  APPROVED: '已通过',
  REJECTED: '已驳回',
  ESCALATED: '上报中',
  SUSPENDED: '已挂起',
  CLOSED: '已归档',
};

/** 层级节点状态（含 PENDING_CONCLUSION：全员表态后待人工填写结论） */
export const InstanceNodeStatus = {
  PENDING: 'PENDING',
  VOTING: 'VOTING',
  PENDING_CONCLUSION: 'PENDING_CONCLUSION',
  PASSED: 'PASSED',
  REJECTED: 'REJECTED',
  TIMEOUT: 'TIMEOUT',
  ESCALATED: 'ESCALATED',
  SKIPPED: 'SKIPPED',
  DONE: 'DONE',
} as const;
export type InstanceNodeStatus = (typeof InstanceNodeStatus)[keyof typeof InstanceNodeStatus];
export const INSTANCE_NODE_STATUS_LABEL: Record<InstanceNodeStatus, string> = {
  PENDING: '待开启',
  VOTING: '投票中',
  PENDING_CONCLUSION: '待填写结论',
  PASSED: '已通过',
  REJECTED: '已驳回',
  TIMEOUT: '已超时',
  ESCALATED: '已上报',
  SKIPPED: '已跳过',
  DONE: '已完成',
};

/** 结论模式（默认 MANUAL_CONFIRM：系统只给拟判定） */
export const ConclusionMode = {
  AUTO: 'AUTO',
  MANUAL_CONFIRM: 'MANUAL_CONFIRM',
  MANUAL_OVERRIDE: 'MANUAL_OVERRIDE',
} as const;
export type ConclusionMode = (typeof ConclusionMode)[keyof typeof ConclusionMode];
export const CONCLUSION_MODE_LABEL: Record<ConclusionMode, string> = {
  AUTO: '系统判定即结论（无需人填）',
  MANUAL_CONFIRM: '人工确认或改判（默认）',
  MANUAL_OVERRIDE: '人工自由裁定',
};

/** 结论状态 */
export const ConclusionStatus = {
  NOT_REQUIRED: 'NOT_REQUIRED',
  PENDING: 'PENDING',
  SUBMITTED: 'SUBMITTED',
  TIMEOUT: 'TIMEOUT',
} as const;
export type ConclusionStatus = (typeof ConclusionStatus)[keyof typeof ConclusionStatus];
export const CONCLUSION_STATUS_LABEL: Record<ConclusionStatus, string> = {
  NOT_REQUIRED: '无需填写',
  PENDING: '待填写',
  SUBMITTED: '已填写',
  TIMEOUT: '填写超时',
};

/** 人工结论断定 */
export const ConclusionDecision = {
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
} as const;
export type ConclusionDecision = (typeof ConclusionDecision)[keyof typeof ConclusionDecision];
export const CONCLUSION_DECISION_LABEL: Record<ConclusionDecision, string> = {
  APPROVE: '通过',
  REJECT: '驳回',
};

/** 截止时间计算模式（已确认：自然日） */
export const DeadlineMode = {
  CALENDAR_DAY: 'CALENDAR_DAY',
  WORKING_DAY: 'WORKING_DAY',
} as const;
export type DeadlineMode = (typeof DeadlineMode)[keyof typeof DeadlineMode];
export const DEADLINE_MODE_LABEL: Record<DeadlineMode, string> = {
  CALENDAR_DAY: '自然日（默认）',
  WORKING_DAY: '工作日（需节假日数据）',
};
