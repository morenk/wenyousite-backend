import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { BusinessException } from '../exceptions/business.exception';
import { httpStatusToCode } from '../exceptions/error-codes';

/** 统一错误响应体 */
interface ErrorResponse {
  code: number;
  message: string;
  data: null;
}

/** 全局异常过滤器：统一 { code, message, data: null } 格式，支持 BusinessException 错误码 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    let httpStatus: number;
    let code: number;
    let message: string;

    if (exception instanceof BusinessException) {
      httpStatus = exception.getStatus();
      code = exception.errorCode;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      httpStatus = exception.getStatus();
      code = httpStatusToCode(httpStatus);
      const res = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, unknown>;
        if (Array.isArray(resObj.message)) {
          // ValidationPipe 的 message 是数组，合并为一条消息
          message = resObj.message.join('; ');
        } else {
          message = String(resObj.message ?? exception.message);
        }
      } else {
        message = exception.message;
      }
    } else {
      httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
      code = 50000;
      message = '服务器内部错误';
    }

    this.logger.error(
      `${request.method} ${request.url} ${httpStatus} [${code}] - ${message}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    const body: ErrorResponse = { code, message, data: null };
    response.status(httpStatus).send(body);
  }
}
