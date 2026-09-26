import { ERROR_CODES } from '@oa/shared';
import {
  allowedInstanceEvents,
  allowedNodeEvents,
  instanceEventForNode,
  transitionInstance,
  transitionNode,
  type InstanceTransitionContext,
  type NodeTransitionContext,
} from './state-machines';

const instanceCtx = (over: Partial<InstanceTransitionContext> = {}): InstanceTransitionContext => ({
  status: 'VOTING',
  ...over,
});

const nodeCtx = (over: Partial<NodeTransitionContext> = {}): NodeTransitionContext => ({
  status: 'VOTING',
  ...over,
});

describe('状态机 · 流程实例 §6.1', () => {
  it('DRAFT + SUBMIT → VOTING，并创建首层节点与快照投票人', () => {
    const r = transitionInstance(
      instanceCtx({ status: 'DRAFT', templatePublished: true, formValid: true, canCreate: true }),
      'SUBMIT',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe('VOTING');
    expect(r.actions).toEqual(
      expect.arrayContaining(['CREATE_NODE', 'SNAPSHOT_VOTERS', 'SET_DEADLINE', 'SCHEDULE_VOTE_TIMEOUT']),
    );
  });

  it('DRAFT + SUBMIT：模板未发布 / 表单不合规 / 无权限 三种守卫都要拒绝', () => {
    expect(transitionInstance(instanceCtx({ status: 'DRAFT', templatePublished: false }), 'SUBMIT')).toMatchObject({
      ok: false,
      error: ERROR_CODES.WF_VERSION_NOT_PUBLISHED,
    });
    expect(transitionInstance(instanceCtx({ status: 'DRAFT', formValid: false }), 'SUBMIT')).toMatchObject({
      ok: false,
      error: ERROR_CODES.WF_FORM_SCHEMA_INVALID,
    });
    expect(transitionInstance(instanceCtx({ status: 'DRAFT', canCreate: false }), 'SUBMIT')).toMatchObject({
      ok: false,
      error: ERROR_CODES.PERM_DENIED,
    });
  });

  it('VOTING + NODE_PASSED：还有下一层时留在 VOTING，最后一层转为 APPROVED', () => {
    const middle = transitionInstance(instanceCtx({ hasNextLayer: true }), 'NODE_PASSED');
    expect(middle.ok && middle.status).toBe('VOTING');
    expect(middle.ok && middle.actions).toContain('CREATE_TASKS');

    const last = transitionInstance(instanceCtx({ hasNextLayer: false }), 'NODE_PASSED');
    expect(last.ok && last.status).toBe('APPROVED');
    expect(last.ok && last.actions).toEqual(
      expect.arrayContaining(['SET_ENDED_AT', 'NOTIFY_INITIATOR', 'ARCHIVE_OUTBOX']),
    );
  });

  it('VOTING + NODE_REJECTED：命中「驳回即上报」时转 ESCALATED，否则 REJECTED', () => {
    expect(transitionInstance(instanceCtx({ escalationTriggered: true }), 'NODE_REJECTED')).toMatchObject({
      ok: true,
      status: 'ESCALATED',
    });
    expect(transitionInstance(instanceCtx({ escalationTriggered: false }), 'NODE_REJECTED')).toMatchObject({
      ok: true,
      status: 'REJECTED',
    });
  });

  it('ESCALATE 必须命中触发源，否则拒绝', () => {
    expect(transitionInstance(instanceCtx({ escalationTriggered: false }), 'ESCALATE')).toMatchObject({
      ok: false,
      error: ERROR_CODES.ESC_INVALID_TRANSITION,
    });
    expect(transitionInstance(instanceCtx({ escalationTriggered: true }), 'ESCALATE')).toMatchObject({
      ok: true,
      status: 'ESCALATED',
    });
  });

  it('ESCALATED + RESUME：只有上级意见为 CONTINUE 才能恢复投票', () => {
    expect(transitionInstance(instanceCtx({ status: 'ESCALATED', escalationOpinion: 'CONTINUE' }), 'RESUME')).toMatchObject({
      ok: true,
      status: 'VOTING',
    });
    expect(transitionInstance(instanceCtx({ status: 'ESCALATED', escalationOpinion: 'RETURN' }), 'RESUME')).toMatchObject({
      ok: false,
      error: ERROR_CODES.ESC_INVALID_TRANSITION,
    });
  });

  it('ESCALATED + FINAL_*：意见必须与事件一致，终审后落 APPROVED / REJECTED', () => {
    expect(
      transitionInstance(instanceCtx({ status: 'ESCALATED', escalationOpinion: 'FINAL_REJECT' }), 'FINAL_APPROVE'),
    ).toMatchObject({ ok: false, error: ERROR_CODES.ESC_INVALID_TRANSITION });

    expect(
      transitionInstance(instanceCtx({ status: 'ESCALATED', escalationOpinion: 'FINAL_APPROVE' }), 'FINAL_APPROVE'),
    ).toMatchObject({ ok: true, status: 'APPROVED' });

    expect(
      transitionInstance(instanceCtx({ status: 'ESCALATED', escalationOpinion: 'FINAL_REJECT' }), 'FINAL_REJECT'),
    ).toMatchObject({ ok: true, status: 'REJECTED' });
  });

  it('ESCALATED + RETURN：按退回深度回到原层或直接驳回，REQUEST_MORE 走驳回', () => {
    expect(
      transitionInstance(
        instanceCtx({ status: 'ESCALATED', escalationOpinion: 'RETURN', returnToLayer: true }),
        'RETURN',
      ),
    ).toMatchObject({ ok: true, status: 'VOTING' });

    const deep = transitionInstance(
      instanceCtx({ status: 'ESCALATED', escalationOpinion: 'RETURN', returnToLayer: false }),
      'RETURN',
    );
    expect(deep).toMatchObject({ ok: true, status: 'REJECTED' });
    expect(deep.ok && deep.actions).toContain('NOTIFY_INITIATOR');

    expect(
      transitionInstance(instanceCtx({ status: 'ESCALATED', escalationOpinion: 'REQUEST_MORE' }), 'RETURN'),
    ).toMatchObject({ ok: true, status: 'REJECTED' });
  });

  it('SUSPENDED + RESUME 恢复冻结前状态（默认 VOTING）', () => {
    expect(transitionInstance(instanceCtx({ status: 'SUSPENDED' }), 'RESUME')).toMatchObject({
      ok: true,
      status: 'VOTING',
    });
    expect(
      transitionInstance(instanceCtx({ status: 'SUSPENDED', suspendedFrom: 'ESCALATED' }), 'RESUME'),
    ).toMatchObject({ ok: true, status: 'ESCALATED' });
  });

  it('WITHDRAW：已有生效结论时拒绝，否则作废未完成节点并关闭', () => {
    expect(transitionInstance(instanceCtx({ hasEffectiveConclusion: true }), 'WITHDRAW')).toMatchObject({
      ok: false,
      error: ERROR_CODES.VOTE_CLOSED,
    });
    const r = transitionInstance(instanceCtx({ hasEffectiveConclusion: false, canOperate: true }), 'WITHDRAW');
    expect(r).toMatchObject({ ok: true, status: 'CLOSED' });
    expect(r.ok && r.actions).toContain('VOID_PENDING_NODES');
    expect(transitionInstance(instanceCtx({ canOperate: false }), 'WITHDRAW')).toMatchObject({
      ok: false,
      error: ERROR_CODES.PERM_DENIED,
    });
  });

  it('CLOSE 只允许从 APPROVED / REJECTED 触发', () => {
    expect(transitionInstance(instanceCtx({ status: 'APPROVED' }), 'CLOSE')).toMatchObject({
      ok: true,
      status: 'CLOSED',
    });
    expect(transitionInstance(instanceCtx({ status: 'VOTING' }), 'CLOSE')).toMatchObject({
      ok: false,
      error: ERROR_CODES.NODE_INVALID_TRANSITION,
    });
  });

  it('事件表只暴露合法事件（供前端渲染按钮）', () => {
    expect(allowedInstanceEvents('DRAFT')).toEqual(['SUBMIT']);
    expect(allowedInstanceEvents('CLOSED')).toEqual([]);
    expect(allowedInstanceEvents('ESCALATED')).toEqual(
      expect.arrayContaining(['RESUME', 'FINAL_APPROVE', 'FINAL_REJECT', 'RETURN']),
    );
  });
});

describe('状态机 · 层级节点 §6.2', () => {
  it('PENDING + OPEN：首层或上层已完结才能开启；投票人为空直接报错', () => {
    expect(transitionNode(nodeCtx({ status: 'PENDING', isFirstLayer: false, prevNodeDone: false, voterCount: 3 }), 'OPEN')).toMatchObject(
      { ok: false, error: ERROR_CODES.NODE_INVALID_TRANSITION },
    );
    expect(transitionNode(nodeCtx({ status: 'PENDING', isFirstLayer: true, voterCount: 0 }), 'OPEN')).toMatchObject({
      ok: false,
      error: ERROR_CODES.NODE_VOTER_EMPTY,
    });
    const opened = transitionNode(nodeCtx({ status: 'PENDING', isFirstLayer: true, voterCount: 5 }), 'OPEN');
    expect(opened).toMatchObject({ ok: true, status: 'VOTING' });
    expect(opened.ok && opened.actions).toEqual(
      expect.arrayContaining(['CREATE_NODE_VOTERS', 'SET_DEADLINE', 'SCHEDULE_VOTE_TIMEOUT']),
    );
  });

  it('VOTE_CAST：非投票人 / 已出结论 / 已超时 / 弃权 一律拒绝', () => {
    expect(transitionNode(nodeCtx({ isVoter: false }), 'VOTE_CAST')).toMatchObject({
      ok: false,
      error: ERROR_CODES.VOTE_NOT_VOTER,
    });
    expect(transitionNode(nodeCtx({ isVoter: true, conclusionFormed: true }), 'VOTE_CAST')).toMatchObject({
      ok: false,
      error: ERROR_CODES.VOTE_CLOSED,
    });
    expect(transitionNode(nodeCtx({ isVoter: true, deadlinePassed: true }), 'VOTE_CAST')).toMatchObject({
      ok: false,
      error: ERROR_CODES.VOTE_EXPIRED,
    });
    expect(
      transitionNode(nodeCtx({ isVoter: true, conclusionDecision: 'ABSTAIN' }), 'VOTE_CAST'),
    ).toMatchObject({ ok: false, error: ERROR_CODES.VOTE_ABSTAIN_NOT_ALLOWED });
  });

  it('VOTE_CAST：改票按策略限量，改票时先标记旧票 isReplaced', () => {
    expect(
      transitionNode(nodeCtx({ isVoter: true, revoteCount: 1, revotePolicy: 'NOT_ALLOWED' }), 'VOTE_CAST'),
    ).toMatchObject({ ok: false, error: ERROR_CODES.VOTE_REVOTE_NOT_ALLOWED });

    expect(
      transitionNode(nodeCtx({ isVoter: true, revoteCount: 2, revotePolicy: 'ONCE' }), 'VOTE_CAST'),
    ).toMatchObject({ ok: false, error: ERROR_CODES.VOTE_REVOTE_NOT_ALLOWED });

    const revote = transitionNode(
      nodeCtx({ isVoter: true, revoteCount: 1, revotePolicy: 'UNLIMITED_BEFORE_CONCLUSION' }),
      'VOTE_CAST',
    );
    expect(revote.ok && revote.status).toBe('VOTING');
    expect(revote.ok && revote.actions[0]).toBe('REPLACE_OLD_VOTE');

    const first = transitionNode(nodeCtx({ isVoter: true, revoteCount: 0 }), 'VOTE_CAST');
    expect(first.ok && first.actions).not.toContain('REPLACE_OLD_VOTE');
  });

  it('VETO_LOCK：只锁定不予通过，节点仍停留在 VOTING 等全员表态', () => {
    const r = transitionNode(nodeCtx(), 'VETO_LOCK');
    expect(r).toMatchObject({ ok: true, status: 'VOTING' });
    expect(r.ok && r.actions).toContain('SET_VETO_LOCKED');
    expect(r.ok && r.reason).toContain('仍等待');
  });

  it('ALL_STATED：池内还有人未表态时不得进入结论阶段', () => {
    expect(transitionNode(nodeCtx({ hasUnstatedVoters: true }), 'ALL_STATED')).toMatchObject({
      ok: false,
      error: ERROR_CODES.NODE_INVALID_TRANSITION,
    });
    const r = transitionNode(nodeCtx({ hasUnstatedVoters: false }), 'ALL_STATED');
    expect(r).toMatchObject({ ok: true, status: 'PENDING_CONCLUSION' });
    expect(r.ok && r.actions).toEqual(
      expect.arrayContaining(['WRITE_PROVISIONAL_RESULT', 'SET_CONCLUSION_PENDING', 'SCHEDULE_CONCLUSION_TIMEOUT']),
    );
  });

  it('MARK_ABSENT：权限 / 理由 / 委托 三个守卫', () => {
    expect(transitionNode(nodeCtx({ canMarkAbsent: false }), 'MARK_ABSENT')).toMatchObject({
      ok: false,
      error: ERROR_CODES.PERM_DENIED,
    });
    expect(transitionNode(nodeCtx({ canMarkAbsent: true }), 'MARK_ABSENT')).toMatchObject({
      ok: false,
      error: ERROR_CODES.SYS_VALIDATION_FAILED,
    });
    expect(
      transitionNode(nodeCtx({ canMarkAbsent: true, absentReasonProvided: true, hasActiveDelegation: true }), 'MARK_ABSENT'),
    ).toMatchObject({ ok: false, error: ERROR_CODES.NODE_INVALID_TRANSITION });
  });

  it('MARK_ABSENT：剔除后跌破法定人数 → 直接上报；剔除后全员表态 → 直接进入结论阶段', () => {
    const quorumBroken = transitionNode(
      nodeCtx({ canMarkAbsent: true, absentReasonProvided: true, absentBreaksQuorum: true }),
      'MARK_ABSENT',
    );
    expect(quorumBroken).toMatchObject({ ok: true, status: 'ESCALATED' });
    expect(quorumBroken.ok && quorumBroken.actions).toContain('CREATE_ESCALATION');

    const allStated = transitionNode(
      nodeCtx({
        canMarkAbsent: true,
        absentReasonProvided: true,
        absentBreaksQuorum: false,
        allStatedAfterAbsent: true,
      }),
      'MARK_ABSENT',
    );
    expect(allStated).toMatchObject({ ok: true, status: 'PENDING_CONCLUSION' });

    const plain = transitionNode(nodeCtx({ canMarkAbsent: true, absentReasonProvided: true }), 'MARK_ABSENT');
    expect(plain).toMatchObject({ ok: true, status: 'VOTING' });
    expect(plain.ok && plain.actions).toContain('RECALC_POOL');
  });

  it('REVOKE_ABSENT：结论已形成后不允许再调整投票池', () => {
    expect(
      transitionNode(nodeCtx({ canMarkAbsent: true, conclusionFormed: true }), 'REVOKE_ABSENT'),
    ).toMatchObject({ ok: false, error: ERROR_CODES.VOTE_CLOSED });
    expect(transitionNode(nodeCtx({ canMarkAbsent: true }), 'REVOKE_ABSENT')).toMatchObject({
      ok: true,
      status: 'VOTING',
    });
  });

  it('DEADLINE_HIT：全员已表态时不应走超时分支', () => {
    expect(transitionNode(nodeCtx({ hasUnstatedVoters: false }), 'DEADLINE_HIT')).toMatchObject({
      ok: false,
      error: ERROR_CODES.NODE_INVALID_TRANSITION,
    });
    const r = transitionNode(nodeCtx({ hasUnstatedVoters: true }), 'DEADLINE_HIT');
    expect(r).toMatchObject({ ok: true, status: 'TIMEOUT' });
    expect(r.ok && r.actions).toContain('RECORD_UNSTATED_VOTERS');
  });

  it('超时策略：催办未超轮次回到 VOTING，超轮次强制上报', () => {
    const remind = transitionNode(
      nodeCtx({ status: 'TIMEOUT', timeoutPolicy: 'REMIND_ONLY', remindCount: 1, maxRemindRounds: 3 }),
      'APPLY_POLICY',
    );
    expect(remind).toMatchObject({ ok: true, status: 'VOTING' });
    expect(remind.ok && remind.reason).toContain('2/3');

    const forced = transitionNode(
      nodeCtx({ status: 'TIMEOUT', timeoutPolicy: 'REMIND_ONLY', remindCount: 3, maxRemindRounds: 3 }),
      'APPLY_POLICY',
    );
    expect(forced).toMatchObject({ ok: true, status: 'ESCALATED' });
    expect(forced.ok && forced.actions).toContain('FORCE_ESCALATE');
  });

  it('超时策略：AUTO_REJECT 转入结论阶段；AUTO_APPROVE 默认禁用', () => {
    expect(transitionNode(nodeCtx({ status: 'TIMEOUT', timeoutPolicy: 'AUTO_REJECT' }), 'APPLY_POLICY')).toMatchObject({
      ok: true,
      status: 'PENDING_CONCLUSION',
    });
    expect(transitionNode(nodeCtx({ status: 'TIMEOUT', timeoutPolicy: 'AUTO_APPROVE' }), 'APPLY_POLICY')).toMatchObject({
      ok: false,
      error: ERROR_CODES.NODE_INVALID_TRANSITION,
    });
    expect(
      transitionNode(nodeCtx({ status: 'TIMEOUT', timeoutPolicy: 'AUTO_APPROVE', allowAutoApprove: true }), 'APPLY_POLICY'),
    ).toMatchObject({ ok: true, status: 'PENDING_CONCLUSION' });
    expect(transitionNode(nodeCtx({ status: 'TIMEOUT', timeoutPolicy: 'ESCALATE' }), 'APPLY_POLICY')).toMatchObject({
      ok: true,
      status: 'ESCALATED',
    });
  });

  it('SUBMIT_CONCLUSION：权限、取值、节点去向', () => {
    expect(
      transitionNode(
        nodeCtx({ status: 'PENDING_CONCLUSION', canConclude: false, conclusionDecision: 'APPROVE' }),
        'SUBMIT_CONCLUSION',
      ),
    ).toMatchObject({ ok: false, error: ERROR_CODES.VOTE_CONCLUSION_AUTHOR_REQUIRED });

    expect(
      transitionNode(nodeCtx({ status: 'PENDING_CONCLUSION', canConclude: true, conclusionDecision: 'ABSTAIN' }), 'SUBMIT_CONCLUSION'),
    ).toMatchObject({ ok: false, error: ERROR_CODES.SYS_VALIDATION_FAILED });

    const passed = transitionNode(
      nodeCtx({ status: 'PENDING_CONCLUSION', canConclude: true, conclusionDecision: 'APPROVE' }),
      'SUBMIT_CONCLUSION',
    );
    expect(passed).toMatchObject({ ok: true, status: 'PASSED' });
    expect(passed.ok && passed.actions).toEqual(
      expect.arrayContaining(['WRITE_CONCLUSION', 'CANCEL_CONCLUSION_TIMEOUT', 'CREATE_TASKS', 'ADVANCE_INSTANCE']),
    );

    expect(
      transitionNode(
        nodeCtx({ status: 'PENDING_CONCLUSION', canConclude: true, conclusionDecision: 'REJECT' }),
        'SUBMIT_CONCLUSION',
      ),
    ).toMatchObject({ ok: true, status: 'REJECTED' });
  });

  it('PENDING_CONCLUSION + CONCLUSION_TIMEOUT → 上报上级部门', () => {
    expect(transitionNode(nodeCtx({ status: 'PENDING_CONCLUSION' }), 'CONCLUSION_TIMEOUT')).toMatchObject({
      ok: true,
      status: 'ESCALATED',
    });
  });

  it('ESCALATED：RESUME 回到 VOTING，FINAL 由上级终审定局', () => {
    expect(transitionNode(nodeCtx({ status: 'ESCALATED' }), 'RESUME')).toMatchObject({ ok: true, status: 'VOTING' });

    const approved = transitionNode(nodeCtx({ status: 'ESCALATED', finalDecision: 'APPROVE' }), 'FINAL');
    expect(approved).toMatchObject({ ok: true, status: 'PASSED' });
    expect(approved.ok && approved.actions).toEqual(
      expect.arrayContaining(['WRITE_FINAL_RESULT', 'SYSTEM_CONCLUSION']),
    );

    expect(transitionNode(nodeCtx({ status: 'ESCALATED', finalDecision: 'REJECT' }), 'FINAL')).toMatchObject({
      ok: true,
      status: 'REJECTED',
    });
    expect(transitionNode(nodeCtx({ status: 'ESCALATED' }), 'FINAL')).toMatchObject({
      ok: false,
      error: ERROR_CODES.SYS_VALIDATION_FAILED,
    });
  });

  it('SKIP 必须写原因；COMPLETE 必须在任务已创建之后', () => {
    expect(transitionNode(nodeCtx({ status: 'VOTING' }), 'SKIP')).toMatchObject({
      ok: false,
      error: ERROR_CODES.SYS_VALIDATION_FAILED,
    });
    expect(transitionNode(nodeCtx({ status: 'VOTING', skipReason: '条件分支未命中' }), 'SKIP')).toMatchObject({
      ok: true,
      status: 'SKIPPED',
    });

    expect(transitionNode(nodeCtx({ status: 'PASSED', tasksCreated: false }), 'COMPLETE')).toMatchObject({
      ok: false,
      error: ERROR_CODES.NODE_INVALID_TRANSITION,
    });
    expect(transitionNode(nodeCtx({ status: 'PASSED', tasksCreated: true }), 'COMPLETE')).toMatchObject({
      ok: true,
      status: 'DONE',
    });
    expect(transitionNode(nodeCtx({ status: 'TIMEOUT' }), 'COMPLETE')).toMatchObject({
      ok: false,
      error: ERROR_CODES.NODE_INVALID_TRANSITION,
    });
  });

  it('节点事件表与节点 → 实例联动映射', () => {
    expect(allowedNodeEvents('DONE')).toEqual([]);
    expect(allowedNodeEvents('PENDING_CONCLUSION')).toEqual(
      expect.arrayContaining(['SUBMIT_CONCLUSION', 'CONCLUSION_TIMEOUT']),
    );
    expect(instanceEventForNode('PASSED')).toBe('NODE_PASSED');
    expect(instanceEventForNode('REJECTED')).toBe('NODE_REJECTED');
    expect(instanceEventForNode('ESCALATED')).toBe('ESCALATE');
    expect(instanceEventForNode('DONE')).toBeNull();
    expect(instanceEventForNode('SKIPPED')).toBeNull();
  });
});
