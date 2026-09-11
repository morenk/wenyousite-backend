import { mediaVariantUrls } from '../media/media-response.mapper';
import { visiblePostWhere } from '../access/block-visibility.where';
import { readPreviewDescriptors } from '../media/media-animation-preview-policy';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ThreadCoverMediaResponseDto } from './dto/thread-list-response.dto';
import { authorSelect, countMembersAndPosts } from '../common/prisma-helpers';
import { truncateMarkdownToCompactPlainText } from '../common/markdown-truncate';
import {
  extractMarkdownCoverImages,
  stripVisibleMarkdownImages,
} from '../common/markdown-cover-images';
import {
  threadCategoryInfoSelect,
  withThreadCategoryInfo,
} from '../taxonomy/thread-category-info';

/** 首页、搜索、收藏和用户主页共用的主题帖卡片查询投影。 */
export const threadListCardIncludeFor = (viewerId?: string) => ({
  owner: { select: authorSelect },
  categoryDefinition: { select: threadCategoryInfoSelect },
  defaultSubthread: {
    select: {
      id: true,
      title: true,
      lastPostAt: true,
      posts: {
        where: { kind: 'BODY', ...visiblePostWhere(viewerId) },
        take: 1,
        orderBy: { createdAt: 'asc' },
        select: { content: true },
      },
    },
  },
  topicTags: { include: { tag: true } },
  ...countMembersAndPosts(viewerId),
} satisfies Prisma.ThreadInclude);

export const threadListCardInclude = threadListCardIncludeFor();

export type ThreadListCardRow = Prisma.ThreadGetPayload<{
  include: typeof threadListCardInclude;
}>;

/** 把数据库行收敛为客户端唯一的主题帖列表卡片形状。 */
export function mapThreadListCard(thread: ThreadListCardRow) {
  const bodyContent = thread.defaultSubthread?.posts?.[0]?.content ?? '';
  const coverImages = extractMarkdownCoverImages(bodyContent);
  const preview = bodyContent
    ? truncateMarkdownToCompactPlainText(
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

  return withThreadCategoryInfo({
    id: thread.id,
    title: thread.title,
    category: thread.category,
    categoryDefinition: thread.categoryDefinition,
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
    coverMedia: coverImages[0]
      ? { url: coverImages[0], animated: null, posterUrl: null, previewVariants: null } as ThreadCoverMediaResponseDto
      : null,
  });
}

/** 只解析已经通过帖子可见性过滤的卡片；按精确 URL 一次查询，不在列表读取对象存储。 */
export async function resolveThreadListCards(prisma: PrismaService, threads: ThreadListCardRow[]) {
  const cards = threads.map(mapThreadListCard);
  const urls = [...new Set(cards.flatMap((card) => card.coverImages))];
  if (urls.length === 0) return cards;
  const media = await prisma.media.findMany({
    where: { url: { in: urls }, status: 'COMPLETED', deletionClaimedAt: null },
    select: { url: true, contentType: true, animated: true, posterUrl: true, previewVariants: true, purpose: true },
  });
  const byUrl = new Map<string, typeof media>();
  for (const item of media) byUrl.set(item.url, [...(byUrl.get(item.url) ?? []), item]);
  for (const card of cards) {
    const cover = card.coverMedia;
    if (!cover) continue;
    const matches = byUrl.get(cover.url);
    // 历史重复 URL 不能任意挑一条记录来宣布其静态/动画属性。
    if (matches?.length !== 1) continue;
    const item = matches[0];
    if (item.posterUrl) {
      cover.animated = item.animated;
      cover.posterUrl = item.posterUrl;
      cover.previewVariants = item.animated ? readPreviewDescriptors(item.previewVariants) : null;
    } else if (!item.animated && ['image/jpeg', 'image/webp'].includes(item.contentType ?? '')) {
      // JPEG 本身静态；本站现有 WebP 母版经静态归一化，动画 WebP 输入仍被拒绝。
      cover.animated = false;
      cover.posterUrl = item.purpose
        ? mediaVariantUrls({ ...item, status: 'COMPLETED' }).feedUrl ?? item.url
        : item.url;
    }
  }
  return cards;
}
