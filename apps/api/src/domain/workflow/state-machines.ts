import {
  ERROR_CODES,
  type ConclusionStatus,
  type ErrorDef,
  type InstanceNodeStatus,
  type InstanceStatus,
  type RevotePolicy,
  type TimeoutPolicy,
  type VoteDecision,
} from '@oa/shared';

/**
 * 流程实例 / 层级节点状态机（纯函数，零 IO）。
 *
 * 唯一口径：docs/stage-0/04-domain-model-draft.md §6.1（实例）与 §6.2（节点）。
 * 这里只负责「当前状态 + 事件 + 守卫条件 → 下一状态 + 副作用清单」，
 * 不碰数据库：副作用清单由调用方（领域服务）在同一事务里翻译成
 * AuditLog + OutboxEvent + WebSocket 广播（约束 C9）。
 */

/** 转移被守卫拒绝时返回的统一结构 */
export interface TransitionRejected {
  ok: false;
  error: ErrorDef;
  reason: string;
}

export interface TransitionAccepted<S, A extends string> {
  ok: true;
  from: S;
  status: S;
  actions: A[];
  reason: string;
}

export type TransitionResult<S, A extends string> =
  | TransitionAccepted<S, A>
  | TransitionRejected;

function accept<S, A extends string>(
  from: S,
  status: S,
  actions: A[],
  reason: string,
): TransitionAccepted<S, A> {
  return { ok: true, from, status, actions, reason };
}

function reject<S, A extends string>(
  error: ErrorDef,
  reason: string,
): TransitionResult<S, A> {
  return { ok: false, error, reason };
}

function invalid<S, A extends string>(
  status: S,
  event: string,
): TransitionResult<S, A> {
  return reject<S, A>(
    ERROR_CODES.NODE_INVALID_TRANSITION,
    `状态 ${status} 不允许事件 ${event}`,
  );
}

/* ------------------------------------------------------------------ *
 * 6.1 流程实例 WorkflowInstance
 * ------------------------------------------------------------------ */

export type InstanceEvent =
  | 'SUBMIT'
  | 'NODE_PASSED'
  | 'NODE_REJECTED'
  | 'ESCALATE'
  | 'RESUME'
  | 'FINAL_APPROVE'
  | 'FINAL_REJECT'
  | 'RETURN'
  | 'CLOSE'
  | 'SUSPEND'
  | 'WITHDRAW';

export const INSTANCE_EVENT_LABEL: Record<InstanceEvent, string> = {
  SUBMIT: '提交发起',
  NODE_PASSED: '本层通过',
  NODE_REJECTED: '本层驳回',
  ESCALATE: '上报',
  RESUME: '恢复',
  FINAL_APPROVE: '上级终审通过',
  FINAL_REJECT: '上级终审驳回',
  RETURN: '上级退回',
  CLOSE: '归档关闭',
  SUSPEND: '挂起',
  WITHDRAW: '发起人撤回',
};

export type InstanceAction =
  | 'CREATE_NODE'
  | 'SNAPSHOT_VOTERS'
  | 'SET_DEADLINE'
  | 'SCHEDULE_VOTE_TIMEOUT'
  | 'NOTIFY_VOTERS'
  | 'CREATE_TASKS'
  | 'SET_ENDED_AT'
  | 'NOTIFY_INITIATOR'
  | 'ARCHIVE_OUTBOX'
  | 'NOTIFY_SAME_LAYER'
  | 'CREATE_ESCALATION'
  | 'WRITE_SUSPENSION'
  | 'FREEZE_TASKS'
  | 'NOTIFY_TARGET_WORKNO'
  | 'UNFREEZE_TASKS'
  | 'RESTORE_CURRENT_NODE'
  | 'RECALC_DEADLINE'
  | 'RECORD_DECIDER'
  | 'NOTIFY_CHAIN'
  | 'REOPEN_LAYER'
  | 'SETTLE_STATS'
  | 'PAUSE_TIMER'
  | 'RESUME_TIMER'
  | 'VOID_PENDING_NODES';

/** 上级处理意见（Escalation 结论回写原流程） */
export type EscalationOpinion =
  | 'CONTINUE'
  | 'RETURN'
  | 'REQUEST_MORE'
  | 'FINAL_APPROVE'
  | 'FINAL_REJECT';

