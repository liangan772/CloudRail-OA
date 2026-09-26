import { round4, type VoterType } from '@oa/shared';
import { isInSubtree } from '../access/data-scope';

/**
 * 投票人解析（纯函数，零 IO）。
 *
 * 唯一口径：docs/stage-0/04-domain-model-draft.md §7 的 6 种 `voterType`。
 * 调用方负责把库里的候选数据查好塞进 `VoterDirectory`（本函数不做任何查询），
 * 因此解析规则可以被单测穷举，不会出现"只有连上库才知道选出来是谁"的情况。
 *
 * 三条硬规则：
 * 1. **去重取最大权重**：同一个人被多条规则命中时权重取最大，不累加（避免多重身份刷票）；
 * 2. **只留有效用户**：解析结果里不属于本租户 / 已停用的候选人直接剔除并记 note；
 * 3. **可解释**：每个投票人都带 `sourceReason`（写进 `InstanceNodeVoter.sourceReason`），
 *    回答审计问题"为什么这个人是投票人"。
 */

export interface VoterRuleSpec {
  id: number;
  voterType: VoterType;
  voterValue: Record<string, unknown>;
  weight: number;
  isRequired: boolean;
  order: number;
}

export interface DirectoryDepartment {
  id: number;
  parentId: number | null;
  path: string;
}

export interface DirectoryUser {
  userId: number;
  /** 所属部门 */
  deptIds: number[];
  /** 任负责人的部门 */
  leaderDeptIds?: number[];
  roleCodes: string[];
}

export interface DirectoryVoteGroup {
  code: string;
  members: { userId: number; weight: number }[];
}

export interface DirectoryWorkNoMember {
  departmentId: number;
  userId: number;
  isPrimary: boolean;
}

/** 解析所需的候选数据（由服务层按租户一次性查好） */
export interface VoterDirectory {
  departments: DirectoryDepartment[];
  users: DirectoryUser[];
  voteGroups: DirectoryVoteGroup[];
  workNoMembers: DirectoryWorkNoMember[];
  /** 发起人主部门 */
  initiatorDeptId: number | null;
  /** 发起人部门的直接上级部门（逐级上报与 PARENT_DEPT 规则用） */
  parentDeptId: number | null;
}

export interface ResolvedVoter {
  userId: number;
  weight: number;
  isRequired: boolean;
  /** 为什么他是投票人（写库字段，长度上限 255） */
  sourceReason: string;
  /** 权重最高的那条规则，便于回溯配置 */
  sourceRuleId: number;
}

export interface VoterResolution {
  voters: ResolvedVoter[];
  /** 解析过程中的跳过说明与告警（空规则、剔除无效用户等） */
  notes: string[];
}

const REASON_MAX = 255;

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter((item) => item.length > 0);
}

/** 读取 `formData.a.b` 这类路径；允许直接写字段名 */
export function readFormPath(source: Record<string, unknown>, path: string): unknown {
  const trimmed = path.replace(/^formData\./, '');
  return trimmed
    .split('.')
    .filter(Boolean)
    .reduce<unknown>(
      (acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined),
      source,
    );
}

