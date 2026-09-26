import type { EscalationRuleSpec } from './rule-engine';
import { evaluateEscalationRules, summarizeExplain } from './rule-engine';
import { explain, type RuleNode } from '@oa/shared';

const baseRule = (over: Partial<EscalationRuleSpec> = {}): EscalationRuleSpec => ({
  id: 1,
  triggerType: 'OVER_LIMIT',
  condition: null,
  targetDeptRule: 'DIRECT_PARENT',
  timeout: 48,
  freezeSource: true,
  maxLevel: 5,
  acceptMode: 'AUTO',
  onMissingWorkNo: 'ESCALATE_UP',
  ...over,
});

describe('上报规则引擎 · 无条件的触发器', () => {
  it('未配置条件的规则直接命中（触发源本身就是触发器）', () => {
    const r = evaluateEscalationRules([baseRule({ triggerType: 'QUORUM_NOT_MET' })], {});
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0]!.triggerLabel).toBe('未达法定人数');
    expect(r.matched[0]!.reason).toContain('命中即上报');
    expect(r.errors).toEqual([]);
  });

  it('携带目标部门与处理参数，供后续创建上报单使用', () => {
    const r = evaluateEscalationRules([baseRule({ timeout: 72, maxLevel: 3, freezeSource: false })], {});
    expect(r.matched[0]!.target).toEqual({
      targetDeptRule: 'DIRECT_PARENT',
      timeoutHours: 72,
      freezeSource: false,
      maxLevel: 3,
      acceptMode: 'AUTO',
      onMissingWorkNo: 'ESCALATE_UP',
    });
  });
});

describe('上报规则引擎 · 条件求值', () => {
  const overLimit: RuleNode = { gt: ['formData.amount', 50000] };

  it('金额超限命中：给出叶子级解释（哪个字段、阈值、实际值）', () => {
    const r = evaluateEscalationRules([baseRule({ condition: overLimit })], {
      formData: { amount: 80000 },
    });
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0]!.reason).toContain('formData.amount');
    expect(r.matched[0]!.reason).toContain('大于 50000');
    expect(r.matched[0]!.reason).toContain('实际 80000');
  });

  it('金额未超限时不命中，但命中项里仍然说明原因', () => {
    const r = evaluateEscalationRules([baseRule({ condition: overLimit })], {
      formData: { amount: 12000 },
    });
    expect(r.matched).toHaveLength(0);
    expect(r.hits[0]!.matched).toBe(false);
    expect(r.hits[0]!.reason).toContain('条件未命中');
    expect(r.hits[0]!.reason).toContain('实际 12000');
  });

  it('字段缺失时按未命中处理，不抛错', () => {
    const r = evaluateEscalationRules([baseRule({ condition: overLimit })], { formData: {} });
    expect(r.matched).toHaveLength(0);
    expect(r.hits[0]!.reason).toContain('未提供');
  });

  it('组合条件（且 / 或）按 DSL 语义求值', () => {
    const complex: RuleNode = {
      and: [
        { gt: ['formData.amount', 50000] },
        { or: [{ eq: ['formData.category', '硬件'] }, { eq: ['formData.urgent', true] }] },
      ],
    };
    expect(
      evaluateEscalationRules([baseRule({ condition: complex })], {
        formData: { amount: 90000, category: '硬件' },
      }).matched,
    ).toHaveLength(1);

    expect(
      evaluateEscalationRules([baseRule({ condition: complex })], {
        formData: { amount: 90000, category: '软件', urgent: false },
      }).matched,
    ).toHaveLength(0);
  });

  it('可以引用投票结果与部门信息（白名单根）', () => {
    const rule: RuleNode = { and: [{ eq: ['voteResult.tie', true] }, { eq: ['dept.level', 3] }] };
    const r = evaluateEscalationRules([baseRule({ triggerType: 'TIE', condition: rule })], {
      voteResult: { tie: true },
      dept: { level: 3 },
    });
    expect(r.matched).toHaveLength(1);
  });

  it('now 根默认注入当前时间，可被显式覆盖', () => {
    const rule: RuleNode = { lt: ['now', '2099-01-01T00:00:00.000Z'] };
    expect(evaluateEscalationRules([baseRule({ condition: rule })], {}).matched).toHaveLength(1);
    expect(
      evaluateEscalationRules([baseRule({ condition: rule })], { now: '2100-01-01T00:00:00.000Z' }).matched,
    ).toHaveLength(0);
  });
});

