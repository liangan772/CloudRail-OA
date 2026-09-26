import { ERROR_CODES } from '@oa/shared';
import { allowedTaskEvents, transitionTask, type TaskTransitionContext } from './state-machine';

const ctx = (over: Partial<TaskTransitionContext> = {}): TaskTransitionContext => ({
  status: 'PENDING_ASSIGN',
  canAssign: true,
  hasOwner: true,
  hasAcceptor: true,
  ...over,
});

describe('任务状态机 · 分配与接单（E2）', () => {
  it('ASSIGN 需要权限 + 唯一负责人 + 唯一验收人', () => {
    expect(transitionTask(ctx({ canAssign: false }), 'ASSIGN')).toMatchObject({
      ok: false,
      error: ERROR_CODES.PERM_DENIED,
    });
    expect(transitionTask(ctx({ hasOwner: false }), 'ASSIGN')).toMatchObject({
      ok: false,
      error: ERROR_CODES.TASK_OWNER_REQUIRED,
    });
    expect(transitionTask(ctx({ hasAcceptor: false }), 'ASSIGN')).toMatchObject({
      ok: false,
      error: ERROR_CODES.TASK_ACCEPTOR_REQUIRED,
    });

    const assigned = transitionTask(ctx(), 'ASSIGN');
    expect(assigned).toMatchObject({ ok: true, status: 'PENDING_ACCEPT' });
    expect(assigned.ok && assigned.actions).toContain('WRITE_ASSIGNEES');
  });

  it('依赖未完成时直接进 BLOCKED，而不是先让人接单再接不了（E3）', () => {
    const r = transitionTask(ctx({ hasUnfinishedDependency: true }), 'ASSIGN');
    expect(r).toMatchObject({ ok: true, status: 'BLOCKED' });
    expect(r.ok && r.actions).toContain('SET_BLOCKED_REASON');
    expect(r.ok && r.reason).toContain('前置任务');
  });

  it('只有负责人能接单 / 拒单', () => {
    expect(transitionTask(ctx({ status: 'PENDING_ACCEPT', isOwner: false }), 'ACCEPT')).toMatchObject({
      ok: false,
      error: ERROR_CODES.TASK_NOT_ASSIGNEE,
    });
    const accepted = transitionTask(ctx({ status: 'PENDING_ACCEPT', isOwner: true }), 'ACCEPT');
    expect(accepted).toMatchObject({ ok: true, status: 'IN_PROGRESS' });
    expect(accepted.ok && accepted.actions).toContain('SET_STARTED_AT');
    expect(transitionTask(ctx({ status: 'PENDING_ACCEPT', isOwner: true }), 'REJECT_ASSIGN')).toMatchObject({
      ok: true,
      status: 'PENDING_ASSIGN',
    });
  });

  it('转派：负责人本人或有 TASK_TRANSFER 权限，且必须给出新负责人；状态不变', () => {
    expect(
      transitionTask(ctx({ status: 'IN_PROGRESS', isOwner: false, canTransfer: false }), 'TRANSFER'),
    ).toMatchObject({ ok: false, error: ERROR_CODES.PERM_DENIED });

    const r = transitionTask(ctx({ status: 'IN_PROGRESS', isOwner: true }), 'TRANSFER');
    expect(r).toMatchObject({ ok: true, status: 'IN_PROGRESS' });
    expect(r.ok && r.actions).toEqual(expect.arrayContaining(['WRITE_ASSIGNEES', 'WRITE_TRANSFER_LOG']));
  });
});

