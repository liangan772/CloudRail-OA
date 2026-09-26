import { z } from 'zod';
import { paginationQuerySchema } from '@oa/shared';

export const taskListQuerySchema = paginationQuerySchema.extend({
  /** mine=我是参与人（负责人/验收人/协作者）；all=数据范围内全部 */
  scope: z.enum(['mine', 'all']).default('mine'),
  status: z
    .enum([
      'PENDING_ASSIGN',
      'PENDING_ACCEPT',
      'IN_PROGRESS',
      'PENDING_ACCEPTANCE',
      'DONE',
      'OVERDUE',
      'CANCELLED',
      'BLOCKED',
      'ESCALATED',
    ])
    .optional(),
  instanceId: z.coerce.number().int().positive().optional(),
});
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;

export const assignTaskSchema = z.object({
  ownerId: z.coerce.number().int().positive(),
  acceptorId: z.coerce.number().int().positive().optional(),
});
export type AssignTaskBody = z.infer<typeof assignTaskSchema>;

export const transferTaskSchema = z.object({
  ownerId: z.coerce.number().int().positive(),
  reason: z.string().trim().min(2, '转派必须填写原因').max(500),
});
export type TransferTaskBody = z.infer<typeof transferTaskSchema>;

export const taskCommentSchema = z.object({
  comment: z.string().trim().max(2000).optional(),
});
export type TaskCommentBody = z.infer<typeof taskCommentSchema>;

export const taskReasonSchema = z.object({
  reason: z.string().trim().min(2, '必须填写原因').max(500),
});
export type TaskReasonBody = z.infer<typeof taskReasonSchema>;

export const checklistItemSchema = z.object({
  done: z.boolean(),
});
export type ChecklistItemBody = z.infer<typeof checklistItemSchema>;