describe('上报规则引擎 · 健壮性', () => {
  it('规则写错时不抛错、不阻断流程，而是记进 errors 并标记未命中', () => {
    const broken = { weirdOp: ['formData.amount', 1] } as unknown as RuleNode;
    const r = evaluateEscalationRules([baseRule({ condition: broken })], { formData: { amount: 999 } });
    expect(r.matched).toHaveLength(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('求值失败');
    expect(r.hits[0]!.reason).toContain('不阻断流程');
  });

  it('一条规则坏了不影响其它规则命中', () => {
    const broken = { weirdOp: ['formData.amount', 1] } as unknown as RuleNode;
    const r = evaluateEscalationRules(
      [baseRule({ id: 1, condition: broken }), baseRule({ id: 2, triggerType: 'TIE' })],
      {},
    );
    expect(r.matched.map((hit) => hit.ruleId)).toEqual([2]);
    expect(r.errors).toHaveLength(1);
  });

  it('多条规则同时命中时全部返回（由调用方决定优先级）', () => {
    const r = evaluateEscalationRules(
      [baseRule({ id: 1, triggerType: 'OVER_LIMIT' }), baseRule({ id: 2, triggerType: 'CROSS_DEPT_DISPUTE' })],
      {},
    );
    expect(r.matched.map((hit) => hit.triggerType)).toEqual(['OVER_LIMIT', 'CROSS_DEPT_DISPUTE']);
  });

  it('summarizeExplain 能翻译嵌套条件', () => {
    const rule: RuleNode = { and: [{ gt: ['formData.amount', 50000] }, { eq: ['dept.level', 3] }] };
    const text = summarizeExplain(explain(rule, { formData: { amount: 1 }, dept: { level: 3 } }));
    expect(text).toContain('formData.amount 大于 50000');
    expect(text).toContain('dept.level 等于 3');
    expect(text).toContain(' 且 ');
  });
});

describe('上报规则引擎 · 越级开关（C13）', () => {
  it('租户未开启越级时，指定部门 / 指定层级的规则即使命中也被忽略', () => {
    const r = evaluateEscalationRules(
      [
        baseRule({ id: 1, targetDeptRule: 'SPECIFIC_DEPT' }),
        baseRule({ id: 2, targetDeptRule: 'SKIP_TO_LEVEL' }),
        baseRule({ id: 3, targetDeptRule: 'DIRECT_PARENT' }),
      ],
      {},
      { allowCrossLevel: false },
    );
    expect(r.matched.map((hit) => hit.ruleId)).toEqual([3]);
    expect(r.hits[0]!.reason).toContain('allowCrossLevel=false');
    expect(r.hits[0]!.matched).toBe(false);
  });

  it('开启越级后逐级与越级规则都可命中', () => {
    const r = evaluateEscalationRules(
      [baseRule({ id: 1, targetDeptRule: 'SPECIFIC_DEPT' })],
      {},
      { allowCrossLevel: true },
    );
    expect(r.matched.map((hit) => hit.ruleId)).toEqual([1]);
  });

  it('未显式传开关时不做越级限制（由调用方决定）', () => {
    const r = evaluateEscalationRules([baseRule({ id: 1, targetDeptRule: 'SPECIFIC_DEPT' })], {});
    expect(r.matched).toHaveLength(1);
  });
});

describe('上报规则引擎 · 触发源适用性', () => {
  it('不在适用白名单里的触发源不参与判定（避免无条件规则被误判命中）', () => {
    const r = evaluateEscalationRules(
      [
        baseRule({ id: 1, triggerType: 'OVER_LIMIT', condition: { gt: ['formData.amount', 50000] } }),
        // 这两条在种子里没有条件：若不按场景过滤，每次结论都会误判上报
        baseRule({ id: 2, triggerType: 'QUORUM_NOT_MET', condition: null }),
        baseRule({ id: 3, triggerType: 'TASK_OVERDUE', condition: null }),
      ],
      { formData: { amount: 12000 } },
      { applicableTriggers: ['OVER_LIMIT', 'TIE'] },
    );

    expect(r.matched).toHaveLength(0);
    expect(r.hits.map((hit) => hit.matched)).toEqual([false, false, false]);
    expect(r.hits[1]!.reason).toContain('当前场景不适用触发源');
    expect(r.hits[2]!.reason).toContain('任务逾期');
  });

  it('适用白名单里的触发源照常求值', () => {
    const r = evaluateEscalationRules(
      [baseRule({ id: 1, triggerType: 'OVER_LIMIT', condition: { gt: ['formData.amount', 50000] } })],
      { formData: { amount: 80000 } },
      { applicableTriggers: ['OVER_LIMIT'] },
    );
    expect(r.matched.map((hit) => hit.ruleId)).toEqual([1]);
  });

  it('不传适用白名单时不做场景过滤（预测试算用）', () => {
    const r = evaluateEscalationRules([baseRule({ id: 2, triggerType: 'QUORUM_NOT_MET' })], {});
    expect(r.matched).toHaveLength(1);
  });
});
