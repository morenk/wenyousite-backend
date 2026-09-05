import { visiblePostWhere } from '../access/block-visibility.where';
import { countMembersAndPosts } from './prisma-helpers';

describe('Prisma query helpers', () => {
  it('主题帖楼层计数排除正文和软删除楼层', () => {
    expect(countMembersAndPosts()).toEqual({
      _count: {
        select: {
          members: { where: { user: {} } },
          posts: { where: { kind: 'FLOOR', ...visiblePostWhere() } },
        },
      },
    });
  });
});
