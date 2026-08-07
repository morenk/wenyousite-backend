import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { PaginatedResult } from '../dto/paginated-result';
import { sanitizePublicUserSummaries } from '../user-summary';
import { FastifyReply, FastifyRequest } from 'fastify';
import { API_CONTRACT_VERSION } from '../swagger/openapi-document';

/** 统一成功响应体 */
export interface ApiResponse<T = unknown> {
  /** 业务错误码，0 表示成功 */
  code: number;
  /** 提示信息 */
  message: string;
  /** 响应数据 */
  data: T;
  /** 分页等元信息，仅分页接口有值 */
  meta?: Record<string, unknown>;
}

/** 统一响应拦截器：将所有成功响应包装为 { code: 0, message, data, meta? } 格式 */
@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const response = context.switchToHttp().getResponse<FastifyReply>();
    response.header('X-Request-ID', request.id);
    response.header('X-API-Contract-Version', API_CONTRACT_VERSION);
    return next.handle().pipe(
      map((rawData): ApiResponse<T> => {
        // 分页结果：items → data，pagination → meta
        if (rawData instanceof PaginatedResult) {
          return {
            code: 0,
            message: 'ok',
            data: sanitizePublicUserSummaries(rawData.items) as unknown as T,
            meta: rawData.pagination as unknown as Record<string, unknown>,
          };
        }

        // 普通数据
        return {
          code: 0,
          message: 'ok',
          data: sanitizePublicUserSummaries(rawData) as T,
        };
      }),
    );
  }
}
