import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { AdminContentQueryDto, UpdateContentTaxonomyDto } from './admin-content.dto';
import { AdminContentController } from '../admin-content.controller';
import { AdminGuard } from '../guards/admin.guard';
import { AdminAuthService } from '../admin-auth.service';
import { AUTH_MODE_KEY, AuthMode } from '../../auth/decorators/auth-mode.constants';

describe('综合管理内容输入与认证边界', () => {
  it('分类遵循注册表规范，理由去除空白', async () => {
    const dto = plainToInstance(UpdateContentTaxonomyDto, {
      category: ' next ',
      reason: ' 整理 ',
      version: 1,
      tagIds: [],
    });
    expect(dto.category).toBe('NEXT');
    expect(dto.reason).toBe('整理');
    expect(await validate(dto)).toHaveLength(0);
  });
  it.each([
    { category: null },
    { category: '' },
    { category: 'bad-slug' },
    { tagIds: null },
    { tagIds: ['a', 'a'] },
    { tagIds: ['1', '2', '3', '4', '5', '6'] },
    { version: 0 },
    { reason: '   ' },
  ])('拒绝非法整理输入 %j', async (input) => {
    const dto = plainToInstance(UpdateContentTaxonomyDto, { version: 1, reason: '整理', ...input });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });
  it('分页仅接受20或50并校验时间、内容类型', async () => {
    expect(
      await validate(plainToInstance(AdminContentQueryDto, { limit: '50', type: 'post' })),
    ).toHaveLength(0);
    for (const input of [
      { limit: '100' },
      { limit: '1' },
      { type: 'private' },
      { createdAfter: 'invalid' },
    ]) {
      expect((await validate(plainToInstance(AdminContentQueryDto, input))).length).toBeGreaterThan(
        0,
      );
    }
  });
  it('新控制器只能使用管理Cookie，普通Bearer不会传给session校验', async () => {
    expect(Reflect.getMetadata(AUTH_MODE_KEY, AdminContentController)).toBe(AuthMode.ADMIN);
    const validateSession = jest.fn().mockRejectedValue(new Error('管理会话不存在'));
    const guard = new AdminGuard(new Reflector(), {
      validateSession,
    } as unknown as AdminAuthService);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization: 'Bearer ordinary-user' } }),
      }),
      getHandler: () => AdminContentController.prototype.list,
      getClass: () => AdminContentController,
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).rejects.toThrow('管理会话不存在');
    expect(validateSession).toHaveBeenCalledWith(undefined);
  });
});
