import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { AppError } from '../errors/app-error';
import type { AuthenticatedUser, RequestWithUser } from '../context/authenticated-user';

/** 取当前登录用户；`@CurrentUser('userId')` 可直接取字段 */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) throw AppError.of('AUTH_TOKEN_INVALID', '缺少登录上下文');
    return field ? user[field] : user;
  },
);
