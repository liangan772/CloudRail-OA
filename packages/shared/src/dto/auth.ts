import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('请输入正确的邮箱'),
  password: z.string().min(8, '密码至少 8 位').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

export const changePasswordSchema = z
  .object({
    oldPassword: z.string().min(8).max(128),
    newPassword: z.string().min(8, '新密码至少 8 位').max(128),
    confirmPassword: z.string().min(8).max(128),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: '两次输入的新密码不一致',
    path: ['confirmPassword'],
  });

export const currentUserSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string(),
  avatar: z.string().nullable().optional(),
  tenantId: z.number(),
  deptIds: z.array(z.number()),
  primaryDeptId: z.number().nullable(),
  roleCodes: z.array(z.string()),
  permissions: z.array(z.string()),
  scope: z.string(),
});
export type CurrentUser = z.infer<typeof currentUserSchema>;
