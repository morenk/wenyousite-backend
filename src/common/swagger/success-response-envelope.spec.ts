/** Swagger 成功响应包装测试：保证生成契约与运行时 envelope 一致 */

import type { OpenAPIObject } from '@nestjs/swagger';
import { applySuccessResponseEnvelope } from './success-response-envelope';

function createDocument(): OpenAPIObject {
  return {
    openapi: '3.0.0',
    info: { title: 'test', version: '1.0.0' },
    paths: {
      '/candidates': {
        get: {
          responses: {
            200: {
              description: '候选列表',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/CandidatesDto' },
                },
              },
            },
            401: { description: '未登录' },
          },
        },
      },
      '/posts': {
        post: {
          responses: {
            201: { description: '创建成功' },
          },
        },
      },
      '/empty': {
        delete: {
          responses: {
            204: { description: '无响应体' },
          },
        },
      },
    },
    components: {
      schemas: {
        CandidatesDto: { type: 'object', properties: { users: { type: 'array', items: {} } } },
      },
    },
  };
}

describe('applySuccessResponseEnvelope', () => {
  it('把已声明 DTO 的 2xx JSON 响应放入 data', () => {
    const document = applySuccessResponseEnvelope(createDocument());
    const schema = document.paths['/candidates'].get?.responses['200'];

    expect(schema).toMatchObject({
      content: {
        'application/json': {
          schema: {
            allOf: [
              { $ref: '#/components/schemas/ApiSuccessEnvelope' },
              {
                type: 'object',
                required: ['data'],
                properties: {
                  data: { $ref: '#/components/schemas/CandidatesDto' },
                },
              },
            ],
          },
        },
      },
    });
  });

  it('为未声明业务 DTO 的 2xx 响应补充统一 JSON envelope', () => {
    const document = applySuccessResponseEnvelope(createDocument());
    const response = document.paths['/posts'].post?.responses['201'];

    expect(response).toMatchObject({
      description: '创建成功',
      content: {
        'application/json': {
          schema: {
            allOf: [
              { $ref: '#/components/schemas/ApiSuccessEnvelope' },
              {
                properties: { data: {} },
              },
            ],
          },
        },
      },
    });
  });

  it('注册公共 envelope schema，保留错误响应并跳过 204', () => {
    const document = applySuccessResponseEnvelope(createDocument());

    expect(document.components?.schemas?.ApiSuccessEnvelope).toEqual({
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'integer', enum: [0], example: 0 },
        message: { type: 'string', example: 'ok' },
        meta: { $ref: '#/components/schemas/ApiPaginationMeta' },
      },
    });
    expect(document.components?.schemas?.ApiPaginationMeta).toEqual({
      type: 'object',
      required: ['cursor', 'hasMore'],
      properties: {
        cursor: { type: 'string', nullable: true },
        hasMore: { type: 'boolean' },
      },
    });
    expect(document.paths['/candidates'].get?.responses['401']).toEqual({ description: '未登录' });
    expect(document.paths['/empty'].delete?.responses['204']).toEqual({ description: '无响应体' });
  });

  it('重复执行不会产生嵌套 envelope', () => {
    const document = createDocument();
    applySuccessResponseEnvelope(document);
    applySuccessResponseEnvelope(document);

    const response = document.paths['/candidates'].get?.responses['200'];
    expect(JSON.stringify(response).match(/ApiSuccessEnvelope/g)).toHaveLength(1);
  });
});
