import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../../../common/decorators/require-permissions.decorator';
import type { RequestWithUser } from '../../../common/context/authenticated-user';
import { AppError } from '../../../common/errors/app-error';

/** 权限点守卫：`@RequirePermissions('WF_PUBLISH')` 任一命中即放行 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const granted = request.user?.permissions ?? [];
    if (!required.some((code) => granted.includes(code))) {
      throw AppError.of('PERM_DENIED', `缺少权限：${required.join(' / ')}`);
    }
    return true;
  }
}
