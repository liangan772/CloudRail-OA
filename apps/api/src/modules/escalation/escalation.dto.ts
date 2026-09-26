import { z } from 'zod';
import { paginationQuerySchema } from '@oa/shared';

export const escalationListQuerySchema = paginationQuerySchema.extend({
  /** mine=我所在工号待处理的；all=我数据范围内的全部 */
  scope: z.enum(['mine', 'all']).default('mine'),
  status: z
    .enum(['PENDING', 'SUBMITTED', 'SIGNED', 'VOTING', 'PENDING_CONCLUSION', 'ADOPTED', 'RETURNED', 'UPGRADED', 'CLOSED'])
    .optional(),
  instanceId: z.coerce.number().int().positive().optional(),
});
export type EscalationListQuery = z.infer<typeof escalationListQuerySchema>;

/** 上级处理意见（D8：不通过默认 RETURN，终审才直接定局） */
export const submitEscalationConclusionSchema = z.object({
  opinion: z.enum(['CONTINUE', 'RETURN', 'REQUEST_MORE', 'FINAL_APPROVE', 'FINAL_REJECT']),
  content: z.string().trim().min(1, '上级意见必填').max(4000),
});
export type SubmitEscalationConclusionBody = z.infer<typeof submitEscalationConclusionSchema>;

export const upgradeEscalationSchema = z.object({
  reason: z.string().trim().min(2, '上溯原因必填').max(500),
});
export type UpgradeEscalationBody = z.infer<typeof upgradeEscalationSchema>;
