/** 帖内搜索控制器契约测试：保证可选登录态与分页响应声明不被回归。 */

import 'reflect-metadata';
import { DECORATORS } from '@nestjs/swagger';
import { AUTH_MODE_KEY, AuthMode } from '../auth/decorators/auth-mode.constants';
import { SearchPostResponseDto } from './dto/search-response.dto';
import { ThreadSearchController } from './thread-search.controller';

describe('ThreadSearchController', () => {
  it('帖内楼层搜索使用可选认证并声明分页帖子响应', () => {
    const method = ThreadSearchController.prototype.searchPosts;
    const authMode = Reflect.getMetadata(AUTH_MODE_KEY, method);
    const responses = Reflect.getMetadata(
      DECORATORS.API_RESPONSE,
      method,
    ) as Record<number, { type?: unknown; isArray?: boolean }>;

    expect(authMode).toBe(AuthMode.OPTIONAL);
    expect(responses[200]).toMatchObject({
      type: SearchPostResponseDto,
      isArray: true,
    });
    expect(responses[400]).toBeDefined();
    expect(responses[404]).toBeDefined();
  });
});
