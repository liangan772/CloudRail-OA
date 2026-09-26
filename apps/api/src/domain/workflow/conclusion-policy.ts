import {
  ERROR_CODES,
  type ConclusionMode,
  type ConclusionStatus,
  type ErrorDef,
  type InstanceNodeStatus,
  type TallyResult,
  type VoteDecision,
} from '@oa/shared';

/**
 * 人工投票结论策略（纯函数，零 IO）。
 *
 * 已确认规则：
 * - 每层必须形成**人工投票结论**（默认 `MANUAL_CONFIRM`：确认或改判，改判须填理由）；
 * - 系统计票只产出**拟判定**（`VoteResult.isProvisional=true`），没有 `VoteConclusion` 不得推进流程；
 * - 结论填写人默认本部门工号主责人，无工号则回退部门负责人（由调用方解析后传 `canConclude`）；
 * - 结论填写超时 → 上报上级部门裁定（`CONCLUSION_TIMEOUT`），避免流程卡死。
 */

export interface ConclusionFailure {
  ok: false;
  error: ErrorDef;
  reason: string;
}

/* ---------------------------- 结论计划 ---------------------------- */

export interface ConclusionPlan {
  ok: true;
  /** 是否需要人工填写结论 */
  required: boolean;
  conclusionStatus: ConclusionStatus;
  /** 系统拟判定（一定是终局值：APPROVE / REJECT） */
  systemDecision: VoteDecision;
  /** `AUTO` 模式下系统直接落库的结论 */
  autoConclusion?: {
    source: 'SYSTEM_AUTO';
    decision: VoteDecision;
    systemDecision: VoteDecision;
    isOverride: false;
  };
  /** 提前算出的节点去向，便于调用方直接落库 */
  nodeStatus: Extract<InstanceNodeStatus, 'PASSED' | 'REJECTED'>;
  reason: string;
}

export type ConclusionPlanResult = ConclusionPlan | ConclusionFailure;

/**
 * 计票完成后（`readyForConclusion=true`）决定「要不要人填结论」。
 * 计票仍在 PENDING（池内未全员表态）时不允许进入结论阶段。
 */
export function planConclusion(mode: ConclusionMode, tally: TallyResult): ConclusionPlanResult {
  if (tally.systemDecision === 'PENDING' || !tally.readyForConclusion) {
    return {
      ok: false,
      error: ERROR_CODES.NODE_INVALID_TRANSITION,
      reason: `尚未具备出结论条件：${tally.reason}`,
    };
  }

  const systemDecision = tally.systemDecision;
  const nodeStatus: Extract<InstanceNodeStatus, 'PASSED' | 'REJECTED'> =
    systemDecision === 'APPROVE' ? 'PASSED' : 'REJECTED';

  if (mode === 'AUTO') {
    return {
      ok: true,
      required: false,
      conclusionStatus: 'NOT_REQUIRED',
      systemDecision,
      autoConclusion: {
        source: 'SYSTEM_AUTO',
        decision: systemDecision,
        systemDecision,
        isOverride: false,
      },
      nodeStatus,
      reason: `规则为系统判定即结论；${tally.reason}`,
    };
  }

  return {
    ok: true,
    required: true,
    conclusionStatus: 'PENDING',
    systemDecision,
    nodeStatus,
    reason: `已产出系统拟判定（${systemDecision}），等待人工结论${
      mode === 'MANUAL_OVERRIDE' ? '（可自由裁定）' : '（确认或改判）'
    }`,
  };
}

/* ---------------------------- 提交结论 ---------------------------- */

export interface SubmitConclusionInput {
  mode: ConclusionMode;
  /** 计票产出的系统拟判定 */
  systemDecision: VoteDecision;
  /** 结论人选择的判定 */
  decision: VoteDecision;
  /** 结论意见（必填） */
  content: string;
  /** 改判理由：与系统拟判定不一致时必填 */
  overrideReason?: string;
  /** 结论填写人（系统代填时为 null） */
  authorId?: number | null;
}

export interface ConclusionRecord {
  decision: VoteDecision;
  systemDecision: VoteDecision;
  isOverride: boolean;
  overrideReason?: string;
  content: string;
  source: 'MANUAL' | 'SYSTEM_FINAL';
  authorId: number | null;
}

export interface SubmitConclusionSuccess {
  ok: true;
  conclusion: ConclusionRecord;
  nodeStatus: Extract<InstanceNodeStatus, 'PASSED' | 'REJECTED'>;
  /** 人工结论是否与系统拟判定一致（前端用于高亮「改判」） */
  isOverride: boolean;
  reason: string;
}

