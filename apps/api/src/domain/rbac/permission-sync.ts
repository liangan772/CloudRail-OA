export interface ExistingPermission {
  id: number;
  code: string;
}

export interface PermissionPrunePlan {
  /** 库里存在、但代码（`PERMISSIONS`）里已删除的权限点 —— 需要清理 */
  stale: ExistingPermission[];
  /** 代码里有、库里还没有的权限点 —— seed 的 upsert 会补上，这里只用于提示 */
  missing: string[];
}

/**
 * 计算权限点同步计划（纯函数，零 IO）。
 *
 * 背景：权限点只能由代码定义（`AdminRoleService.assertPermissionCodes` 拒绝未知 code），
 * 所以从 `PERMISSIONS` 里删掉一个权限点后，库里那一行不会被任何业务流程清掉。
 * 只 upsert 不 prune 的种子会让这种偏差永久累积，最终表现为
 * "权限目录看不到它、角色详情却能看到它"的精神分裂。
 *
 * 这里把"哪些该清"独立成纯函数，是为了能脱离数据库验证分类逻辑；
 * 真正落库的删除在 `prisma/seed/index.ts#prunePermissions`。
 */
export function planPermissionPrune(
  knownCodes: readonly string[],
  existing: readonly ExistingPermission[],
): PermissionPrunePlan {
  // 防御：已知集合为空时，"全部都是孤儿"是危险结论，必须显式失败而不是照算
  if (knownCodes.length === 0) {
    throw new Error('已知权限点为空，拒绝计算清理计划（避免误判全部权限点为孤儿）');
  }

  const known = new Set(knownCodes);
  const existingCodes = new Set(existing.map((permission) => permission.code));

  return {
    stale: existing.filter((permission) => !known.has(permission.code)),
    missing: [...new Set(knownCodes)].filter((code) => !existingCodes.has(code)),
  };
}
