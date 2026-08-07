import { validate } from 'class-validator';
import { ThreadQueryDto } from './thread-query.dto';

describe('ThreadQueryDto tagId', () => {
  it('允许省略或提供 CUID，拒绝无效标签 ID', async () => {
    const omitted = Object.assign(new ThreadQueryDto(), { sort: 'newest' });
    const valid = Object.assign(new ThreadQueryDto(), {
      tagId: 'cms7rnyij000z7qdyg6zbge8e',
    });
    const invalid = Object.assign(new ThreadQueryDto(), { tagId: 'tag-1' });

    expect(await validate(omitted)).toEqual([]);
    expect(await validate(valid)).toEqual([]);
    expect((await validate(invalid)).some((error) => error.property === 'tagId')).toBe(true);
  });
});
