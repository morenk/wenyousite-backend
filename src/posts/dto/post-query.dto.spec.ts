import { validate } from 'class-validator';
import { PostQueryDto } from './post-query.dto';

describe('PostQueryDto authorId', () => {
  it('允许省略、现有 CUID 或 UUID 用户 ID，拒绝普通字符串', async () => {
    const omitted = Object.assign(new PostQueryDto(), {});
    const cuid = Object.assign(new PostQueryDto(), {
      authorId: 'cms7rnyij000z7qdyg6zbge8e',
    });
    const uuid = Object.assign(new PostQueryDto(), {
      authorId: '550e8400-e29b-41d4-a716-446655440000',
    });
    const invalid = Object.assign(new PostQueryDto(), { authorId: 'author-1' });

    expect(await validate(omitted)).toEqual([]);
    expect(await validate(cuid)).toEqual([]);
    expect(await validate(uuid)).toEqual([]);
    expect((await validate(invalid)).some((error) => error.property === 'authorId')).toBe(true);
  });
});
