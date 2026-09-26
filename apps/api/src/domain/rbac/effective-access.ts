import type { ScopeType } from '@oa/shared';

/**
 * 有效权限与数据范围（纯函数，零 IO）。
 *
 * 一个人的角色可能有多个，每个角色分配（`UserRole`）自带 `scopeType` / `scopeId`：
 * - **权限**取并集（角色叠加）；
 * - **数据范围**取最宽的那个（否则"多给一个角色反而缩小可见范围"），
 *   但「最宽」的判定顺序是明确的：TENANT ⊃ DEPT_AND_SUB ⊃ DEPT_LIST ⊃ DEPT ⊃ SELF。
 */

const SCOPE_RANK: Record<ScopeType, number> = {
  SELF: 0,
  DEPT: 1,
  DEPT_LIST: 2,
  DEPT_AND_SUB: 3,
  TENANT: 4,
};

export interface RoleAssignment {
  scopeType: ScopeType;
  /** `DEPT_LIST` 时指向具体部门 */
  scopeId: number | null;
}

export interface EffectiveScope {
  scopeType: ScopeType;
  /** `DEPT_LIST` 时生效的部门集合（去重排序） */
  scopedDeptIds: number[];
}

/** 权限并集：去重 + 排序，保证同一用户在两次请求里拿到一致的结果（便于缓存与断言） */
export function mergePermissions(grants: readonly (readonly string[])[]): string[] {
  const set = new Set<string>();
  for (const list of grants) for (const code of list) set.add(code);
  return [...set].sort();
}

/** 取最宽的数据范围；`DEPT_LIST` 时收集所有指定部门 */
export function effectiveScope(
  assignments: readonly RoleAssignment[],
  fallback: ScopeType = 'SELF',
): EffectiveScope {
  if (assignments.length === 0) return { scopeType: fallback, scopedDeptIds: [] };

  let widest: ScopeType = fallback;
  for (const item of assignments) {
    if (SCOPE_RANK[item.scopeType] > SCOPE_RANK[widest]) widest = item.scopeType;
  }

  const scopedDeptIds =
    widest === 'DEPT_LIST'
      ? [
          ...new Set(
            assignments
              .filter((a) => a.scopeType === 'DEPT_LIST' && a.scopeId != null)
              .map((a) => a.scopeId as number),
          ),
        ].sort((a, b) => a - b)
      : [];

  return { scopeType: widest, scopedDeptIds };
}

/** 是否具备某个权限点 */
export function hasPermission(permissions: readonly string[], code: string): boolean {
  return permissions.includes(code);
}
