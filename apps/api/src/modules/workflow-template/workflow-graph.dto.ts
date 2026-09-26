import { z } from 'zod';

// 设计器保存的整图：节点（含投票规则与投票人规则）+ 连线。
// 采用「整图替换」而不是逐节点增删：前端一次提交完整图，后端一次校验一次落库，
// 不会出现"改了一半"的中间态。

export const voterRuleSchema = z.object({
  voterType: z.enum(['USER', 'ROLE', 'DEPARTMENT', 'VOTE_GROUP', 'DEPT_WORKNO', 'DYNAMIC']),
  // 具体结构由 voterType 决定（userIds / roleCodes / deptRef / groupCodes / from…），保留原始 JSON
  voterValue: z.record(z.unknown()).default({}),
  weight: z.coerce.number().positive().max(1000).default(1),
  isRequired: z.boolean().default(true),
  order: z.coerce.number().int().min(0).default(0),
});
export type VoterRuleInput = z.infer<typeof voterRuleSchema>;

export const voteRuleSchema = z.object({
  passRule: z.enum(['ALL', 'MAJORITY', 'RATIO', 'WEIGHTED', 'AT_LEAST_N']),
  passThreshold: z.coerce.number().nonnegative().nullable().optional(),
  rejectRule: z.enum(['ANY_VETO', 'OPPOSE_OVER', 'NONE']).default('NONE'),
  rejectThreshold: z.coerce.number().nonnegative().nullable().optional(),
  abstainPolicy: z.enum(['COUNT_IN_DENOMINATOR', 'EXCLUDE_FROM_DENOMINATOR', 'AS_APPROVE', 'AS_REJECT']).default('EXCLUDE_FROM_DENOMINATOR'),
  timeoutPolicy: z.enum(['REMIND_ONLY', 'AUTO_REJECT', 'ESCALATE', 'AUTO_APPROVE']).default('REMIND_ONLY'),
  visibility: z.enum(['PUBLIC', 'RESULT_ONLY', 'ANONYMOUS']).default('RESULT_ONLY'),
  viewScope: z.enum(['DEPT_ONLY', 'TENANT']).default('DEPT_ONLY'),
  allowAbstain: z.boolean().default(false),
  requireAllVote: z.boolean().default(true),
  revotePolicy: z.enum(['NOT_ALLOWED', 'ONCE', 'UNLIMITED_BEFORE_CONCLUSION']).default('UNLIMITED_BEFORE_CONCLUSION'),
  vetoTerminates: z.boolean().default(false),
  tiePolicy: z.enum(['ESCALATE', 'REJECT', 'CHAIRMAN_VOTE']).default('ESCALATE'),
  conclusionMode: z.enum(['AUTO', 'MANUAL_CONFIRM', 'MANUAL_OVERRIDE']).default('MANUAL_CONFIRM'),
  conclusionAuthorRule: z.record(z.unknown()).nullable().optional(),
  timeoutHours: z.coerce.number().int().positive().max(24 * 30).default(24),
  remindIntervalHours: z.coerce.number().int().positive().max(24 * 7).default(8),
  maxRemindRounds: z.coerce.number().int().min(0).max(10).default(3),
  conclusionTimeoutHours: z.coerce.number().int().positive().max(24 * 30).default(24),
  quorumPolicy: z.enum(['MIN_POOL_RATIO', 'NONE', 'MIN_POOL_N']).default('MIN_POOL_RATIO'),
  minQuorum: z.coerce.number().min(0).max(1).default(0.6),
  allowMarkAbsent: z.boolean().default(true),
});
export type VoteRuleInput = z.infer<typeof voteRuleSchema>;

export const graphNodeSchema = z.object({
  nodeKey: z.string().trim().min(1).max(64),
  type: z.enum(['START', 'VOTE', 'TASK', 'ESCALATION', 'CONDITION', 'END']),
  name: z.string().trim().min(1).max(128),
  order: z.coerce.number().int().min(0).default(0),
  layerIndex: z.coerce.number().int().min(1).nullable().optional(),
  // 读接口会把「没有规则」返回成 null（START/END 就是没有），
  // 所以 schema 必须同时接受 null —— 否则"读出来再存回去"这条最基本的往返会失败
  config: z.record(z.unknown()).nullable().optional(),
  voteRule: voteRuleSchema.nullable().optional(),
  voterRules: z.array(voterRuleSchema).nullable().optional(),
});
export type GraphNodeInput = z.infer<typeof graphNodeSchema>;

export const graphEdgeSchema = z.object({
  from: z.string().trim().min(1),
  to: z.string().trim().min(1),
  priority: z.coerce.number().int().default(0),
  label: z.string().trim().max(128).nullable().optional(),
  condition: z.record(z.unknown()).nullable().optional(),
});
export type GraphEdgeInput = z.infer<typeof graphEdgeSchema>;

export const saveGraphSchema = z.object({
  nodes: z.array(graphNodeSchema).min(1),
  edges: z.array(graphEdgeSchema).default([]),
});
export type SaveGraphInput = z.infer<typeof saveGraphSchema>;

export const createVersionSchema = z.object({
  /** 从哪个版本克隆；不传则取最新版本 */
  fromVersionId: z.coerce.number().int().positive().optional(),
});
export type CreateVersionInput = z.infer<typeof createVersionSchema>;
