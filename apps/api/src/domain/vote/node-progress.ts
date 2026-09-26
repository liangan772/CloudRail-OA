import type { TallyInput, TallyResult } from '@oa/shared';
import { tally } from './tally';

/**
 * 「计票 → 该施加哪个节点事件」的判定（纯函数，零 IO）。
 *
 * 把 VoteEngine（算票）与 NodeStateMachine（改状态）之间的粘合逻辑单独拿出来，
 * 因为它才是投票接口每次都要走的分支：什么时候只是记一票、什么时候置否决锁定、
 * 什么时候进结论阶段、什么时候因法定人数不足直接上报。
 *
 * 返回的 `events` 是**有序**的节点事件列表，调用方按顺序逐个施加即可。
 */

export type NodeProgressEvent = 'VETO_LOCK' | 'VETO_TERMINATE' | 'ALL_STATED' | 'ESCALATE';

export interface NodeProgressDecision {
  tally: TallyResult;
  events: NodeProgressEvent[];
  allStated: boolean;
  vetoLocked: boolean;
  readyForConclusion: boolean;
  reason: string;
}

export function decideNodeProgress(state: TallyInput): NodeProgressDecision {
  const result = tally(state);
  const allStated = result.statedCount >= result.pool.pool;
  const events: NodeProgressEvent[] = [];
  const notes: string[] = [result.reason];

  // 1) 法定人数不足：本层不得通过，直接上报（已确认规则 A9）
  if (!result.pool.quorumSatisfied) {
    return {
      tally: result,
      events: ['ESCALATE'],
      allStated,
      vetoLocked: result.vetoLocked,
      readyForConclusion: result.readyForConclusion,
      reason: result.reason,
    };
  }

  // 2) 否决规则命中
  if (result.vetoLocked) {
    if (state.rule.vetoTerminates) {
      events.push('VETO_TERMINATE');
      notes.push('本层开启否决立即终结，锁定不予通过并直接进入结论阶段');
      return {
        tally: result,
        events,
        allStated,
        vetoLocked: true,
        readyForConclusion: result.readyForConclusion,
        reason: notes.join('；'),
      };
    }
    events.push('VETO_LOCK');
    notes.push('已锁定不予通过，仍等待池内其余成员表态');
  }

  // 3) 池内全员表态 → 进入结论阶段（结论仍需人工确认或改判）
  if (allStated && result.readyForConclusion) {
    events.push('ALL_STATED');
  }

  return {
    tally: result,
    events,
    allStated,
    vetoLocked: result.vetoLocked,
    readyForConclusion: result.readyForConclusion,
    reason: notes.join('；'),
  };
}
