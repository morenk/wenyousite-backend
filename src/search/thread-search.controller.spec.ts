/** 帖内搜索控制器契约测试：保证可选登录态与分页响应声明不被回归。 */

import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { DECORATORS } from '@nestjs/swagger';
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard';
import { SearchPostResponseDto } from './dto/search-response.dto';
import { ThreadSearchController } from './thread-search.controller';

describe('ThreadSearchController', () => {
  it('帖内楼层搜索使用可选认证并声明分页帖子响应', () => {
    const method = ThreadSearchController.prototype.searchPosts;
    const guards = Reflect.getMetadata(GUARDS_METADATA, method) as unknown[];
    const responses = Reflect.getMetadata(
      DECORATORS.API_RESPONSE,
      method,
    ) as Record<number, { type?: unknown; isArray?: boolean }>;

    expect(guards).toContain(OptionalJwtAuthGuard);
    expect(responses[200]).toMatchObject({
      type: SearchPostResponseDto,
      isArray: true,
    });
    expect(responses[400]).toBeDefined();
    expect(responses[404]).toBeDefined();
  });
});