export interface InstanceTransitionContext {
  status: InstanceStatus;
  /** 模板版本已发布 */
  templatePublished?: boolean;
  /** 表单通过 schema 校验 */
  formValid?: boolean;
  /** 发起人具备 INSTANCE_CREATE 权限 */
  canCreate?: boolean;
  /** 当前层之后是否还有层 */
  hasNextLayer?: boolean;
  /** 上报触发是否命中（平票 / 超时 / 越限 / 争议等） */
  escalationTriggered?: boolean;
  /** 上级处理意见 */
  escalationOpinion?: EscalationOpinion;
  /** 退回深度：true=回到原层继续投票，false=直接驳回 */
  returnToLayer?: boolean;
  /** 是否存在已生效的投票结论（撤回守卫：不允许） */
  hasEffectiveConclusion?: boolean;
  /** 挂起前状态（SUSPENDED → RESUME 用） */
  suspendedFrom?: Exclude<InstanceStatus, 'SUSPENDED'>;
  /** 操作人是否有权限（挂起 / 撤回） */
  canOperate?: boolean;
}

export const INSTANCE_EVENT_TABLE: Record<InstanceStatus, InstanceEvent[]> = {
  DRAFT: ['SUBMIT'],
  VOTING: ['NODE_PASSED', 'NODE_REJECTED', 'ESCALATE', 'SUSPEND', 'WITHDRAW'],
  APPROVED: ['CLOSE'],
  REJECTED: ['CLOSE'],
  ESCALATED: ['RESUME', 'FINAL_APPROVE', 'FINAL_REJECT', 'RETURN', 'SUSPEND'],
  SUSPENDED: ['RESUME'],
  CLOSED: [],
};

export function allowedInstanceEvents(status: InstanceStatus): InstanceEvent[] {
  return [...INSTANCE_EVENT_TABLE[status]];
}

/**
 * 实例状态转移。
 *
 * 注意 `RESUME` 的歧义：`ESCALATED --RESUME--> VOTING`（上级结论 CONTINUE）
 * 与 `SUSPENDED --RESUME--> 冻结前状态` 是两条不同规则，按当前状态分流。
 */
