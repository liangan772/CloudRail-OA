/** 组织、权限、通用枚举 */

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
  LOCKED: 'LOCKED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];
export const USER_STATUS_LABEL: Record<UserStatus, string> = {
  ACTIVE: '正常',
  DISABLED: '已停用',
  LOCKED: '已锁定',
};

export const DepartmentStatus = {
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
} as const;
export type DepartmentStatus = (typeof DepartmentStatus)[keyof typeof DepartmentStatus];
export const DEPARTMENT_STATUS_LABEL: Record<DepartmentStatus, string> = {
  ACTIVE: '正常',
  DISABLED: '已停用',
};

/** 数据范围 */
export const ScopeType = {
  SELF: 'SELF',
  DEPT: 'DEPT',
  DEPT_AND_SUB: 'DEPT_AND_SUB',
  DEPT_LIST: 'DEPT_LIST',
  TENANT: 'TENANT',
} as const;
export type ScopeType = (typeof ScopeType)[keyof typeof ScopeType];
export const SCOPE_TYPE_LABEL: Record<ScopeType, string> = {
  SELF: '仅本人',
  DEPT: '本部门',
  DEPT_AND_SUB: '本部门及下级',
  DEPT_LIST: '指定部门',
  TENANT: '全租户',
};

export const PermissionType = {
  MENU: 'MENU',
  ACTION: 'ACTION',
  DATA: 'DATA',
} as const;
export type PermissionType = (typeof PermissionType)[keyof typeof PermissionType];
export const PERMISSION_TYPE_LABEL: Record<PermissionType, string> = {
  MENU: '菜单',
  ACTION: '操作',
  DATA: '数据',
};

export const NotificationType = {
  VOTE_PENDING: 'VOTE_PENDING',
  VOTE_RESULT: 'VOTE_RESULT',
  CONCLUSION_PENDING: 'CONCLUSION_PENDING',
  TASK_ASSIGNED: 'TASK_ASSIGNED',
  TASK_OVERDUE: 'TASK_OVERDUE',
  ESCALATION_CREATED: 'ESCALATION_CREATED',
  ESCALATION_VOTING: 'ESCALATION_VOTING',
  ESCALATION_HANDLED: 'ESCALATION_HANDLED',
  INSTANCE_FINISHED: 'INSTANCE_FINISHED',
  SYSTEM: 'SYSTEM',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];
export const NOTIFICATION_TYPE_LABEL: Record<NotificationType, string> = {
  VOTE_PENDING: '待我投票',
  VOTE_RESULT: '投票结果',
  CONCLUSION_PENDING: '待我填写结论',
  TASK_ASSIGNED: '任务分配',
  TASK_OVERDUE: '任务逾期',
  ESCALATION_CREATED: '新上报待受理',
  ESCALATION_VOTING: '上级投票中',
  ESCALATION_HANDLED: '上级已处理',
  INSTANCE_FINISHED: '流程结束',
  SYSTEM: '系统通知',
};

export const OutboxStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SENT: 'SENT',
  FAILED: 'FAILED',
  DEAD: 'DEAD',
} as const;
export type OutboxStatus = (typeof OutboxStatus)[keyof typeof OutboxStatus];
export const OUTBOX_STATUS_LABEL: Record<OutboxStatus, string> = {
  PENDING: '待投递',
  PROCESSING: '投递中',
  SENT: '已投递',
  FAILED: '投递失败',
  DEAD: '已放弃',
};

export const StorageDriver = {
  LOCAL: 'local',
  S3: 's3',
} as const;
export type StorageDriver = (typeof StorageDriver)[keyof typeof StorageDriver];
