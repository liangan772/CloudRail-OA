import { ERROR_CODES } from '@oa/shared';
import { validateFormData } from './form';

const schema = {
  type: 'object',
  required: ['title', 'amount'],
  properties: {
    title: { type: 'string', title: '采购事由', minLength: 2, maxLength: 100 },
    amount: { type: 'number', title: '金额', minimum: 1, maximum: 1000000 },
    expectedDate: { type: 'string', title: '期望到货日期', format: 'date' },
    category: { type: 'string', title: '类别', enum: ['硬件', '软件'] },
    urgent: { type: 'boolean', title: '加急' },
  },
};

describe('表单校验 · 通过场景', () => {
  it('没配 schema 时不做限制（先跑通流程再补表单）', () => {
    expect(validateFormData(undefined, {})).toEqual({ ok: true });
    expect(validateFormData({}, { anything: 1 })).toEqual({ ok: true });
  });

  it('必填齐备且格式正确时通过，非必填字段可缺省', () => {
    expect(validateFormData(schema, { title: '采购服务器', amount: 12000 })).toEqual({ ok: true });
    expect(
      validateFormData(schema, {
        title: '采购服务器',
        amount: 12000,
        expectedDate: '2026-10-01',
        category: '硬件',
        urgent: true,
      }),
    ).toEqual({ ok: true });
  });
});

describe('表单校验 · 失败场景', () => {
  const reasonsOf = (data: Record<string, unknown>): string[] => {
    const r = validateFormData(schema, data);
    expect(r.ok).toBe(false);
    if (r.ok) return [];
    expect(r.error).toBe(ERROR_CODES.WF_FORM_SCHEMA_INVALID);
    return r.reasons;
  };

  it('缺必填字段时报字段中文名（用 title 而不是 key）', () => {
    const reasons = reasonsOf({ amount: 10 });
    expect(reasons.join()).toContain('采购事由');
  });

  it('空白字符串视为未填', () => {
    expect(reasonsOf({ title: '   ', amount: 10 }).join()).toContain('采购事由');
  });

  it('类型不符要报错，且不继续做该字段的其它校验', () => {
    const reasons = reasonsOf({ title: '采购服务器', amount: '12000' });
    expect(reasons.join()).toContain('金额');
    expect(reasons.join()).toContain('number');
  });

  it('字符串长度、数值上下限、枚举、日期格式都会被校验', () => {
    expect(reasonsOf({ title: '短', amount: 10 }).join()).toContain('至少 2 个字符');
    expect(reasonsOf({ title: '采购服务器', amount: 0 }).join()).toContain('不能小于 1');
    expect(reasonsOf({ title: '采购服务器', amount: 2000000 }).join()).toContain('不能大于 1000000');
    expect(reasonsOf({ title: '采购服务器', amount: 10, category: '服务' }).join()).toContain('取值不在允许范围内');
    expect(reasonsOf({ title: '采购服务器', amount: 10, expectedDate: '不是日期' }).join()).toContain('合法日期');
  });

  it('一次把所有问题都报出来（不是遇到第一个就返回）', () => {
    const reasons = reasonsOf({ amount: 0, category: '服务', expectedDate: 'x' });
    expect(reasons.length).toBeGreaterThanOrEqual(3);
  });

  it('根节点必须是 object', () => {
    const r = validateFormData({ type: 'array' }, {});
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reasons[0]).toContain('根节点必须是 object');
  });
});
