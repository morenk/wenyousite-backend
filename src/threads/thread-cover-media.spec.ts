
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { mapThreadListCard, resolveThreadListCards, ThreadListCardRow } from './thread-list-card';

const findMany = jest.fn();
const prisma = { media: { findMany } } as unknown as PrismaService;
function row(content: string, id = 'thread-1') {
  return {
    id, title: '帖子', category: null, categoryDefinition: null,
    defaultSubthread: { id: 'sub-1', title: '主贴', lastPostAt: null, posts: [{ content }] },
    topicTags: [], _count: { posts: 1, members: 1 },
  } as unknown as ThreadListCardRow;
}
const image = (url: string) => '![](' + url + ')';
const url = 'https://media.example.test/a.gif';

describe('主题帖封面媒体读模型', () => {
  beforeEach(() => findMany.mockReset().mockResolvedValue([]));

  it('无普通图和表情、代码图片都不发媒体查询', async () => {
    const content = '正文\n![](https://example.test/sticker "wenyousite-sticker:v1")\n`![](https://example.test/code)`';
    const cards = await resolveThreadListCards(prisma, [row(content)]);
    expect(cards[0].coverMedia).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('只处理第一张普通图并按原始 URL 去重，一批卡片只查询一次', async () => {
    const posterUrl = 'https://media.example.test/a_poster.webp';
    findMany.mockResolvedValue([{ url, animated: true, contentType: 'image/gif', posterUrl }]);
    const cards = await resolveThreadListCards(prisma, [
      row(image(url) + image('https://example.test/ignored'), 'a'), row(image(url), 'b'),
    ]);
    expect(cards.map((card) => card.coverMedia)).toEqual([
      { url, animated: true, posterUrl, previewVariants: null }, { url, animated: true, posterUrl, previewVariants: null },
    ]);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: { url: { in: [url] }, status: 'COMPLETED', deletionClaimedAt: null },
      select: { url: true, contentType: true, animated: true, posterUrl: true, previewVariants: true },
    });
  });

  it.each([false, true])('历史 GIF animated=%s 没有登记 poster 必须未知', async (animated) => {
    findMany.mockResolvedValue([{ url, animated, contentType: 'image/gif', posterUrl: null }]);
    expect((await resolveThreadListCards(prisma, [row(image(url))]))[0].coverMedia)
      .toEqual({ url, animated: null, posterUrl: null, previewVariants: null });
  });

  it.each(['image/jpeg', 'image/webp'])('可信历史静态 %s 可沿用母版', async (contentType) => {
    findMany.mockResolvedValue([{ url, animated: false, contentType, posterUrl: null }]);
    expect((await resolveThreadListCards(prisma, [row(image(url))]))[0].coverMedia)
      .toEqual({ url, animated: false, posterUrl: url, previewVariants: null });
  });

  it.each(['image/png', null, 'image/svg+xml'])('不能证明静态的历史 %s 保持未知', async (contentType) => {
    findMany.mockResolvedValue([{ url, animated: false, contentType, posterUrl: null }]);
    expect((await resolveThreadListCards(prisma, [row(image(url))]))[0].coverMedia)
      .toEqual({ url, animated: null, posterUrl: null, previewVariants: null });
  });

  it('重复地址、外链及不同 query 地址不任意匹配或猜衍生图', async () => {
    findMany.mockResolvedValue([
      { url, animated: true, contentType: 'image/gif', posterUrl: 'https://example.test/a_poster.webp' },
      { url, animated: false, contentType: 'image/jpeg', posterUrl: null },
    ]);
    const urls = [url, url + '?v=2', 'https://external.example.test/a.jpg'];
    const cards = await resolveThreadListCards(prisma, urls.map((value) => row(image(value))));
    expect(cards.map((card) => card.coverMedia)).toEqual(
      urls.map((value) => ({ url: value, animated: null, posterUrl: null, previewVariants: null })),
    );
  });

  it('共享语料保留旧服务缺字段和全部 nullable 状态', () => {
    const fixture = JSON.parse(readFileSync(resolve(__dirname, '../../contracts/thread-cover-media-v1-fixtures.json'), 'utf8'));
    expect(fixture.schemaVersion).toBe(1);
    for (const item of fixture.cases) {
      if (item.name === 'old-service') {
        expect(item).not.toHaveProperty('coverMedia');
      } else if (!item.coverImages.length) {
        expect(mapThreadListCard(row('')).coverMedia).toBeNull();
      } else {
        expect(item.coverMedia.url).toBe(item.coverImages[0]);
        expect([true, false, null]).toContain(item.coverMedia.animated);
        expect(item.coverMedia.posterUrl === null || typeof item.coverMedia.posterUrl === 'string').toBe(true);
      }
    }
  });
  it('只发布可信动画已登记的有效预览，原 URL 不变且按实际面积排序', async () => {
    const posterUrl = 'https://media.test/poster.webp';
    const variants = [
      { url: 'https://media.test/large.webp', width: 800, height: 450, bytes: 200 },
      { url: 'https://media.test/small.webp', width: 480, height: 270, bytes: 100 },
    ];
    findMany.mockResolvedValue([{ url, animated: true, posterUrl, previewVariants: variants }]);
    expect((await resolveThreadListCards(prisma, [row(image(url))]))[0].coverMedia)
      .toEqual({ url, animated: true, posterUrl, previewVariants: [...variants].reverse() });
    findMany.mockResolvedValue([{ url, animated: true, posterUrl, previewVariants: [{ ...variants[0], bytes: -1 }] }]);
    expect((await resolveThreadListCards(prisma, [row(image(url))]))[0].coverMedia!.previewVariants).toBeNull();
    findMany.mockResolvedValue([{ url, animated: true, posterUrl: null, previewVariants: variants }]);
    expect((await resolveThreadListCards(prisma, [row(image(url))]))[0].coverMedia!.previewVariants).toBeNull();
  });

});