export function transitionInstance(
  ctx: InstanceTransitionContext,
  event: InstanceEvent,
): TransitionResult<InstanceStatus, InstanceAction> {
  const from = ctx.status;

  switch (event) {
    case 'SUBMIT': {
      if (from !== 'DRAFT') return invalid(from, event);
      if (ctx.templatePublished === false) {
        return reject(ERROR_CODES.WF_VERSION_NOT_PUBLISHED, '模板版本未发布，不能用于发起');
      }
      if (ctx.formValid === false) {
        return reject(ERROR_CODES.WF_FORM_SCHEMA_INVALID, '表单数据未通过校验');
      }
      if (ctx.canCreate === false) {
        return reject(ERROR_CODES.PERM_DENIED, '发起人缺少 INSTANCE_CREATE 权限');
      }
      return accept(from, 'VOTING', [
        'CREATE_NODE',
        'SNAPSHOT_VOTERS',
        'SET_DEADLINE',
        'SCHEDULE_VOTE_TIMEOUT',
        'NOTIFY_VOTERS',
      ], '首层节点已创建并快照投票人');
    }

    case 'NODE_PASSED': {
      if (from !== 'VOTING') return invalid(from, event);
      if (ctx.hasNextLayer) {
        return accept(from, 'VOTING', [
          'CREATE_NODE',
          'SNAPSHOT_VOTERS',
          'SET_DEADLINE',
          'SCHEDULE_VOTE_TIMEOUT',
          'CREATE_TASKS',
          'NOTIFY_VOTERS',
        ], '存在下一层：创建下一层节点并按模板派生任务');
      }
      return accept(from, 'APPROVED', [
        'SET_ENDED_AT',
        'NOTIFY_INITIATOR',
        'ARCHIVE_OUTBOX',
      ], '最后一层通过，流程置为已通过');
    }

    case 'NODE_REJECTED': {
      if (from !== 'VOTING') return invalid(from, event);
      if (ctx.escalationTriggered) {
        return accept(from, 'ESCALATED', [
          'CREATE_ESCALATION',
          'WRITE_SUSPENSION',
          'FREEZE_TASKS',
          'NOTIFY_TARGET_WORKNO',
        ], '驳回即上报规则命中，转上级部门');
      }
      return accept(from, 'REJECTED', [
        'SET_ENDED_AT',
        'NOTIFY_INITIATOR',
        'NOTIFY_SAME_LAYER',
      ], '本层驳回，流程置为已驳回');
    }

    case 'ESCALATE': {
      if (from !== 'VOTING') return invalid(from, event);
      if (!ctx.escalationTriggered) {
        return reject(ERROR_CODES.ESC_INVALID_TRANSITION, '未命中任何上报触发源');
      }
      return accept(from, 'ESCALATED', [
        'CREATE_ESCALATION',
        'WRITE_SUSPENSION',
        'FREEZE_TASKS',
        'NOTIFY_TARGET_WORKNO',
      ], '上报已创建，原流程冻结');
    }

    case 'RESUME': {
      if (from === 'SUSPENDED') {
        const back = ctx.suspendedFrom ?? 'VOTING';
        return accept(from, back, ['RESUME_TIMER', 'RESTORE_CURRENT_NODE'], '解除挂起，恢复冻结前状态');
      }
      if (from !== 'ESCALATED') return invalid(from, event);
      if (ctx.escalationOpinion !== 'CONTINUE') {
        return reject(ERROR_CODES.ESC_INVALID_TRANSITION, '上级结论不是 CONTINUE，不能直接恢复投票');
      }
      return accept(from, 'VOTING', [
        'UNFREEZE_TASKS',
        'RESTORE_CURRENT_NODE',
        'RECALC_DEADLINE',
      ], '上级意见为继续，解冻并恢复投票');
    }

    case 'FINAL_APPROVE':
    case 'FINAL_REJECT': {
      if (from !== 'ESCALATED') return invalid(from, event);
      const expected: EscalationOpinion = event === 'FINAL_APPROVE' ? 'FINAL_APPROVE' : 'FINAL_REJECT';
      if (ctx.escalationOpinion !== expected) {
        return reject(ERROR_CODES.ESC_INVALID_TRANSITION, `上级结论不是 ${expected}`);
      }
      return accept(from, event === 'FINAL_APPROVE' ? 'APPROVED' : 'REJECTED', [
        'RECORD_DECIDER',
        'SET_ENDED_AT',
        'UNFREEZE_TASKS',
        'NOTIFY_CHAIN',
      ], '上级终审已回写原流程');
    }

    case 'RETURN': {
      if (from !== 'ESCALATED') return invalid(from, event);
      const opinion = ctx.escalationOpinion;
      if (opinion !== 'RETURN' && opinion !== 'REQUEST_MORE') {
        return reject(ERROR_CODES.ESC_INVALID_TRANSITION, '上级结论不是退回 / 要求补充');
      }
      if (opinion === 'RETURN' && ctx.returnToLayer) {
        return accept(from, 'VOTING', [
          'UNFREEZE_TASKS',
          'REOPEN_LAYER',
          'RECALC_DEADLINE',
          'NOTIFY_VOTERS',
        ], '按退回深度回到原层重走本层投票');
      }
      return accept(from, 'REJECTED', [
        'SET_ENDED_AT',
        'UNFREEZE_TASKS',
        'NOTIFY_INITIATOR',
      ], opinion === 'RETURN' ? '退回深度已到底，直接驳回' : '要求补充材料，按补充失败处理');
    }

    case 'CLOSE': {
      if (from !== 'APPROVED' && from !== 'REJECTED') return invalid(from, event);
      return accept(from, 'CLOSED', ['SETTLE_STATS', 'NOTIFY_CHAIN'], '流程归档关闭');
    }

    case 'SUSPEND': {
      if (from !== 'VOTING' && from !== 'ESCALATED') return invalid(from, event);
      if (ctx.canOperate === false) {
        return reject(ERROR_CODES.PERM_DENIED, '无权挂起该流程');
      }
      return accept(from, 'SUSPENDED', ['PAUSE_TIMER', 'WRITE_SUSPENSION'], '流程已挂起并暂停计时');
    }

    case 'WITHDRAW': {
      if (from !== 'VOTING') return invalid(from, event);
      if (ctx.canOperate === false) {
        return reject(ERROR_CODES.PERM_DENIED, '仅发起人本人可撤回');
      }
      if (ctx.hasEffectiveConclusion) {
        return reject(ERROR_CODES.VOTE_CLOSED, '已有生效投票结论，不能撤回');
      }
      return accept(from, 'CLOSED', [
        'VOID_PENDING_NODES',
        'SET_ENDED_AT',
        'NOTIFY_SAME_LAYER',
      ], '发起人撤回，未完成的投票节点作废');
    }

    default:
      return invalid(from, String(event));
  }
}

/* ------------------------------------------------------------------ *
 * 6.2 层级节点 InstanceNode
 * ------------------------------------------------------------------ */

