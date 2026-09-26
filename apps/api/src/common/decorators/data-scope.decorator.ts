import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { RequestWithUser } from '../context/authenticated-user';
import type { ScopePredicate } from '../../domain/access/data-scope';

/** 取 DataScopeGuard 解析好的范围谓词；没有上下文时返回 NONE（范围内无数据） */
export const DataScope = createParamDecorator((_data: unknown, ctx: ExecutionContext): ScopePredicate => {
  const request = ctx.switchToHttp().getRequest<RequestWithUser>();
  return request.dataScope ?? { kind: 'NONE', tenantId: request.user?.tenantId ?? 0 };
});
