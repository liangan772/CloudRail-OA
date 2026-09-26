import { ERROR_CODES } from '@oa/shared';
import {
  allowedEscalationEvents,
  transitionEscalation,
  writeBackFromOpinion,
  type EscalationTransitionContext,
} from './state-machine';

const ctx = (over: Partial<EscalationTransitionContext> = {}): EscalationTransitionContext => ({
  status: 'SUBMITTED',
  targetResolved: true,
  acceptMode: 'AUTO',
  level: 1,
  maxLevel: 5,
  ...over,
});

describe('上报状态机 · 投递与开投', () => {
  it('PENDING + SUBMIT → SUBMITTED（投递给工号全部成员）', () => {
    const r = transitionEscalation(ctx({ status: 'PENDING' }), 'SUBMIT');
    expect(r).toMatchObject({ ok: true, status: 'SUBMITTED' });
    expect(r.ok && r.actions).toEqual(expect.arrayContaining(['NOTIFY_WORKNO', 'WRITE_RECORD']));
  });

  it('目标工号没解析出来时拒绝提交（不能建一个投不出去的上报单）', () => {
    const r = transitionEscalation(ctx({ status: 'PENDING', targetResolved: false }), 'SUBMIT');
    expect(r).toMatchObject({ ok: false, error: ERROR_CODES.ESC_WORKNO_MISSING });
  });

  it('SUBMITTED + AUTO_START_VOTE → VOTING（默认投递即开投）', () => {
    const r = transitionEscalation(ctx(), 'AUTO_START_VOTE');
    expect(r).toMatchObject({ ok: true, status: 'VOTING' });
    expect(r.ok && r.actions).toContain('START_VOTE');
  });

  it('签收：必须是目标工号成员且有 ESC_HANDLE 权限', () => {
    expect(transitionEscalation(ctx({ isTargetWorkNoMember: false }), 'SIGN')).toMatchObject({
      ok: false,
      error: ERROR_CODES.PERM_DENIED,
    });
    expect(transitionEscalation(ctx({ isTargetWorkNoMember: true, canHandle: false }), 'SIGN')).toMatchObject({
      ok: false,
      error: ERROR_CODES.PERM_DENIED,
    });
    expect(transitionEscalation(ctx({ isTargetWorkNoMember: true, canHandle: true }), 'SIGN')).toMatchObject({
      ok: true,
      status: 'SIGNED',
    });
  });
});

describe('上报状态机 · 上级投票与僵局', () => {
  it('上级投票必须全员表态才进结论阶段', () => {
    expect(transitionEscalation(ctx({ status: 'VOTING', allStated: false }), 'ALL_STATED')).toMatchObject({
      ok: false,
      error: ERROR_CODES.ESC_INVALID_TRANSITION,
    });
    expect(transitionEscalation(ctx({ status: 'VOTING', allStated: true }), 'ALL_STATED')).toMatchObject({
      ok: true,
      status: 'PENDING_CONCLUSION',
    });
  });

  it('平票：只有策略为上报时才上溯', () => {
    expect(transitionEscalation(ctx({ status: 'VOTING', tieEscalates: false }), 'TIE')).toMatchObject({
      ok: false,
      error: ERROR_CODES.ESC_INVALID_TRANSITION,
    });
    expect(transitionEscalation(ctx({ status: 'VOTING', tieEscalates: true }), 'TIE')).toMatchObject({
      ok: true,
      status: 'UPGRADED',
    });
  });

  it('三种超时都上溯一级：签收超时 / 投票僵局 / 结论超时', () => {
    expect(transitionEscalation(ctx({ status: 'SUBMITTED' }), 'SIGN_TIMEOUT')).toMatchObject({
      ok: true,
      status: 'UPGRADED',
    });
    expect(transitionEscalation(ctx({ status: 'SIGNED' }), 'SIGN_TIMEOUT')).toMatchObject({
      ok: true,
      status: 'UPGRADED',
    });
    expect(transitionEscalation(ctx({ status: 'VOTING' }), 'DEADLOCK_TIMEOUT')).toMatchObject({
      ok: true,
      status: 'UPGRADED',
    });
    expect(transitionEscalation(ctx({ status: 'PENDING_CONCLUSION' }), 'CONCLUSION_TIMEOUT')).toMatchObject({
      ok: true,
      status: 'UPGRADED',
    });
  });

  it('状态不对时的事件一律拒绝', () => {
    expect(transitionEscalation(ctx({ status: 'CLOSED' }), 'VOTE_CAST')).toMatchObject({
      ok: false,
      error: ERROR_CODES.ESC_INVALID_TRANSITION,
    });
    expect(allowedEscalationEvents('CLOSED')).toEqual([]);
  });
});

