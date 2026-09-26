import { ERROR_CODES, type ErrorDef, type TaskStatus } from '@oa/shared';

/**
 * 任务状态机（纯函数，零 IO）。
 *
 * 唯一口径：docs/stage-0/04-domain-model-draft.md §6.3 与已确认规则 E1–E5。
 *
 * 三条硬约束：
 * - **恰好一个 OWNER + 恰好一个 ACCEPTOR**（E2）：`ASSIGN` 的守卫直接拦；
 * - **依赖未完成 → BLOCKED**（E3）：分配或阻塞时按依赖状态进阻塞，依赖完成再解锁；
 * - **任务完成再推动下一层**（C1/C3）：`ACCEPTANCE_PASS` 的副作用里带 `ADVANCE_INSTANCE`，
 *   由调用方在同层任务全部完成时执行。
 */

export type TaskEvent =
  | 'ASSIGN'
  | 'ACCEPT'
  | 'REJECT_ASSIGN'
  | 'TRANSFER'
  | 'SUBMIT'
  | 'BLOCK'
  | 'UNBLOCK'
  | 'ACCEPTANCE_PASS'
  | 'ACCEPTANCE_REJECT'
  | 'OVERDUE'
  | 'CANCEL'
  | 'ESCALATE'
  | 'REOPEN';

export const TASK_EVENT_LABEL: Record<TaskEvent, string> = {
  ASSIGN: '分配任务',
  ACCEPT: '接受任务',
  REJECT_ASSIGN: '拒绝接单',
  TRANSFER: '转派',
  SUBMIT: '提交验收',
  BLOCK: '阻塞',
  UNBLOCK: '解除阻塞',
  ACCEPTANCE_PASS: '验收通过',
  ACCEPTANCE_REJECT: '验收打回',
  OVERDUE: '逾期',
  CANCEL: '取消',
  ESCALATE: '上报',
  REOPEN: '重开',
};

export type TaskActionType =
  | 'WRITE_ASSIGNEES'
  | 'NOTIFY_OWNER'
  | 'NOTIFY_CREATOR'
  | 'NOTIFY_ACCEPTOR'
  | 'SET_STARTED_AT'
  | 'SET_BLOCKED_REASON'
  | 'WRITE_TRANSFER_LOG'
  | 'WRITE_LOG'
  | 'MARK_OVERDUE'
  | 'SET_OVERDUE_NOTIFIED'
  | 'CANCEL_SUBTASKS'
  | 'CREATE_ESCALATION'
  | 'SET_COMPLETED_AT'
  | 'UNLOCK_DOWNSTREAM'
  | 'ADVANCE_INSTANCE';

export interface TaskTransitionContext {
  status: TaskStatus;
  /** 具备 TASK_ASSIGN 权限 */
  canAssign?: boolean;
  /** 已解析出负责人 / 验收人 */
  hasOwner?: boolean;
  hasAcceptor?: boolean;
  /** 存在未完成的前置依赖 */
  hasUnfinishedDependency?: boolean;
  /** 当前操作人就是负责人 / 验收人 */
  isOwner?: boolean;
  isAcceptor?: boolean;
  /** 具备 TASK_TRANSFER / TASK_REOPEN 权限 */
  canTransfer?: boolean;
  canReopen?: boolean;
  /** 检查项校验（requireChecklist 关闭时不校验） */
  requireChecklist?: boolean;
  checklistComplete?: boolean;
  /** 阻塞前状态（UNBLOCK 恢复用） */
  blockedFrom?: TaskStatus;
  /** 所有前置依赖都已完成（UNBLOCK 用） */
  dependenciesDone?: boolean;
}

export interface TaskTransitionAccepted {
  ok: true;
  from: TaskStatus;
  status: TaskStatus;
  actions: TaskActionType[];
  reason: string;
}

export interface TaskTransitionRejected {
  ok: false;
  error: ErrorDef;
  reason: string;
}

export type TaskTransitionResult = TaskTransitionAccepted | TaskTransitionRejected;

function accept(
  from: TaskStatus,
  status: TaskStatus,
  actions: TaskActionType[],
  reason: string,
): TaskTransitionAccepted {
  return { ok: true, from, status, actions, reason };
}

