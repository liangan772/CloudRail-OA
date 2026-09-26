import type { ScopePredicate, ActorContext } from '../../domain/access/data-scope';

/**
 * 已认证用户上下文（JwtAuthGuard 注入到 `request.user`）。
 *
 * 它同时是数据范围判断所需的 `ActorContext`（含部门物化路径），
 * 目的是让守卫、服务、Repository 拿到同一份身份与范围信息，不各自再查一遍。
 */
export interface AuthenticatedUser extends ActorContext {
  email: string;
  name: string;
  primaryDeptId: number | null;
  roleCodes: string[];
  permissions: string[];
}

/** 极简请求对象视图：只声明我们真正读写的字段，避免依赖 express 类型 */
export interface RequestWithUser {
  user?: AuthenticatedUser;
  /** DataScopeGuard 解析出的查询谓词 */
  dataScope?: ScopePredicate;
  traceId?: string;
  headers?: Record<string, unknown>;
}