export function resolveVoters(
  rules: readonly VoterRuleSpec[],
  directory: VoterDirectory,
  formData: Record<string, unknown> = {},
): VoterResolution {
  const notes: string[] = [];
  const deptById = new Map(directory.departments.map((d) => [d.id, d]));
  const userById = new Map(directory.users.map((u) => [u.userId, u]));

  const deptFamily = (rootId: number, includeSub: boolean): number[] => {
    const root = deptById.get(rootId);
    if (!root) return [];
    if (!includeSub) return [rootId];
    return directory.departments.filter((d) => isInSubtree(d.path, root.path)).map((d) => d.id);
  };

  /** `deptRef` 与 `scope` 两种写法都支持（种子与设计器历史上都出现过） */
  const refDeptId = (value: Record<string, unknown>): number | null => {
    const ref = String(value.deptRef ?? value.scope ?? 'INITIATOR_DEPT');
    if (ref === 'PARENT_DEPT') return directory.parentDeptId;
    if (ref === 'FIXED' || ref === 'FIXED_DEPT') return asNumberArray(value.deptIds)[0] ?? null;
    return directory.initiatorDeptId;
  };

  const collected = new Map<number, ResolvedVoter>();
  const ordered = [...rules].sort((a, b) => a.order - b.order || a.id - b.id);

  for (const rule of ordered) {
    const value = rule.voterValue ?? {};
    const baseWeight = Number.isFinite(rule.weight) && rule.weight > 0 ? rule.weight : 1;
    let candidates: { userId: number; weight: number; reason: string }[] = [];

    switch (rule.voterType) {
      case 'USER': {
        candidates = asNumberArray(value.userIds).map((userId) => ({
          userId,
          weight: baseWeight,
          reason: '指定人员',
        }));
        break;
      }

      case 'ROLE': {
        const roleCodes = asStringArray(value.roleCodes);
        const explicitDeptIds = asNumberArray(value.deptIds);
        const includeSub = value.includeSub === true;
        const ref = refDeptId(value);
        const scopeDeptIds =
          explicitDeptIds.length > 0
            ? explicitDeptIds.flatMap((id) => deptFamily(id, includeSub))
            : ref != null
              ? deptFamily(ref, includeSub)
              : [];
        const leaderOnly = value.leaderOnly === true;

        candidates = directory.users
          .filter((u) => u.roleCodes.some((code) => roleCodes.includes(code)))
          .filter((u) => scopeDeptIds.length === 0 || u.deptIds.some((d) => scopeDeptIds.includes(d)))
          .filter((u) => !leaderOnly || (u.leaderDeptIds ?? []).some((d) => scopeDeptIds.includes(d)))
          .map((u) => ({
            userId: u.userId,
            weight: baseWeight,
            reason: `角色 ${roleCodes.join('/')}${scopeDeptIds.length > 0 ? ` @部门 ${scopeDeptIds.join('/')}` : ''}`,
          }));
        break;
      }

      case 'DEPARTMENT': {
        const explicitDeptIds = asNumberArray(value.deptIds);
        const ref = refDeptId(value);
        const roots = explicitDeptIds.length > 0 ? explicitDeptIds : ref != null ? [ref] : [];
        const targetDeptIds = roots.flatMap((id) => deptFamily(id, value.includeSub === true));
        const leaderOnly = value.leaderOnly === true;

        candidates = directory.users
          .filter((u) =>
            leaderOnly
              ? (u.leaderDeptIds ?? []).some((d) => targetDeptIds.includes(d))
              : u.deptIds.some((d) => targetDeptIds.includes(d)),
          )
          .map((u) => ({
            userId: u.userId,
            weight: baseWeight,
            reason: `部门 ${targetDeptIds.join('/')}${leaderOnly ? ' 负责人' : ' 成员'}`,
          }));
        break;
      }

      case 'VOTE_GROUP': {
        const codes = asStringArray(value.groupCodes);
        for (const group of directory.voteGroups.filter((g) => codes.includes(g.code))) {
          for (const member of group.members) {
            candidates.push({
              userId: member.userId,
              weight: round4((member.weight > 0 ? member.weight : 1) * baseWeight),
              reason: `投票组 ${group.code}`,
            });
          }
        }
        break;
      }

      case 'DEPT_WORKNO': {
        const explicitDeptIds = asNumberArray(value.deptIds);
        const ref = refDeptId(value);
        const targets = explicitDeptIds.length > 0 ? explicitDeptIds : ref != null ? [ref] : [];
        const primaryOnly = value.primaryOnly === true;

        for (const member of directory.workNoMembers) {
          if (!targets.includes(member.departmentId)) continue;
          if (primaryOnly && !member.isPrimary) continue;
          candidates.push({
            userId: member.userId,
            weight: baseWeight,
            reason: `部门工号成员${member.isPrimary ? '（主责人）' : ''}`,
          });
        }
        break;
      }

      case 'DYNAMIC': {
        const from = typeof value.from === 'string' ? value.from : '';
        const raw = readFormPath(formData, from);
        const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
        const as = (value.as as VoterType | undefined) ?? 'USER';

        if (as === 'USER') {
          candidates = list
            .map((item) => Number(item))
            .filter((item) => Number.isInteger(item) && item > 0)
            .map((userId) => ({ userId, weight: baseWeight, reason: `表单字段 ${from}` }));
        } else if (as === 'ROLE') {
          const wanted = list.map((item) => String(item));
          candidates = directory.users
            .filter((u) => u.roleCodes.some((code) => wanted.includes(code)))
            .map((u) => ({ userId: u.userId, weight: baseWeight, reason: `表单字段 ${from}（角色）` }));
        } else if (as === 'DEPARTMENT') {
          const wanted = list.map((item) => Number(item)).filter((n) => Number.isInteger(n));
          const targetDeptIds = wanted.flatMap((id) => deptFamily(id, value.includeSub === true));
          candidates = directory.users
            .filter((u) => u.deptIds.some((d) => targetDeptIds.includes(d)))
            .map((u) => ({ userId: u.userId, weight: baseWeight, reason: `表单字段 ${from}（部门）` }));
        } else {
          notes.push(`表单动态规则暂不支持 as=${as}`);
        }
        break;
      }

      default: {
        notes.push(`未知投票人类型：${String(rule.voterType)}`);
      }
    }

    const valid = candidates.filter((c) => userById.has(c.userId));
    const dropped = candidates.length - valid.length;
    if (valid.length === 0) {
      notes.push(`规则「${rule.voterType}」未解析出任何投票人${dropped > 0 ? `（剔除 ${dropped} 个无效用户）` : ''}`);
    } else if (dropped > 0) {
      notes.push(`规则「${rule.voterType}」剔除 ${dropped} 个非本租户/已停用用户`);
    }

    for (const candidate of valid) {
      const weight = round4(candidate.weight);
      const existing = collected.get(candidate.userId);
      if (!existing) {
        collected.set(candidate.userId, {
          userId: candidate.userId,
          weight,
          isRequired: rule.isRequired,
          sourceReason: candidate.reason.slice(0, REASON_MAX),
          sourceRuleId: rule.id,
        });
        continue;
      }
      // 去重取最大权重；理由叠加但截断，方便审计"被哪几条规则同时命中"
      if (weight > existing.weight) {
        existing.weight = weight;
        existing.sourceRuleId = rule.id;
      }
      existing.isRequired = existing.isRequired || rule.isRequired;
      existing.sourceReason = `${existing.sourceReason}；${candidate.reason}`.slice(0, REASON_MAX);
    }
  }

  return {
    voters: [...collected.values()].sort((a, b) => a.userId - b.userId),
    notes,
  };
}
