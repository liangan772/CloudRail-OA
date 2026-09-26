import { z } from 'zod';

/** 统一响应封装：{ code, message, data, traceId } */
export const apiResponseSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    code: z.string(),
    message: z.string(),
    data: data,
    traceId: z.string().optional(),
  });

export const idSchema = z.coerce.number().int().positive();

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  keyword: z.string().trim().max(100).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const paginatedSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
  });

export const sortOrderSchema = z.enum(['asc', 'desc']).default('desc');

export const fileRefSchema = z.object({
  fileName: z.string().min(1).max(255),
  fileKey: z.string().min(1).max(512),
  size: z.number().int().nonnegative(),
  mime: z.string().max(128),
});
export type FileRef = z.infer<typeof fileRefSchema>;
