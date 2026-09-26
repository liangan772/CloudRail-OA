import { ERROR_CODES, type ErrorCode, type ErrorDef } from '@oa/shared';

/**
 * 领域错误：携带 shared 里的统一错误码定义（code + httpStatus + message）。
 * 过滤器据此产出 `{ code, message, traceId }`，前端按 code 做文案与埋点，不解析 message。
 */
export class AppError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  /** 面向排查的补充说明，不替代标准 message */
  readonly detail?: string;

  constructor(def: ErrorDef, detail?: string) {
    super(def.message);
    this.name = 'AppError';
    this.code = def.code;
    this.httpStatus = def.httpStatus;
    this.detail = detail;
  }

  static of(code: ErrorCode, detail?: string): AppError {
    return new AppError(ERROR_CODES[code], detail);
  }

  /** 领域层（状态机 / 数据范围守卫）返回的 `{ ok:false, error, reason }` 直接转异常 */
  static fromDef(def: ErrorDef, detail?: string): AppError {
    return new AppError(def, detail);
  }
}
