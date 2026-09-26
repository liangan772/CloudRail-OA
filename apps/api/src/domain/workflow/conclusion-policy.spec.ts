import { ERROR_CODES, TALLY_ENGINE_VERSION, type TallyResult } from '@oa/shared';
import {
  conclusionTimeoutOutcome,
  describeConclusion,
  finalConclusionFromEscalation,
  planConclusion,
  submitConclusion,
} from './conclusion-policy';

/** 计票结果工厂：默认是「池内 3 人全部同意」的理想结果 */
function tally(over: Partial<TallyResult> = {}): TallyResult {
  return {
    counts: { approve: 3, reject: 0, abstain: 0 },
    weighted: { approve: 3, reject: 0, total: 3 },
    pool: {
      expected: 3,
      pool: 3,
      absentUserIds: [],
      absentWeight: 0,
      totalWeight: 3,
      minQuorum: 0.6,
      quorumSatisfied: true,
    },
    denominator: 3,
    statedCount: 3,
    passSatisfied: true,
    rejectSatisfied: false,
    vetoLocked: false,
    tieDetected: false,
    systemDecision: 'APPROVE',
    readyForConclusion: true,
    reason: '通过规则命中（同意 3/3）',
    engineVersion: TALLY_ENGINE_VERSION,
    ...over,
  };
}

describe('结论策略 · 结论计划', () => {
  it('池内尚未全员表态（systemDecision=PENDING）时不允许进入结论阶段', () => {
    const r = planConclusion(
      'MANUAL_CONFIRM',
      tally({ systemDecision: 'PENDING', readyForConclusion: false, statedCount: 1, reason: '尚未全员表态（1/3）' }),
    );
    expect(r).toMatchObject({ ok: false, error: ERROR_CODES.NODE_INVALID_TRANSITION });
    expect(r.ok === false && r.reason).toContain('尚未具备出结论条件');
  });

  it('MANUAL_CONFIRM（默认）：系统只给拟判定，结论状态为 PENDING', () => {
    const r = planConclusion('MANUAL_CONFIRM', tally());
    expect(r).toMatchObject({ ok: true, required: true, conclusionStatus: 'PENDING', systemDecision: 'APPROVE', nodeStatus: 'PASSED' });
    expect(r.ok === true && r.autoConclusion).toBeUndefined();
  });

  it('MANUAL_OVERRIDE：同样需要人工填写，只是允许自由裁定', () => {
    const r = planConclusion('MANUAL_OVERRIDE', tally({ systemDecision: 'REJECT', passSatisfied: false }));
    expect(r).toMatchObject({ ok: true, required: true, conclusionStatus: 'PENDING', nodeStatus: 'REJECTED' });
    expect(r.ok === true && r.reason).toContain('自由裁定');
  });

  it('AUTO：系统判定即结论，不需要人工结论', () => {
    const r = planConclusion('AUTO', tally());
    expect(r).toMatchObject({ ok: true, required: false, conclusionStatus: 'NOT_REQUIRED' });
    expect(r.ok === true && r.autoConclusion).toEqual({
      source: 'SYSTEM_AUTO',
      decision: 'APPROVE',
      systemDecision: 'APPROVE',
      isOverride: false,
    });
  });
});

