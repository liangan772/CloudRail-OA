import { z } from 'zod';
import { paginationQuerySchema } from '@oa/shared';

export const departmentQuerySchema = z.object({
  keyword: z.string().trim().max(100).optional(),
  /** 默认只看启用部门 */
  includeDisabled: z.coerce.boolean().optional(),
});
export type DepartmentQuery = z.infer<typeof departmentQuerySchema>;

export const orgUserQuerySchema = paginationQuerySchema.extend({
  deptId: z.coerce.number().int().positive().optional(),
});
export type OrgUserQuery = z.infer<typeof orgUserQuerySchema>;
