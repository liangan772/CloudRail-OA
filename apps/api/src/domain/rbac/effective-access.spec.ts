import { effectiveScope, hasPermission, mergePermissions } from './effective-access';

describe('RBAC · 权限并集', () => {
  it('多个角色的权限取并集、去重并排序', () => {
    expect(mergePermissions([['VOTE_CAST', 'TASK_READ'], ['TASK_READ', 'AUDIT_READ']])).toEqual([
      'AUDIT_READ',
      'TASK_READ',
      'VOTE_CAST',
    ]);
  });

  it('没有任何角色时返回空数组（不是 undefined）', () => {
    expect(mergePermissions([])).toEqual([]);
    expect(mergePermissions([[]])).toEqual([]);
  });

  it('hasPermission 用精确匹配，不做前缀匹配', () => {
    const granted = mergePermissions([['VOTE_CAST']]);
    expect(hasPermission(granted, 'VOTE_CAST')).toBe(true);
    expect(hasPermission(granted, 'VOTE_CAST_ALL')).toBe(false);
  });
});

describe('RBAC · 有效数据范围', () => {
  it('取最宽的范围：不是"最后一个角色赢"，避免多加角色反而缩小可见范围', () => {
    const r = effectiveScope([
      { scopeType: 'SELF', scopeId: null },
      { scopeType: 'DEPT', scopeId: null },
    ]);
    expect(r.scopeType).toBe('DEPT');

    const widest = effectiveScope([
      { scopeType: 'TENANT', scopeId: null },
      { scopeType: 'SELF', scopeId: null },
    ]);
    expect(widest.scopeType).toBe('TENANT');
  });

  it('范围宽度顺序 TENANT > DEPT_AND_SUB > DEPT_LIST > DEPT > SELF', () => {
    const order: Array<'SELF' | 'DEPT' | 'DEPT_LIST' | 'DEPT_AND_SUB' | 'TENANT'> = [
      'SELF',
      'DEPT',
      'DEPT_LIST',
      'DEPT_AND_SUB',
      'TENANT',
    ];
    for (let i = 1; i < order.length; i += 1) {
      const lower = order[i - 1]!;
      const higher = order[i]!;
      const r = effectiveScope([
        { scopeType: higher, scopeId: null },
        { scopeType: lower, scopeId: null },
      ]);
      expect(r.scopeType).toBe(higher);
    }
  });

  it('DEPT_LIST 收集全部指定部门并去重排序；忽略空 scopeId', () => {
    const r = effectiveScope([
      { scopeType: 'DEPT_LIST', scopeId: 3 },
      { scopeType: 'DEPT_LIST', scopeId: 1 },
      { scopeType: 'DEPT_LIST', scopeId: 3 },
      { scopeType: 'DEPT_LIST', scopeId: null },
      { scopeType: 'DEPT', scopeId: null },
    ]);
    expect(r).toEqual({ scopeType: 'DEPT_LIST', scopedDeptIds: [1, 3] });
  });

  it('没有角色分配时回落默认范围（默认 SELF）', () => {
    expect(effectiveScope([])).toEqual({ scopeType: 'SELF', scopedDeptIds: [] });
    expect(effectiveScope([], 'DEPT')).toEqual({ scopeType: 'DEPT', scopedDeptIds: [] });
  });

  it('不是 DEPT_LIST 时不返回 scopedDeptIds，避免误用', () => {
    const r = effectiveScope([{ scopeType: 'TENANT', scopeId: 7 }]);
    expect(r.scopedDeptIds).toEqual([]);
  });
});
