import { GUARDS_METADATA } from '@nestjs/common/constants';
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard';
import { ThreadsController } from './threads.controller';

describe('ThreadsController authentication metadata', () => {
  it('主题列表使用可选认证，以便匿名浏览和登录态筛选同时生效', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      ThreadsController.prototype.findAll,
    ) as unknown[];
    expect(guards).toContain(OptionalJwtAuthGuard);
  });
});
