import { resolveVoters, type VoterDirectory, type VoterRuleSpec } from './voter-resolution';

/**
 * 演示组织：总部 /1/ → 产品中心 /1/2/ → 技术部 /1/2/3/
 * 用户：1 张伟(总部/总经理)、2 李静(产品中心/负责人)、3 王强(技术部/负责人)、4 刘洋(技术部)
 */
const directory: VoterDirectory = {
  departments: [
    { id: 1, parentId: null, path: '/1/' },
    { id: 2, parentId: 1, path: '/1/2/' },
    { id: 3, parentId: 2, path: '/1/2/3/' },
  ],
  users: [
    { userId: 1, deptIds: [1], leaderDeptIds: [1], roleCodes: ['TENANT_ADMIN', 'DEPT_MANAGER'] },
    { userId: 2, deptIds: [2], leaderDeptIds: [2], roleCodes: ['DEPT_MANAGER'] },
    { userId: 3, deptIds: [3], leaderDeptIds: [3], roleCodes: ['DEPT_MANAGER', 'VOTER'] },
    { userId: 4, deptIds: [3], roleCodes: ['VOTER', 'TASK_EXECUTOR'] },
  ],
  voteGroups: [
    { code: 'TECH_COMMITTEE', members: [{ userId: 3, weight: 2 }, { userId: 4, weight: 1 }] },
  ],
  workNoMembers: [
    { departmentId: 2, userId: 2, isPrimary: true },
    { departmentId: 2, userId: 3, isPrimary: false },
    { departmentId: 1, userId: 1, isPrimary: true },
  ],
  initiatorDeptId: 3,
  parentDeptId: 2,
};

const rule = (over: Partial<VoterRuleSpec>): VoterRuleSpec => ({
  id: 1,
  voterType: 'USER',
  voterValue: {},
  weight: 1,
  isRequired: true,
  order: 0,
  ...over,
});

describe('投票人解析 · 六种 voterType', () => {
  it('USER：指定人员，无效 id 被剔除并留 note', () => {
    const r = resolveVoters(
      [rule({ voterValue: { userIds: [3, 4, 999] } })],
      directory,
    );
    expect(r.voters.map((v) => v.userId)).toEqual([3, 4]);
    expect(r.voters[0]!.sourceReason).toBe('指定人员');
    expect(r.notes.join()).toContain('剔除 1 个非本租户/已停用用户');
  });

  it('ROLE：按角色 + 发起人部门范围（seed 里的 scope 写法）', () => {
    const r = resolveVoters(
      [rule({ voterType: 'ROLE', voterValue: { roleCodes: ['DEPT_MANAGER'], scope: 'INITIATOR_DEPT' } })],
      directory,
    );
    // 发起人部门是技术部 /1/2/3/，只有王强（3）在技术部且是 DEPT_MANAGER
    expect(r.voters.map((v) => v.userId)).toEqual([3]);
    expect(r.voters[0]!.sourceReason).toContain('角色 DEPT_MANAGER @部门 3');
  });

  it('ROLE：includeSub 把下级部门一起纳入', () => {
    const r = resolveVoters(
      [
        rule({
          voterType: 'ROLE',
          voterValue: { roleCodes: ['DEPT_MANAGER'], scope: 'PARENT_DEPT', includeSub: true },
        }),
      ],
      directory,
    );
    // 产品中心 /1/2/ 含下级技术部：李静(2) 与 王强(3)
    expect(r.voters.map((v) => v.userId)).toEqual([2, 3]);
  });

  it('ROLE：leaderOnly 只取部门负责人', () => {
    const r = resolveVoters(
      [
        rule({
          voterType: 'ROLE',
          voterValue: { roleCodes: ['DEPT_MANAGER', 'VOTER'], deptIds: [3], leaderOnly: true },
        }),
      ],
      directory,
    );
    expect(r.voters.map((v) => v.userId)).toEqual([3]);
  });

  it('DEPARTMENT：部门成员，includeSub 递归到下级', () => {
    const direct = resolveVoters(
      [rule({ voterType: 'DEPARTMENT', voterValue: { deptIds: [2], includeSub: false } })],
      directory,
    );
    expect(direct.voters.map((v) => v.userId)).toEqual([2]);

    const withSub = resolveVoters(
      [rule({ voterType: 'DEPARTMENT', voterValue: { deptIds: [2], includeSub: true } })],
      directory,
    );
    expect(withSub.voters.map((v) => v.userId)).toEqual([2, 3, 4]);
  });

  it('DEPARTMENT：deptRef=INITIATOR_DEPT / PARENT_DEPT 分别解析本部门与上级部门', () => {
    const self = resolveVoters(
      [rule({ voterType: 'DEPARTMENT', voterValue: { deptRef: 'INITIATOR_DEPT' } })],
      directory,
    );
    expect(self.voters.map((v) => v.userId)).toEqual([3, 4]);

    const parent = resolveVoters(
      [rule({ voterType: 'DEPARTMENT', voterValue: { deptRef: 'PARENT_DEPT' } })],
      directory,
    );
    expect(parent.voters.map((v) => v.userId)).toEqual([2]);
  });

  it('VOTE_GROUP：带权重的投票组，权重与规则权重相乘', () => {
    const r = resolveVoters(
      [rule({ voterType: 'VOTE_GROUP', voterValue: { groupCodes: ['TECH_COMMITTEE'] }, weight: 2 })],
      directory,
    );
    expect(r.voters).toEqual([
      expect.objectContaining({ userId: 3, weight: 4 }),
      expect.objectContaining({ userId: 4, weight: 2 }),
    ]);
    expect(r.voters[0]!.sourceReason).toBe('投票组 TECH_COMMITTEE');
  });

  it('DEPT_WORKNO：取部门工号成员，primaryOnly 只留主责人', () => {
    const all = resolveVoters(
      [rule({ voterType: 'DEPT_WORKNO', voterValue: { deptRef: 'PARENT_DEPT' } })],
      directory,
    );
    expect(all.voters.map((v) => v.userId)).toEqual([2, 3]);

    const primary = resolveVoters(
      [rule({ voterType: 'DEPT_WORKNO', voterValue: { deptRef: 'PARENT_DEPT', primaryOnly: true } })],
      directory,
    );
    expect(primary.voters).toEqual([expect.objectContaining({ userId: 2, weight: 1 })]);
    expect(primary.voters[0]!.sourceReason).toContain('主责人');
  });

  it('DYNAMIC：从表单字段动态取人，支持 formData. 前缀', () => {
    const r = resolveVoters(
      [rule({ voterType: 'DYNAMIC', voterValue: { from: 'formData.approvers', as: 'USER' } })],
      directory,
      { approvers: [2, 4] },
    );
    expect(r.voters.map((v) => v.userId)).toEqual([2, 4]);
    expect(r.voters[0]!.sourceReason).toContain('formData.approvers');
  });

  it('DYNAMIC：表单没填该字段时不报错，只留空与 note', () => {
    const r = resolveVoters(
      [rule({ voterType: 'DYNAMIC', voterValue: { from: 'formData.approvers' } })],
      directory,
      {},
    );
    expect(r.voters).toEqual([]);
    expect(r.notes.join()).toContain('未解析出任何投票人');
  });
});

