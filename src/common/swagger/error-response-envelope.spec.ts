import type { OpenAPIObject } from '@nestjs/swagger';
import { applyErrorResponseEnvelope } from './error-response-envelope';

describe('applyErrorResponseEnvelope', () => {
  const jsonSchema = (response: unknown) =>
    (response as { content?: { 'application/json'?: { schema?: unknown } } })?.content?.[
      'application/json'
    ]?.schema;

  it('为声明错误与兜底错误注入统一 schema', () => {
    const document = {
      openapi: '3.0.0',
      info: { title: 'test', version: '1' },
      paths: {
        '/items': {
          get: {
            responses: {
              200: { description: 'ok' },
              404: { description: 'not found' },
            },
          },
        },
      },
    } as OpenAPIObject;

    applyErrorResponseEnvelope(document);

    expect(document.components?.schemas?.ApiErrorEnvelope).toBeDefined();
    expect(jsonSchema(document.paths['/items'].get?.responses['404'])).toEqual({
      $ref: '#/components/schemas/ApiErrorEnvelope',
    });
    expect(jsonSchema(document.paths['/items'].get?.responses.default)).toEqual({
      $ref: '#/components/schemas/ApiErrorEnvelope',
    });
  });
});
