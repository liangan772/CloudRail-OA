import {
  ERROR_CODES,
  type ErrorDef,
  type EscalationAcceptMode,
  type EscalationStatus,
  type WriteBackAction,
} from '@oa/shared';

/**
 * 上报状态机（纯函数，零 IO）。
 *
 * 唯一口径：docs/stage-0/04-domain-model-draft.md §6.4。
 * 关键语义：**上报 = 让上级部门再跑一次同样的投票**（复用 InstanceNode + VoteEngine），
 * 因此 VOTING / PENDING_CONCLUSION / TIE / 结论超时 这些状态与普通层级完全对称。
 */

export type EscalationEvent =
  | 'SUBMIT'
  | 'AUTO_START_VOTE'
  | 'SIGN'
  | 'SIGN_TIMEOUT'
  | 'VOTE_CAST'
  | 'ALL_STATED'
  | 'TIE'
  | 'DEADLOCK_TIMEOUT'
  | 'SUBMIT_CONCLUSION'
  | 'CONCLUSION_TIMEOUT'
  | 'UPGRADE'
  | 'WRITE_BACK'
  | 'CLOSE';

export const ESCALATION_EVENT_LABEL: Record<EscalationEvent, string> = {
  SUBMIT: '提交上报',
  AUTO_START_VOTE: '投递即开投',
  SIGN: '工号签收',
  SIGN_TIMEOUT: '签收超时',
  VOTE_CAST: '上级投票',
  ALL_STATED: '上级全员表态',
  TIE: '上级投票平票',
  DEADLOCK_TIMEOUT: '上级投票僵局',
  SUBMIT_CONCLUSION: '提交上级结论',
  CONCLUSION_TIMEOUT: '上级结论超时',
  UPGRADE: '继续上报上一级',
  WRITE_BACK: '结论回写原流程',
  CLOSE: '归档',
};

export type EscalationActionType =
  | 'SIGN'
  | 'START_VOTE'
  | 'NOTIFY_WORKNO'
  | 'NOTIFY_ADMIN'
  | 'QUALIFY_WORKNO'
  | 'WRITE_BACK'
  | 'UNFREEZE_INSTANCE'
  | 'REOPEN_SOURCE_NODE'
  | 'FINALIZE_INSTANCE'
  | 'FINALIZE_UPWARD_NODE'
  | 'APPEND_CHAIN'
  | 'WRITE_RECORD'
  | 'CLOSE_SOURCE';

export interface EscalationTransitionContext {
  status: EscalationStatus;
  /** 目标工号解析成功（否则 SUBMIT 应被拒绝） */
  targetResolved?: boolean;
  /** 承接模式：AUTO 投递即开投 / GRAB 需签收 / ASSIGNED 指定处理人 */
  acceptMode?: EscalationAcceptMode;
  /** 操作人是否目标工号成员 */
  isTargetWorkNoMember?: boolean;
  /** 是否具备 ESC_HANDLE 权限 */
  canHandle?: boolean;
  /** 当前层级 / 最高层级 */
  level?: number;
  maxLevel?: number;
  /** 上级投票是否平票且平票策略为上报 */
  tieEscalates?: boolean;
  /** 回写动作（上级结论） */
  writeBackAction?: WriteBackAction;
  /** 上级投票是否已全员表态 */
  allStated?: boolean;
}

export interface EscalationTransitionAccepted {
  ok: true;
  from: EscalationStatus;
  status: EscalationStatus;
  actions: EscalationActionType[];
  reason: string;
}

export interface EscalationTransitionRejected {
  ok: false;
  error: ErrorDef;
  reason: string;
}

export type EscalationTransitionResult = EscalationTransitionAccepted | EscalationTransitionRejected;

function accept(
  from: EscalationStatus,
  status: EscalationStatus,
  actions: EscalationActionType[],
  reason: string,
): EscalationTransitionAccepted {
  return { ok: true, from, status, actions, reason };
}

function reject(error: ErrorDef, reason: string): EscalationTransitionRejected {
  return { ok: false, error, reason };
}

