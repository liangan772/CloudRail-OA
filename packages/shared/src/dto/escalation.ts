import { z } from 'zod';

export const createEscalationSchema = z.object({
  sourceType: z.enum(['VOTE', 'TASK', 'INSTANCE', 'MANUAL']),
  sourceId: z.number().int().positive(),
  instanceId: z.number().int().positive().optional(),
  taskId: z.number().int().positive().optional(),
  reason: z.string().trim().min(2, '上报原因必填').max(2000),
  /** 默认按规则解析直接上级；指定部门需租户开关 allowCrossLevel */
  targetDeptId: z.number().int().positive().optional(),
  attachments: z
    .array(z.object({ fileName: z.string(), fileKey: z.string(), size: z.number(), mime: z.string() }))
    .max(10)
    .optional(),
});
export type CreateEscalationInput = z.infer<typeof createEscalationSchema>;

/** 上级结论文书（最终意见回写原流程） */
export const escalationConcludeSchema = z.object({
  decision: z.enum(['CONTINUE', 'RETURN', 'REQUEST_MORE', 'FINAL_APPROVE', 'FINAL_REJECT']),
  content: z.string().trim().min(1, '上级结论意见必填').max(4000),
  actionItems: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  attachments: z
    .array(z.object({ fileName: z.string(), fileKey: z.string(), size: z.number(), mime: z.string() }))
    .max(10)
    .optional(),
});
export type EscalationConcludeInput = z.infer<typeof escalationConcludeSchema>;

export const escalationQuerySchema = z.object({
  scope: z.enum(['toWorkNo', 'requested', 'all', 'pending']).default('toWorkNo'),
  status: z
    .array(z.enum(['PENDING', 'SUBMITTED', 'SIGNED', 'VOTING', 'PENDING_CONCLUSION', 'ADOPTED', 'RETURNED', 'UPGRADED', 'CLOSED']))
    .optional(),
  toWorkNo: z.string().trim().max(64).optional(),
});
export type EscalationQuery = z.infer<typeof escalationQuerySchema>;
