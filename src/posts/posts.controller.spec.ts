/** 帖子控制器契约测试：保证编辑器读写端点声明完整 Swagger 响应 DTO */

import 'reflect-metadata';
import { DECORATORS } from '@nestjs/swagger';
import { PostsController } from './posts.controller';
import {
  FloorResponseDto,
  PostDetailResponseDto,
  PostResponseDto,
  ReplyResponseDto,
} from './dto/post-response.dto';
import { ReplyOrder } from '../common/dto/reply-query.dto';

function responseMetadata(method: keyof PostsController) {
  return Reflect.getMetadata(
    DECORATORS.API_RESPONSE,
    PostsController.prototype[method],
  ) as Record<number, { type?: unknown; isArray?: boolean }>;
}

describe('PostsController Swagger 响应契约', () => {
  it('楼层分页声明 FloorResponseDto 数组', () => {
    expect(responseMetadata('findFloors')[200]).toMatchObject({
      type: FloorResponseDto,
      isArray: true,
    });
  });

  it('楼中楼分页声明 ReplyResponseDto 数组', () => {
    expect(responseMetadata('findReplies')[200]).toMatchObject({
      type: ReplyResponseDto,
      isArray: true,
    });
  });

  it.each([
    ['upsertBody', 200],
    ['create', 201],
    ['update', 200],
  ] as const)('%s 声明 PostResponseDto', (method, status) => {
    expect(responseMetadata(method)[status].type).toBe(PostResponseDto);
  });

  it('帖子详情声明 PostDetailResponseDto', () => {
    expect(responseMetadata('findById')[200].type).toBe(PostDetailResponseDto);
  });

  it('创建帖子声明 409 幂等键冲突', () => {
    expect(responseMetadata('create')[409]).toBeDefined();
  });

  it('楼层查询把显式倒序传给服务层', async () => {
    const postsService = {
      findAllBySubthread: jest.fn().mockResolvedValue({ items: [], meta: {} }),
    };
    const controller = new PostsController(postsService as never);

    await controller.findFloors(
      'subthread-1',
      { cursor: 'cursor-1', limit: 10, order: ReplyOrder.NEWEST },
      { user: { id: 'user-1' } } as never,
    );

    expect(postsService.findAllBySubthread).toHaveBeenCalledWith(
      'subthread-1',
      'cursor-1',
      10,
      'user-1',
      ReplyOrder.NEWEST,
    );
  });
});
