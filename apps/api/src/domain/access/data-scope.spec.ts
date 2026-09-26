import { ERROR_CODES } from '@oa/shared';
import {
  assertVisible,
  assertVisibleWithPath,
  canViewEscalationChain,
  isInSubtree,
  matchesScope,
  resolveScope,
  voteDetailVisibility,
  type ActorContext,
} from './data-scope';

/** 演示组织树：总部 /1/ → 产品中心 /1/2/ → 技术部 /1/2/3/；另一个易混淆的 /1/20/ */
const HQ = { id: 1, path: '/1/' };
const PRODUCT = { id: 2, path: '/1/2/' };
const TECH = { id: 3, path: '/1/2/3/' };
const OTHER = { id: 20, path: '/1/20/' };

function actor(over: Partial<ActorContext> = {}): ActorContext {
  return {
    tenantId: 1,
    userId: 100,
    departments: [PRODUCT],
    scopeType: 'DEPT',
    ...over,
  };
}

describe('数据范围 · resolveScope', () => {
  it('TENANT：只带租户隔离，不做部门限制', () => {
    const r = resolveScope(actor({ scopeType: 'TENANT' }));
    expect(r).toEqual({ ok: true, predicate: { kind: 'TENANT', tenantId: 1 } });
  });

  it('SELF：只带本人', () => {
    const r = resolveScope(actor({ scopeType: 'SELF' }));
    expect(r).toEqual({ ok: true, predicate: { kind: 'SELF', tenantId: 1, userId: 100 } });
  });

  it('DEPT：命中本人所属的全部部门（含兼职）', () => {
    const r = resolveScope(actor({ scopeType: 'DEPT', departments: [PRODUCT, TECH] }));
    expect(r.ok === true && r.predicate.deptIds).toEqual([2, 3]);
  });

  it('DEPT_AND_SUB：带物化路径，供子树前缀匹配', () => {
    const r = resolveScope(actor({ scopeType: 'DEPT_AND_SUB', departments: [PRODUCT] }));
    expect(r.ok === true && r.predicate.deptPaths).toEqual(['/1/2/']);
  });

  it('没有任何部门时退化为「范围内无数据」，而不是全租户', () => {
    for (const scopeType of ['DEPT', 'DEPT_AND_SUB'] as const) {
      const r = resolveScope(actor({ scopeType, departments: [] }));
      expect(r.ok === true && r.predicate.kind).toBe('NONE');
      expect(matchesScope(r.ok === true ? r.predicate : { kind: 'NONE', tenantId: 1 }, { tenantId: 1, deptId: 2 })).toBe(false);
    }
  });

  it('DEPT_LIST：未配置部门直接报错，避免被当成全租户', () => {
    const r = resolveScope(actor({ scopeType: 'DEPT_LIST', scopedDeptIds: [] }));
    expect(r).toMatchObject({ ok: false, error: ERROR_CODES.SYS_VALIDATION_FAILED });
    expect(resolveScope(actor({ scopeType: 'DEPT_LIST', scopedDeptIds: [3] }))).toMatchObject({
      ok: true,
      predicate: { kind: 'DEPT_LIST', deptIds: [3] },
    });
  });
});

describe('数据范围 · matchesScope', () => {
  it('租户不匹配时一律不可见', () => {
    const predicate = { kind: 'TENANT' as const, tenantId: 1 };
    expect(matchesScope(predicate, { tenantId: 2 })).toBe(false);
  });

  it('SELF 只命中本人，ownerId 缺失时不命中', () => {
    const predicate = { kind: 'SELF' as const, tenantId: 1, userId: 100 };
    expect(matchesScope(predicate, { tenantId: 1, ownerId: 100 })).toBe(true);
    expect(matchesScope(predicate, { tenantId: 1, ownerId: 101 })).toBe(false);
    expect(matchesScope(predicate, { tenantId: 1, ownerId: null })).toBe(false);
  });

  it('DEPT 命中本部门，不命中兄弟部门', () => {
    const predicate = { kind: 'DEPT' as const, tenantId: 1, deptIds: [2] };
    expect(matchesScope(predicate, { tenantId: 1, deptId: 2 })).toBe(true);
    expect(matchesScope(predicate, { tenantId: 1, deptId: 3 })).toBe(false);
  });
});

