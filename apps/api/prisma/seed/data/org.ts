/** 演示租户、部门树（含部门工号）、用户 */

export const DEMO_TENANT = {
  code: 'demo',
  name: '云轨科技（演示租户）',
} as const;

/** 演示口令：明文只出现在这里与文档中，入库为 scrypt 哈希 */
export const DEMO_PASSWORD = 'Oa@12345678';

export interface SeedDepartment {
  code: string;
  name: string;
  parentCode: string | null;
  /** 部门工号：上报统一投递到上级部门的工号 */
  workNo: string;
  sort: number;
}

export const DEMO_DEPARTMENTS: SeedDepartment[] = [
  { code: 'HQ', name: '云轨科技', parentCode: null, workNo: 'D1000', sort: 1 },
  { code: 'PRODUCT', name: '产品中心', parentCode: 'HQ', workNo: 'D1001', sort: 1 },
  { code: 'TECH', name: '技术部', parentCode: 'PRODUCT', workNo: 'D1003', sort: 1 },
];

export interface SeedUser {
  email: string;
  name: string;
  phone: string;
  deptCode: string;
  title: string;
  isLeader: boolean;
  roleCodes: string[];
}

export const DEMO_USERS: SeedUser[] = [
  {
    email: 'admin@cloudrail.dev',
    name: '张伟',
    phone: '13800000001',
    deptCode: 'HQ',
    title: '总经理',
    isLeader: true,
    roleCodes: ['TENANT_ADMIN', 'DEPT_MANAGER'],
  },
  {
    email: 'lijing@cloudrail.dev',
    name: '李静',
    phone: '13800000002',
    deptCode: 'PRODUCT',
    title: '产品中心总监',
    isLeader: true,
    roleCodes: ['DEPT_MANAGER', 'VOTER'],
  },
  {
    email: 'wangqiang@cloudrail.dev',
    name: '王强',
    phone: '13800000003',
    deptCode: 'TECH',
    title: '技术部经理',
    isLeader: true,
    roleCodes: ['DEPT_MANAGER', 'VOTER', 'TASK_EXECUTOR'],
  },
  { email: 'liuyang@cloudrail.dev', name: '刘洋', phone: '13800000004', deptCode: 'TECH', title: '后端工程师', isLeader: false, roleCodes: ['VOTER', 'TASK_EXECUTOR'] },
  { email: 'chenchen@cloudrail.dev', name: '陈晨', phone: '13800000005', deptCode: 'TECH', title: '前端工程师', isLeader: false, roleCodes: ['VOTER', 'TASK_EXECUTOR'] },
  { email: 'zhaomin@cloudrail.dev', name: '赵敏', phone: '13800000006', deptCode: 'TECH', title: '测试工程师', isLeader: false, roleCodes: ['VOTER', 'TASK_EXECUTOR'] },
  { email: 'sunpeng@cloudrail.dev', name: '孙鹏', phone: '13800000007', deptCode: 'PRODUCT', title: '产品经理', isLeader: false, roleCodes: ['VOTER', 'TASK_EXECUTOR'] },
  { email: 'zhoulin@cloudrail.dev', name: '周琳', phone: '13800000008', deptCode: 'PRODUCT', title: '运营经理', isLeader: false, roleCodes: ['VOTER'] },
  { email: 'wutao@cloudrail.dev', name: '吴涛', phone: '13800000009', deptCode: 'PRODUCT', title: '审计专员', isLeader: false, roleCodes: ['AUDITOR'] },
];

export interface SeedWorkNoMember {
  workNo: string;
  email: string;
  isPrimary: boolean;
}

/** 部门工号成员：工号成员即该级上报的投票人；isPrimary 只决定默认结论填写人 */
export const DEMO_WORKNO_MEMBERS: SeedWorkNoMember[] = [
  { workNo: 'D1000', email: 'admin@cloudrail.dev', isPrimary: true },
  { workNo: 'D1001', email: 'lijing@cloudrail.dev', isPrimary: true },
  { workNo: 'D1001', email: 'sunpeng@cloudrail.dev', isPrimary: false },
  { workNo: 'D1001', email: 'zhoulin@cloudrail.dev', isPrimary: false },
  { workNo: 'D1003', email: 'wangqiang@cloudrail.dev', isPrimary: true },
  { workNo: 'D1003', email: 'liuyang@cloudrail.dev', isPrimary: false },
  { workNo: 'D1003', email: 'chenchen@cloudrail.dev', isPrimary: false },
  { workNo: 'D1003', email: 'zhaomin@cloudrail.dev', isPrimary: false },
];