describe('投票人解析 · 去重与可解释性', () => {
  it('同一人被多条规则命中：权重取最大而不是累加，理由叠加', () => {
    const r = resolveVoters(
      [
        rule({ id: 1, voterType: 'DEPARTMENT', voterValue: { deptIds: [3] }, weight: 1, order: 0 }),
        // 投票组里王强的成员权重是 2，规则权重 1 → 有效权重 2
        rule({ id: 2, voterType: 'VOTE_GROUP', voterValue: { groupCodes: ['TECH_COMMITTEE'] }, weight: 1, order: 1 }),
      ],
      directory,
    );
    const wangqiang = r.voters.find((v) => v.userId === 3)!;
    // 部门规则给 1、投票组给 2 → 取 2；若累加会得到 3（同一人不应因多重身份刷票）
    expect(wangqiang.weight).toBe(2);
    expect(wangqiang.sourceRuleId).toBe(2);
    expect(wangqiang.sourceReason).toContain('部门');
    expect(wangqiang.sourceReason).toContain('投票组');
  });

  it('isRequired 取并集：任一条必填规则命中即为必填', () => {
    const r = resolveVoters(
      [
        rule({ id: 1, voterValue: { userIds: [4] }, isRequired: false, order: 0 }),
        rule({ id: 2, voterType: 'DEPARTMENT', voterValue: { deptIds: [3] }, isRequired: true, order: 1 }),
      ],
      directory,
    );
    expect(r.voters.find((v) => v.userId === 4)!.isRequired).toBe(true);
  });

  it('输出按 userId 升序，保证同一配置每次解析结果一致', () => {
    const r = resolveVoters([rule({ voterValue: { userIds: [4, 3, 2] } })], directory);
    expect(r.voters.map((v) => v.userId)).toEqual([2, 3, 4]);
  });

  it('sourceReason 截断到 255 字符以内（对齐数据库字段长度）', () => {
    const manyRules = Array.from({ length: 40 }, (_, index) =>
      rule({ id: index + 1, voterType: 'DEPARTMENT', voterValue: { deptIds: [3] }, order: index }),
    );
    const r = resolveVoters(manyRules, directory);
    for (const voter of r.voters) expect(voter.sourceReason.length).toBeLessThanOrEqual(255);
  });

  it('规则解析不出人时留 note 而不是抛错（由调用方决定是否 NODE_VOTER_EMPTY）', () => {
    const r = resolveVoters([rule({ voterType: 'USER', voterValue: { userIds: [] } })], directory);
    expect(r.voters).toEqual([]);
    expect(r.notes).toHaveLength(1);
  });

  it('未知 voterType 记 note，不影响其它规则', () => {
    const r = resolveVoters(
      [
        rule({ id: 1, voterType: 'WEIRD' as never, order: 0 }),
        rule({ id: 2, voterValue: { userIds: [4] }, order: 1 }),
      ],
      directory,
    );
    expect(r.voters.map((v) => v.userId)).toEqual([4]);
    expect(r.notes.join()).toContain('未知投票人类型');
  });
});
