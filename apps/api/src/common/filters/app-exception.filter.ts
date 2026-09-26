import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { ERROR_CODES } from '@oa/shared';
import { AppError } from '../errors/app-error';

interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): void;
}

interface RequestLike {
  traceId?: string;
  url?: string;
}

/** 统一错误响应：`{ code, message, detail?, traceId }` */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<ResponseLike>();
    const request = ctx.getRequest<RequestLike>();
    const traceId = request.traceId;

    if (exception instanceof AppError) {
      response.status(exception.httpStatus).json({
        code: exception.code,
        message: exception.message,
        detail: exception.detail,
        data: null,
        traceId,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json({
        code: status === 404 ? ERROR_CODES.SYS_NOT_FOUND.code : ERROR_CODES.SYS_INTERNAL_ERROR.code,
        message: exception.message,
        data: null,
        traceId,
      });
      return;
    }

    // 未预期异常：对外只给标准错误码，细节留在服务端日志
    this.logger.error(
      `未处理异常 ${request.url ?? ''} trace=${traceId ?? '-'}`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    response.status(ERROR_CODES.SYS_INTERNAL_ERROR.httpStatus).json({
      code: ERROR_CODES.SYS_INTERNAL_ERROR.code,
      message: ERROR_CODES.SYS_INTERNAL_ERROR.message,
      data: null,
      traceId,
    });
  }
}
