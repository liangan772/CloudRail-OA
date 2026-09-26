import { Injectable, PipeTransform } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';
import { AppError } from '../errors/app-error';

/**
 * 用 shared 里的 zod schema 校验入参：前后端共用同一份契约，避免"前端过了后端拒"。
 * 报错统一为 SYS_VALIDATION_FAILED，并把第一条字段错误放进 detail。
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodTypeAny) {}

  transform(value: unknown): unknown {
    const parsed = this.schema.safeParse(value ?? {});
    if (parsed.success) return parsed.data;

    const first = parsed.error.issues[0];
    const path = first?.path.join('.') ?? '';
    throw AppError.of('SYS_VALIDATION_FAILED', path ? `${path}: ${first?.message}` : first?.message);
  }
}
