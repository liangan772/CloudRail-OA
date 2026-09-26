import { ERROR_CODES, type AssigneeRuleType, type ErrorDef } from '@oa/shared';
import { isInSubtree } from '../access/data-scope';

/**
 * 任务分配解析（纯函数，零 IO）。
 *
 * 唯一口径：已确认规则 E1（六种分配算法 + 抢单）与 E2（**每任务恰好一个 OWNER + 恰好一个 ACCEPTOR**）。
 *
 * 设计取舍：
 * - **确定性**：候选人排序固定（负载升序 → userId 升序），同一份目录每次解析出同一个人，
 *   否则同样的配置在不同时间派给不同人，出问题无法复现；
 * - **抢单是模式不是人**：`GRAB` 不预指定负责人，任务停在待分配由人抢；
 *   验收人仍然必须唯一（没人验收的任务等于没完成）。
 */

export interface AssigneeDirectoryUser {
  userId: number;
  deptIds: number[];
  /** 任负责人的部门 */
  leaderDeptIds?: number[];
  roleCodes: string[];
  /** 在手未结任务数，负载均衡用 */
  openTaskCount: number;
}

export interface AssigneeDirectory {
  users: AssigneeDirectoryUser[];
  voteGroups: { code: string; members: { userId: number }[] }[];
  workNoMembers: { departmentId: number; userId: number; isPrimary: boolean }[];
  departments: { id: number; parentId: number | null; path: string }[];
  initiatorDeptId: number | null;
  parentDeptId: number | null;
}

export interface AssigneeRuleSpec {
  type: AssigneeRuleType;
  value: Record<string, unknown>;
}

export interface AssignmentSuccess {
  ok: true;
  /** ASSIGNED=已确定负责人；GRAB=待抢单 */
  mode: 'ASSIGNED' | 'GRAB';
  ownerId: number | null;
  acceptorId: number | null;
  ownerReason: string;
  acceptorReason: string;
  /** 候选人（抢单/协作者/兜底改派时可用） */
  candidates: number[];
}

export type AssignmentResult = AssignmentSuccess | { ok: false; error: ErrorDef; reason: string };

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter((item) => item.length > 0);
}

