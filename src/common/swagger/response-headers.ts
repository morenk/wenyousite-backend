/** Swagger 响应头契约：与全局成功拦截器和异常过滤器保持一致。 */

import type { OpenAPIObject } from '@nestjs/swagger';

type OperationObject = NonNullable<OpenAPIObject['paths'][string]['get']>;
type ResponseDefinition = NonNullable<OperationObject['responses'][string]>;
type ReferenceObject = { $ref: string };
type ResponseObject = Exclude<ResponseDefinition, ReferenceObject>;

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;
const REQUEST_ID_HEADER_REF = '#/components/headers/XRequestId';
const CONTRACT_VERSION_HEADER_REF = '#/components/headers/XApiContractVersion';
const RETRY_AFTER_HEADER_REF = '#/components/headers/RetryAfter';

function isReferenceObject(value: object): value is ReferenceObject {
  return '$ref' in value;
}

function applyOperationResponseHeaders(operation: OperationObject): void {
  for (const [status, response] of Object.entries(operation.responses)) {
    if (!response || isReferenceObject(response)) continue;
    const responseObject = response as ResponseObject;
    responseObject.headers = {
      ...(responseObject.headers ?? {}),
      'X-Request-ID': { $ref: REQUEST_ID_HEADER_REF },
      'X-API-Contract-Version': { $ref: CONTRACT_VERSION_HEADER_REF },
      ...(/^429$/.test(status) ? { 'Retry-After': { $ref: RETRY_AFTER_HEADER_REF } } : {}),
    };
  }
}

/** 为所有操作响应声明可观测头，并为显式 429 响应声明重试时间。 */
export function applyResponseHeaders(document: OpenAPIObject): OpenAPIObject {
  document.components ??= {};
  document.components.headers ??= {};
  document.components.headers.XRequestId = {
    description: '请求跟踪 ID；可随崩溃报告记录，不得与凭证一同记录',
    schema: { type: 'string' },
  };
  document.components.headers.XApiContractVersion = {
    description: '处理该请求的 API 契约版本',
    schema: { type: 'string' },
  };
  document.components.headers.RetryAfter = {
    description: '建议客户端等待的秒数',
    schema: { type: 'integer', minimum: 0 },
  };

  for (const path of Object.values(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = path[method];
      if (operation) applyOperationResponseHeaders(operation);
    }
  }

  return document;
}
