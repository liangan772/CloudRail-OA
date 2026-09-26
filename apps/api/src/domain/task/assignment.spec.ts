import { resolveAssignees, type AssigneeDirectory } from './assignment';

/**
 * 组织：总部 1 → 产品中心 2 → 技术部 3（发起人在技术部）
 * 用户：2 李静（产品中心负责人，在手 0）、3 王强（技术部负责人，在手 3）、
 *       4 刘洋（技术部，在手 1）、5 陈晨（技术部，在手 0）
 */
const directory: AssigneeDirectory = {
  users: [
    { userId: 2, deptIds: [2], leaderDeptIds: [2], roleCodes: ['DEPT_MANAGER'], openTaskCount: 0 },
    { userId: 3, deptIds: [3], leaderDeptIds: [3], roleCodes: ['DEPT_MANAGER', 'TASK_EXECUTOR'], openTaskCount: 3 },
    { userId: 4, deptIds: [3], roleCodes: ['TASK_EXECUTOR', 'VOTER'], openTaskCount: 1 },
    { userId: 5, deptIds: [3], roleCodes: ['TASK_EXECUTOR'], openTaskCount: 0 },
  ],
  voteGroups: [{ code: 'TECH_COMMITTEE', members: [{ userId: 3 }, { userId: 4 }] }],
  workNoMembers: [
    { departmentId: 3, userId: 3, isPrimary: true },
    { departmentId: 3, userId: 4, isPrimary: false },
  ],
  departments: [
    { id: 1, parentId: null, path: '/1/' },
    { id: 2, parentId: 1, path: '/1/2/' },
    { id: 3, parentId: 2, path: '/1/2/3/' },
  ],
  initiatorDeptId: 3,
  parentDeptId: 2,
};

const rule = (type: string, value: Record<string, unknown> = {}) => ({ type, value }) as never;

describe('任务分配 · 手动 / 角色 / 部门', () => {
  it('手动指定负责人与验收人', () => {
    const r = resolveAssignees(rule('MANUAL', { userIds: [5] }), rule('MANUAL', { userIds: [2] }), directory);
    expect(r).toMatchObject({ ok: true, mode: 'ASSIGNED', ownerId: 5, acceptorId: 2 });
    expect(r.ok && r.ownerReason).toBe('手动指定');
  });

  it('按角色 + 发起人部门范围：候选里取负载最少者', () => {
    const r = resolveAssignees(
      rule('ROLE', { roleCodes: ['TASK_EXECUTOR'], scope: 'INITIATOR_DEPT' }),
      rule('ROLE', { roleCodes: ['DEPT_MANAGER'], scope: 'PARENT_DEPT' }),
      directory,
    );
    // 技术部里 TASK_EXECUTOR 是 3/4/5，负载最少的是陈晨（0）
    expect(r).toMatchObject({ ok: true, ownerId: 5, acceptorId: 2 });
  });

  it('按部门（含下级）与部门负责人', () => {
    const r = resolveAssignees(
      rule('DEPARTMENT', { deptRef: 'PARENT_DEPT', includeSub: true }),
      rule('DEPARTMENT', { deptIds: [2], leaderOnly: true }),
      directory,
    );
    // 产品中心含技术部 → 候选 2/3/4/5；负载同为 0 的是 2 与 5，取 userId 小者
    expect(r).toMatchObject({ ok: true, ownerId: 2, acceptorId: 2 });
  });
});

describe('任务分配 · 负载均衡 / 投票组 / 工号 / 抢单（E1）', () => {
  it('负载均衡：优先最空闲的人，并把候选池一并返回', () => {
    const r = resolveAssignees(
      rule('LOAD_BALANCE', { roleCodes: ['TASK_EXECUTOR'], deptIds: [3] }),
      rule('MANUAL', { userIds: [2] }),
      directory,
    );
    expect(r).toMatchObject({ ok: true, ownerId: 5 });
    expect(r.ok && r.candidates).toEqual(expect.arrayContaining([3, 4, 5]));
  });

  it('投票组：成员即候选人', () => {
    const r = resolveAssignees(
      rule('VOTE_GROUP', { groupCodes: ['TECH_COMMITTEE'] }),
      rule('MANUAL', { userIds: [2] }),
      directory,
    );
    // 组内 3（负载 3）与 4（负载 1）→ 取 4
    expect(r).toMatchObject({ ok: true, ownerId: 4 });
  });

  it('部门工号成员：primaryOnly 只留主责人', () => {
    const all = resolveAssignees(
      rule('DEPT_WORKNO', { deptRef: 'INITIATOR_DEPT' }),
      rule('MANUAL', { userIds: [2] }),
      directory,
    );
    expect(all).toMatchObject({ ok: true, ownerId: 4 }); // 3 负载 3、4 负载 1

    const primary = resolveAssignees(
      rule('DEPT_WORKNO', { deptRef: 'INITIATOR_DEPT', primaryOnly: true }),
      rule('MANUAL', { userIds: [2] }),
      directory,
    );
    expect(primary).toMatchObject({ ok: true, ownerId: 3 });
  });

  it('抢单：不预指定负责人（任务停在待分配），但验收人仍必须唯一', () => {
    const r = resolveAssignees(
      rule('GRAB', { roleCodes: ['TASK_EXECUTOR'], deptIds: [3] }),
      rule('MANUAL', { userIds: [2] }),
      directory,
    );
    expect(r).toMatchObject({ ok: true, mode: 'GRAB', ownerId: null, acceptorId: 2 });
    expect(r.ok && r.ownerReason).toContain('抢单');
    expect(r.ok && r.candidates.length).toBeGreaterThan(0);
  });
});

describe('任务分配 · 守卫（E2：恰好一个负责人 + 恰好一个验收人）', () => {
  it('解析不出负责人 → TASK_OWNER_REQUIRED', () => {
    const r = resolveAssignees(
      rule('ROLE', { roleCodes: ['NOBODY'], scope: 'INITIATOR_DEPT' }),
      rule('MANUAL', { userIds: [2] }),
      directory,
    );
    expect(r).toMatchObject({ ok: false, error: expect.objectContaining({ code: 'TASK_OWNER_REQUIRED' }) });
  });

  it('解析不出验收人 → TASK_ACCEPTOR_REQUIRED', () => {
    const r = resolveAssignees(
      rule('MANUAL', { userIds: [5] }),
      rule('DEPARTMENT', { deptIds: [999] }),
      directory,
    );
    expect(r).toMatchObject({ ok: false, error: expect.objectContaining({ code: 'TASK_ACCEPTOR_REQUIRED' }) });
  });

  it('验收人也不允许抢单（没人验收的任务等于没完成）', () => {
    const r = resolveAssignees(
      rule('GRAB', { deptIds: [3] }),
      rule('GRAB', { deptIds: [3] }),
      directory,
    );
    expect(r).toMatchObject({ ok: false, error: expect.objectContaining({ code: 'TASK_ACCEPTOR_REQUIRED' }) });
    expect(!r.ok && r.reason).toContain('抢单');
  });

  it('手动指定的 userId 不存在时视为解析失败', () => {
    const r = resolveAssignees(rule('MANUAL', { userIds: [999] }), rule('MANUAL', { userIds: [2] }), directory);
    expect(r).toMatchObject({ ok: false, error: expect.objectContaining({ code: 'TASK_OWNER_REQUIRED' }) });
  });
});
