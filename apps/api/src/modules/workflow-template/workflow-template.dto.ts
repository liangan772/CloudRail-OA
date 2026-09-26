import { z } from 'zod';
import { paginationQuerySchema } from '@oa/shared';

export const templateQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
});
export type TemplateQuery = z.infer<typeof templateQuerySchema>;

export const publishVersionSchema = z.object({
  /** 不传则发布最新版本 */
  versionId: z.coerce.number().int().positive().optional(),
  changelog: z.string().trim().max(2000).optional(),
});
export type PublishVersionInput = z.infer<typeof publishVersionSchema>;