describe('数据范围 · 子树前缀判定', () => {
  it('isInSubtree 命中自身与下级，且不会被 /1/20/ 这类同前缀干扰', () => {
    expect(isInSubtree('/1/2/3/', '/1/2/')).toBe(true);
    expect(isInSubtree('/1/2/', '/1/2/')).toBe(true);
    expect(isInSubtree('/1/2/', '/1/2/3/')).toBe(false);
    expect(isInSubtree('/1/20/', '/1/2/')).toBe(false);
  });

  it('DEPT_AND_SUB：本部门及下级可见，上级与旁支不可见（需要 path 才能判子树）', () => {
    const viewer = actor({ scopeType: 'DEPT_AND_SUB', departments: [PRODUCT] });

    expect(assertVisibleWithPath(viewer, { tenantId: 1, deptId: 3, deptPath: '/1/2/3/' })).toEqual({ ok: true });
    expect(assertVisibleWithPath(viewer, { tenantId: 1, deptId: 2, deptPath: '/1/2/' })).toEqual({ ok: true });
    expect(assertVisibleWithPath(viewer, { tenantId: 1, deptId: 20, deptPath: '/1/20/' })).toMatchObject({
      ok: false,
      error: ERROR_CODES.PERM_OUT_OF_SCOPE,
    });
    expect(assertVisibleWithPath(viewer, { tenantId: 1, deptId: 1, deptPath: '/1/' })).toMatchObject({ ok: false });
  });

  it('DEPT_AND_SUB 缺少物化路径时保守拒绝，而不是放行', () => {
    const viewer = actor({ scopeType: 'DEPT_AND_SUB', departments: [PRODUCT] });
    expect(assertVisibleWithPath(viewer, { tenantId: 1, deptId: 3 })).toMatchObject({
      ok: false,
      error: ERROR_CODES.PERM_OUT_OF_SCOPE,
    });
  });
});

describe('数据范围 · 详情越权语义（F3）', () => {
  it('越权返回 404 语义的错误（不暴露存在性），跨租户同样按 404 处理', () => {
    const viewer = actor();
    const denied = assertVisible(viewer, { tenantId: 1, deptId: 3 });
    expect(denied).toMatchObject({ ok: false, error: ERROR_CODES.PERM_OUT_OF_SCOPE });
    expect(!denied.ok && denied.error.httpStatus).toBe(404);

    const crossTenant = assertVisible(viewer, { tenantId: 2, deptId: 2 });
    expect(!crossTenant.ok && crossTenant.error.httpStatus).toBe(404);

    expect(assertVisible(viewer, { tenantId: 1, deptId: 2 })).toEqual({ ok: true });
  });
});

describe('投票明细可见性（B1/B2/B3）', () => {
  it('本部门投票人（含兼职部门）看到明细，其他部门只看聚合计数', () => {
    const viewer = actor({ departments: [PRODUCT, TECH] });
    expect(voteDetailVisibility(viewer, 2)).toBe('DETAIL');
    expect(voteDetailVisibility(viewer, 3)).toBe('DETAIL');
    expect(voteDetailVisibility(viewer, 20)).toBe('AGGREGATE');
    expect(voteDetailVisibility(viewer, null)).toBe('AGGREGATE');
  });

  it('上报链上的上级部门工号成员可见全部层级明细', () => {
    const viewer = actor({ departments: [PRODUCT], escalationChainVisible: true });
    expect(voteDetailVisibility(viewer, 3)).toBe('DETAIL');
    expect(voteDetailVisibility(viewer, 20)).toBe('DETAIL');
  });

  it('放大到上报链全部明细需要 VOTE_VIEW_ALL，且本部门必须是目标部门的上级', () => {
    // 产品中心 /1/2/ 是技术部 /1/2/3/ 的上级
    expect(canViewEscalationChain(true, '/1/2/3/', ['/1/2/'])).toBe(true);
    // 没有权限不放行
    expect(canViewEscalationChain(false, '/1/2/3/', ['/1/2/'])).toBe(false);
    // 不是上级不放行（技术部看不到产品中心的明细）
    expect(canViewEscalationChain(true, '/1/2/', ['/1/2/3/'])).toBe(false);
    // 旁支更不放行
    expect(canViewEscalationChain(true, '/1/20/', ['/1/2/'])).toBe(false);
  });
});
