import { PrismaService } from '../prisma/prisma.service';
import { MediaDisplayProjectionService } from './media-display-projection.service';

const url = 'https://cdn.test/a.gif';
const display = { url: 'https://cdn.test/a_display.webp', contentType: 'image/webp', width: 10, height: 20,
  bytes: 100, animated: true, frameCount: 2, durationMs: 300, loopCount: 0 };
function media(overrides: Record<string, unknown> = {}) {
  return { id: 'm', url, purpose: 'RICH_CONTENT', displayAsset: display,
    avatarUser: null, profileCoverUser: null, profileCoverMobileUser: null,
    postAttachments: [{ postId: 'p', post: { threadId: 't' } }], draftAttachments: [], ...overrides };
}

describe('授权响应完整展示投影', () => {
  const prisma = { media: { findMany: jest.fn() }, stickerAsset: { findMany: jest.fn() } };
  const service = new MediaDisplayProjectionService(prisma as unknown as PrismaService);
  beforeEach(() => { jest.clearAllMocks(); prisma.media.findMany.mockResolvedValue([media()]); prisma.stickerAsset.findMany.mockResolvedValue([]); });

  it('正文身份不改，嵌套楼中楼必须各自有账本，代码内图片不参与', async () => {
    const value = { id: 'p', threadId: 't', content: `![x](${url})\n\n\`![code](https://cdn.test/secret.gif)\``,
      replies: [{ id: 'reply', threadId: 't', content: `![x](${url})` }] };
    const result = await service.project(value);
    expect(result).toMatchObject({ content: value.content, mediaDisplays: [{ sourceUrl: url, display }], replies: [{ mediaDisplays: [] }] });
    expect(prisma.media.findMany.mock.calls[0][0].where.url.in).toEqual([url]);
  });
  it.each(['DIRECT_MESSAGE', 'AVATAR', 'STICKER_SOURCE'])('公开正文伪造%s来源即使URL存在也不扩展', async (purpose) => {
    prisma.media.findMany.mockResolvedValue([media({ purpose })]);
    expect(await service.project({ id: 'p', threadId: 't', content: `![x](${url})` })).toMatchObject({ mediaDisplays: [] });
  });
  it('撤回/删除/未返回正文不触发正文解析，头像注销不恢复', async () => {
    expect(await service.project({ content: null, media: null, recalledAt: new Date() })).toEqual({ content: null, media: null, recalledAt: expect.any(Date) });
    await service.project({ id: 'p', threadId: 't', deletedAt: new Date(), content: `![x](${url})` });
    await service.project({ id: 'u', username: 'gone', avatar: url, deletedAt: new Date() });
    expect(prisma.media.findMany).not.toHaveBeenCalled();
  });
  it('草稿必须对应此草稿账本；来源主机/query变化不匹配', async () => {
    prisma.media.findMany.mockResolvedValue([media({ draftAttachments: [{ draftId: 'd' }] })]);
    expect(await service.project({ id: 'd', slot: 1, content: `![x](${url})` })).toMatchObject({ mediaDisplays: [{ sourceUrl: url, display }] });
    for (const source of [url + '?copy=1', url.replace('cdn.test', 'other.test')]) {
      expect(await service.project({ id: 'd', slot: 1, content: `![x](${source})` })).toMatchObject({ mediaDisplays: [] });
    }
  });
  it('重复URL不任选一条，缺display不猜后缀', async () => {
    prisma.media.findMany.mockResolvedValue([media(), media({ id: 'duplicate' })]);
    expect(await service.project({ id: 'p', threadId: 't', content: `![x](${url})` })).toMatchObject({ mediaDisplays: [] });
    prisma.media.findMany.mockResolvedValue([media({ displayAsset: null })]);
    expect(await service.project({ id: 'p', threadId: 't', content: `![x](${url})` })).toMatchObject({ mediaDisplays: [{ sourceUrl: url, display: null }] });
  });
  it('头像必须此用户绑定，封面必须此主题正文引用，结构化媒体保留来源', async () => {
    prisma.media.findMany.mockResolvedValue([media({ avatarUser: { id: 'u' } })]);
    const result = await service.project([{ id: 'u', username: 'a', avatar: url },
      { id: 'other', username: 'b', avatar: url }, { id: 't', coverMedia: { url } },
      { id: 'other-thread', coverMedia: { url } }, { media: { id: 'm', url, contentType: 'image/gif' } }]);
    expect(result).toMatchObject([{ avatarDisplay: display }, { avatarDisplay: null },
      { coverMedia: { display } }, { coverMedia: { display: null } }, { media: { url, display } }]);
  });
  it('Mention/通知/邀请/搜索真实用户名摘要都能投影，具名Moment和DM表情同形', async () => {
    prisma.media.findMany.mockResolvedValue([media({ avatarUser: { id: 'u' } })]);
    prisma.stickerAsset.findMany.mockResolvedValue([{ id: 's', url: 'https://cdn.test/s.webp', displayAsset: display }]);
    const value = {
      users: [{ id: 'u', username: 'name', avatar: url, relation: 'PLAYER' }],
      fromUser: { id: 'u', username: 'name', avatar: url, level: 1, deletedAt: null },
      owner: { id: 'u', username: 'name', avatar: url },
      search: { id: 'u', username: 'name', avatar: url, bio: null },
      moment: { coverMedia: { id: 'm', url, contentType: 'image/gif', width: 10, height: 20, animated: true } },
      comment: { media: { id: 'm', url, contentType: 'image/gif' } },
      direct: { sticker: { id: 's', url: 'https://cdn.test/s.webp', animated: true, width: 10, height: 20 } },
    };
    expect(await service.project(value)).toMatchObject({ users: [{ avatarDisplay: display }], fromUser: { avatarDisplay: display },
      owner: { avatarDisplay: display }, search: { avatarDisplay: display }, moment: { coverMedia: { display } },
      comment: { media: { display } }, direct: { sticker: { display } } });
  });
  it('正文只对实际规范表情标记和相同资产ID返回WebP描述', async () => {
    prisma.media.findMany.mockResolvedValue([]);
    const id = 'cm00000000000000000000000';
    const sourceUrl = 'https://cdn.test/s.webp';
    prisma.stickerAsset.findMany.mockResolvedValue([{ id, url: sourceUrl, displayAsset: display }]);
    expect(await service.project({ id: 'p', kind: 'BODY', content: `![表情](${sourceUrl} "wenyousite-sticker:v1:${id}")` })).toMatchObject({ mediaDisplays: [{ sourceUrl, display }] });
    expect(await service.project({ id: 'p', kind: 'BODY', content: `![x](${sourceUrl})` })).toMatchObject({ mediaDisplays: [] });
  });
  it('完整display可证明历史封面动画，缺poster仍保留空值而不猜路径', async () => {
    const result = await service.project({ id: 't', coverMedia: { url, animated: null, posterUrl: null } });
    expect(result).toMatchObject({ coverMedia: { display, animated: true, posterUrl: null } });
  });
  it('所有查询固定分块并过滤完成状态与删除领取，巨大正文不形成查询', async () => {
    prisma.media.findMany.mockResolvedValue([]);
    await service.project({ id: 'p', threadId: 't', content: 'x'.repeat(1_000_001) });
    expect(prisma.media.findMany).not.toHaveBeenCalled();
    await service.project({ id: 'p', threadId: 't', content: Array.from({ length: 2100 }, (_, i) => `![x](https://cdn.test/${i}.gif)`).join('\n') });
    expect(prisma.media.findMany).toHaveBeenCalledTimes(10);
    for (const [query] of prisma.media.findMany.mock.calls) {
      expect(query.where).toMatchObject({ status: 'COMPLETED', deletionClaimedAt: null });
      expect(query.where.url.in.length).toBeLessThanOrEqual(200);
    }
  });
});
