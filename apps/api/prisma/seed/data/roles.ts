import { PERMISSIONS } from '@oa/shared';

export interface SeedRole {
  code: string;
  name: string;
  dataScopeDefault: 'SELF' | 'DEPT' | 'DEPT_AND_SUB' | 'DEPT_LIST' | 'TENANT';
  /** 授予的权限点；'*' 表示全部 */
  permissions: string[] | '*';
}

export const DEMO_ROLES: SeedRole[] = [
  {
    code: 'TENANT_ADMIN',
    name: '租户管理员',
    dataScopeDefault: 'TENANT',
    permissions: '*',
  },
  {
    code: 'DEPT_MANAGER',
    name: '部门负责人',
    dataScopeDefault: 'DEPT_AND_SUB',
    permissions: [
      'INSTANCE_CREATE',
      'INSTANCE_READ',
      'INSTANCE_WITHDRAW',
      'VOTE_READ',
      'VOTE_CAST',
      'VOTE_VIEW_DEPT',
      'VOTE_MARK_ABSENT',
      'VOTE_REMIND',
      'NODE_CONCLUDE',
      'NODE_CONCLUDE_OVERRIDE',
      'TASK_READ',
      'TASK_CREATE',
      'TASK_ASSIGN',
      'TASK_ACCEPT',
      'TASK_SUBMIT',
      'TASK_ACCEPTANCE',
      'TASK_TRANSFER',
      'ESC_READ',
      'ESC_CREATE',
      'ESC_HANDLE',
      'ESC_VOTE',
      'ESC_CONCLUDE',
      'ESC_UPGRADE',
      'STATS_READ',
    ],
  },
  {
    code: 'VOTER',
    name: '投票人',
    dataScopeDefault: 'SELF',
    permissions: [
      'INSTANCE_CREATE',
      'INSTANCE_READ',
      'VOTE_READ',
      'VOTE_CAST',
      'VOTE_VIEW_DEPT',
      'TASK_READ',
      'TASK_ACCEPT',
      'TASK_SUBMIT',
      'ESC_READ',
      'ESC_VOTE',
    ],
  },
  {
    code: 'TASK_EXECUTOR',
    name: '任务执行人',
    dataScopeDefault: 'SELF',
    permissions: [
      'INSTANCE_READ',
      'VOTE_READ',
      'TASK_READ',
      'TASK_ACCEPT',
      'TASK_SUBMIT',
      'TASK_TRANSFER',
      'ESC_READ',
      'ESC_CREATE',
    ],
  },
  {
    code: 'AUDITOR',
    name: '审计者',
    dataScopeDefault: 'TENANT',
    permissions: ['INSTANCE_READ', 'VOTE_READ', 'VOTE_VIEW_ALL', 'TASK_READ', 'ESC_READ', 'STATS_READ', 'AUDIT_READ', 'AUDIT_EXPORT'],
  },
];

/** 展开角色权限：'*' → 全部权限点 code */
export function expandPermissions(role: SeedRole): string[] {
  if (role.permissions === '*') return PERMISSIONS.map((p) => p.code);
  return role.permissions;
}
