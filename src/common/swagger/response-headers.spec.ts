import type { OpenAPIObject } from '@nestjs/swagger';
import { applyResponseHeaders } from './response-headers';

describe('applyResponseHeaders', () => {
  it('为所有响应声明契约头，429 额外声明 Retry-After', () => {
    const document = {
      openapi: '3.0.0',
      info: { title: 'test', version: '1' },
      paths: {
        '/items': {
          get: {
            responses: {
              200: { description: 'ok' },
              429: { description: 'rate limited' },
              default: { description: 'error' },
            },
          },
        },
      },
    } as OpenAPIObject;

    applyResponseHeaders(document);

    expect(document.paths['/items'].get?.responses['200']).toMatchObject({
      headers: {
        'X-Request-ID': { $ref: '#/components/headers/XRequestId' },
        'X-API-Contract-Version': { $ref: '#/components/headers/XApiContractVersion' },
      },
    });
    expect(document.paths['/items'].get?.responses['429']).toMatchObject({
      headers: {
        'X-Request-ID': { $ref: '#/components/headers/XRequestId' },
        'X-API-Contract-Version': { $ref: '#/components/headers/XApiContractVersion' },
        'Retry-After': { $ref: '#/components/headers/RetryAfter' },
      },
    });
    expect(document.paths['/items'].get?.responses.default).not.toHaveProperty(
      'headers.Retry-After',
    );
  });

  it('注册可复用 header components', () => {
    const document = {
      openapi: '3.0.0',
      info: { title: 'test', version: '1' },
      paths: {},
    } as OpenAPIObject;

    applyResponseHeaders(document);

    expect(document.components?.headers).toEqual({
      XRequestId: {
        description: '请求跟踪 ID；可随崩溃报告记录，不得与凭证一同记录',
        schema: { type: 'string' },
      },
      XApiContractVersion: {
        description: '处理该请求的 API 契约版本',
        schema: { type: 'string' },
      },
      RetryAfter: {
        description: '建议客户端等待的秒数',
        schema: { type: 'integer', minimum: 0 },
      },
    });
  });
});
