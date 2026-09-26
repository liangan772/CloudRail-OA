import { PERMISSIONS } from '@oa/shared';
import { planPermissionPrune, type ExistingPermission } from './permission-sync';

const p = (id: number, code: string): ExistingPermission => ({ id, code });

describe('planPermissionPrune', () => {
  it('库与代码完全一致时，没有孤儿也没有缺失', () => {
    const plan = planPermissionPrune(['A', 'B', 'C'], [p(1, 'A'), p(2, 'B'), p(3, 'C')]);

    expect(plan.stale).toEqual([]);
    expect(plan.missing).toEqual([]);
  });

  it('库里多出的权限点判定为孤儿，并带上 id 供删除', () => {
    const plan = planPermissionPrune(['A', 'B'], [p(1, 'A'), p(2, 'B'), p(9, 'LEGACY_X'), p(10, 'LEGACY_Y')]);

    expect(plan.stale).toEqual([p(9, 'LEGACY_X'), p(10, 'LEGACY_Y')]);
    expect(plan.missing).toEqual([]);
  });

  it('代码新增但库里缺失的权限点计入 missing（由 upsert 补齐，不属于孤儿）', () => {
    const plan = planPermissionPrune(['A', 'B', 'NEW_ONE'], [p(1, 'A'), p(2, 'B')]);

    expect(plan.stale).toEqual([]);
    expect(plan.missing).toEqual(['NEW_ONE']);
  });

  it('新增与孤儿可以同时出现，两者互不干扰', () => {
    const plan = planPermissionPrune(['A', 'NEW_ONE'], [p(1, 'A'), p(7, 'OLD_ONE')]);

    expect(plan.stale).toEqual([p(7, 'OLD_ONE')]);
    expect(plan.missing).toEqual(['NEW_ONE']);
  });

  it('库里一条权限都没有时，代码里的全部算缺失、没有孤儿', () => {
    const plan = planPermissionPrune(['A', 'B'], []);

    expect(plan.stale).toEqual([]);
    expect(plan.missing).toEqual(['A', 'B']);
  });

  it('已知权限点为空时直接抛错，不把全部权限点判成孤儿', () => {
    // 这是最危险的退化场景：常量表被误清空 → 若照常计算会删掉库里的全部权限
    expect(() => planPermissionPrune([], [p(1, 'A'), p(2, 'B')])).toThrow('已知权限点为空');
  });

  it('代码里重复的权限码只算一次 missing', () => {
    const plan = planPermissionPrune(['A', 'A', 'B'], [p(1, 'A')]);

    expect(plan.missing).toEqual(['B']);
  });

  it('判定基于 code 而不是 id：id 变化不影响结论', () => {
    const plan = planPermissionPrune(['A'], [p(999, 'A')]);

    expect(plan.stale).toEqual([]);
  });

  it('对着真实的 PERMISSIONS 常量跑一遍：与自身完全同步时无孤儿', () => {
    const codes = PERMISSIONS.map((permission) => permission.code);
    const existing = codes.map((code, index) => p(index + 1, code));
    const plan = planPermissionPrune(codes, existing);

    expect(plan.stale).toEqual([]);
    expect(plan.missing).toEqual([]);
    expect(codes.length).toBeGreaterThan(0);
  });
});