function invalid(status: EscalationStatus, event: string): EscalationTransitionRejected {
  return reject(ERROR_CODES.ESC_INVALID_TRANSITION, `上报状态 ${status} 不允许事件 ${event}`);
}

export const ESCALATION_EVENT_TABLE: Record<EscalationStatus, EscalationEvent[]> = {
  PENDING: ['SUBMIT', 'CLOSE'],
  SUBMITTED: ['AUTO_START_VOTE', 'SIGN', 'SIGN_TIMEOUT', 'UPGRADE', 'CLOSE'],
  SIGNED: ['AUTO_START_VOTE', 'SIGN_TIMEOUT', 'UPGRADE', 'CLOSE'],
  VOTING: ['VOTE_CAST', 'ALL_STATED', 'TIE', 'DEADLOCK_TIMEOUT', 'UPGRADE', 'CLOSE'],
  PENDING_CONCLUSION: ['SUBMIT_CONCLUSION', 'CONCLUSION_TIMEOUT', 'UPGRADE', 'CLOSE'],
  ADOPTED: ['WRITE_BACK', 'CLOSE'],
  RETURNED: ['WRITE_BACK', 'CLOSE'],
  UPGRADED: ['AUTO_START_VOTE', 'SIGN', 'UPGRADE', 'CLOSE'],
  CLOSED: [],
};

export function allowedEscalationEvents(status: EscalationStatus): EscalationEvent[] {
  return [...ESCALATION_EVENT_TABLE[status]];
}

