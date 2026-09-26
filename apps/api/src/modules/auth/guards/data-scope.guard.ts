import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { RequestWithUser } from '../../../common/context/authenticated-user';
import { AppError } from '../../../common/errors/app-error';
import { resolveScope } from '../../../domain/access/data-scope';

/**
 * 数据范围守卫：把当前用户的数据范围解析成查询谓词挂到 `request.dataScope`，
 * Repository 统一按 `tenantId + dataScope` 拼条件；范围配置非法时立刻失败，
 * 绝不允许"解析失败就退化成全租户"。
 */
@Injectable()
export class DataScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) return true; // 公开接口没有范围可算

    const resolved = resolveScope(user);
    if (!resolved.ok) throw AppError.fromDef(resolved.error, resolved.reason);
    request.dataScope = resolved.predicate;
    return true;
  }
}
