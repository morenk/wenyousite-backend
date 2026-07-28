import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes';

/** 业务异常：携带机器可识别的错误码，供 Flutter 端程序化处理 */
export class BusinessException extends HttpException {
  readonly errorCode: number;

  constructor(
    errorCode: number,
    message: string,
    httpStatus: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super(message, httpStatus);
    this.errorCode = errorCode;
  }

  /** 获取包含 errorCode 的响应体 */
  getErrorResponse(): { errorCode: number; message: string } {
    return {
      errorCode: this.errorCode,
      message: this.message,
    };
  }
}

/** 资源不存在快捷工厂 */
export function notFound(
  code: ErrorCode = ErrorCode.NOT_FOUND,
  message = '资源不存在',
): BusinessException {
  return new BusinessException(code as number, message, HttpStatus.NOT_FOUND);
}

/** 权限不足快捷工厂 */
export function forbidden(
  message = '权限不足',
  code: ErrorCode = ErrorCode.FORBIDDEN,
): BusinessException {
  return new BusinessException(code as number, message, HttpStatus.FORBIDDEN);
}

/** 未认证快捷工厂 */
export function unauthorized(
  message = '请先登录',
  code: ErrorCode = ErrorCode.UNAUTHORIZED,
): BusinessException {
  return new BusinessException(code as number, message, HttpStatus.UNAUTHORIZED);
}