describe('上报状态机 · 上级结论与回写（D8）', () => {
  it('CONTINUE / FINAL_* 归入 ADOPTED，RETURN / REQUEST_MORE 归入 RETURNED', () => {
    for (const [action, expected] of [
      ['CONTINUE', 'ADOPTED'],
      ['FINAL_APPROVE', 'ADOPTED'],
      ['FINAL_REJECT', 'ADOPTED'],
      ['RETURN', 'RETURNED'],
      ['REQUEST_MORE', 'RETURNED'],
    ] as const) {
      const r = transitionEscalation(ctx({ status: 'PENDING_CONCLUSION', writeBackAction: action }), 'SUBMIT_CONCLUSION');
      expect(r).toMatchObject({ ok: true, status: expected });
    }
  });

  it('没给回写动作时拒绝提交结论', () => {
    expect(transitionEscalation(ctx({ status: 'PENDING_CONCLUSION' }), 'SUBMIT_CONCLUSION')).toMatchObject({
      ok: false,
      error: ERROR_CODES.SYS_VALIDATION_FAILED,
    });
  });

  it('WRITE_BACK：CONTINUE 解冻恢复；RETURN 解冻并重开本层；终审直接定局；补材料只解冻', () => {
    const cont = transitionEscalation(ctx({ status: 'ADOPTED', writeBackAction: 'CONTINUE' }), 'WRITE_BACK');
    expect(cont).toMatchObject({ ok: true, status: 'CLOSED' });
    expect(cont.ok && cont.actions).toContain('UNFREEZE_INSTANCE');
    expect(cont.ok && cont.actions).not.toContain('FINALIZE_INSTANCE');

    const ret = transitionEscalation(ctx({ status: 'RETURNED', writeBackAction: 'RETURN' }), 'WRITE_BACK');
    expect(ret.ok && ret.actions).toEqual(expect.arrayContaining(['UNFREEZE_INSTANCE', 'REOPEN_SOURCE_NODE']));

    const fin = transitionEscalation(ctx({ status: 'ADOPTED', writeBackAction: 'FINAL_REJECT' }), 'WRITE_BACK');
    expect(fin.ok && fin.actions).toContain('FINALIZE_INSTANCE');
    expect(fin.ok && fin.reason).toContain('直接驳回');

    const more = transitionEscalation(ctx({ status: 'RETURNED', writeBackAction: 'REQUEST_MORE' }), 'WRITE_BACK');
    expect(more.ok && more.actions).not.toContain('REOPEN_SOURCE_NODE');
    expect(more.ok && more.reason).toContain('补充材料');
  });

  it('writeBackFromOpinion：五种意见映射，未知意见返回 null（不默认通过）', () => {
    expect(writeBackFromOpinion('CONTINUE')).toBe('CONTINUE');
    expect(writeBackFromOpinion('RETURN')).toBe('RETURN');
    expect(writeBackFromOpinion('REQUEST_MORE')).toBe('REQUEST_MORE');
    expect(writeBackFromOpinion('FINAL_APPROVE')).toBe('FINAL_APPROVE');
    expect(writeBackFromOpinion('FINAL_REJECT')).toBe('FINAL_REJECT');
    expect(writeBackFromOpinion('WHATEVER')).toBeNull();
  });
});
