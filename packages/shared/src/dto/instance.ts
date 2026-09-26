import { z } from 'zod';

export const createInstanceSchema = z.object({
  templateId: z.number().int().positive(),
  title: z.string().trim().min(2, '标题至少 2 个字').max(200),
  summary: z.string().trim().max(500).optional(),
  /** 表单数据必须通过模板的 formSchema 校验（服务端再校验一次） */
  formData: z.record(z.unknown()),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  attachmentKeys: z.array(z.string()).max(20).optional(),
  saveAsDraft: z.boolean().default(false),
});
export type CreateInstanceInput = z.infer<typeof createInstanceSchema>;

export const withdrawInstanceSchema = z.object({
  reason: z.string().trim().min(2, '撤回必须填写原因').max(500),
});

export const resubmitInstanceSchema = z.object({
  formData: z.record(z.unknown()).optional(),
  reason: z.string().trim().max(500).optional(),
});

export const instanceQuerySchema = z.object({
  status: z
    .array(z.enum(['DRAFT', 'VOTING', 'APPROVED', 'REJECTED', 'ESCALATED', 'SUSPENDED', 'CLOSED']))
    .optional(),
  templateId: z.coerce.number().int().positive().optional(),
  initiatorId: z.coerce.number().int().positive().optional(),
  scope: z.enum(['mine', 'dept', 'all', 'active', 'closed']).default('mine'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type InstanceQuery = z.infer<typeof instanceQuerySchema>;
