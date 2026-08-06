/** Swagger 错误响应契约：为所有操作声明统一 envelope 与机器可读错误码。 */

import type { OpenAPIObject } from '@nestjs/swagger';
import { ErrorCode } from '../exceptions/error-codes';

type OperationObject = NonNullable<OpenAPIObject['paths'][string]['get']>;
type ResponseDefinition = NonNullable<OperationObject['responses'][string]>;
type ReferenceObject = { $ref: string };
type ResponseObject = Exclude<ResponseDefinition, ReferenceObject>;

const ERROR_SCHEMA_NAME = 'ApiErrorEnvelope';
const ERROR_SCHEMA_REF = `#/components/schemas/${ERROR_SCHEMA_NAME}`;
const ERROR_CODE_SCHEMA_NAME = 'BusinessErrorCode';
const ERROR_CODE_SCHEMA_REF = `#/components/schemas/${ERROR_CODE_SCHEMA_NAME}`;
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

function isReferenceObject(value: object): value is ReferenceObject {
  return '$ref' in value;
}

function applyErrorSchema(response: ResponseObject): void {
  response.content = {
    ...(response.content ?? {}),
    'application/json': {
      ...(response.content?.['application/json'] ?? {}),
      schema: { $ref: ERROR_SCHEMA_REF },
    },
  };
}

function applyOperationErrors(operation: OperationObject): void {
  for (const [status, response] of Object.entries(operation.responses)) {
    if (!/^[45]\d\d$/.test(status) || !response || isReferenceObject(response)) continue;
    applyErrorSchema(response);
  }

  const defaultResponse = operation.responses.default;
  if (!defaultResponse) {
    operation.responses.default = {
      description: '未在此操作中单独列出的错误响应',
      content: { 'application/json': { schema: { $ref: ERROR_SCHEMA_REF } } },
    };
  } else if (!isReferenceObject(defaultResponse)) {
    applyErrorSchema(defaultResponse);
  }
}

/** 修改 Swagger 文档，使声明错误与兜底错误都匹配全局异常过滤器。 */
export function applyErrorResponseEnvelope(document: OpenAPIObject): OpenAPIObject {
  document.components ??= {};
  document.components.schemas ??= {};
  document.components.schemas[ERROR_CODE_SCHEMA_NAME] = Object.assign(
    {
      type: 'integer' as const,
      enum: Object.values(ErrorCode),
      description: '稳定业务错误码；名称和值来源于 ErrorCode',
    },
    { 'x-enum-varnames': Object.keys(ErrorCode) },
  );
  document.components.schemas[ERROR_SCHEMA_NAME] = {
    type: 'object',
    required: ['code', 'message', 'data'],
    properties: {
      code: { $ref: ERROR_CODE_SCHEMA_REF },
      message: { type: 'string' },
      data: { type: 'object', nullable: true, additionalProperties: false, example: null },
    },
  };

  for (const path of Object.values(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = path[method];
      if (operation) applyOperationErrors(operation);
    }
  }

  return document;
}
