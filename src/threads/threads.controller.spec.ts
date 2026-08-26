import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AUTH_MODE_KEY, AuthMode } from '../auth/decorators/auth-mode.constants';
import { ThreadsController } from './threads.controller';

const contract = JSON.parse(
  readFileSync(resolve(__dirname, '../../contracts/openapi.json'), 'utf8'),
) as {
  paths: Record<
    string,
    Record<
      string,
      {
        responses?: Record<
          string,
          {
            description?: string;
            content?: Record<string, { schema?: { $ref?: string } }>;
          }
        >;
      }
    >
  >;
};

describe('ThreadsController authentication metadata', () => {
  it('主题列表使用可选认证，以便匿名浏览和登录态筛选同时生效', () => {
    const authMode = Reflect.getMetadata(
      AUTH_MODE_KEY,
      ThreadsController.prototype.findAll,
    );
    expect(authMode).toBe(AuthMode.OPTIONAL);
  });
});

describe('ThreadsController 私密存在性 OpenAPI 契约', () => {
  it.each([
    ['/api/v1/threads/{id}', 'delete'],
    ['/api/v1/threads/{id}/like', 'post'],
    ['/api/v1/threads/{id}/like', 'delete'],
  ])('%s %s 显式声明不可见主题的 404', (path, method) => {
    expect(contract.paths[path]?.[method]?.responses?.['404']).toMatchObject({
      description: '主题帖不存在、已删除，或当前用户无权访问未发布/PRIVATE 主题',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ApiErrorEnvelope' },
        },
      },
    });
  });
});
