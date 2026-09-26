import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'oa:isPublic';

/** 标记无需登录的接口（登录、刷新、健康检查） */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