export function resolveAssignees(
  ownerRule: AssigneeRuleSpec,
  acceptorRule: AssigneeRuleSpec,
  directory: AssigneeDirectory,
): AssignmentResult {
  const byId = new Map(directory.users.map((user) => [user.userId, user]));
  const deptById = new Map(directory.departments.map((dept) => [dept.id, dept]));

  const deptFamily = (rootId: number, includeSub: boolean): number[] => {
    const root = deptById.get(rootId);
    if (!root) return [];
    if (!includeSub) return [rootId];
    return directory.departments.filter((dept) => isInSubtree(dept.path, root.path)).map((dept) => dept.id);
  };

  /** `deptRef` 与 `scope` 两种写法都支持（与投票人规则一致） */
  const refDeptId = (value: Record<string, unknown>): number | null => {
    const ref = String(value.deptRef ?? value.scope ?? 'INITIATOR_DEPT');
    if (ref === 'PARENT_DEPT') return directory.parentDeptId;
    if (ref === 'FIXED' || ref === 'FIXED_DEPT') return asNumberArray(value.deptIds)[0] ?? null;
    return directory.initiatorDeptId;
  };

  /** 按规则性质选出候选用户（不做"选谁"的决策） */
  const candidatesFor = (rule: AssigneeRuleSpec): { userIds: number[]; reason: string } => {
    const value = rule.value ?? {};
    switch (rule.type) {
      case 'MANUAL': {
        const ids = asNumberArray(value.userIds).filter((id) => byId.has(id));
        return { userIds: ids, reason: '手动指定' };
      }
      case 'ROLE': {
        const roleCodes = asStringArray(value.roleCodes);
        const explicit = asNumberArray(value.deptIds);
        const ref = refDeptId(value);
        const scopeDepts =
          explicit.length > 0
            ? explicit.flatMap((id) => deptFamily(id, value.includeSub === true))
            : ref != null
              ? deptFamily(ref, value.includeSub === true)
              : [];
        const leaderOnly = value.leaderOnly === true;
        const userIds = directory.users
          .filter((user) => user.roleCodes.some((code) => roleCodes.includes(code)))
          .filter((user) => scopeDepts.length === 0 || user.deptIds.some((d) => scopeDepts.includes(d)))
          .filter((user) => !leaderOnly || (user.leaderDeptIds ?? []).some((d) => scopeDepts.includes(d)))
          .map((user) => user.userId);
        return { userIds, reason: `角色 ${roleCodes.join('/')}` };
      }
      case 'DEPARTMENT': {
        const explicit = asNumberArray(value.deptIds);
        const ref = refDeptId(value);
        const roots = explicit.length > 0 ? explicit : ref != null ? [ref] : [];
        const targetDepts = roots.flatMap((id) => deptFamily(id, value.includeSub === true));
        const leaderOnly = value.leaderOnly === true;
        const userIds = directory.users
          .filter((user) =>
            leaderOnly
              ? (user.leaderDeptIds ?? []).some((d) => targetDepts.includes(d))
              : user.deptIds.some((d) => targetDepts.includes(d)),
          )
          .map((user) => user.userId);
        return { userIds, reason: `部门 ${targetDepts.join('/')}${leaderOnly ? ' 负责人' : ' 成员'}` };
      }
      case 'VOTE_GROUP': {
        const codes = asStringArray(value.groupCodes);
        const userIds = directory.voteGroups
          .filter((group) => codes.includes(group.code))
          .flatMap((group) => group.members.map((member) => member.userId))
          .filter((id) => byId.has(id));
        return { userIds: [...new Set(userIds)], reason: `投票组 ${codes.join('/')}` };
      }
      case 'DEPT_WORKNO': {
        const explicit = asNumberArray(value.deptIds);
        const ref = refDeptId(value);
        const targets = explicit.length > 0 ? explicit : ref != null ? [ref] : [];
        const primaryOnly = value.primaryOnly === true;
        const userIds = directory.workNoMembers
          .filter((member) => targets.includes(member.departmentId))
          .filter((member) => !primaryOnly || member.isPrimary)
          .map((member) => member.userId)
          .filter((id) => byId.has(id));
        return { userIds: [...new Set(userIds)], reason: `部门工号成员${primaryOnly ? '（主责人）' : ''}` };
      }
      case 'LOAD_BALANCE':
      case 'GRAB': {
        // 两者都用"角色 + 部门范围"筛候选，区别在后续怎么选人
        const roleCodes = asStringArray(value.roleCodes);
        const explicit = asNumberArray(value.deptIds);
        const ref = refDeptId(value);
        const scopeDepts =
          explicit.length > 0
            ? explicit.flatMap((id) => deptFamily(id, value.includeSub === true))
            : ref != null
              ? deptFamily(ref, value.includeSub === true)
              : [];
        const userIds = directory.users
          .filter((user) => roleCodes.length === 0 || user.roleCodes.some((code) => roleCodes.includes(code)))
          .filter((user) => scopeDepts.length === 0 || user.deptIds.some((d) => scopeDepts.includes(d)))
          .map((user) => user.userId);
        return {
          userIds,
          reason: rule.type === 'GRAB' ? '抢单候选池' : `负载均衡（角色 ${roleCodes.join('/') || '不限'}）`,
        };
      }
      default:
        return { userIds: [], reason: `未知分配规则 ${String(rule.type)}` };
    }
  };

  /** 确定性选人：负载升序 → userId 升序 */
  const pickOne = (userIds: number[]): number | null => {
    if (userIds.length === 0) return null;
    const sorted = [...userIds].sort((a, b) => {
      const loadA = byId.get(a)?.openTaskCount ?? 0;
      const loadB = byId.get(b)?.openTaskCount ?? 0;
      return loadA - loadB || a - b;
    });
    return sorted[0]!;
  };

  // ---- 负责人 ----
  if (ownerRule.type === 'GRAB') {
    if (acceptorRule.type === 'GRAB') {
      return {
        ok: false,
        error: ERROR_CODES.TASK_ACCEPTOR_REQUIRED,
        reason: '验收人不支持抢单模式：任务必须指定唯一验收人',
      };
    }
    const acceptorCandidates = candidatesFor(acceptorRule);
    const acceptorId = pickOne(acceptorCandidates.userIds);
    if (acceptorId == null) {
      return {
        ok: false,
        error: ERROR_CODES.TASK_ACCEPTOR_REQUIRED,
        reason: `未解析出验收人（${acceptorCandidates.reason}）`,
      };
    }
    return {
      ok: true,
      mode: 'GRAB',
      ownerId: null,
      acceptorId,
      ownerReason: '抢单模式：不预指定负责人，任务停在待分配',
      acceptorReason: acceptorCandidates.reason,
      candidates: candidatesFor(ownerRule).userIds,
    };
  }

  const ownerCandidates = candidatesFor(ownerRule);
  const ownerId = pickOne(ownerCandidates.userIds);
  if (ownerId == null) {
    return {
      ok: false,
      error: ERROR_CODES.TASK_OWNER_REQUIRED,
      reason: `未解析出负责人（${ownerCandidates.reason}）`,
    };
  }

  const acceptorCandidates = candidatesFor(acceptorRule);
  const acceptorId = pickOne(acceptorCandidates.userIds);
  if (acceptorId == null) {
    return {
      ok: false,
      error: ERROR_CODES.TASK_ACCEPTOR_REQUIRED,
      reason: `未解析出验收人（${acceptorCandidates.reason}）`,
    };
  }

  return {
    ok: true,
    mode: 'ASSIGNED',
    ownerId,
    acceptorId,
    ownerReason: ownerCandidates.reason,
    acceptorReason: acceptorCandidates.reason,
    candidates: ownerCandidates.userIds,
  };
}
