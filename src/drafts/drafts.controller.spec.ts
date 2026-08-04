/** 草稿控制器契约测试：保证跨端草稿接口声明完整 Swagger 响应 DTO */

import 'reflect-metadata';
import { DECORATORS } from '@nestjs/swagger';
import { DraftsController } from './drafts.controller';
import {
  DeleteDraftResponseDto,
  DraftResponseDto,
  DraftSlotUsageResponseDto,
} from './dto/draft-response.dto';

function responseMetadata(method: keyof DraftsController) {
  return Reflect.getMetadata(
    DECORATORS.API_RESPONSE,
    DraftsController.prototype[method],
  ) as Record<number, { type?: unknown; isArray?: boolean }>;
}

describe('DraftsController Swagger 响应契约', () => {
  it('列表声明 DraftResponseDto 数组', () => {
    expect(responseMetadata('findAll')[200]).toMatchObject({
      type: DraftResponseDto,
      isArray: true,
    });
  });

  it.each([
    ['create', 201],
    ['findById', 200],
    ['update', 200],
  ] as const)('%s 声明 DraftResponseDto', (method, status) => {
    expect(responseMetadata(method)[status].type).toBe(DraftResponseDto);
  });

  it('槽位查询声明 DraftSlotUsageResponseDto', () => {
    expect(responseMetadata('slotUsage')[200].type).toBe(DraftSlotUsageResponseDto);
  });

  it('删除声明 DeleteDraftResponseDto', () => {
    expect(responseMetadata('remove')[200].type).toBe(DeleteDraftResponseDto);
  });

  it.each(['create', 'update'] as const)('%s 声明 409 并发冲突', (method) => {
    expect(responseMetadata(method)[409]).toBeDefined();
  });
});
