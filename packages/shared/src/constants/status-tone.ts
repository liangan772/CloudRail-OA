/**
 * 状态 → 语义色（唯一事实来源，前端不再各写一套）
 * tone 对应 Tailwind 语义：success / info / warning / danger / neutral
 */

export type Tone = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

export const STATUS_TONE: Record<string, Tone> = {
  // 模板 / 实例
  DRAFT: 'neutral',
  PUBLISHED: 'success',
  ARCHIVED: 'neutral',
  VOTING: 'info',
  APPROVED: 'success',
  REJECTED: 'danger',
  ESCALATED: 'warning',
  SUSPENDED: 'warning',
  CLOSED: 'neutral',
  // 节点
  PENDING: 'warning',
  PENDING_CONCLUSION: 'info',
  PASSED: 'success',
  TIMEOUT: 'warning',
  SKIPPED: 'neutral',
  DONE: 'success',
  // 投票人 / 票
  VOTED: 'success',
  DELEGATED: 'info',
  ABSENT: 'neutral',
  APPROVE: 'success',
  REJECT: 'danger',
  ABSTAIN: 'neutral',
  // 任务
  PENDING_ASSIGN: 'warning',
  PENDING_ACCEPT: 'warning',
  IN_PROGRESS: 'info',
  PENDING_ACCEPTANCE: 'warning',
  OVERDUE: 'danger',
  CANCELLED: 'neutral',
  BLOCKED: 'warning',
  // 上报
  SUBMITTED: 'info',
  SIGNED: 'info',
  ADOPTED: 'success',
  RETURNED: 'warning',
  UPGRADED: 'warning',
  // 通用
  SENT: 'success',
  FAILED: 'danger',
  PROCESSING: 'info',
  DEAD: 'neutral',
};

export function toneOf(status: string | null | undefined): Tone {
  if (!status) return 'neutral';
  return STATUS_TONE[status] ?? 'neutral';
}
