import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'oa:permissions';

/**
 * 声明接口需要的权限点（与 `packages/shared/src/constants/permissions.ts` 同一套常量）。
 * 语义为「任一命中即可」；需要全部命中时在服务层再校验。
 */
export const RequirePermissions = (...codes: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSIONS_KEY, codes);
