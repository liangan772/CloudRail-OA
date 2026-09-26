import { ERROR_CODES, type ErrorDef, type ScopeType } from '@oa/shared';

/**
 * 数据范围过滤（纯函数，零 IO）。
 *
 * 唯一口径：docs/stage-0/README.md §F2/F3 与 §B1–B3（Q1–Q27 冻结基线）。
 *
 * - F2 数据范围：本人 / 本部门 / 本部门及下级 / 指定部门 / 全租户；
 * - F3 越权响应：详情越权返回 **404**（`PERM_OUT_OF_SCOPE`），不暴露资源存在性；
 * - B1 投票明细按部门可见：投票人**只能看到本部门**的明细（姓名 + 选择）；
 * - B2 跨部门只给聚合计数（已表态 N/M、同意数、反对数），不含姓名；
 * - B3 上报链上的上级部门及其工号成员可见**全部层级**投票明细。
 *
 * 这里只算「能不能看见」，不拼 SQL；调用方（Repository）把 `ScopePredicate`
 * 翻译成 Prisma where 条件，保证任何查询都带 `tenantId` 硬隔离。
 */

/** 部门引用（`path` 是物化路径，如 `/1/2/3/`） */
export interface DeptRef {
  id: number;
  path: string;
}

/** 请求上下文中的数据主体（由 JwtAuthGuard → PermissionGuard → DataScopeGuard 注入） */
export interface ActorContext {
  tenantId: number;
  userId: number;
  /** 本人所属部门（允许兼职多部门） */
  departments: DeptRef[];
  /** 该权限点对应的数据范围 */
  scopeType: ScopeType;
  /** `DEPT_LIST` 时生效的指定部门 */
  scopedDeptIds?: number[];
  /** 是否落在上报链上（上级部门工号成员 → 可见全部层级明细，B3） */
  escalationChainVisible?: boolean;
}

/** 被访问对象的位置信息 */
export interface SubjectLocation {
  tenantId: number;
  /** 归属人（SELF 范围用） */
  ownerId?: number | null;
  /** 归属部门（DEPT / DEPT_AND_SUB / DEPT_LIST 用） */
  deptId?: number | null;
}

export interface ScopePredicate {
  kind: ScopeType | 'NONE';
  tenantId: number;
  userId?: number;
  deptIds?: number[];
  /** 本部门及下级：用物化路径前缀匹配，避免递归查询 */
  deptPaths?: string[];
}

export interface ScopeFailure {
  ok: false;
  error: ErrorDef;
  reason: string;
}

export type ScopeResult = { ok: true; predicate: ScopePredicate } | ScopeFailure;

/** 是否为同一租户（跨租户一律不可见，先于任何范围判断） */
function tenantMismatch(actor: ActorContext, subject: SubjectLocation): boolean {
  return actor.tenantId !== subject.tenantId;
}

/** 对象是否落在某个部门的子树内（含自身）：`/1/2/` 命中 `/1/2/3/`，但不命中 `/1/20/` */
export function isInSubtree(deptPath: string, prefixPath: string): boolean {
  const prefix = prefixPath.endsWith('/') ? prefixPath : `${prefixPath}/`;
  return deptPath === prefix || deptPath.startsWith(prefix);
}

/**
 * 把数据主体解析成可用于查询的范围谓词。
 * 返回 `NONE` 表示「范围内没有任何数据」——调用方应直接返回空列表，而不是退化成全租户。
 */
export function resolveScope(actor: ActorContext): ScopeResult {
  const tenantId = actor.tenantId;
  const myDeptIds = actor.departments.map((d) => d.id);

  switch (actor.scopeType) {
    case 'TENANT':
      return { ok: true, predicate: { kind: 'TENANT', tenantId } };

    case 'SELF':
      return { ok: true, predicate: { kind: 'SELF', tenantId, userId: actor.userId } };

    case 'DEPT':
      if (myDeptIds.length === 0) {
        return { ok: true, predicate: { kind: 'NONE', tenantId, deptIds: [] } };
      }
      return { ok: true, predicate: { kind: 'DEPT', tenantId, deptIds: myDeptIds } };

    case 'DEPT_AND_SUB':
      if (actor.departments.length === 0) {
        return { ok: true, predicate: { kind: 'NONE', tenantId, deptIds: [], deptPaths: [] } };
      }
      return {
        ok: true,
        predicate: {
          kind: 'DEPT_AND_SUB',
          tenantId,
          deptIds: myDeptIds,
          deptPaths: actor.departments.map((d) => d.path),
        },
      };

    case 'DEPT_LIST': {
      const ids = actor.scopedDeptIds ?? [];
      if (ids.length === 0) {
        return {
          ok: false,
          error: ERROR_CODES.SYS_VALIDATION_FAILED,
          reason: '数据范围为「指定部门」但未配置任何部门',
        };
      }
      return { ok: true, predicate: { kind: 'DEPT_LIST', tenantId, deptIds: [...ids].sort((a, b) => a - b) } };
    }

    default:
      return {
        ok: false,
        error: ERROR_CODES.SYS_VALIDATION_FAILED,
        reason: `未知的数据范围：${String(actor.scopeType)}`,
      };
  }
}

/**
 * 纯判定：某对象是否落在范围谓词内（不抛错）。
 *
 * ⚠️ 只按 `SubjectLocation` 里的字段判断：`DEPT_AND_SUB` 的**下级**需要部门物化路径，
 * 而 `SubjectLocation` 不带 path，所以这里只认「本部门」。列表查询请把谓词翻译成
 * `OR [deptId IN (...), department.path LIKE '/1/2/%']`，详情判定请用 `assertVisibleWithPath`。
 */
