/** 任务域枚举 */

export const TaskStatus = {
  PENDING_ASSIGN: 'PENDING_ASSIGN',
  PENDING_ACCEPT: 'PENDING_ACCEPT',
  IN_PROGRESS: 'IN_PROGRESS',
  PENDING_ACCEPTANCE: 'PENDING_ACCEPTANCE',
  DONE: 'DONE',
  OVERDUE: 'OVERDUE',
  CANCELLED: 'CANCELLED',
  BLOCKED: 'BLOCKED',
  ESCALATED: 'ESCALATED',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  PENDING_ASSIGN: '待分配',
  PENDING_ACCEPT: '待接受',
  IN_PROGRESS: '进行中',
  PENDING_ACCEPTANCE: '待验收',
  DONE: '已完成',
  OVERDUE: '已逾期',
  CANCELLED: '已取消',
  BLOCKED: '被阻塞',
  ESCALATED: '已上报',
};

export const TaskPriority = {
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
} as const;
export type TaskPriority = (typeof TaskPriority)[keyof typeof TaskPriority];
export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: '低',
  NORMAL: '普通',
  HIGH: '高',
  URGENT: '紧急',
};

/** 任务参与角色：每任务恰好一个 OWNER + 恰好一个 ACCEPTOR */
export const TaskAssigneeRole = {
  OWNER: 'OWNER',
  COLLABORATOR: 'COLLABORATOR',
  WATCHER: 'WATCHER',
  ACCEPTOR: 'ACCEPTOR',
} as const;
export type TaskAssigneeRole = (typeof TaskAssigneeRole)[keyof typeof TaskAssigneeRole];
export const TASK_ASSIGNEE_ROLE_LABEL: Record<TaskAssigneeRole, string> = {
  OWNER: '负责人',
  COLLABORATOR: '协作者',
  WATCHER: '关注者',
  ACCEPTOR: '验收人',
};

export const AssigneeRuleType = {
  MANUAL: 'MANUAL',
  ROLE: 'ROLE',
  DEPARTMENT: 'DEPARTMENT',
  VOTE_GROUP: 'VOTE_GROUP',
  DEPT_WORKNO: 'DEPT_WORKNO',
  LOAD_BALANCE: 'LOAD_BALANCE',
  GRAB: 'GRAB',
} as const;
export type AssigneeRuleType = (typeof AssigneeRuleType)[keyof typeof AssigneeRuleType];
export const ASSIGNEE_RULE_TYPE_LABEL: Record<AssigneeRuleType, string> = {
  MANUAL: '手动指定',
  ROLE: '按角色',
  DEPARTMENT: '按部门',
  VOTE_GROUP: '投票组',
  DEPT_WORKNO: '部门工号成员',
  LOAD_BALANCE: '负载均衡',
  GRAB: '抢单',
};

export const TaskDependencyType = {
  FINISH_TO_START: 'FINISH_TO_START',
  START_TO_START: 'START_TO_START',
} as const;
export type TaskDependencyType = (typeof TaskDependencyType)[keyof typeof TaskDependencyType];
export const TASK_DEPENDENCY_TYPE_LABEL: Record<TaskDependencyType, string> = {
  FINISH_TO_START: '前置完成后开始',
  START_TO_START: '前置开始后开始',
};
