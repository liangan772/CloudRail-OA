import type { VoteDecision, VoterSnapshot, VoteRuleConfig } from '@oa/shared';
import { resolveVotingPool, tally } from './tally';

const BASE_RULE: VoteRuleConfig = {
  passRule: 'MAJORITY',
  rejectRule: 'NONE',
  abstainPolicy: 'EXCLUDE_FROM_DENOMINATOR',
  timeoutPolicy: 'REMIND_ONLY',
  visibility: 'RESULT_ONLY',
  viewScope: 'DEPT_ONLY',
  allowAbstain: false,
  requireAllVote: true,
  revotePolicy: 'UNLIMITED_BEFORE_CONCLUSION',
  vetoTerminates: false,
  tiePolicy: 'ESCALATE',
  conclusionMode: 'MANUAL_CONFIRM',
  timeoutHours: 24,
  remindIntervalHours: 8,
  maxRemindRounds: 3,
  conclusionTimeoutHours: 24,
  quorumPolicy: 'NONE',
  minQuorum: 0.6,
  allowMarkAbsent: true,
};

const rule = (overrides: Partial<VoteRuleConfig> = {}): VoteRuleConfig => ({ ...BASE_RULE, ...overrides });

function makeVoters(spec: Array<{ id: number; weight?: number; absent?: boolean }>): VoterSnapshot[] {
  return spec.map((s) => ({
    userId: s.id,
    weight: s.weight ?? 1,
    status: s.absent ? 'ABSENT' : 'PENDING',
  }));
}

function makeVotes(spec: Array<{ id: number; decision: VoteDecision; weight?: number }>) {
  return spec.map((s) => ({ voterId: s.id, decision: s.decision, weight: s.weight ?? 1 }));
}

const threeVoters = makeVoters([{ id: 1 }, { id: 2 }, { id: 3 }]);

describe('resolveVotingPool', () => {
  it('缺席者被剔除出投票池，权重同步剔除', () => {
    const voters = makeVoters([{ id: 1 }, { id: 2, weight: 2 }, { id: 3, absent: true, weight: 5 }]);
    const pool = resolveVotingPool(voters, 0.6, 'MIN_POOL_RATIO');
    expect(pool.expected).toBe(3);
    expect(pool.pool).toBe(2);
    expect(pool.absentUserIds).toEqual([3]);
    expect(pool.absentWeight).toBe(5);
    expect(pool.totalWeight).toBe(3);
  });

  it('池内人数低于法定下限时不满足 quorum', () => {
    const voters = makeVoters([{ id: 1 }, { id: 2 }, { id: 3, absent: true }, { id: 4, absent: true }, { id: 5, absent: true }]);
    const pool = resolveVotingPool(voters, 0.6, 'MIN_POOL_RATIO');
    expect(pool.pool).toBe(2);
    expect(pool.quorumSatisfied).toBe(false);
  });

  it('池内比例正好等于下限算满足（3/5 = 0.6）', () => {
    const voters = makeVoters([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4, absent: true }, { id: 5, absent: true }]);
    const pool = resolveVotingPool(voters, 0.6, 'MIN_POOL_RATIO');
    expect(pool.quorumSatisfied).toBe(true);
  });

  it('策略为 NONE 时不设下限', () => {
    const voters = makeVoters([{ id: 1 }, { id: 2, absent: true }]);
    expect(resolveVotingPool(voters, 0.6, 'NONE').quorumSatisfied).toBe(true);
  });
});

