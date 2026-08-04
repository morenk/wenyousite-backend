/** 创建帖子 DTO 契约测试：客户端幂等 UUID */

import { validate } from 'class-validator';
import { CreatePostDto } from './create-post.dto';

describe('CreatePostDto clientRequestId', () => {
  it('允许省略或提供 UUID v4，拒绝普通字符串', async () => {
    const omitted = Object.assign(new CreatePostDto(), { content: '正文' });
    const valid = Object.assign(new CreatePostDto(), {
      content: '正文', clientRequestId: '6f9619ff-8b86-4e4b-a59b-19a25f6d6f77',
    });
    const invalid = Object.assign(new CreatePostDto(), { content: '正文', clientRequestId: 'retry-1' });

    expect(await validate(omitted)).toEqual([]);
    expect(await validate(valid)).toEqual([]);
    expect((await validate(invalid)).some((error) => error.property === 'clientRequestId')).toBe(true);
  });
});
