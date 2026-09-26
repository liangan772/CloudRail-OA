import {
  TALLY_ENGINE_VERSION,
  gteRatio,
  gtRatio,
  isMajority,
  round4,
  type QuorumPolicy,
  type TallyInput,
  type TallyResult,
  type VoterSnapshot,
  type VotingPool,
} from '@oa/shared';

/**
 * 投票池：缺席者（ABSENT）不算票、也不计入分母与权重。
 * 对应已确认规则「缺席不算票、不计入总投票池」+「最低法定人数」。
 */
export function resolveVotingPool(
  voters: readonly VoterSnapshot[],
  minQuorum: number,
  policy: QuorumPolicy = 'MIN_POOL_RATIO',
): VotingPool {
  const expected = voters.length;
  const absent = voters.filter((v) => v.status === 'ABSENT');
  const present = voters.filter((v) => v.status !== 'ABSENT');

  const absentWeight = round4(absent.reduce((sum, v) => sum + v.weight, 0));
  const totalWeight = round4(present.reduce((sum, v) => sum + v.weight, 0));
  const pool = present.length;

  let quorumSatisfied: boolean;
  if (policy === 'NONE') {
    quorumSatisfied = true;
  } else if (policy === 'MIN_POOL_N') {
    quorumSatisfied = pool >= minQuorum;
  } else {
    // 默认 MIN_POOL_RATIO：池内人数 ≥ 应投票人数 × minQuorum
    quorumSatisfied = expected > 0 && gteRatio(pool, expected, minQuorum);
  }

  return {
    expected,
    pool,
    absentUserIds: absent.map((v) => v.userId),
    absentWeight,
    totalWeight,
    minQuorum,
    quorumSatisfied,
  };
}

interface Counted {
  approve: number;
  reject: number;
  abstain: number;
  weightedApprove: number;
  weightedReject: number;
  weightedAbstain: number;
}

function count(weighted: boolean): Counted {
  return {
    approve: 0,
    reject: 0,
    abstain: 0,
    weightedApprove: 0,
    weightedReject: 0,
    weightedAbstain: 0,
  };
}

/**
 * 计票引擎（纯函数，零 IO）。
 *
 * 判定顺序严格按 docs/stage-0/04-domain-model-draft.md §8.4：
 *   0) 计算投票池（缺席剔除）+ 法定人数校验
 *   1) 只统计池内票（只含最新票，改票历史已在调用方过滤）
 *   2) 按弃权策略折算分母与有效票（本版本不允许弃权，B 恒为 0）
 *   3) 否决优先：命中则锁定「不予通过」（vetoTerminates=false 时仍等全员表态）
 *   4) 通过规则判定
 *   5) 平票交由调用方按 tiePolicy 处理
 */
