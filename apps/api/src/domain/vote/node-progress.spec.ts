import type { TallyInput, VoteRuleConfig } from '@oa/shared';
import { decideNodeProgress } from './node-progress';

const rule = (over: Partial<VoteRuleConfig> = {}): VoteRuleConfig => ({
  passRule: 'MAJORITY',
  rejectRule: 'ANY_VETO',
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
  quorumPolicy: 'MIN_POOL_RATIO',
  minQuorum: 0.6,
  allowMarkAbsent: true,
  ...over,
});

const voters = (...statuses: Array<'PENDING' | 'VOTED' | 'ABSENT'>) =>
  statuses.map((status, index) => ({ userId: index + 1, weight: 1, status }));

const state = (over: Partial<TallyInput> = {}): TallyInput => ({
  voters: voters('VOTED', 'PENDING', 'PENDING'),
  votes: [{ voterId: 1, decision: 'APPROVE', weight: 1 }],
  rule: rule({ rejectRule: 'NONE' }),
  ...over,
});

describe('节点推进判定 · 只记一票', () => {
  it('刚投一票、池内还有未表态：不产生任何状态变更', () => {
    const d = decideNodeProgress(state());
    expect(d.events).toEqual([]);
    expect(d.allStated).toBe(false);
    expect(d.tally.systemDecision).toBe('PENDING');
  });
});

describe('节点推进判定 · 全员表态', () => {
  it('池内全员表态且无否决 → ALL_STATED', () => {
    const d = decideNodeProgress(
      state({
        voters: voters('VOTED', 'VOTED'),
        votes: [
          { voterId: 1, decision: 'APPROVE', weight: 1 },
          { voterId: 2, decision: 'APPROVE', weight: 1 },
        ],
      }),
    );
    expect(d.events).toEqual(['ALL_STATED']);
    expect(d.allStated).toBe(true);
    expect(d.readyForConclusion).toBe(true);
  });

  it('缺席者被剔除后池内已全员表态 → 同样进入结论阶段（缺席不算未表态）', () => {
    // 3 人里 1 人缺席 → 池内 2 人（2/3 = 67% ≥ 60%，法定人数通过），池内两人都已表态
    const d = decideNodeProgress(
      state({
        voters: voters('VOTED', 'VOTED', 'ABSENT'),
        votes: [
          { voterId: 1, decision: 'APPROVE', weight: 1 },
          { voterId: 2, decision: 'APPROVE', weight: 1 },
        ],
      }),
    );
    expect(d.tally.pool.pool).toBe(2);
    expect(d.events).toEqual(['ALL_STATED']);
  });
});

describe('节点推进判定 · 否决', () => {
  it('默认（vetoTerminates=false）：只锁定不予通过，仍等其余人表态', () => {
    const d = decideNodeProgress(
      state({
        voters: voters('VOTED', 'PENDING', 'PENDING'),
        votes: [{ voterId: 1, decision: 'REJECT', weight: 1 }],
        rule: rule({ rejectRule: 'ANY_VETO' }),
      }),
    );
    expect(d.vetoLocked).toBe(true);
    expect(d.events).toEqual(['VETO_LOCK']);
    expect(d.tally.systemDecision).toBe('REJECT');
    expect(d.reason).toContain('仍等待池内其余成员表态');
  });

  it('全员已表态且有人否决 → 先锁定再进结论阶段', () => {
    const d = decideNodeProgress(
      state({
        voters: voters('VOTED', 'VOTED'),
        votes: [
          { voterId: 1, decision: 'REJECT', weight: 1 },
          { voterId: 2, decision: 'APPROVE', weight: 1 },
        ],
        rule: rule({ rejectRule: 'ANY_VETO' }),
      }),
    );
    expect(d.events).toEqual(['VETO_LOCK', 'ALL_STATED']);
    expect(d.tally.systemDecision).toBe('REJECT');
  });

  it('显式开启 vetoTerminates → 立即终结进入结论阶段，不等其余人', () => {
    const d = decideNodeProgress(
      state({
        rule: rule({ rejectRule: 'ANY_VETO', vetoTerminates: true }),
        votes: [{ voterId: 1, decision: 'REJECT', weight: 1 }],
      }),
    );
    expect(d.events).toEqual(['VETO_TERMINATE']);
    expect(d.allStated).toBe(false);
  });
});

describe('节点推进判定 · 法定人数', () => {
  it('池内人数低于 minQuorum → 直接上报，不进入结论阶段', () => {
    // 应投票 5 人，4 人缺席 → 池内 1 人 < 5 × 0.6
    const d = decideNodeProgress(
      state({
        voters: voters('VOTED', 'ABSENT', 'ABSENT', 'ABSENT', 'ABSENT'),
        votes: [{ voterId: 1, decision: 'APPROVE', weight: 1 }],
      }),
    );
    expect(d.tally.pool.quorumSatisfied).toBe(false);
    expect(d.events).toEqual(['ESCALATE']);
    expect(d.reason).toContain('未达法定人数');
  });

  it('恰好达到 minQuorum 时可以正常推进', () => {
    // 5 人里 2 人缺席 → 池内 3 人 = 60%，达到下限
    const d = decideNodeProgress(
      state({
        voters: voters('VOTED', 'VOTED', 'VOTED', 'ABSENT', 'ABSENT'),
        votes: [
          { voterId: 1, decision: 'APPROVE', weight: 1 },
          { voterId: 2, decision: 'APPROVE', weight: 1 },
          { voterId: 3, decision: 'APPROVE', weight: 1 },
        ],
      }),
    );
    expect(d.tally.pool.quorumSatisfied).toBe(true);
    expect(d.events).toEqual(['ALL_STATED']);
  });
});

describe('节点推进判定 · 加权与平票', () => {
  it('加权规则按权重判定通过，事件仍是 ALL_STATED（由结论人确认）', () => {
    const d = decideNodeProgress(
      state({
        voters: [
          { userId: 1, weight: 3, status: 'VOTED' },
          { userId: 2, weight: 1, status: 'VOTED' },
        ],
        votes: [
          { voterId: 1, decision: 'APPROVE', weight: 3 },
          { voterId: 2, decision: 'REJECT', weight: 1 },
        ],
        rule: rule({ passRule: 'WEIGHTED', passThreshold: 0.7, rejectRule: 'NONE' }),
      }),
    );
    expect(d.tally.passSatisfied).toBe(true);
    expect(d.tally.systemDecision).toBe('APPROVE');
    expect(d.events).toEqual(['ALL_STATED']);
  });

  it('平票且 tiePolicy=ESCALATE：系统拟判定保留，事件交给结论人（reason 提示上报）', () => {
    const d = decideNodeProgress(
      state({
        voters: voters('VOTED', 'VOTED'),
        votes: [
          { voterId: 1, decision: 'APPROVE', weight: 1 },
          { voterId: 2, decision: 'REJECT', weight: 1 },
        ],
        rule: rule({ passRule: 'MAJORITY', rejectRule: 'NONE', tiePolicy: 'ESCALATE' }),
      }),
    );
    expect(d.tally.tieDetected).toBe(true);
    expect(d.reason).toContain('平票策略为上报');
    expect(d.events).toEqual(['ALL_STATED']);
  });
});