function reject(error: ErrorDef, reason: string): TaskTransitionRejected {
  return { ok: false, error, reason };
}

function invalid(status: TaskStatus, event: string): TaskTransitionRejected {
  return reject(ERROR_CODES.TASK_INVALID_TRANSITION, `任务状态 ${status} 不允许事件 ${event}`);
}

/** 终态：不再接受普通推进（`REOPEN` 是唯一例外） */
const TERMINAL: TaskStatus[] = ['DONE', 'CANCELLED'];

export const TASK_EVENT_TABLE: Record<TaskStatus, TaskEvent[]> = {
  PENDING_ASSIGN: ['ASSIGN', 'BLOCK', 'CANCEL'],
  PENDING_ACCEPT: ['ACCEPT', 'REJECT_ASSIGN', 'TRANSFER', 'CANCEL', 'ESCALATE'],
  IN_PROGRESS: ['SUBMIT', 'BLOCK', 'TRANSFER', 'OVERDUE', 'CANCEL', 'ESCALATE'],
  PENDING_ACCEPTANCE: ['ACCEPTANCE_PASS', 'ACCEPTANCE_REJECT', 'OVERDUE', 'CANCEL', 'ESCALATE'],
  BLOCKED: ['UNBLOCK', 'CANCEL'],
  DONE: ['REOPEN'],
  CANCELLED: [],
  ESCALATED: ['CANCEL'],
  OVERDUE: ['SUBMIT', 'ACCEPTANCE_PASS', 'ACCEPTANCE_REJECT', 'CANCEL', 'ESCALATE'],
};

export function allowedTaskEvents(status: TaskStatus): TaskEvent[] {
  return [...TASK_EVENT_TABLE[status]];
}

