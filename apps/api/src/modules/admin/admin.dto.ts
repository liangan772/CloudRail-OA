import { z } from 'zod';
import { paginationQuerySchema } from '@oa/shared';

/* ------------------------------- 用户 ------------------------------- */

export const adminUserQuerySchema = paginationQuerySchema.extend({
  deptId: z.coerce.number().int().positive().optional(),
  status: z.enum(['ACTIVE', 'DISABLED', 'LOCKED']).optional(),
  roleCode: z.string().trim().max(64).optional(),
});
export type AdminUserQuery = z.infer<typeof adminUserQuerySchema>;

export const createUserSchema = z.object({
  email: z.string().trim().email('邮箱格式不正确').max(128),
  name: z.string().trim().min(1, '姓名不能为空').max(64),
  phone: z.string().trim().max(32).optional(),
  password: z.string().min(8, '密码至少 8 位').max(64),
  deptId: z.coerce.number().int().positive().optional(),
  title: z.string().trim().max(64).optional(),
  isLeader: z.boolean().optional(),
  roleCodes: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
});
export type CreateUserDto = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  status: z.enum(['ACTIVE', 'DISABLED', 'LOCKED']).optional(),
  deptId: z.coerce.number().int().positive().nullable().optional(),
  title: z.string().trim().max(64).nullable().optional(),
  isLeader: z.boolean().optional(),
});
export type UpdateUserDto = z.infer<typeof updateUserSchema>;

export const resetPasswordSchema = z.object({
  /** 不传则重置为 DEFAULT_PASSWORD 约定值，由服务层决定 */
  password: z.string().min(8, '密码至少 8 位').max(64).optional(),
});
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;

export const assignRolesSchema = z.object({
  roleCodes: z.array(z.string().trim().min(1).max(64)).max(20),
});
export type AssignRolesDto = z.infer<typeof assignRolesSchema>;

/* ------------------------------- 角色 ------------------------------- */

export const adminRoleQuerySchema = paginationQuerySchema;

export const createRoleSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[A-Z][A-Z0-9_]*$/, '角色码只能用大写字母、数字与下划线，且以字母开头'),
  name: z.string().trim().min(1).max(64),
  dataScopeDefault: z.enum(['SELF', 'DEPT', 'DEPT_AND_SUB', 'DEPT_LIST', 'TENANT']).default('DEPT'),
  permissionCodes: z.array(z.string().trim().min(1).max(64)).max(200).optional(),
});
export type CreateRoleDto = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  dataScopeDefault: z.enum(['SELF', 'DEPT', 'DEPT_AND_SUB', 'DEPT_LIST', 'TENANT']).optional(),
});
export type UpdateRoleDto = z.infer<typeof updateRoleSchema>;

export const setRolePermissionsSchema = z.object({
  permissionCodes: z.array(z.string().trim().min(1).max(64)).max(200),
});
export type SetRolePermissionsDto = z.infer<typeof setRolePermissionsSchema>;

/* ------------------------------- 部门 ------------------------------- */

export const createDepartmentSchema = z.object({
  name: z.string().trim().min(1).max(64),
  code: z.string().trim().max(64).optional(),
  parentId: z.coerce.number().int().positive().nullable().optional(),
  workNo: z.string().trim().max(64).nullable().optional(),
  managerId: z.coerce.number().int().positive().nullable().optional(),
  sort: z.coerce.number().int().min(0).max(9999).optional(),
});
export type CreateDepartmentDto = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = createDepartmentSchema.partial().extend({
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
});
export type UpdateDepartmentDto = z.infer<typeof updateDepartmentSchema>;

export const moveDepartmentSchema = z.object({
  /** null 表示提到根 */
  parentId: z.coerce.number().int().positive().nullable(),
});
export type MoveDepartmentDto = z.infer<typeof moveDepartmentSchema>;

/* ------------------------------- 工号 ------------------------------- */

export const setWorkNoSchema = z.object({
  workNo: z.string().trim().max(64).nullable(),
});
export type SetWorkNoDto = z.infer<typeof setWorkNoSchema>;

export const addWorkNoMemberSchema = z.object({
  userId: z.coerce.number().int().positive(),
  isPrimary: z.boolean().optional(),
});
export type AddWorkNoMemberDto = z.infer<typeof addWorkNoMemberSchema>;

export const setWorkNoPrimarySchema = z.object({
  userId: z.coerce.number().int().positive(),
});
export type SetWorkNoPrimaryDto = z.infer<typeof setWorkNoPrimarySchema>;

/* ------------------------------- 审计 ------------------------------- */

export const adminAuditQuerySchema = paginationQuerySchema.extend({
  actorId: z.coerce.number().int().positive().optional(),
  action: z.string().trim().max(64).optional(),
  targetType: z.string().trim().max(64).optional(),
  targetId: z.string().trim().max(64).optional(),
  from: z.string().trim().max(32).optional(),
  to: z.string().trim().max(32).optional(),
});
export type AdminAuditQuery = z.infer<typeof adminAuditQuerySchema>;

/* ------------------------------- 运维 ------------------------------- */

export const outboxQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['PENDING', 'PROCESSING', 'SENT', 'FAILED', 'DEAD']).optional(),
});
export type OutboxQuery = z.infer<typeof outboxQuerySchema>;