export function matchesScope(predicate: ScopePredicate, subject: SubjectLocation): boolean {
  if (predicate.tenantId !== subject.tenantId) return false;

  switch (predicate.kind) {
    case 'TENANT':
      return true;
    case 'SELF':
      return subject.ownerId != null && subject.ownerId === predicate.userId;
    case 'DEPT':
    case 'DEPT_LIST':
      return subject.deptId != null && !!predicate.deptIds?.includes(subject.deptId);
    case 'DEPT_AND_SUB':
      if (subject.deptId != null && predicate.deptIds?.includes(subject.deptId)) return true;
      // 子树判定需要 path（见上方说明），拿不到时保守判为不可见（宁少不多）
      return false;
    case 'NONE':
    default:
      return false;
  }
}

/**
 * 详情越权判定（F3）：越权返回 404 语义的错误，而不是 403 —— 避免通过状态码探测资源存在性。
 */
export function assertVisible(
  actor: ActorContext,
  subject: SubjectLocation,
): { ok: true } | ScopeFailure {
  if (tenantMismatch(actor, subject)) {
    return { ok: false, error: ERROR_CODES.PERM_OUT_OF_SCOPE, reason: '租户不匹配，视为不存在' };
  }
  const resolved = resolveScope(actor);
  if (!resolved.ok) return resolved;
  if (!matchesScope(resolved.predicate, subject)) {
    return { ok: false, error: ERROR_CODES.PERM_OUT_OF_SCOPE, reason: '不在你的数据范围内，视为不存在' };
  }
  return { ok: true };
}

/**
 * 带子树路径的详情判定：`DEPT_AND_SUB` 需要对象的部门 path 才能真正判子树。
 */
export function assertVisibleWithPath(
  actor: ActorContext,
  subject: SubjectLocation & { deptPath?: string | null },
): { ok: true } | ScopeFailure {
  if (tenantMismatch(actor, subject)) {
    return { ok: false, error: ERROR_CODES.PERM_OUT_OF_SCOPE, reason: '租户不匹配，视为不存在' };
  }
  const resolved = resolveScope(actor);
  if (!resolved.ok) return resolved;
  const predicate = resolved.predicate;

  if (predicate.kind === 'TENANT') return { ok: true };
  if (predicate.kind === 'SELF') {
    return subject.ownerId != null && subject.ownerId === predicate.userId
      ? { ok: true }
      : { ok: false, error: ERROR_CODES.PERM_OUT_OF_SCOPE, reason: '不在你的数据范围内，视为不存在' };
  }
  if (subject.deptId == null) {
    return { ok: false, error: ERROR_CODES.PERM_OUT_OF_SCOPE, reason: '对象没有归属部门，无法判定范围' };
  }
  if (predicate.kind === 'DEPT' || predicate.kind === 'DEPT_LIST') {
    return predicate.deptIds?.includes(subject.deptId)
      ? { ok: true }
      : { ok: false, error: ERROR_CODES.PERM_OUT_OF_SCOPE, reason: '不在你的数据范围内，视为不存在' };
  }
  if (predicate.kind === 'DEPT_AND_SUB') {
    if (predicate.deptIds?.includes(subject.deptId)) return { ok: true };
    const path = subject.deptPath;
    if (!path) {
      return { ok: false, error: ERROR_CODES.PERM_OUT_OF_SCOPE, reason: '缺少部门物化路径，无法判定下级范围' };
    }
    const hit = (predicate.deptPaths ?? []).some((prefix) => isInSubtree(path, prefix));
    return hit
      ? { ok: true }
      : { ok: false, error: ERROR_CODES.PERM_OUT_OF_SCOPE, reason: '不在你的数据范围内，视为不存在' };
  }
  return { ok: false, error: ERROR_CODES.PERM_OUT_OF_SCOPE, reason: '不在你的数据范围内，视为不存在' };
}

/* ------------------------------------------------------------------ *
 * 投票明细可见性（B1 / B2 / B3）
 * ------------------------------------------------------------------ */

/** 可见粒度：DETAIL=可见姓名与选择；AGGREGATE=只看聚合计数 */
export type VoteDetailVisibility = 'DETAIL' | 'AGGREGATE';

/**
 * 投票明细可见性：
 * - 本人所属部门（含兼职部门）→ 明细；
 * - 上报链上级部门 / 其工号成员 → 全部层级明细（B3）；
 * - 其余 → 仅聚合计数（B2），前端只拿到「已表态 N/M、同意数、反对数」。
 *
 * 注意：`VoteVisibility=ANONYMOUS` 只影响「显示什么」，不影响计票与这里的可见性（B4）。
 */
export function voteDetailVisibility(
  viewer: ActorContext,
  subjectDeptId: number | null,
): VoteDetailVisibility {
  if (viewer.escalationChainVisible) return 'DETAIL';
  if (subjectDeptId == null) return 'AGGREGATE';
  const myDeptIds = viewer.departments.map((d) => d.id);
  return myDeptIds.includes(subjectDeptId) ? 'DETAIL' : 'AGGREGATE';
}

/**
 * 需要把「本部门可见」扩大到「上报链全部明细」时的判定。
 * 只有具备 `VOTE_VIEW_ALL`、且本部门是目标部门**上级**（物化路径上是祖先）的工号成员才放行。
 * 越级被禁止，`Escalation.advance()` 只能沿 `parentId` 走一级，所以祖先判定与上报链判定等价。
 */
export function canViewEscalationChain(
  hasViewAllPermission: boolean,
  targetDeptPath: string,
  actorDeptPaths: readonly string[],
): boolean {
  if (!hasViewAllPermission) return false;
  return actorDeptPaths.some((path) => isInSubtree(targetDeptPath, path));
}