export type NodeEvent =
  | 'OPEN'
  | 'VOTE_CAST'
  | 'VETO_LOCK'
  | 'VETO_TERMINATE'
  | 'ALL_STATED'
  | 'MARK_ABSENT'
  | 'REVOKE_ABSENT'
  | 'DEADLINE_HIT'
  | 'APPLY_POLICY'
  | 'ESCALATE'
  | 'SUBMIT_CONCLUSION'
  | 'CONCLUSION_TIMEOUT'
  | 'RESUME'
  | 'FINAL'
  | 'SKIP'
  | 'COMPLETE';

export const NODE_EVENT_LABEL: Record<NodeEvent, string> = {
  OPEN: '开启投票',
  VOTE_CAST: '投票 / 改票',
  VETO_LOCK: '否决锁定',
  VETO_TERMINATE: '否决立即终结',
  ALL_STATED: '池内全员表态',
  MARK_ABSENT: '标记缺席',
  REVOKE_ABSENT: '撤销缺席',
  DEADLINE_HIT: '到达截止时间',
  APPLY_POLICY: '应用超时策略',
  ESCALATE: '上报',
  SUBMIT_CONCLUSION: '提交人工结论',
  CONCLUSION_TIMEOUT: '结论填写超时',
  RESUME: '上级结论为继续',
  FINAL: '上级终审',
  SKIP: '跳过节点',
  COMPLETE: '节点完结',
};

export type NodeAction =
  | 'CREATE_NODE_VOTERS'
  | 'SET_STARTED_AT'
  | 'SET_DEADLINE'
  | 'SCHEDULE_VOTE_TIMEOUT'
  | 'NOTIFY_VOTERS'
  | 'INSERT_VOTE'
  | 'REPLACE_OLD_VOTE'
  | 'RECALC_PROGRESS'
  | 'BROADCAST_VOTE_CAST'
  | 'SET_VETO_LOCKED'
  | 'NOTIFY_CONCLUSION_AUTHOR'
  | 'WRITE_PROVISIONAL_RESULT'
  | 'SET_CONCLUSION_PENDING'
  | 'SCHEDULE_CONCLUSION_TIMEOUT'
  | 'BROADCAST_CONCLUSION_PENDING'
  | 'MARK_VOTER_ABSENT'
  | 'RECALC_POOL'
  | 'RESTORE_VOTER_PENDING'
  | 'STOP_TIMER'
  | 'RECORD_UNSTATED_VOTERS'
  | 'RESET_DEADLINE'
  | 'INCREMENT_REMIND'
  | 'NOTIFY_REMIND'
  | 'FORCE_ESCALATE'
  | 'CREATE_ESCALATION'
  | 'PAUSE_TIMER'
  | 'WRITE_CONCLUSION'
  | 'FINALIZE_RESULT'
  | 'CANCEL_CONCLUSION_TIMEOUT'
  | 'BROADCAST_CONCLUSION_SUBMITTED'
  | 'CREATE_TASKS'
  | 'ADVANCE_INSTANCE'
  | 'RESUME_TIMER'
  | 'WRITE_FINAL_RESULT'
  | 'SYSTEM_CONCLUSION'
  | 'RECORD_SKIP_REASON'
  | 'COMPLETE_NODE'
  | 'WRITE_AUDIT';

export interface NodeTransitionContext {
  status: InstanceNodeStatus;
  /** 是否首层 */
  isFirstLayer?: boolean;
  /** 上一层是否已 DONE */
  prevNodeDone?: boolean;
  /** 快照投票人数（0 → NODE_VOTER_EMPTY） */
  voterCount?: number;
  /** 操作人是否在快照名单内 */
  isVoter?: boolean;
  /** 改票策略 */
  revotePolicy?: RevotePolicy;
  /** 该投票人本轮已改票次数（ONCE 守卫用） */
  revoteCount?: number;
  /** 本轮是否已形成结论 */
  conclusionFormed?: boolean;
  /** 截止时间是否已过 */
  deadlinePassed?: boolean;
  /** 是否仍有池内成员未表态 */
  hasUnstatedVoters?: boolean;
  /** 是否已命中否决规则（锁定不予通过） */
  vetoLocked?: boolean;
  /** 一票否决是否立即终结投票（默认 false，见已确认规则 A5） */
  vetoTerminates?: boolean;
  /** 已催办轮次 */
  remindCount?: number;
  /** 最大催办轮次（默认 3） */
  maxRemindRounds?: number;
  /** 超时策略 */
  timeoutPolicy?: TimeoutPolicy;
  /** 租户是否允许自动通过（默认禁用） */
  allowAutoApprove?: boolean;
  /** 操作人具备 VOTE_MARK_ABSENT 权限 */
  canMarkAbsent?: boolean;
  /** 缺席理由已填写 */
  absentReasonProvided?: boolean;
  /** 被标记缺席者存在有效委托（守卫拒绝） */
  hasActiveDelegation?: boolean;
  /** 标记缺席后池内人数低于 minQuorum */
  absentBreaksQuorum?: boolean;
  /** 标记缺席后池内满足全员表态 */
  allStatedAfterAbsent?: boolean;
  /** 操作人具备 NODE_CONCLUDE 权限 */
  canConclude?: boolean;
  /** 人工结论结论值 */
  conclusionDecision?: VoteDecision;
  /** 上级终审结论 */
  finalDecision?: 'APPROVE' | 'REJECT';
  /** 条件分支未命中或被配置跳过时的原因 */
  skipReason?: string;
  /** 相关任务是否已创建（COMPLETE 守卫） */
  tasksCreated?: boolean;
}

