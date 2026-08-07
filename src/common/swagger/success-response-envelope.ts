/** Swagger 成功响应转换：把控制器业务数据 schema 包装为统一 API envelope */

import type { OpenAPIObject } from '@nestjs/swagger';

type OperationObject = NonNullable<OpenAPIObject['paths'][string]['get']>;
type ResponseDefinition = NonNullable<OperationObject['responses'][string]>;
type ReferenceObject = { $ref: string };
type ResponseObject = Exclude<ResponseDefinition, ReferenceObject>;
type JsonContent = NonNullable<ResponseObject['content']>[string];
type SchemaObject = NonNullable<JsonContent['schema']>;

const ENVELOPE_SCHEMA_NAME = 'ApiSuccessEnvelope';
const ENVELOPE_SCHEMA_REF = `#/components/schemas/${ENVELOPE_SCHEMA_NAME}`;
const PAGINATED_ENVELOPE_SCHEMA_NAME = 'ApiPaginatedSuccessEnvelope';
const PAGINATED_ENVELOPE_SCHEMA_REF = `#/components/schemas/${PAGINATED_ENVELOPE_SCHEMA_NAME}`;
const PAGINATION_META_SCHEMA_NAME = 'ApiPaginationMeta';
const PAGINATION_META_SCHEMA_REF = `#/components/schemas/${PAGINATION_META_SCHEMA_NAME}`;
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

function isReferenceObject(value: object): value is ReferenceObject {
  return '$ref' in value;
}

function isAlreadyWrapped(schema: SchemaObject | ReferenceObject | undefined): boolean {
  if (!schema || isReferenceObject(schema)) return false;
  return schema.allOf?.some(
    (part) => isReferenceObject(part) &&
      (part.$ref === ENVELOPE_SCHEMA_REF || part.$ref === PAGINATED_ENVELOPE_SCHEMA_REF),
  ) ?? false;
}

function responseComponentName(operationId: string, status: string): string {
  return `${operationId[0].toUpperCase()}${operationId.slice(1)}${status}Response`;
}

function wrapResponse(
  document: OpenAPIObject,
  operationId: string,
  status: string,
  response: ResponseObject,
  paginated: boolean,
): void {
  const jsonContentTypes = Object.keys(response.content ?? {}).filter(
    (contentType) => contentType === 'application/json' || contentType.endsWith('+json'),
  );

  // 未声明 content 的普通控制器响应仍是 JSON；显式声明为其他媒体类型的响应保持原样。
  if (!response.content) {
    response.content = { 'application/json': {} };
    jsonContentTypes.push('application/json');
  }

  for (const contentType of jsonContentTypes) {
    const mediaType = response.content[contentType];
    if (!mediaType || isAlreadyWrapped(mediaType.schema)) continue;
    const dataSchema = mediaType.schema ?? {};
    const componentName = responseComponentName(operationId, status);
    document.components!.schemas![componentName] = {
      allOf: [
        { $ref: paginated ? PAGINATED_ENVELOPE_SCHEMA_REF : ENVELOPE_SCHEMA_REF },
        {
          type: 'object',
          required: ['data'],
          properties: { data: dataSchema },
        },
      ],
    };
    mediaType.schema = { $ref: `#/components/schemas/${componentName}` };
  }
}

function wrapOperation(document: OpenAPIObject, operation: OperationObject): void {
  const operationId = operation.operationId;
  if (!operationId) return;
  const paginated =
    (operation as typeof operation & Record<string, unknown>)['x-pagination'] === 'cursor';
  for (const [status, response] of Object.entries(operation.responses)) {
    if (!/^2\d\d$/.test(status) || status === '204' || status === '205' || !response) continue;
    if (isReferenceObject(response)) continue;
    wrapResponse(document, operationId, status, response, paginated);
  }
}

/** 修改 Swagger 文档，使所有 2xx JSON 响应与 TransformInterceptor 的运行时结构一致。 */
export function applySuccessResponseEnvelope(document: OpenAPIObject): OpenAPIObject {
  document.components ??= {};
  document.components.schemas ??= {};
  document.components.schemas[PAGINATION_META_SCHEMA_NAME] = {
    type: 'object',
    required: ['cursor', 'hasMore'],
    properties: {
      cursor: { type: 'string', nullable: true },
      hasMore: { type: 'boolean' },
    },
  };
  document.components.schemas[ENVELOPE_SCHEMA_NAME] = {
    type: 'object',
    required: ['code', 'message'],
    properties: {
      code: { type: 'integer', enum: [0], example: 0 },
      message: { type: 'string', example: 'ok' },
    },
  };
  document.components.schemas[PAGINATED_ENVELOPE_SCHEMA_NAME] = {
    allOf: [
      { $ref: ENVELOPE_SCHEMA_REF },
      {
        type: 'object',
        required: ['meta'],
        properties: { meta: { $ref: PAGINATION_META_SCHEMA_REF } },
      },
    ],
  };

  for (const path of Object.values(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = path[method];
      if (operation) wrapOperation(document, operation);
    }
  }

  return document;
}
