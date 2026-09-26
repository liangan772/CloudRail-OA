import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

interface RequestLike {
  traceId?: string;
}

/**
 * 统一成功响应：`{ code: 'OK', message: 'success', data, traceId }`。
 * 分页等结构保持在 data 内，前端 api-client 只解一层。
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestLike>();
    return next.handle().pipe(
      map((data) => ({
        code: 'OK',
        message: 'success',
        data: data ?? null,
        traceId: request.traceId,
      })),
    );
  }
}
