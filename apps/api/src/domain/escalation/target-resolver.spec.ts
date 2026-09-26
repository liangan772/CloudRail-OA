import { resolveEscalationTarget, type DeptNode } from './target-resolver';

/**
 * 组织树：总部 /1/ → 产品中心 /1/2/ → 技术部 /1/2/3/
 * 工号：总部 D1000、产品中心 D1001、技术部 D1003
 */
const departments: DeptNode[] = [
  { id: 1, parentId: null, path: '/1/', level: 1, workNo: 'D1000', managerId: 1 },
  { id: 2, parentId: 1, path: '/1/2/', level: 2, workNo: 'D1001', managerId: 2 },
  { id: 3, parentId: 2, path: '/1/2/3/', level: 3, workNo: 'D1003', managerId: 3 },
];

const base = {
  rule: 'DIRECT_PARENT' as const,
  fromDeptId: 3,
  currentLevel: 0,
  maxLevel: 5,
  allowCrossLevel: false,
  onMissingWorkNo: 'ESCALATE_UP' as const,
  departments,
};

describe('上报目标解析 · 逐级上溯', () => {
  it('首次上报：技术部 → 直接上级产品中心（带工号快照）', () => {
    const r = resolveEscalationTarget(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target.toDeptId).toBe(2);
    expect(r.target.toWorkNo).toBe('D1001');
    expect(r.target.fallback).toBe('NONE');
  });

  it('继续上报：传上一次的目标部门，从它的上级继续（产品中心 → 总部）', () => {
    const r = resolveEscalationTarget({ ...base, currentToDeptId: 2, currentLevel: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target.toDeptId).toBe(1);
    expect(r.target.toWorkNo).toBe('D1000');
  });

  it('已在根节点：没有更上级，报最高层级错误（不能跳级也不能停在原地）', () => {
    const r = resolveEscalationTarget({ ...base, currentToDeptId: 1, currentLevel: 1 });
    expect(r).toMatchObject({ ok: false, error: expect.objectContaining({ code: 'ESC_MAX_LEVEL_REACHED' }) });
  });

  it('超过 maxLevel 直接拒绝', () => {
    const r = resolveEscalationTarget({ ...base, currentLevel: 5, maxLevel: 5 });
    expect(r).toMatchObject({ ok: false, error: expect.objectContaining({ code: 'ESC_MAX_LEVEL_REACHED' }) });
  });
});

describe('上报目标解析 · 禁止越级（C13 / D2）', () => {
  it('指定部门 / 跳到指定层级在未开启越级时一律拒绝，即便配置了目标', () => {
    for (const rule of ['SPECIFIC_DEPT', 'SKIP_TO_LEVEL'] as const) {
      const r = resolveEscalationTarget({ ...base, rule, targetDeptIds: [1] });
      expect(r).toMatchObject({
        ok: false,
        error: expect.objectContaining({ code: 'ESC_CROSS_LEVEL_FORBIDDEN' }),
      });
    }
  });

  it('开启越级后才允许指定部门', () => {
    const r = resolveEscalationTarget({ ...base, rule: 'SPECIFIC_DEPT', targetDeptIds: [1], allowCrossLevel: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target.toDeptId).toBe(1);
  });

  it('开了越级但没配目标部门 → 参数错误', () => {
    const r = resolveEscalationTarget({ ...base, rule: 'SPECIFIC_DEPT', allowCrossLevel: true });
    expect(r).toMatchObject({ ok: false, error: expect.objectContaining({ code: 'SYS_VALIDATION_FAILED' }) });
  });
});

describe('上报目标解析 · 工号缺失兜底（D10）', () => {
  const withoutWorkNo: DeptNode[] = [
    { ...departments[0]!, workNo: 'D1000' },
    { ...departments[1]!, workNo: null },
    departments[2]!,
  ];

  it('ESCALATE_UP（默认）：一路向上找到有工号的部门，并记录经过的部门', () => {
    const r = resolveEscalationTarget({ ...base, departments: withoutWorkNo });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target.toDeptId).toBe(1);
    expect(r.target.toWorkNo).toBe('D1000');
    expect(r.target.fallback).toBe('ESCALATE_UP');
    expect(r.target.hops.map((hop) => hop.deptId)).toEqual([2, 1]);
    expect(r.target.reason).toContain('继续上溯');
  });

  it('NOTIFY_ADMIN：不投递工号，改为通知租户管理员', () => {
    const r = resolveEscalationTarget({ ...base, departments: withoutWorkNo, onMissingWorkNo: 'NOTIFY_ADMIN' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target.toWorkNo).toBeNull();
    expect(r.target.fallback).toBe('NOTIFY_ADMIN');
    expect(r.target.reason).toContain('通知租户管理员');
  });

  it('BLOCK：目标部门没有工号就报错阻断', () => {
    const r = resolveEscalationTarget({ ...base, departments: withoutWorkNo, onMissingWorkNo: 'BLOCK' });
    expect(r).toMatchObject({ ok: false, error: expect.objectContaining({ code: 'ESC_WORKNO_MISSING' }) });
  });

  it('沿路都没有工号（已到根）：报错而不是投给一个空目标', () => {
    const allWithout: DeptNode[] = departments.map((dept) => ({ ...dept, workNo: null }));
    const r = resolveEscalationTarget({ ...base, departments: allWithout });
    expect(r).toMatchObject({ ok: false, error: expect.objectContaining({ code: 'ESC_WORKNO_MISSING' }) });
  });
});
