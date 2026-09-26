import { PermissionType, type PermissionType as PermissionTypeValue } from '../enums/org';

export interface PermissionDef {
  code: string;
  name: string;
  module: string;
  type: PermissionTypeValue;
}

const P = (code: string, name: string, module: string, type: PermissionTypeValue = PermissionType.ACTION): PermissionDef => ({
  code,
  name,
  module,
  type,
});

/** 全部权限点：阶段 1 种子数据直接据此建库 */
export const PERMISSIONS: readonly PermissionDef[] = [
  // 组织与权限
  P('ORG_MANAGE', '组织架构管理', 'system', PermissionType.MENU),
  P('ROLE_MANAGE', '角色权限管理', 'system', PermissionType.MENU),
  P('USER_MANAGE', '用户管理', 'system'),
  P('DEPT_WORKNO_MANAGE', '部门工号维护', 'system'),
  // 流程模板
  P('WF_DESIGN', '流程设计器', 'workflow', PermissionType.MENU),
  P('WF_PUBLISH', '流程模板发布', 'workflow'),
  // 流程实例
  P('INSTANCE_CREATE', '发起流程', 'workflow'),
  P('INSTANCE_READ', '查看流程', 'workflow', PermissionType.MENU),
  P('INSTANCE_WITHDRAW', '撤回流程', 'workflow'),
  // 投票
  P('VOTE_READ', '投票中心', 'vote', PermissionType.MENU),
  P('VOTE_CAST', '投票', 'vote'),
  P('VOTE_VIEW_DEPT', '查看本部门投票明细', 'vote'),
  P('VOTE_VIEW_ALL', '查看全部投票明细（上报链上级部门）', 'vote'),
  P('VOTE_MARK_ABSENT', '标记投票人缺席', 'vote'),
  P('VOTE_REMIND', '催办投票', 'vote'),
  P('NODE_CONCLUDE', '填写投票结论', 'vote'),
  P('NODE_CONCLUDE_OVERRIDE', '改判系统判定', 'vote'),
  // 任务
  P('TASK_READ', '任务中心', 'task', PermissionType.MENU),
  P('TASK_CREATE', '创建任务', 'task'),
  P('TASK_ASSIGN', '分配任务', 'task'),
  P('TASK_DESIGN', '任务分配器', 'task', PermissionType.MENU),
  P('TASK_ACCEPT', '接受任务', 'task'),
  P('TASK_SUBMIT', '提交验收', 'task'),
  P('TASK_ACCEPTANCE', '任务验收', 'task'),
  P('TASK_TRANSFER', '转派任务', 'task'),
  P('TASK_REOPEN', '重开任务', 'task'),
  // 上报
  P('ESC_READ', '上报中心', 'escalation', PermissionType.MENU),
  P('ESC_CREATE', '发起上报', 'escalation'),
  P('ESC_HANDLE', '工号受理', 'escalation'),
  P('ESC_VOTE', '上级投票', 'escalation'),
  P('ESC_CONCLUDE', '填写上级结论', 'escalation'),
  P('ESC_UPGRADE', '继续上报', 'escalation'),
  P('ESC_CROSS_LEVEL', '越级上报（默认关闭）', 'escalation'),
  // 统计与审计
  P('STATS_READ', '统计报表', 'stats', PermissionType.MENU),
  P('AUDIT_READ', '审计日志', 'audit', PermissionType.MENU),
  P('AUDIT_EXPORT', '审计报表导出', 'audit'),
] as const;

export const PERMISSION_CODES = PERMISSIONS.map((p) => p.code);

export type PermissionCode = (typeof PERMISSION_CODES)[number];

/** 权限点快速判定用集合 */
export const PERMISSION_CODE_SET: ReadonlySet<string> = new Set(PERMISSION_CODES);