export const NODE_EVENT_TABLE: Record<InstanceNodeStatus, NodeEvent[]> = {
  PENDING: ['OPEN', 'SKIP'],
  VOTING: [
    'VOTE_CAST',
    'VETO_LOCK',
    'VETO_TERMINATE',
    'ALL_STATED',
    'MARK_ABSENT',
    'REVOKE_ABSENT',
    'DEADLINE_HIT',
    'ESCALATE',
    'SKIP',
  ],
  PENDING_CONCLUSION: ['SUBMIT_CONCLUSION', 'CONCLUSION_TIMEOUT', 'SKIP'],
  PASSED: ['COMPLETE'],
  REJECTED: ['COMPLETE'],
  TIMEOUT: ['APPLY_POLICY', 'ESCALATE', 'SKIP'],
  ESCALATED: ['RESUME', 'FINAL', 'SKIP'],
  SKIPPED: ['COMPLETE'],
  DONE: [],
};

export function allowedNodeEvents(status: InstanceNodeStatus): NodeEvent[] {
  return [...NODE_EVENT_TABLE[status]];
}

/**
 * 节点状态转移。
 *
 * 三条硬约束落在守卫里（阶段 0 已冻结）：
 * - 必须表态且不允许弃权：`VOTE_CAST` 只接受 APPROVE / REJECT；
 * - 全员表态才出结论：`ALL_STATED` 要求池内无未表态人（`hasUnstatedVoters=false`）；
 * - 缺席不算票也不入池：`MARK_ABSENT` 后重算池，跌破法定人数立即上报。
 */