describe('结论策略 · 人工提交', () => {
  it('确认系统拟判定：不算改判，结论为通过', () => {
    const r = submitConclusion({
      mode: 'MANUAL_CONFIRM',
      systemDecision: 'APPROVE',
      decision: 'APPROVE',
      content: '同意采购，预算充足',
      authorId: 7,
    });
    expect(r).toMatchObject({ ok: true, nodeStatus: 'PASSED', isOverride: false });
    expect(r.ok === true && r.conclusion).toMatchObject({
      decision: 'APPROVE',
      systemDecision: 'APPROVE',
      isOverride: false,
      source: 'MANUAL',
      authorId: 7,
    });
  });

  it('改判系统判定必须填理由，缺理由直接拒绝', () => {
    const r = submitConclusion({
      mode: 'MANUAL_CONFIRM',
      systemDecision: 'APPROVE',
      decision: 'REJECT',
      content: '否决',
      authorId: 7,
    });
    expect(r).toMatchObject({ ok: false, error: ERROR_CODES.VOTE_CONCLUSION_REASON_REQUIRED });

    const withReason = submitConclusion({
      mode: 'MANUAL_CONFIRM',
      systemDecision: 'APPROVE',
      decision: 'REJECT',
      content: '否决',
      overrideReason: '供应商资质存疑，需重新询价',
      authorId: 7,
    });
    expect(withReason).toMatchObject({ ok: true, nodeStatus: 'REJECTED', isOverride: true });
    expect(withReason.ok === true && withReason.conclusion.overrideReason).toBe('供应商资质存疑，需重新询价');
    expect(withReason.ok === true && withReason.reason).toContain('人工改判');
  });

  it('结论意见必填、取值只能是同意或反对、AUTO 模式不接受人工提交', () => {
    expect(
      submitConclusion({
        mode: 'MANUAL_CONFIRM',
        systemDecision: 'APPROVE',
        decision: 'APPROVE',
        content: '   ',
      }),
    ).toMatchObject({ ok: false, error: ERROR_CODES.SYS_VALIDATION_FAILED });

    expect(
      submitConclusion({
        mode: 'MANUAL_CONFIRM',
        systemDecision: 'APPROVE',
        decision: 'ABSTAIN',
        content: '弃权',
      }),
    ).toMatchObject({ ok: false, error: ERROR_CODES.SYS_VALIDATION_FAILED });

    expect(
      submitConclusion({ mode: 'AUTO', systemDecision: 'APPROVE', decision: 'APPROVE', content: '通过' }),
    ).toMatchObject({ ok: false, error: ERROR_CODES.SYS_VALIDATION_FAILED });
  });
});

describe('结论策略 · 上级终审与超时', () => {
  it('上级终审通过：系统代填 isOverride=true、authorId=null 的结论并回写原流程', () => {
    const r = finalConclusionFromEscalation('FINAL_APPROVE', 'REJECT', '上级裁定通过');
    expect(r).toMatchObject({ ok: true, nodeStatus: 'PASSED', writeBackAction: 'FINAL_APPROVE' });
    expect(r.ok === true && r.conclusion).toMatchObject({
      decision: 'APPROVE',
      systemDecision: 'REJECT',
      isOverride: true,
      source: 'SYSTEM_FINAL',
      authorId: null,
    });
  });

  it('上级终审驳回：没填意见时给出默认意见', () => {
    const r = finalConclusionFromEscalation('FINAL_REJECT', 'APPROVE', '');
    expect(r).toMatchObject({ ok: true, nodeStatus: 'REJECTED', writeBackAction: 'FINAL_REJECT' });
    expect(r.ok === true && r.conclusion.content).toBe('上级终审驳回');
  });

  it('结论填写超时：上报上级部门，并通知原结论填写人', () => {
    expect(conclusionTimeoutOutcome(12)).toMatchObject({ escalated: true, notifyUserIds: [12] });
    expect(conclusionTimeoutOutcome(null)).toMatchObject({ escalated: true, notifyUserIds: [] });
  });
});

describe('结论策略 · 展示口径', () => {
  it('describeConclusion 区分「确认」与「改判」', () => {
    const confirmed = submitConclusion({
      mode: 'MANUAL_CONFIRM',
      systemDecision: 'APPROVE',
      decision: 'APPROVE',
      content: '同意',
      authorId: 1,
    });
    expect(confirmed.ok === true && describeConclusion(confirmed.conclusion)).toContain('人工确认：通过');

    const overridden = submitConclusion({
      mode: 'MANUAL_CONFIRM',
      systemDecision: 'APPROVE',
      decision: 'REJECT',
      content: '驳回',
      overrideReason: '预算超限',
      authorId: 1,
    });
    const text = overridden.ok === true ? describeConclusion(overridden.conclusion) : '';
    expect(text).toContain('改判');
    expect(text).toContain('预算超限');
    expect(text).toContain('系统拟判定「通过」→ 人工结论「驳回」');
  });
});
