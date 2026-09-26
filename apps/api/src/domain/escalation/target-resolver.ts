import {
  ERROR_CODES,
  type ErrorDef,
  type TargetDeptRule,
  type WorkNoMissingPolicy,
} from '@oa/shared';

/**
 * 上报目标解析（纯函数，零 IO）。
 *
 * 唯一口径：已确认规则 D2（**不允许越级**，只能「直接上级」或沿 `Department.path` 逐级上溯一级）、
 * D3（投递到**上级部门的工号**，不投给个人）、D10（工号缺失兜底）。
 *
 * 输出是"下一跳"：目标部门 + 该部门工号快照 + 上溯过程（审计用）。
 */

export interface DeptNode {
  id: number;
  parentId: number | null;
  path: string;
  level: number;
  workNo: string | null;
  managerId: number | null;
}

export interface EscalationTargetInput {
  /** 规则里的目标部门解析方式 */
  rule: TargetDeptRule;
  /** `SPECIFIC_DEPT` / `FIXED` 时显式指定的部门 */
  targetDeptIds?: number[];
  /** 起点：原流程所属部门 */
  fromDeptId: number;
  /**
   * 当前这一级的目标部门。
   * 首次上报时为 `null`（从 `fromDeptId` 的上级开始）；继续上报时传上一次的目标，从它的上级继续。
   */
  currentToDeptId?: number | null;
  /** 已上溯层级（首次上报为 0，上溯一层后为 1） */
  currentLevel: number;
  maxLevel: number;
  /** 租户是否允许越级（已确认默认 false） */
  allowCrossLevel: boolean;
  onMissingWorkNo: WorkNoMissingPolicy;
  departments: readonly DeptNode[];
}

export interface TargetHop {
  deptId: number;
  workNo: string | null;
  note: string;
}

export interface EscalationTarget {
  toDeptId: number;
  /** 目标工号快照；`NOTIFY_ADMIN` 兜底时为 null */
  toWorkNo: string | null;
  /** 上溯过程中经过的部门（含被跳过的无工号部门） */
  hops: TargetHop[];
  /** 走了哪种兜底 */
  fallback: 'NONE' | 'ESCALATE_UP' | 'NOTIFY_ADMIN';
  reason: string;
}

export type EscalationTargetResult =
  | { ok: true; target: EscalationTarget }
  | { ok: false; error: ErrorDef; reason: string };

function fail(error: ErrorDef, reason: string): EscalationTargetResult {
  return { ok: false, error, reason };
}

/** 逐级上溯：`DIRECT_PARENT` 与 `LEVEL_UP` 在本版本语义一致（都不允许跳级） */
function nextParent(deptId: number, byId: Map<number, DeptNode>): DeptNode | null {
  const current = byId.get(deptId);
  if (!current || current.parentId == null) return null;
  return byId.get(current.parentId) ?? null;
}

export function resolveEscalationTarget(input: EscalationTargetInput): EscalationTargetResult {
  const byId = new Map(input.departments.map((dept) => [dept.id, dept]));
  const hops: TargetHop[] = [];

  if (input.currentLevel + 1 > input.maxLevel) {
    return fail(
      ERROR_CODES.ESC_MAX_LEVEL_REACHED,
      `已达最高上报层级（maxLevel=${input.maxLevel}），不能再继续上溯`,
    );
  }

  // ---- 1. 先确定这一跳的目标部门 ----
  let targetDeptId: number | null;
  switch (input.rule) {
    case 'SPECIFIC_DEPT':
    case 'SKIP_TO_LEVEL': {
      if (!input.allowCrossLevel) {
        return fail(
          ERROR_CODES.ESC_CROSS_LEVEL_FORBIDDEN,
          `目标规则「${input.rule}」属于越级上报，但租户未开启 allowCrossLevel`,
        );
      }
      targetDeptId = input.targetDeptIds?.[0] ?? null;
      if (targetDeptId == null) {
        return fail(ERROR_CODES.SYS_VALIDATION_FAILED, `目标规则「${input.rule}」未指定部门`);
      }
      break;
    }
    case 'BY_RULE':
    case 'DIRECT_PARENT':
    case 'LEVEL_UP':
    default: {
      const from = input.currentToDeptId ?? input.fromDeptId;
      const parent = nextParent(from, byId);
      if (!parent) {
        return fail(
          ERROR_CODES.ESC_MAX_LEVEL_REACHED,
          `部门 ${from} 已是组织根节点，没有可上报的上级部门`,
        );
      }
      targetDeptId = parent.id;
      break;
    }
  }

  // ---- 2. 目标部门必须有工号；没有就按兜底策略处理 ----
  let cursor: DeptNode | null = byId.get(targetDeptId) ?? null;
  if (!cursor) {
    return fail(ERROR_CODES.SYS_NOT_FOUND, `目标部门 ${targetDeptId} 不存在`);
  }

  let fallback: EscalationTarget['fallback'] = 'NONE';
  while (cursor && !cursor.workNo) {
    hops.push({ deptId: cursor.id, workNo: null, note: '该部门未配置工号' });

    if (input.onMissingWorkNo === 'BLOCK') {
      return fail(
        ERROR_CODES.ESC_WORKNO_MISSING,
        `上级部门「${cursor.id}」未配置工号，按策略 BLOCK 阻断上报`,
      );
    }

    if (input.onMissingWorkNo === 'NOTIFY_ADMIN') {
      fallback = 'NOTIFY_ADMIN';
      break;
    }

    // ESCALATE_UP（默认）：继续上溯找有工号的部门
    fallback = 'ESCALATE_UP';
    const parent = nextParent(cursor.id, byId);
    if (!parent) {
      return fail(
        ERROR_CODES.ESC_WORKNO_MISSING,
        '沿组织树一路上溯都没有找到配置了工号的部门（已到根节点）',
      );
    }
    hops.push({ deptId: parent.id, workNo: parent.workNo, note: '继续上溯' });
    cursor = parent;
  }

  const toWorkNo = cursor?.workNo ?? null;
  const reason =
    fallback === 'ESCALATE_UP'
      ? `目标部门无工号，按策略继续上溯到「${cursor?.id}」（工号 ${toWorkNo}）`
      : fallback === 'NOTIFY_ADMIN'
        ? `目标部门无工号，按策略改为通知租户管理员（不投递工号）`
        : `投递到部门 ${cursor?.id} 的工号 ${toWorkNo}`;

  return {
    ok: true,
    target: { toDeptId: cursor!.id, toWorkNo, hops, fallback, reason },
  };
}
