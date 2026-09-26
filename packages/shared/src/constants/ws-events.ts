/** WebSocket 事件名与房间名（前后端共用，避免字符串漂移） */

export const WS_EVENTS = {
  // 投票
  VOTE_CAST: 'vote.cast',
  NODE_PASSED: 'node.passed',
  NODE_REJECTED: 'node.rejected',
  NODE_TIMEOUT: 'node.timeout',
  NODE_ESCALATED: 'node.escalated',
  // 结论
  CONCLUSION_PENDING: 'conclusion.pending',
  CONCLUSION_SUBMITTED: 'conclusion.submitted',
  // 任务
  TASK_CREATED: 'task.created',
  TASK_UPDATED: 'task.updated',
  TASK_OVERDUE: 'task.overdue',
  // 上报
  ESCALATION_CREATED: 'escalation.created',
  ESCALATION_VOTING_STARTED: 'escalation.voting_started',
  ESCALATION_CONCLUDED: 'escalation.concluded',
  ESCALATION_HANDLED: 'escalation.handled',
  // 通用
  NOTIFICATION_NEW: 'notification.new',
  INSTANCE_UPDATED: 'instance.updated',
} as const;

export type WsEvent = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];

export const WS_ROOMS = {
  instance: (id: number | string) => `instance:${id}`,
  workno: (workNo: string) => `workno:${workNo}`,
  user: (id: number | string) => `user:${id}`,
  dept: (id: number | string) => `dept:${id}`,
} as const;
