import { z } from 'zod';

export const createTaskSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(5000).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  ownerId: z.number().int().positive().optional(),
  acceptorId: z.number().int().positive().optional(),
  collaboratorIds: z.array(z.number().int().positive()).max(20).optional(),
  dueAt: z.string().datetime().optional(),
  parentTaskId: z.number().int().positive().optional(),
  instanceId: z.number().int().positive().optional(),
  instanceNodeId: z.number().int().positive().optional(),
  checklist: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  dependsOnTaskIds: z.array(z.number().int().positive()).max(20).optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const taskTransitionSchema = z.object({
  action: z.enum(['ACCEPT', 'REJECT_ASSIGN', 'SUBMIT', 'ACCEPTANCE_PASS', 'ACCEPTANCE_REJECT', 'BLOCK', 'UNBLOCK', 'CANCEL', 'REOPEN']),
  comment: z.string().trim().max(2000).optional(),
  blockedReason: z.string().trim().max(500).optional(),
});
export type TaskTransitionInput = z.infer<typeof taskTransitionSchema>;

export const assignTaskSchema = z.object({
  ownerId: z.number().int().positive(),
  acceptorId: z.number().int().positive(),
  collaboratorIds: z.array(z.number().int().positive()).optional(),
  comment: z.string().trim().max(500).optional(),
});
export type AssignTaskInput = z.infer<typeof assignTaskSchema>;

export const taskQuerySchema = z.object({
  scope: z.enum(['mine', 'dept', 'all', 'created', 'acceptance']).default('mine'),
  status: z.array(z.string()).optional(),
  priority: z.array(z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT'])).optional(),
  instanceId: z.coerce.number().int().positive().optional(),
  overdueOnly: z.coerce.boolean().default(false),
});
export type TaskQuery = z.infer<typeof taskQuerySchema>;
