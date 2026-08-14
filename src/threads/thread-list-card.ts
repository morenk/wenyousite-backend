import { Prisma } from '@prisma/client';
import { authorSelect, countMembersAndPosts, notDeleted } from '../common/prisma-helpers';
import { truncateMarkdown } from '../common/markdown-truncate';
import {
  extractMarkdownCoverImages,
  stripVisibleMarkdownImages,
} from '../common/markdown-cover-images';

/** 首页与显式搜索共用的主题帖卡片查询投影。 */
export const threadListCardInclude = {
  owner: { select: authorSelect },
  defaultSubthread: {
    select: {
      id: true,
      title: true,
      lastPostAt: true,
      posts: {
        where: { kind: 'BODY', ...notDeleted },
        take: 1,
        orderBy: { createdAt: 'asc' },
        select: { content: true },
      },
    },
  },
  topicTags: { include: { tag: true } },
  ...countMembersAndPosts(),
} satisfies Prisma.ThreadInclude;

export type ThreadListCardRow = Prisma.ThreadGetPayload<{
  include: typeof threadListCardInclude;
}>;

/** 把数据库行收敛为客户端唯一的主题帖列表卡片形状。 */
export function mapThreadListCard(thread: ThreadListCardRow) {
  const bodyContent = thread.defaultSubthread?.posts[0]?.content ?? '';
  const coverImages = extractMarkdownCoverImages(bodyContent);
  const preview = bodyContent
    ? truncateMarkdown(
        coverImages.length > 0 ? stripVisibleMarkdownImages(bodyContent) : bodyContent,
      )
    : '';
  const defaultSubthread = thread.defaultSubthread
    ? {
        id: thread.defaultSubthread.id,
        title: thread.defaultSubthread.title,
        lastPostAt: thread.defaultSubthread.lastPostAt,
      }
    : null;

  return {
    id: thread.id,
    title: thread.title,
    category: thread.category,
    status: thread.status,
    visibility: thread.visibility,
    published: thread.published,
    pinned: thread.pinned,
    tipTotal: thread.tipTotal,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    deletedAt: thread.deletedAt,
    owner: thread.owner,
    defaultSubthread,
    topicTags: thread.topicTags,
    _count: thread._count,
    preview,
    coverImages,
  };
}