describe('tally · 通过规则', () => {
  it('ALL：三人全部同意才通过', () => {
    const result = tally({
      voters: threeVoters,
      votes: makeVotes([
        { id: 1, decision: 'APPROVE' },
        { id: 2, decision: 'APPROVE' },
        { id: 3, decision: 'APPROVE' },
      ]),
      rule: rule({ passRule: 'ALL' }),
    });
    expect(result.passSatisfied).toBe(true);
    expect(result.systemDecision).toBe('APPROVE');
    expect(result.readyForConclusion).toBe(true);
  });

  it('ALL：有一人反对则不通过', () => {
    const result = tally({
      voters: threeVoters,
      votes: makeVotes([
        { id: 1, decision: 'APPROVE' },
        { id: 2, decision: 'APPROVE' },
        { id: 3, decision: 'REJECT' },
      ]),
      rule: rule({ passRule: 'ALL' }),
    });
    expect(result.passSatisfied).toBe(false);
    expect(result.systemDecision).toBe('REJECT');
  });

  it('MAJORITY：2/3 同意通过', () => {
    const result = tally({
      voters: threeVoters,
      votes: makeVotes([
        { id: 1, decision: 'APPROVE' },
        { id: 2, decision: 'APPROVE' },
        { id: 3, decision: 'REJECT' },
      ]),
      rule: rule({ passRule: 'MAJORITY' }),
    });
    expect(result.passSatisfied).toBe(true);
    expect(result.systemDecision).toBe('APPROVE');
  });

  it('MAJORITY：1 同意 1 反对为平票，须由 tiePolicy 处理', () => {
    const result = tally({
      voters: makeVoters([{ id: 1 }, { id: 2 }]),
      votes: makeVotes([
        { id: 1, decision: 'APPROVE' },
        { id: 2, decision: 'REJECT' },
      ]),
      rule: rule({ passRule: 'MAJORITY', tiePolicy: 'ESCALATE' }),
    });
    expect(result.tieDetected).toBe(true);
    expect(result.passSatisfied).toBe(false);
    expect(result.reason).toContain('上报');
  });

  it('RATIO：3/5 正好等于 0.6 阈值，判为通过', () => {
    const voters = makeVoters([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]);
    const result = tally({
      voters,
      votes: makeVotes([
        { id: 1, decision: 'APPROVE' },
        { id: 2, decision: 'APPROVE' },
        { id: 3, decision: 'APPROVE' },
        { id: 4, decision: 'REJECT' },
        { id: 5, decision: 'REJECT' },
      ]),
      rule: rule({ passRule: 'RATIO', passThreshold: 0.6 }),
    });
    expect(result.denominator).toBe(5);
    expect(result.passSatisfied).toBe(true);
  });

  it('RATIO：2/5 低于阈值，全员表态后拟驳回', () => {
    const voters = makeVoters([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]);
    const result = tally({
      voters,
      votes: makeVotes([
        { id: 1, decision: 'APPROVE' },
        { id: 2, decision: 'APPROVE' },
        { id: 3, decision: 'REJECT' },
        { id: 4, decision: 'REJECT' },
        { id: 5, decision: 'REJECT' },
      ]),
      rule: rule({ passRule: 'RATIO', passThreshold: 0.6 }),
    });
    expect(result.passSatisfied).toBe(false);
    expect(result.systemDecision).toBe('REJECT');
    expect(result.reason).toContain('全员已表态');
  });

  it('WEIGHTED：按权重通过（同意权重 3/5 = 0.6）', () => {
    const voters = makeVoters([{ id: 1, weight: 2 }, { id: 2, weight: 1 }, { id: 3, weight: 2 }]);
    const result = tally({
      voters,
      votes: makeVotes([
        { id: 1, decision: 'APPROVE', weight: 2 },
        { id: 2, decision: 'APPROVE', weight: 1 },
        { id: 3, decision: 'REJECT', weight: 2 },
      ]),
      rule: rule({ passRule: 'WEIGHTED', passThreshold: 0.6 }),
    });
    expect(result.weighted.total).toBe(5);
    expect(result.passSatisfied).toBe(true);
  });

  it('WEIGHTED：浮点权重不产生精度误差（0.1 × 3）', () => {
    const voters = makeVoters([{ id: 1, weight: 0.1 }, { id: 2, weight: 0.1 }, { id: 3, weight: 0.1 }]);
    const result = tally({
      voters,
      votes: makeVotes([
        { id: 1, decision: 'APPROVE', weight: 0.1 },
        { id: 2, decision: 'APPROVE', weight: 0.1 },
        { id: 3, decision: 'APPROVE', weight: 0.1 },
      ]),
      rule: rule({ passRule: 'WEIGHTED', passThreshold: 1 }),
    });
    expect(result.weighted.total).toBe(0.3);
    expect(result.passSatisfied).toBe(true);
  });

  it('AT_LEAST_N：达到固定票数即通过', () => {
    const voters = makeVoters([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
    const result = tally({
      voters,
      votes: makeVotes([
        { id: 1, decision: 'APPROVE' },
        { id: 2, decision: 'APPROVE' },
        { id: 3, decision: 'REJECT' },
        { id: 4, decision: 'REJECT' },
      ]),
      rule: rule({ passRule: 'AT_LEAST_N', passThreshold: 2 }),
    });
    expect(result.passSatisfied).toBe(true);
  });
});

describe('tally · 否决规则（否决优先）', () => {
  it('ANY_VETO：多数同意但一票反对仍锁定不予通过', () => {
    const voters = makeVoters([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]);
    const result = tally({
      voters,
      votes: makeVotes([
        { id: 1, decision: 'APPROVE' },
        { id: 2, decision: 'APPROVE' },
        { id: 3, decision: 'APPROVE' },
        { id: 4, decision: 'APPROVE' },
        { id: 5, decision: 'REJECT' },
      ]),
      rule: rule({ passRule: 'RATIO', passThreshold: 0.6, rejectRule: 'ANY_VETO' }),
    });
    expect(result.passSatisfied).toBe(false);
    expect(result.vetoLocked).toBe(true);
    expect(result.systemDecision).toBe('REJECT');
  });

  it('ANY_VETO：仍等待全员表态（vetoTerminates=false）', () => {
    const voters = makeVoters([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const result = tally({
      voters,
      votes: makeVotes([{ id: 1, decision: 'REJECT' }]),
      rule: rule({ rejectRule: 'ANY_VETO', vetoTerminates: false }),
    });
    expect(result.vetoLocked).toBe(true);
    expect(result.readyForConclusion).toBe(false);
  });

  it('ANY_VETO：vetoTerminates=true 时立即具备出结论条件', () => {
    const voters = makeVoters([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const result = tally({
      voters,
      votes: makeVotes([{ id: 1, decision: 'REJECT' }]),
      rule: rule({ rejectRule: 'ANY_VETO', vetoTerminates: true }),
    });
    expect(result.readyForConclusion).toBe(true);
  });

  it('OPPOSE_OVER：反对比例超过阈值即驳回（2/5 = 0.4 > 0.34）', () => {
    const voters = makeVoters([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]);
    const result = tally({
      voters,
      votes: makeVotes([
        { id: 1, decision: 'APPROVE' },
        { id: 2, decision: 'APPROVE' },
        { id: 3, decision: 'APPROVE' },
        { id: 4, decision: 'REJECT' },
        { id: 5, decision: 'REJECT' },
      ]),
      rule: rule({ passRule: 'RATIO', passThreshold: 0.6, rejectRule: 'OPPOSE_OVER', rejectThreshold: 0.34 }),
    });
    expect(result.rejectSatisfied).toBe(true);
    expect(result.systemDecision).toBe('REJECT');
  });
});

describe('tally · 全员表态与缺席', () => {
  it('未全员表态时不具备进入结论阶段的条件', () => {
    const result = tally({
      voters: threeVoters,
      votes: makeVotes([
        { id: 1, decision: 'APPROVE' },
        { id: 2, decision: 'APPROVE' },
      ]),
      rule: rule(),
    });
    expect(result.statedCount).toBe(2);
    expect(result.readyForConclusion).toBe(false);
    expect(result.reason).toContain('尚未全员表态');
    // 投票未结束时不能给出终局判定，否则调用方会把"未投完"误写成驳回
    expect(result.systemDecision).toBe('PENDING');
  });

  it('池外（缺席者）的票不计入统计', () => {
    const voters = makeVoters([{ id: 1 }, { id: 2 }, { id: 3, absent: true }]);
    const result = tally({
      voters,
      votes: makeVotes([
        { id: 1, decision: 'APPROVE' },
        { id: 2, decision: 'APPROVE' },
        { id: 3, decision: 'REJECT' },
      ]),
      rule: rule({ passRule: 'ALL' }),
    });
    expect(result.counts.reject).toBe(0);
    expect(result.pool.pool).toBe(2);
    expect(result.systemDecision).toBe('APPROVE');
  });

  it('缺席使池缩小后，分母按池内人数计算', () => {
    const voters = makeVoters([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4, absent: true }]);
    const result = tally({
      voters,
      votes: makeVotes([
        { id: 1, decision: 'APPROVE' },
        { id: 2, decision: 'APPROVE' },
        { id: 3, decision: 'REJECT' },
      ]),
      rule: rule({ passRule: 'MAJORITY' }),
    });
    expect(result.denominator).toBe(3);
    expect(result.passSatisfied).toBe(true);
  });

  it('未达法定人数直接认定为不予通过（转上报）', () => {
    const voters = makeVoters([
      { id: 1 },
      { id: 2 },
      { id: 3, absent: true },
      { id: 4, absent: true },
      { id: 5, absent: true },
    ]);
    const result = tally({
      voters,
      votes: makeVotes([
        { id: 1, decision: 'APPROVE' },
        { id: 2, decision: 'APPROVE' },
      ]),
      rule: rule({ passRule: 'ALL', quorumPolicy: 'MIN_POOL_RATIO', minQuorum: 0.6 }),
    });
    expect(result.pool.quorumSatisfied).toBe(false);
    expect(result.systemDecision).toBe('REJECT');
    expect(result.reason).toContain('法定人数');
  });

  it('没有任何投票人时不得通过', () => {
    const result = tally({
      voters: [],
      votes: [],
      rule: rule({ passRule: 'ALL', quorumPolicy: 'MIN_POOL_RATIO' }),
    });
    expect(result.pool.quorumSatisfied).toBe(false);
    expect(result.systemDecision).toBe('REJECT');
  });

  it('历史弃权票在 EXCLUDE 策略下不计入分母', () => {
    const result = tally({
      voters: threeVoters,
      votes: makeVotes([
        { id: 1, decision: 'APPROVE' },
        { id: 2, decision: 'APPROVE' },
        { id: 3, decision: 'ABSTAIN' },
      ]),
      rule: rule({ passRule: 'MAJORITY', abstainPolicy: 'EXCLUDE_FROM_DENOMINATOR' }),
    });
    expect(result.counts.abstain).toBe(1);
    expect(result.denominator).toBe(2);
    expect(result.passSatisfied).toBe(true);
  });
});

describe('tally · 改票与快照', () => {
  it('调用方只传最新票时不会重复计数（改票后以最新选择为准）', () => {
    const voters = makeVoters([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const result = tally({
      voters,
      // 1 号先反对后改同意：调用方已过滤掉历史票，此处只出现最新票
      votes: makeVotes([
        { id: 1, decision: 'APPROVE' },
        { id: 2, decision: 'APPROVE' },
        { id: 3, decision: 'REJECT' },
      ]),
      rule: rule({ passRule: 'MAJORITY' }),
    });
    expect(result.statedCount).toBe(3);
    expect(result.counts.approve).toBe(2);
    expect(result.counts.reject).toBe(1);
  });

  it('结果携带引擎版本，便于区分历史结论的算法口径', () => {
    const result = tally({ voters: threeVoters, votes: [], rule: rule() });
    expect(result.engineVersion).toBe('tally-1.0.0');
  });

  it('平票策略为 REJECT 时拟判定为驳回', () => {
    const result = tally({
      voters: makeVoters([{ id: 1 }, { id: 2 }]),
      votes: makeVotes([
        { id: 1, decision: 'APPROVE' },
        { id: 2, decision: 'REJECT' },
      ]),
      rule: rule({ passRule: 'MAJORITY', tiePolicy: 'REJECT' }),
    });
    expect(result.tieDetected).toBe(true);
    expect(result.systemDecision).toBe('REJECT');
    expect(result.reason).toContain('平票');
  });
});
