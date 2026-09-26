import { z } from 'zod';
import { paginationQuerySchema } from '@oa/shared';

export const instanceListQuerySchema = paginationQuerySchema.extend({
  /** mine=我发起的；dept=我数据范围内的人发起的；all=整个租户（仍受数据范围约束） */
  scope: z.enum(['mine', 'dept', 'all']).default('mine'),
  status: z
    .enum(['DRAFT', 'VOTING', 'APPROVED', 'REJECTED', 'ESCALATED', 'SUSPENDED', 'CLOSED'])
    .optional(),
  templateId: z.coerce.number().int().positive().optional(),
});
export type InstanceListQuery = z.infer<typeof instanceListQuerySchema>;