export function transitionEscalation(
  ctx: EscalationTransitionContext,
  event: EscalationEvent,
): EscalationTransitionResult {
  const from = ctx.status;

  switch (event) {
    case 'SUBMIT': {
      if (from !== 'PENDING') return invalid(from, event);
      if (ctx.targetResolved === false) {
        return reject(ERROR_CODES.ESC_WORKNO_MISSING, '上级部门工号未解析成功，不能提交上报');
      }
      return accept(from, 'SUBMITTED', ['NOTIFY_WORKNO', 'WRITE_RECORD'], '上报已投递到上级部门工号');
    }

    case 'AUTO_START_VOTE': {
      if (from !== 'SUBMITTED' && from !== 'SIGNED' && from !== 'UPGRADED') return invalid(from, event);
      return accept(from, 'VOTING', ['START_VOTE', 'QUALIFY_WORKNO', 'WRITE_RECORD'], '已创建上级投票节点并开投');
    }

    case 'SIGN': {
      if (from !== 'SUBMITTED' && from !== 'UPGRADED') return invalid(from, event);
      if (ctx.isTargetWorkNoMember !== true) {
        return reject(ERROR_CODES.PERM_DENIED, '只有目标工号成员可以签收');
      }
      if (ctx.canHandle === false) {
        return reject(ERROR_CODES.PERM_DENIED, '缺少 ESC_HANDLE 权限');
      }
      return accept(from, 'SIGNED', ['SIGN', 'WRITE_RECORD'], '该上报已被签收，同工号其他成员转只读');
    }

    case 'SIGN_TIMEOUT':
    case 'DEADLOCK_TIMEOUT':
    case 'CONCLUSION_TIMEOUT': {
      const allowed: EscalationStatus[] =
        event === 'SIGN_TIMEOUT'
          ? ['SUBMITTED', 'SIGNED']
          : event === 'DEADLOCK_TIMEOUT'
            ? ['VOTING']
            : ['PENDING_CONCLUSION'];
      if (!allowed.includes(from)) return invalid(from, event);
      return accept(from, 'UPGRADED', ['APPEND_CHAIN', 'WRITE_RECORD'], `${ESCALATION_EVENT_LABEL[event]}，上溯一级继续投票`);
    }

    case 'VOTE_CAST': {
      if (from !== 'VOTING') return invalid(from, event);
      return accept(from, 'VOTING', ['WRITE_RECORD'], '上级投票已记录');
    }

    case 'ALL_STATED': {
      if (from !== 'VOTING') return invalid(from, event);
      if (ctx.allStated === false) {
        return reject(ERROR_CODES.ESC_INVALID_TRANSITION, '上级投票尚未全员表态');
      }
      return accept(from, 'PENDING_CONCLUSION', ['WRITE_RECORD'], '上级已全员表态，等待工号填写结论');
    }

    case 'TIE': {
      if (from !== 'VOTING') return invalid(from, event);
      if (ctx.tieEscalates === false) {
        return reject(ERROR_CODES.ESC_INVALID_TRANSITION, '平票策略不是上报，不能按上溯处理');
      }
      return accept(from, 'UPGRADED', ['APPEND_CHAIN', 'WRITE_RECORD'], '上级投票平票，按策略继续上溯');
    }

    case 'SUBMIT_CONCLUSION': {
      if (from !== 'PENDING_CONCLUSION') return invalid(from, event);
      if (!ctx.writeBackAction) {
        return reject(ERROR_CODES.SYS_VALIDATION_FAILED, '上级结论必须给出回写动作');
      }
      const adopted = ctx.writeBackAction === 'CONTINUE' || ctx.writeBackAction.startsWith('FINAL_');
      return accept(
        from,
        adopted ? 'ADOPTED' : 'RETURNED',
        ['WRITE_RECORD'],
        adopted ? '上级结论已采纳' : '上级已退回原部门',
      );
    }

    case 'UPGRADE': {
      if (from !== 'VOTING' && from !== 'PENDING_CONCLUSION' && from !== 'SUBMITTED' && from !== 'SIGNED') {
        return invalid(from, event);
      }
      return accept(from, 'UPGRADED', ['APPEND_CHAIN', 'WRITE_RECORD'], '已上溯到更上一级部门工号');
    }

    case 'WRITE_BACK': {
      if (from !== 'ADOPTED' && from !== 'RETURNED') return invalid(from, event);
      const action = ctx.writeBackAction;
      if (!action) return reject(ERROR_CODES.SYS_VALIDATION_FAILED, '缺少回写动作');

      const actions: EscalationActionType[] = ['UNFREEZE_INSTANCE', 'FINALIZE_UPWARD_NODE', 'WRITE_BACK'];
      let reason: string;
      switch (action) {
        case 'CONTINUE':
          reason = '上级同意继续：解冻原流程并恢复投票';
          break;
        case 'RETURN':
          actions.push('REOPEN_SOURCE_NODE');
          reason = '上级退回：解冻原流程并重走本层投票';
          break;
        case 'REQUEST_MORE':
          reason = '上级要求补充材料：解冻原流程，补充任务由任务引擎派发';
          break;
        case 'FINAL_APPROVE':
        case 'FINAL_REJECT':
          actions.push('FINALIZE_INSTANCE');
          reason = action === 'FINAL_APPROVE' ? '上级终审通过：原流程直接定局通过' : '上级终审驳回：原流程直接驳回';
          break;
        default:
          return reject(ERROR_CODES.SYS_VALIDATION_FAILED, `未知回写动作：${String(action)}`);
      }
      return accept(from, 'CLOSED', actions, reason);
    }

    case 'CLOSE': {
      if (from === 'CLOSED') return invalid(from, event);
      return accept(from, 'CLOSED', ['CLOSE_SOURCE', 'WRITE_RECORD'], '上报已归档');
    }

    default:
      return invalid(from, String(event));
  }
}

/** 上级处理意见 → 回写动作（已确认 D8：不通过默认 RETURN，单人不裁定） */
export function writeBackFromOpinion(opinion: string): WriteBackAction | null {
  switch (opinion) {
    case 'CONTINUE':
      return 'CONTINUE';
    case 'RETURN':
      return 'RETURN';
    case 'REQUEST_MORE':
      return 'REQUEST_MORE';
    case 'FINAL_APPROVE':
      return 'FINAL_APPROVE';
    case 'FINAL_REJECT':
      return 'FINAL_REJECT';
    default:
      return null;
  }
}