export function transitionTask(ctx: TaskTransitionContext, event: TaskEvent): TaskTransitionResult {
  const from = ctx.status;

  switch (event) {
    case 'ASSIGN': {
      if (from !== 'PENDING_ASSIGN') return invalid(from, event);
      if (ctx.canAssign === false) return reject(ERROR_CODES.PERM_DENIED, '缺少 TASK_ASSIGN 权限');
      if (ctx.hasOwner === false) return reject(ERROR_CODES.TASK_OWNER_REQUIRED, '未解析出唯一负责人');
      if (ctx.hasAcceptor === false) return reject(ERROR_CODES.TASK_ACCEPTOR_REQUIRED, '未解析出唯一验收人');
      // 依赖未满足：直接进阻塞，而不是先让人接单再接不了
      if (ctx.hasUnfinishedDependency) {
        return accept(
          from,
          'BLOCKED',
          ['WRITE_ASSIGNEES', 'SET_BLOCKED_REASON', 'WRITE_LOG'],
          '存在未完成的前置任务，已置为阻塞',
        );
      }
      return accept(
        from,
        'PENDING_ACCEPT',
        ['WRITE_ASSIGNEES', 'NOTIFY_OWNER', 'WRITE_LOG'],
        '任务已分配，等待负责人接单',
      );
    }

    case 'ACCEPT': {
      if (from !== 'PENDING_ACCEPT') return invalid(from, event);
      if (ctx.isOwner === false) return reject(ERROR_CODES.TASK_NOT_ASSIGNEE, '只有负责人可以接单');
      return accept(from, 'IN_PROGRESS', ['SET_STARTED_AT', 'NOTIFY_CREATOR', 'WRITE_LOG'], '负责人已接单，任务开始');
    }

    case 'REJECT_ASSIGN': {
      if (from !== 'PENDING_ACCEPT') return invalid(from, event);
      if (ctx.isOwner === false) return reject(ERROR_CODES.TASK_NOT_ASSIGNEE, '只有负责人可以拒绝接单');
      return accept(from, 'PENDING_ASSIGN', ['NOTIFY_CREATOR', 'WRITE_LOG'], '负责人拒绝接单，等待重新分配');
    }

    case 'TRANSFER': {
      if (from !== 'PENDING_ACCEPT' && from !== 'IN_PROGRESS') return invalid(from, event);
      if (ctx.isOwner !== true && ctx.canTransfer !== true) {
        return reject(ERROR_CODES.PERM_DENIED, '只有负责人或具备 TASK_TRANSFER 权限的人可以转派');
      }
      if (ctx.hasOwner === false) return reject(ERROR_CODES.TASK_OWNER_REQUIRED, '转派必须指定新的负责人');
      return accept(from, from, ['WRITE_ASSIGNEES', 'WRITE_TRANSFER_LOG', 'NOTIFY_OWNER'], '任务已转派，状态不变');
    }

    case 'SUBMIT': {
      if (from !== 'IN_PROGRESS' && from !== 'OVERDUE') return invalid(from, event);
      if (ctx.requireChecklist !== false && ctx.checklistComplete === false) {
        return reject(ERROR_CODES.TASK_CHECKLIST_INCOMPLETE, '检查项未全部完成');
      }
      return accept(from, 'PENDING_ACCEPTANCE', ['NOTIFY_ACCEPTOR', 'WRITE_LOG'], '已提交验收');
    }

    case 'BLOCK': {
      if (from !== 'PENDING_ASSIGN' && from !== 'IN_PROGRESS') return invalid(from, event);
      return accept(from, 'BLOCKED', ['SET_BLOCKED_REASON', 'WRITE_LOG'], '任务已阻塞');
    }

    case 'UNBLOCK': {
      if (from !== 'BLOCKED') return invalid(from, event);
      if (ctx.dependenciesDone === false) {
        return reject(ERROR_CODES.TASK_BLOCKED_BY_DEPENDENCY, '仍有前置任务未完成');
      }
      const back: TaskStatus = ctx.blockedFrom ?? 'IN_PROGRESS';
      return accept(from, back, ['NOTIFY_OWNER', 'WRITE_LOG'], `阻塞已解除，回到 ${back}`);
    }

    case 'ACCEPTANCE_PASS': {
      if (from !== 'PENDING_ACCEPTANCE' && from !== 'OVERDUE') return invalid(from, event);
      if (ctx.isAcceptor === false) return reject(ERROR_CODES.TASK_NOT_ASSIGNEE, '只有验收人可以验收');
      return accept(
        from,
        'DONE',
        ['SET_COMPLETED_AT', 'UNLOCK_DOWNSTREAM', 'ADVANCE_INSTANCE', 'WRITE_LOG'],
        '验收通过，任务完成并解锁下游',
      );
    }

    case 'ACCEPTANCE_REJECT': {
      if (from !== 'PENDING_ACCEPTANCE' && from !== 'OVERDUE') return invalid(from, event);
      if (ctx.isAcceptor === false) return reject(ERROR_CODES.TASK_NOT_ASSIGNEE, '只有验收人可以打回');
      return accept(from, 'IN_PROGRESS', ['NOTIFY_OWNER', 'WRITE_LOG'], '验收未通过，已打回负责人');
    }

    case 'OVERDUE': {
      if (TERMINAL.includes(from)) return invalid(from, event);
      // 逾期是标记而不是状态迁移：状态保持原样，只打标记 + 防重复通知（E4）
      return accept(from, from, ['MARK_OVERDUE', 'SET_OVERDUE_NOTIFIED', 'WRITE_LOG'], '任务已逾期');
    }

    case 'CANCEL': {
      if (from === 'CANCELLED') return invalid(from, event);
      return accept(from, 'CANCELLED', ['CANCEL_SUBTASKS', 'WRITE_LOG'], '任务已取消');
    }

    case 'ESCALATE': {
      if (
        from !== 'IN_PROGRESS' &&
        from !== 'PENDING_ACCEPT' &&
        from !== 'PENDING_ACCEPTANCE' &&
        from !== 'OVERDUE'
      ) {
        return invalid(from, event);
      }
      return accept(from, 'ESCALATED', ['CREATE_ESCALATION', 'WRITE_LOG'], '任务已上报');
    }

    case 'REOPEN': {
      if (from !== 'DONE') return invalid(from, event);
      if (ctx.canReopen === false) return reject(ERROR_CODES.PERM_DENIED, '缺少 TASK_REOPEN 权限');
      return accept(from, 'IN_PROGRESS', ['NOTIFY_OWNER', 'WRITE_LOG'], '任务已重开，回到进行中');
    }

    default:
      return invalid(from, String(event));
  }
}