export function transitionNode(
  ctx: NodeTransitionContext,
  event: NodeEvent,
): TransitionResult<InstanceNodeStatus, NodeAction> {
  const from = ctx.status;

  switch (event) {
    case 'OPEN': {
      if (from !== 'PENDING') return invalid(from, event);
      const ready = ctx.isFirstLayer === true || ctx.prevNodeDone === true;
      if (!ready) {
        return reject(ERROR_CODES.NODE_INVALID_TRANSITION, '上一层尚未完成，本层不能开启');
      }
      if (ctx.voterCount === 0) {
        return reject(ERROR_CODES.NODE_VOTER_EMPTY, '投票人解析结果为空，请检查投票人规则');
      }
      return accept(from, 'VOTING', [
        'CREATE_NODE_VOTERS',
        'SET_STARTED_AT',
        'SET_DEADLINE',
        'SCHEDULE_VOTE_TIMEOUT',
        'NOTIFY_VOTERS',
      ], `本层开启，应投票 ${ctx.voterCount ?? 0} 人`);
    }

    case 'VOTE_CAST': {
      // 已经出结论（待填结论 / 已通过 / 已驳回）时给更准确的 VOTE_CLOSED，
      // 只有还没开启等真正"状态不对"的情况才报 NODE_INVALID_TRANSITION
      if (from !== 'VOTING') {
        const alreadyConcluded =
          from === 'PENDING_CONCLUSION' || from === 'PASSED' || from === 'REJECTED' || ctx.conclusionFormed === true;
        if (alreadyConcluded) {
          return reject(ERROR_CODES.VOTE_CLOSED, '本层已形成结论，不能再投票或改票');
        }
        return invalid(from, event);
      }
      if (ctx.isVoter === false) {
        return reject(ERROR_CODES.VOTE_NOT_VOTER, '操作人不在本层投票人快照名单内');
      }
      if (ctx.conclusionFormed) {
        return reject(ERROR_CODES.VOTE_CLOSED, '本层已形成结论，不能再投票或改票');
      }
      if (ctx.deadlinePassed) {
        return reject(ERROR_CODES.VOTE_EXPIRED, '已超过投票截止时间');
      }
      if (ctx.conclusionDecision === 'ABSTAIN') {
        return reject(ERROR_CODES.VOTE_ABSTAIN_NOT_ALLOWED, '本层要求必须表态，不允许弃权');
      }
      const isRevote = (ctx.revoteCount ?? 0) > 0;
      if (isRevote && ctx.revotePolicy === 'NOT_ALLOWED') {
        return reject(ERROR_CODES.VOTE_REVOTE_NOT_ALLOWED, '本层不允许改票');
      }
      if (isRevote && ctx.revotePolicy === 'ONCE' && (ctx.revoteCount ?? 0) >= 2) {
        return reject(ERROR_CODES.VOTE_REVOTE_NOT_ALLOWED, '本层仅允许改票一次');
      }
      const actions: NodeAction[] = ['INSERT_VOTE', 'RECALC_PROGRESS', 'BROADCAST_VOTE_CAST'];
      if (isRevote) actions.unshift('REPLACE_OLD_VOTE');
      return accept(from, 'VOTING', actions, isRevote ? '改票已记录，旧票标记 isReplaced' : '投票已记录');
    }

    case 'VETO_LOCK': {
      if (from !== 'VOTING') return invalid(from, event);
      return accept(from, 'VOTING', [
        'SET_VETO_LOCKED',
        'NOTIFY_CONCLUSION_AUTHOR',
      ], '否决规则命中，锁定为不予通过，但仍等待池内全员表态');
    }

    /**
     * 否决立即终结：只有节点规则显式开启 `vetoTerminates` 才允许（默认关闭）。
     * 已确认规则 A5 要求「一票否决只锁定不予通过，仍等全员表态」，
     * 所以默认路径是 VETO_LOCK；这条事件是给少数"必须立刻停"的场景留的开关。
     */
    case 'VETO_TERMINATE': {
      if (from !== 'VOTING') return invalid(from, event);
      if (!ctx.vetoTerminates) {
        return reject(
          ERROR_CODES.NODE_INVALID_TRANSITION,
          '本层未开启「否决立即终结」（默认仍等池内全员表态）',
        );
      }
      if (!ctx.vetoLocked) {
        return reject(ERROR_CODES.NODE_INVALID_TRANSITION, '尚未命中否决规则，不能按否决终结');
      }
      return accept(from, 'PENDING_CONCLUSION', [
        'SET_VETO_LOCKED',
        'WRITE_PROVISIONAL_RESULT',
        'SET_CONCLUSION_PENDING',
        'SCHEDULE_CONCLUSION_TIMEOUT',
        'NOTIFY_CONCLUSION_AUTHOR',
        'BROADCAST_CONCLUSION_PENDING',
      ], '否决立即终结：锁定不予通过并直接进入结论阶段');
    }

    case 'ALL_STATED': {
      if (from !== 'VOTING') return invalid(from, event);
      if (ctx.hasUnstatedVoters) {
        return reject(ERROR_CODES.NODE_INVALID_TRANSITION, '池内仍有成员未表态，不能进入结论阶段');
      }
      return accept(from, 'PENDING_CONCLUSION', [
        'WRITE_PROVISIONAL_RESULT',
        'SET_CONCLUSION_PENDING',
        'SCHEDULE_CONCLUSION_TIMEOUT',
        'NOTIFY_CONCLUSION_AUTHOR',
        'BROADCAST_CONCLUSION_PENDING',
      ], '池内全员已表态，产出系统拟判定并等待人工结论');
    }

    case 'MARK_ABSENT': {
      if (from !== 'VOTING') return invalid(from, event);
      if (ctx.canMarkAbsent === false) {
        return reject(ERROR_CODES.PERM_DENIED, '缺少 VOTE_MARK_ABSENT 权限');
      }
      if (ctx.conclusionFormed) {
        return reject(ERROR_CODES.VOTE_CLOSED, '结论已形成，不能再调整投票池');
      }
      if (!ctx.absentReasonProvided) {
        return reject(ERROR_CODES.SYS_VALIDATION_FAILED, '标记缺席必须填写理由');
      }
      if (ctx.hasActiveDelegation) {
        return reject(ERROR_CODES.NODE_INVALID_TRANSITION, '被标记人存在有效委托，应由受托人表态');
      }
      const actions: NodeAction[] = ['MARK_VOTER_ABSENT', 'RECALC_POOL', 'WRITE_AUDIT'];
      if (ctx.absentBreaksQuorum) {
        actions.push('CREATE_ESCALATION', 'PAUSE_TIMER');
        return accept(from, 'ESCALATED', actions, '缺席后池内人数低于法定人数，本层不得通过，直接上报');
      }
      if (ctx.allStatedAfterAbsent) {
        actions.push('WRITE_PROVISIONAL_RESULT', 'SET_CONCLUSION_PENDING', 'SCHEDULE_CONCLUSION_TIMEOUT');
        return accept(from, 'PENDING_CONCLUSION', actions, '缺席剔除后池内已全员表态，直接进入结论阶段');
      }
      return accept(from, 'VOTING', actions, '缺席者已剔除出投票池，分母与权重同步重算');
    }

    case 'REVOKE_ABSENT': {
      if (from !== 'VOTING') return invalid(from, event);
      if (ctx.conclusionFormed) {
        return reject(ERROR_CODES.VOTE_CLOSED, '结论已形成，不能再调整投票池');
      }
      if (ctx.canMarkAbsent === false) {
        return reject(ERROR_CODES.PERM_DENIED, '缺少撤销缺席的权限');
      }
      return accept(from, 'VOTING', [
        'RESTORE_VOTER_PENDING',
        'RECALC_POOL',
        'WRITE_AUDIT',
      ], '缺席标记已撤销，投票池恢复并保留撤销痕迹');
    }

    case 'DEADLINE_HIT': {
      if (from !== 'VOTING') return invalid(from, event);
      if (!ctx.hasUnstatedVoters) {
        return reject(ERROR_CODES.NODE_INVALID_TRANSITION, '池内已全员表态，无需按超时处理');
      }
      return accept(from, 'TIMEOUT', [
        'STOP_TIMER',
        'RECORD_UNSTATED_VOTERS',
        'NOTIFY_CONCLUSION_AUTHOR',
      ], '投票截止，记录未表态名单');
    }

    case 'APPLY_POLICY': {
      if (from !== 'TIMEOUT') return invalid(from, event);
      const policy = ctx.timeoutPolicy ?? 'REMIND_ONLY';
      switch (policy) {
        case 'REMIND_ONLY': {
          const rounds = ctx.remindCount ?? 0;
          const max = ctx.maxRemindRounds ?? 3;
          if (rounds < max) {
            return accept(from, 'VOTING', [
              'RESET_DEADLINE',
              'INCREMENT_REMIND',
              'NOTIFY_VOTERS',
            ], `第 ${rounds + 1}/${max} 轮催办，重设截止时间`);
          }
          return accept(from, 'ESCALATED', [
            'FORCE_ESCALATE',
            'CREATE_ESCALATION',
            'PAUSE_TIMER',
          ], `催办已达 ${max} 轮仍未全员表态，强制上报`);
        }
        case 'AUTO_REJECT':
          return accept(from, 'PENDING_CONCLUSION', [
            'WRITE_PROVISIONAL_RESULT',
            'SET_CONCLUSION_PENDING',
            'SCHEDULE_CONCLUSION_TIMEOUT',
          ], '超时策略为「未表态视为反对」，转入结论阶段');
        case 'AUTO_APPROVE': {
          if (!ctx.allowAutoApprove) {
            return reject(ERROR_CODES.NODE_INVALID_TRANSITION, '租户未开启自动通过（默认禁用）');
          }
          return accept(from, 'PENDING_CONCLUSION', [
            'WRITE_PROVISIONAL_RESULT',
            'SET_CONCLUSION_PENDING',
            'SCHEDULE_CONCLUSION_TIMEOUT',
          ], '超时策略为「未表态视为同意」，转入结论阶段');
        }
        case 'ESCALATE':
        default:
          return accept(from, 'ESCALATED', [
            'CREATE_ESCALATION',
            'PAUSE_TIMER',
          ], '超时策略为直接上报，转上级部门');
      }
    }

    case 'ESCALATE': {
      if (from !== 'VOTING' && from !== 'TIMEOUT') return invalid(from, event);
      return accept(from, 'ESCALATED', [
        'CREATE_ESCALATION',
        'PAUSE_TIMER',
      ], '上报已创建，节点暂停计时');
    }

    case 'SUBMIT_CONCLUSION': {
      if (from !== 'PENDING_CONCLUSION') return invalid(from, event);
      if (ctx.canConclude === false) {
        return reject(ERROR_CODES.VOTE_CONCLUSION_AUTHOR_REQUIRED, '操作人不是本层结论填写人');
      }
      const decision = ctx.conclusionDecision;
      if (decision !== 'APPROVE' && decision !== 'REJECT') {
        return reject(ERROR_CODES.SYS_VALIDATION_FAILED, '结论只能是通过或驳回');
      }
      const next: InstanceNodeStatus = decision === 'APPROVE' ? 'PASSED' : 'REJECTED';
      return accept(from, next, [
        'WRITE_CONCLUSION',
        'FINALIZE_RESULT',
        'CANCEL_CONCLUSION_TIMEOUT',
        'BROADCAST_CONCLUSION_SUBMITTED',
        'CREATE_TASKS',
        'ADVANCE_INSTANCE',
      ], decision === 'APPROVE' ? '人工结论为通过' : '人工结论为驳回');
    }

    case 'CONCLUSION_TIMEOUT': {
      if (from !== 'PENDING_CONCLUSION') return invalid(from, event);
      return accept(from, 'ESCALATED', [
        'CREATE_ESCALATION',
        'PAUSE_TIMER',
        'NOTIFY_CONCLUSION_AUTHOR',
      ], '结论填写超时，上报上级部门裁定');
    }

    case 'RESUME': {
      if (from !== 'ESCALATED') return invalid(from, event);
      return accept(from, 'VOTING', [
        'RESUME_TIMER',
        'SET_DEADLINE',
        'SCHEDULE_VOTE_TIMEOUT',
        'NOTIFY_VOTERS',
      ], '上级结论为继续，本层重开投票');
    }

    case 'FINAL': {
      if (from !== 'ESCALATED') return invalid(from, event);
      const decision = ctx.finalDecision;
      if (decision !== 'APPROVE' && decision !== 'REJECT') {
        return reject(ERROR_CODES.SYS_VALIDATION_FAILED, '上级终审结论必须是 APPROVE 或 REJECT');
      }
      return accept(from, decision === 'APPROVE' ? 'PASSED' : 'REJECTED', [
        'WRITE_FINAL_RESULT',
        'SYSTEM_CONCLUSION',
        'CANCEL_CONCLUSION_TIMEOUT',
        'CREATE_TASKS',
        'ADVANCE_INSTANCE',
      ], '上级终审已生效，代填系统结论');
    }

    case 'SKIP': {
      if (from === 'DONE' || from === 'PASSED' || from === 'REJECTED') {
        return invalid(from, event);
      }
      if (!ctx.skipReason) {
        return reject(ERROR_CODES.SYS_VALIDATION_FAILED, '跳过节点必须填写原因');
      }
      return accept(from, 'SKIPPED', ['RECORD_SKIP_REASON', 'WRITE_AUDIT'], '节点已跳过');
    }

    case 'COMPLETE': {
      if (from !== 'PASSED' && from !== 'REJECTED' && from !== 'TIMEOUT' && from !== 'SKIPPED') {
        return invalid(from, event);
      }
      if (from === 'TIMEOUT') {
        return reject(ERROR_CODES.NODE_INVALID_TRANSITION, '超时节点必须先应用超时策略再完结');
      }
      if (ctx.tasksCreated === false) {
        return reject(ERROR_CODES.NODE_INVALID_TRANSITION, '相关任务尚未创建，节点不能完结');
      }
      return accept(from, 'DONE', ['COMPLETE_NODE', 'ADVANCE_INSTANCE'], '节点完结，推进流程实例');
    }

    default:
      return invalid(from, String(event));
  }
}

/* ------------------------------------------------------------------ *
 * 节点 → 实例的联动
 * ------------------------------------------------------------------ */

/**
 * 节点完结后应推给实例的事件。
 * ABANDONED（TIMEOUT 未消解）不在此列——超时策略已在 APPLY_POLICY 里决定去向。
 */
export function instanceEventForNode(nodeStatus: InstanceNodeStatus): InstanceEvent | null {
  switch (nodeStatus) {
    case 'PASSED':
      return 'NODE_PASSED';
    case 'REJECTED':
      return 'NODE_REJECTED';
    case 'ESCALATED':
      return 'ESCALATE';
    default:
      return null;
  }
}

/** 结论状态推导：只有「无需人工结论」的模式才可能 NOT_REQUIRED */
export function conclusionStatusForMode(requiresManualConclusion: boolean): ConclusionStatus {
  return requiresManualConclusion ? 'PENDING' : 'NOT_REQUIRED';
}
