import type { ActorContext, ScopePredicate } from './data-scope';

/**
 * 把数据范围谓词翻译成 Prisma `where` 片段（纯函数，零 IO，可单测）。
 *
 * 返回的是**普通对象**，由 Repository 断言成 `Prisma.XxxWhereInput` 后展开进 where。
 * 这样领域层不依赖 Prisma 类型，而翻译结果又能被单测直接断言，避免"范围写错但没人发现"。
 *
 * 约定：任何分支都**不能**返回空对象以外的宽松条件；无法表达的范围一律用 `{ id: { in: [] } }`
 * 表达"范围内无数据"，绝不退化成全租户。
 */
export type ScopeActor = ActorContext & { primaryDeptId?: number | null };

/** 部门列表/详情过滤 */
export function departmentScopeWhere(predicate: ScopePredicate, actor: ScopeActor): Record<string, unknown> {
  switch (predicate.kind) {
    case 'TENANT':
      return {};
    case 'DEPT':
    case 'DEPT_LIST':
      return { id: { in: predicate.deptIds ?? [] } };
    case 'DEPT_AND_SUB': {
      const paths = predicate.deptPaths ?? [];
      return {
        OR: [
          { id: { in: predicate.deptIds ?? [] } },
          // 物化路径前缀查询，命中 departments(path text_pattern_ops) 索引
          ...paths.map((prefix) => ({ path: { startsWith: prefix } })),
        ],
      };
    }
    case 'SELF':
      return actor.primaryDeptId == null ? { id: { in: [] } } : { id: actor.primaryDeptId };
    case 'NONE':
    default:
      return { id: { in: [] } };
  }
}

/** 用户列表过滤（按所属部门） */
export function userScopeWhere(predicate: ScopePredicate, actor: ScopeActor): Record<string, unknown> {
  switch (predicate.kind) {
    case 'TENANT':
      return {};
    case 'SELF':
      return { id: predicate.userId ?? actor.userId };
    case 'DEPT':
    case 'DEPT_LIST':
      return { departments: { some: { departmentId: { in: predicate.deptIds ?? [] } } } };
    case 'DEPT_AND_SUB': {
      const paths = predicate.deptPaths ?? [];
      return {
        departments: {
          some: {
            department: {
              OR: [
                { id: { in: predicate.deptIds ?? [] } },
                ...paths.map((prefix) => ({ path: { startsWith: prefix } })),
              ],
            },
          },
        },
      };
    }
    case 'NONE':
    default:
      return { id: { in: [] } };
  }
}