describe('任务状态机 · 执行与验收', () => {
  it('提交验收：检查项未完成则拒绝', () => {
    expect(
      transitionTask(ctx({ status: 'IN_PROGRESS', requireChecklist: true, checklistComplete: false }), 'SUBMIT'),
    ).toMatchObject({ ok: false, error: ERROR_CODES.TASK_CHECKLIST_INCOMPLETE });

    expect(
      transitionTask(ctx({ status: 'IN_PROGRESS', requireChecklist: true, checklistComplete: true }), 'SUBMIT'),
    ).toMatchObject({ ok: true, status: 'PENDING_ACCEPTANCE' });
  });

  it('验收：只有验收人可操作；通过则完成并解锁下游 + 推动流程', () => {
    expect(
      transitionTask(ctx({ status: 'PENDING_ACCEPTANCE', isAcceptor: false }), 'ACCEPTANCE_PASS'),
    ).toMatchObject({ ok: false, error: ERROR_CODES.TASK_NOT_ASSIGNEE });

    const passed = transitionTask(ctx({ status: 'PENDING_ACCEPTANCE', isAcceptor: true }), 'ACCEPTANCE_PASS');
    expect(passed).toMatchObject({ ok: true, status: 'DONE' });
    expect(passed.ok && passed.actions).toEqual(
      expect.arrayContaining(['SET_COMPLETED_AT', 'UNLOCK_DOWNSTREAM', 'ADVANCE_INSTANCE']),
    );

    expect(
      transitionTask(ctx({ status: 'PENDING_ACCEPTANCE', isAcceptor: true }), 'ACCEPTANCE_REJECT'),
    ).toMatchObject({ ok: true, status: 'IN_PROGRESS' });
  });

  it('阻塞与解锁：依赖没完成不允许解锁，解锁回到阻塞前状态', () => {
    expect(transitionTask(ctx({ status: 'IN_PROGRESS' }), 'BLOCK')).toMatchObject({ ok: true, status: 'BLOCKED' });

    expect(transitionTask(ctx({ status: 'BLOCKED', dependenciesDone: false }), 'UNBLOCK')).toMatchObject({
      ok: false,
      error: ERROR_CODES.TASK_BLOCKED_BY_DEPENDENCY,
    });
    expect(
      transitionTask(ctx({ status: 'BLOCKED', dependenciesDone: true, blockedFrom: 'PENDING_ACCEPT' }), 'UNBLOCK'),
    ).toMatchObject({ ok: true, status: 'PENDING_ACCEPT' });
  });
});

describe('任务状态机 · 逾期 / 取消 / 上报 / 重开', () => {
  it('逾期是标记而非状态迁移（E4）', () => {
    const r = transitionTask(ctx({ status: 'IN_PROGRESS' }), 'OVERDUE');
    expect(r).toMatchObject({ ok: true, status: 'IN_PROGRESS' });
    expect(r.ok && r.actions).toEqual(expect.arrayContaining(['MARK_OVERDUE', 'SET_OVERDUE_NOTIFIED']));
  });

  it('终态不能再逾期；DONE 只能重开', () => {
    expect(transitionTask(ctx({ status: 'DONE' }), 'OVERDUE')).toMatchObject({
      ok: false,
      error: ERROR_CODES.TASK_INVALID_TRANSITION,
    });
    expect(transitionTask(ctx({ status: 'DONE', canReopen: false }), 'REOPEN')).toMatchObject({
      ok: false,
      error: ERROR_CODES.PERM_DENIED,
    });
    expect(transitionTask(ctx({ status: 'DONE', canReopen: true }), 'REOPEN')).toMatchObject({
      ok: true,
      status: 'IN_PROGRESS',
    });
  });

  it('取消：非取消态都可以取消，并级联取消子任务；重复取消被拒绝', () => {
    const r = transitionTask(ctx({ status: 'IN_PROGRESS' }), 'CANCEL');
    expect(r).toMatchObject({ ok: true, status: 'CANCELLED' });
    expect(r.ok && r.actions).toContain('CANCEL_SUBTASKS');
    expect(transitionTask(ctx({ status: 'CANCELLED' }), 'CANCEL')).toMatchObject({
      ok: false,
      error: ERROR_CODES.TASK_INVALID_TRANSITION,
    });
  });

  it('上报只允许从执行中的状态触发', () => {
    expect(transitionTask(ctx({ status: 'IN_PROGRESS' }), 'ESCALATE')).toMatchObject({
      ok: true,
      status: 'ESCALATED',
    });
    expect(transitionTask(ctx({ status: 'PENDING_ASSIGN' }), 'ESCALATE')).toMatchObject({
      ok: false,
      error: ERROR_CODES.TASK_INVALID_TRANSITION,
    });
  });

  it('事件表与状态对齐：终态与已取消没有可用事件', () => {
    expect(allowedTaskEvents('CANCELLED')).toEqual([]);
    expect(allowedTaskEvents('DONE')).toEqual(['REOPEN']);
    expect(allowedTaskEvents('BLOCKED')).toEqual(expect.arrayContaining(['UNBLOCK']));
  });
});
