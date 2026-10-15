import { AudioProjectionService } from './audio-projection.service';
import { PrismaService } from '../prisma/prisma.service';
const url = 'https://audio.example/media/audio/a.mp3';
describe('可信音频投影', () => {
  const findMany = jest.fn();
  const service = new AudioProjectionService({ media: { findMany } } as unknown as PrismaService);
  const valid = {
    id: 'audio',
    url,
    size: 1024,
    durationMs: 1000,
    contentType: 'audio/mpeg',
    postAttachments: [{ postId: 'p' }],
    draftAttachments: [],
  };
  const body = () => ({
    id: 'p',
    threadId: 't',
    content: `[**用户**标签](${url})`,
    mediaAudios: [],
  });
  beforeEach(() => jest.resetAllMocks());
  it('仅为响应内正文与账本交集返回数据，保持标签原文', async () => {
    findMany.mockResolvedValue([valid]);
    const value = body();
    await service.project(value);
    expect(value.mediaAudios).toEqual([
      { sourceUrl: url, mediaId: 'audio', size: 1024, durationMs: 1000, contentType: 'audio/mpeg' },
    ]);
    expect(value.content).toContain('**用户**标签');
    expect(findMany.mock.calls[0][0].where).toMatchObject({
      purpose: 'RICH_CONTENT_AUDIO',
      status: 'COMPLETED',
      deletionClaimedAt: null,
    });
  });
  it.each([
    { id: '' },
    { size: 0 },
    { size: -1 },
    { size: 1.5 },
    { durationMs: 0 },
    { durationMs: -1 },
    { durationMs: 600001 },
    { durationMs: 1.5 },
    { contentType: 'text/html' },
    { postAttachments: [] },
    { url: 'https://audio.example/media/audio/other.mp3' },
  ])('拒绝错误投影 %j', async (patch) => {
    findMany.mockResolvedValue([{ ...valid, ...patch }]);
    const value = body();
    await service.project(value);
    expect(value.mediaAudios).toEqual([]);
  });
  it('拒绝歧义资源，已删除正文及代码链接', async () => {
    findMany.mockResolvedValue([valid, { ...valid, id: 'duplicate' }]);
    const value = body();
    await service.project(value);
    expect(value.mediaAudios).toEqual([]);
    findMany.mockClear();
    await service.project({ ...body(), deletedAt: new Date() });
    expect(findMany).not.toHaveBeenCalled();
    await service.project({ ...body(), content: '`[音频](' + url + ')`' });
    expect(findMany).not.toHaveBeenCalled();
  });
  it('草稿投影只能用本草稿账本', async () => {
    findMany.mockResolvedValue([{ ...valid, draftAttachments: [{ draftId: 'd' }] }]);
    const value = { id: 'd', slot: 1, content: `[音频](${url})`, mediaAudios: [] };
    await service.project(value);
    expect(value.mediaAudios).toHaveLength(1);
  });
});
