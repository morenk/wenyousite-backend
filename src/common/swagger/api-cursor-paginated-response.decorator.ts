import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtension, ApiOkResponse } from '@nestjs/swagger';

/** 声明游标分页成功响应，使 OpenAPI 为该操作生成必填 meta。 */
export function ApiCursorPaginatedResponse<T extends Type<unknown>>(
  type: T,
  description: string,
) {
  return applyDecorators(
    ApiExtension('x-pagination', 'cursor'),
    ApiOkResponse({ type, isArray: true, description }),
  );
}
