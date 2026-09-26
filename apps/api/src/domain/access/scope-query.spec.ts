import { departmentScopeWhere, userScopeWhere, type ScopeActor } from './scope-query';
import type { ScopePredicate } from './data-scope';

const actor: ScopeActor = {
  tenantId: 1,
  userId: 100,
  departments: [{ id: 2, path: '/1/2/' }],
  scopeType: 'DEPT_AND_SUB',
  primaryDeptId: 2,
};

describe('数据范围 → Prisma where · 部门', () => {
  it('TENANT 不加任何部门限制', () => {
    expect(departmentScopeWhere({ kind: 'TENANT', tenantId: 1 }, actor)).toEqual({});
  });

  it('DEPT / DEPT_LIST 用 id IN 列表', () => {
    expect(departmentScopeWhere({ kind: 'DEPT', tenantId: 1, deptIds: [2, 3] }, actor)).toEqual({
      id: { in: [2, 3] },
    });
    expect(departmentScopeWhere({ kind: 'DEPT_LIST', tenantId: 1, deptIds: [7] }, actor)).toEqual({
      id: { in: [7] },
    });
  });

  it('DEPT_AND_SUB 同时给 id IN 与物化路径前缀（命中 text_pattern_ops 索引）', () => {
    expect(
      departmentScopeWhere({ kind: 'DEPT_AND_SUB', tenantId: 1, deptIds: [2], deptPaths: ['/1/2/'] }, actor),
    ).toEqual({
      OR: [{ id: { in: [2] } }, { path: { startsWith: '/1/2/' } }],
    });
  });

  it('SELF 只给主部门；没有主部门时表达"范围内无数据"', () => {
    expect(departmentScopeWhere({ kind: 'SELF', tenantId: 1, userId: 100 }, actor)).toEqual({ id: 2 });
    expect(departmentScopeWhere({ kind: 'SELF', tenantId: 1, userId: 100 }, { ...actor, primaryDeptId: null })).toEqual({
      id: { in: [] },
    });
  });

  it('NONE 一律表达为空集合，不会退化成全租户', () => {
    expect(departmentScopeWhere({ kind: 'NONE', tenantId: 1 }, actor)).toEqual({ id: { in: [] } });
  });
});

describe('数据范围 → Prisma where · 用户', () => {
  it('TENANT 不加限制；SELF 只命中本人', () => {
    expect(userScopeWhere({ kind: 'TENANT', tenantId: 1 }, actor)).toEqual({});
    expect(userScopeWhere({ kind: 'SELF', tenantId: 1, userId: 100 }, actor)).toEqual({ id: 100 });
  });

  it('DEPT 按所属部门任一命中', () => {
    expect(userScopeWhere({ kind: 'DEPT', tenantId: 1, deptIds: [2] }, actor)).toEqual({
      departments: { some: { departmentId: { in: [2] } } },
    });
  });

  it('DEPT_AND_SUB 通过部门关系的物化路径做下级匹配', () => {
    expect(
      userScopeWhere({ kind: 'DEPT_AND_SUB', tenantId: 1, deptIds: [2], deptPaths: ['/1/2/'] }, actor),
    ).toEqual({
      departments: {
        some: {
          department: {
            OR: [{ id: { in: [2] } }, { path: { startsWith: '/1/2/' } }],
          },
        },
      },
    });
  });

  it('NONE 表达为空集合', () => {
    expect(userScopeWhere({ kind: 'NONE', tenantId: 1 }, actor)).toEqual({ id: { in: [] } });
  });

  it('谓词里缺少 deptIds 时不返回宽松条件', () => {
    const odd: ScopePredicate = { kind: 'DEPT', tenantId: 1 };
    expect(userScopeWhere(odd, actor)).toEqual({ departments: { some: { departmentId: { in: [] } } } });
  });
});