export type SubmitConclusionResult = SubmitConclusionSuccess | ConclusionFailure;

export function submitConclusion(input: SubmitConclusionInput): SubmitConclusionResult {
  if (input.mode === 'AUTO') {
    return {
      ok: false,
      error: ERROR_CODES.SYS_VALIDATION_FAILED,
      reason: '本层规则为系统判定即结论，不接受人工提交',
    };
  }
  if (input.decision !== 'APPROVE' && input.decision !== 'REJECT') {
    return {
      ok: false,
      error: ERROR_CODES.SYS_VALIDATION_FAILED,
      reason: '结论只能是通过（APPROVE）或驳回（REJECT）',
    };
  }
  const content = input.content?.trim() ?? '';
  if (content.length === 0) {
    return {
      ok: false,
      error: ERROR_CODES.SYS_VALIDATION_FAILED,
      reason: '结论意见必填',
    };
  }

  const isOverride = input.decision !== input.systemDecision;
  const overrideReason = input.overrideReason?.trim();
  if (isOverride && !overrideReason) {
    return {
      ok: false,
      error: ERROR_CODES.VOTE_CONCLUSION_REASON_REQUIRED,
      reason: '改判系统判定必须填写理由',
    };
  }

  return {
    ok: true,
    conclusion: {
      decision: input.decision,
      systemDecision: input.systemDecision,
      isOverride,
      overrideReason: isOverride ? overrideReason : undefined,
      content,
      source: 'MANUAL',
      authorId: input.authorId ?? null,
    },
    nodeStatus: input.decision === 'APPROVE' ? 'PASSED' : 'REJECTED',
    isOverride,
    reason: isOverride
      ? `人工改判：系统拟判定 ${input.systemDecision} → ${input.decision}`
      : `人工确认系统拟判定 ${input.decision}`,
  };
}

/* ------------------------ 上级终审 / 结论超时 ------------------------ */

export type EscalationFinalOpinion = 'FINAL_APPROVE' | 'FINAL_REJECT';

export interface FinalConclusionSuccess {
  ok: true;
  conclusion: ConclusionRecord;
  nodeStatus: Extract<InstanceNodeStatus, 'PASSED' | 'REJECTED'>;
  /** 供 `Escalation.finalOpinion` 使用的回写动作 */
  writeBackAction: EscalationFinalOpinion;
  reason: string;
}

export type FinalConclusionResult = FinalConclusionSuccess | ConclusionFailure;

/**
 * 上级终审：上级部门用同一套投票机制投票并填写结论后，
 * 结论回写原流程 —— 终审直接定局，由系统代填一条 `isOverride=true` 的结论记录。
 */
export function finalConclusionFromEscalation(
  opinion: EscalationFinalOpinion,
  systemDecision: VoteDecision,
  content: string,
): FinalConclusionResult {
  const decision: VoteDecision = opinion === 'FINAL_APPROVE' ? 'APPROVE' : 'REJECT';
  const text = content?.trim() || (decision === 'APPROVE' ? '上级终审通过' : '上级终审驳回');

  return {
    ok: true,
    conclusion: {
      decision,
      systemDecision,
      isOverride: true,
      overrideReason: text,
      content: text,
      source: 'SYSTEM_FINAL',
      authorId: null,
    },
    nodeStatus: decision === 'APPROVE' ? 'PASSED' : 'REJECTED',
    writeBackAction: opinion,
    reason: `上级终审 ${opinion}，系统代填结论并回写原流程`,
  };
}

/**
 * 结论填写超时的处置：上报上级部门裁定（不自动通过、也不自动驳回）。
 */
export function conclusionTimeoutOutcome(conclusionAuthorId: number | null): {
  escalated: true;
  notifyUserIds: number[];
  reason: string;
} {
  return {
    escalated: true,
    notifyUserIds: conclusionAuthorId == null ? [] : [conclusionAuthorId],
    reason: '结论填写超时，上报上级部门裁定，避免流程卡死',
  };
}

/* ------------------------------ 只读投影 ------------------------------ */

/** 结论记录 → 前端展示口径（改判时同时给出系统拟判定，避免"为什么变了"说不清） */
export function describeConclusion(record: ConclusionRecord): string {
  const decisionText = record.decision === 'APPROVE' ? '通过' : '驳回';
  if (!record.isOverride) return `人工确认：${decisionText}（与系统拟判定一致）`;
  const systemText = record.systemDecision === 'APPROVE' ? '通过' : '驳回';
  return `改判：系统拟判定「${systemText}」→ 人工结论「${decisionText}」（理由：${
    record.overrideReason ?? '未填写'
  }）`;
}
