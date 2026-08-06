import { countMembersAndPosts } from './prisma-helpers';

describe('Prisma query helpers', () => {
  it('主题帖楼层计数排除正文和软删除楼层', () => {
    expect(countMembersAndPosts()).toEqual({
      _count: {
        select: {
          members: true,
          posts: { where: { kind: 'FLOOR', deletedAt: null } },
        },
      },
    });
  });
});