export function tally(input: TallyInput): TallyResult {
  const { voters, votes, rule } = input;
  const pool = resolveVotingPool(voters, rule.minQuorum, rule.quorumPolicy);

  const poolUserIds = new Set(voters.filter((v) => v.status !== 'ABSENT').map((v) => v.userId));
  const counted = votes.filter((v) => poolUserIds.has(v.voterId));

  const c = count(true);
  for (const vote of counted) {
    if (vote.decision === 'APPROVE') {
      c.approve += 1;
      c.weightedApprove = round4(c.weightedApprove + vote.weight);
    } else if (vote.decision === 'REJECT') {
      c.reject += 1;
      c.weightedReject = round4(c.weightedReject + vote.weight);
    } else {
      // 历史数据兼容：本版本 allowAbstain=false，正常不会出现弃权票
      c.abstain += 1;
      c.weightedAbstain = round4(c.weightedAbstain + vote.weight);
    }
  }

  const statedCount = counted.length;

  // ---- 弃权策略折算 ----
  let denominator: number;
  let effectiveApprove: number;
  let effectiveReject: number;
  let effectiveWeightApprove = c.weightedApprove;
  let effectiveWeightReject = c.weightedReject;

  switch (rule.abstainPolicy) {
    case 'COUNT_IN_DENOMINATOR':
      denominator = c.approve + c.reject + c.abstain;
      effectiveApprove = c.approve;
      effectiveReject = c.reject;
      break;
    case 'AS_APPROVE':
      denominator = c.approve + c.reject + c.abstain;
      effectiveApprove = c.approve + c.abstain;
      effectiveReject = c.reject;
      effectiveWeightApprove = round4(c.weightedApprove + c.weightedAbstain);
      break;
    case 'AS_REJECT':
      denominator = c.approve + c.reject + c.abstain;
      effectiveApprove = c.approve;
      effectiveReject = c.reject + c.abstain;
      effectiveWeightReject = round4(c.weightedReject + c.weightedAbstain);
      break;
    case 'EXCLUDE_FROM_DENOMINATOR':
    default:
      denominator = c.approve + c.reject;
      effectiveApprove = c.approve;
      effectiveReject = c.reject;
      break;
  }

  // ---- 否决规则（优先） ----
  let rejectSatisfied = false;
  if (rule.rejectRule === 'ANY_VETO') {
    rejectSatisfied = effectiveReject >= 1;
  } else if (rule.rejectRule === 'OPPOSE_OVER') {
    rejectSatisfied =
      rule.rejectThreshold != null && gtRatio(effectiveReject, denominator, rule.rejectThreshold);
  }
  const vetoLocked = rejectSatisfied;

  // ---- 通过规则 ----
  let rawPassSatisfied = false;
  if (pool.quorumSatisfied) {
    switch (rule.passRule) {
      case 'ALL':
        rawPassSatisfied = effectiveReject === 0 && effectiveApprove === pool.pool;
        break;
      case 'MAJORITY':
        rawPassSatisfied = isMajority(effectiveApprove, denominator);
        break;
      case 'RATIO':
        rawPassSatisfied =
          rule.passThreshold != null && gteRatio(effectiveApprove, denominator, rule.passThreshold);
        break;
      case 'WEIGHTED':
        rawPassSatisfied =
          rule.passThreshold != null &&
          pool.totalWeight > 0 &&
          gteRatio(effectiveWeightApprove, pool.totalWeight, rule.passThreshold);
        break;
      case 'AT_LEAST_N':
        rawPassSatisfied = rule.passThreshold != null && effectiveApprove >= rule.passThreshold;
        break;
      default:
        rawPassSatisfied = false;
    }
  }

  // 否决优先：一旦被否决规则锁定，本层不再可能通过
  const passSatisfied = !vetoLocked && rawPassSatisfied;

  const tieDetected =
    rule.passRule === 'MAJORITY' && denominator > 0 && effectiveApprove === effectiveReject;

  const allStated = statedCount >= pool.pool;
  const readyForConclusion =
    pool.quorumSatisfied &&
    (allStated || !rule.requireAllVote || (vetoLocked && rule.vetoTerminates));

  let systemDecision: 'APPROVE' | 'REJECT' | 'PENDING';
  let reason: string;
  if (!pool.quorumSatisfied) {
    systemDecision = 'REJECT';
    reason = `投票池 ${pool.pool}/${pool.expected} 未达法定人数下限 ${round4(pool.minQuorum * 100)}%，本层不得通过，转上报`;
  } else if (vetoLocked) {
    systemDecision = 'REJECT';
    reason = `否决规则命中（反对 ${effectiveReject} 票），锁定为不予通过`;
  } else if (!readyForConclusion) {
    systemDecision = 'PENDING';
    reason = `尚未全员表态（${statedCount}/${pool.pool}），暂不具备出结论条件`;
  } else if (tieDetected && rule.tiePolicy === 'REJECT') {
    systemDecision = 'REJECT';
    reason = '平票且平票策略为驳回';
  } else if (passSatisfied) {
    systemDecision = 'APPROVE';
    reason = `通过规则命中（同意 ${effectiveApprove}/${denominator}，权重通过=${effectiveWeightApprove}/${pool.totalWeight}）`;
  } else if (allStated) {
    systemDecision = 'REJECT';
    reason = '全员已表态但未达通过阈值，拟驳回';
  } else {
    systemDecision = 'PENDING';
    reason = `尚未全员表态（${statedCount}/${pool.pool}），暂不具备出结论条件`;
  }

  if (tieDetected && rule.tiePolicy === 'ESCALATE') {
    reason = `${reason}；平票策略为上报，交上级组织裁定`;
  }

  return {
    counts: { approve: c.approve, reject: c.reject, abstain: c.abstain },
    weighted: {
      approve: effectiveWeightApprove,
      reject: effectiveWeightReject,
      total: pool.totalWeight,
    },
    pool,
    denominator,
    statedCount,
    passSatisfied,
    rejectSatisfied,
    vetoLocked,
    tieDetected,
    systemDecision,
    readyForConclusion,
    reason,
    engineVersion: TALLY_ENGINE_VERSION,
  };
}
