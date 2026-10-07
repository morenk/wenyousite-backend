import { ReplyOrder } from '../common/dto/reply-query.dto';
import { ErrorCode } from '../common/exceptions/error-codes';
import { GalleryContext } from './gallery-access.service';
import { decodeGalleryCursor, encodeGalleryCursor, GallerySession } from './gallery-cursor';
import { GalleryQueryDto, GalleryScope } from './gallery.dto';
import { GalleryRow } from './gallery-rows.service';
import { GalleryService } from './gallery.service';

const secret = 'gallery-service-unit-test-secret';
function row(sourceId = 'post', extra: Partial<GalleryRow> = {}): GalleryRow {
  return {
    sourceId,
    sourceVersion: 2,
    imageIndex: 0,
    imageCount: 1,
    groupKey: 2,
    timeKey: 4,
    url: `https://images.invalid/${sourceId}.png`,
    mediaId: null,
    threadId: 'thread',
    subthreadId: 'sub',
    parentPostId: null,
    momentId: null,
    parentCommentId: null,
    floorNumber: 4,
    ...extra,
  };
}
function setup(scope = GalleryScope.SUBTHREAD) {
  const anchor = row();
  const context: GalleryContext = {
    threadId: [GalleryScope.SUBTHREAD, GalleryScope.POST_REPLIES].includes(scope) ? 'thread' : null,
    subthreadId: 'sub',
    momentId: 'moment',
    ownerId: 'owner',
  };
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([{ snapshotTx: '1:5:' }]),
    post: {
      findMany: jest.fn().mockResolvedValue([{ id: 'pin' }]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    momentComment: { findFirst: jest.fn().mockResolvedValue(null) },
    media: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const access = {
    assert: jest.fn().mockResolvedValue(context),
    eligibleAuthor: jest.fn().mockResolvedValue(true),
    postWhere: jest.fn().mockReturnValue({ deletedAt: null }),
  };
  const rows = {
    anchor: jest.fn().mockResolvedValue(anchor),
    adjacent: jest.fn().mockResolvedValue([]),
    contentChanged: jest.fn().mockResolvedValue(false),
  };
  const service = new GalleryService(
    prisma as never,
    access as never,
    rows as never,
    { getOrThrow: () => secret } as never,
  );
  const query: GalleryQueryDto = {
    scope,
    scopeId: 'sub',
    anchorId: 'post',
    anchorIndex: 0,
    anchorVersion: 2,
    limit: 3,
  };
  const session: GallerySession = {
    scope,
    scopeId: 'sub',
    order: ReplyOrder.OLDEST,
    authorId: null,
    viewerId: 'viewer',
    snapshot: Date.now(),
    snapshotTx: '1:5:',
    pinnedIds: ['pin'],
  };
  const token = (overrides: Partial<GallerySession> = {}, boundary: GalleryRow = anchor) =>
    encodeGalleryCursor(
      { version: 1, session: { ...session, ...overrides }, boundary, direction: 'after' },
      secret,
    );
  return { service, prisma, access, rows, anchor, query, session, token };
}

describe('GalleryService', () => {
  it('锚点前后组窗，媒体仅接受唯一关联并将分页绑定原快照和查看者', async () => {
    const { service, prisma, rows, query, anchor, access } = setup();
    const before = row('before', { mediaId: 'media-before' });
    const after = row('after');
    rows.adjacent
      .mockResolvedValueOnce([before])
      .mockResolvedValueOnce([after])
      .mockResolvedValueOnce([row('previous')])
      .mockResolvedValueOnce([row('next')]);
    const asset = (id: string, source: GalleryRow) => ({
      id,
      url: source.url,
      width: 640,
      height: 480,
      animated: true,
      displayAsset: null,
      postAttachments: [{ postId: source.sourceId }],
    });
    prisma.media.findMany.mockResolvedValue([
      asset('media-before', before),
      asset('unique', anchor),
      asset('ambiguous-1', after),
      asset('ambiguous-2', after),
    ]);

    const result = await service.list(query, 'viewer');

    expect(result.items.map((item) => item.sourceId)).toEqual(['before', 'post', 'after']);
    expect(result.items[0]).toMatchObject({
      mediaId: 'media-before',
      width: 640,
      height: 480,
      animated: true,
    });
    expect(result.items[1]).toMatchObject({ mediaId: 'unique', id: 'post:post:2:0' });
    expect(result.items[2]).toMatchObject({
      mediaId: null,
      width: null,
      height: null,
      animated: false,
    });
    expect(result.anchorItemId).toBe('post:post:2:0');
    const previous = decodeGalleryCursor(result.previousCursor!, secret);
    const next = decodeGalleryCursor(result.nextCursor!, secret);
    expect(previous).toMatchObject({
      direction: 'before',
      boundary: { sourceId: 'before' },
      session: { viewerId: 'viewer', snapshotTx: '1:5:', pinnedIds: ['pin'] },
    });
    expect(next).toMatchObject({
      direction: 'after',
      boundary: { sourceId: 'after' },
      session: previous.session,
    });
    expect(access.assert).toHaveBeenCalledTimes(2);
    expect(rows.contentChanged).toHaveBeenCalledTimes(2);
    expect(prisma.media.findMany.mock.calls[0][0].where).toMatchObject({
      status: 'COMPLETED',
      deletionClaimedAt: null,
    });
  });

  it('继续游标复用原快照；空末页不再次返回锚点或查询媒体', async () => {
    const { service, prisma, rows, query, token, session } = setup();
    const result = await service.list({ ...query, cursor: token(), anchorId: undefined }, 'viewer');
    expect(result).toEqual({
      items: [],
      previousCursor: null,
      nextCursor: null,
      anchorItemId: null,
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.media.findMany).not.toHaveBeenCalled();
    expect(rows.adjacent.mock.calls[0]).toEqual([
      session,
      expect.any(Object),
      true,
      expect.any(Object),
      'after',
      3,
    ]);
  });

  it.each([
    { scope: GalleryScope.POST_REPLIES },
    { scopeId: 'other' },
    { order: ReplyOrder.NEWEST },
    { authorId: 'other' },
    { viewerId: 'other' },
  ])('拒绝跨范围、排序、筛选或查看者复用游标：%j', async (override) => {
    const { service, query, token, access } = setup();
    await expect(
      service.list({ ...query, cursor: token(override) }, 'viewer'),
    ).rejects.toMatchObject({ errorCode: ErrorCode.INVALID_CURSOR });
    expect(access.assert).not.toHaveBeenCalled();
  });

  it('动态正文不能作者筛选，未授权范围在快照读取前拒绝', async () => {
    const { service, query, access, prisma } = setup(GalleryScope.MOMENT);
    await expect(service.list({ ...query, authorId: 'author' })).rejects.toMatchObject({
      errorCode: ErrorCode.BAD_REQUEST,
    });
    expect(access.assert).not.toHaveBeenCalled();
    access.assert.mockRejectedValue(new Error('denied'));
    await expect(service.list(query)).rejects.toThrow('denied');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('不完整初始锚点和过大的事务快照拒绝产出会话', async () => {
    const { service, query, prisma, rows } = setup();
    await expect(service.list({ ...query, anchorIndex: undefined })).rejects.toMatchObject({
      errorCode: ErrorCode.BAD_REQUEST,
    });
    prisma.$queryRaw.mockResolvedValue([{ snapshotTx: '1'.repeat(2049) }]);
    await expect(service.list(query)).rejects.toMatchObject({ errorCode: ErrorCode.CONFLICT });
    expect(rows.anchor).not.toHaveBeenCalled();
  });

  it('未完成索引和查询期间编辑分别拒绝返回半成品或旧快照', async () => {
    const { service, query, prisma, rows } = setup(GalleryScope.POST_REPLIES);
    prisma.post.findFirst.mockResolvedValueOnce({ id: 'unindexed' });
    await expect(service.list(query)).rejects.toMatchObject({
      errorCode: ErrorCode.IMAGE_GALLERY_NOT_READY,
    });
    expect(rows.anchor).not.toHaveBeenCalled();
    rows.contentChanged.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await expect(service.list({ ...query, authorId: 'author' })).rejects.toMatchObject({
      errorCode: ErrorCode.CONFLICT,
    });
    expect(prisma.post.findFirst.mock.calls.at(-1)![0].where).toMatchObject({
      AND: [{ OR: [{ kind: 'BODY' }, { authorId: 'author' }] }],
    });
  });

  it('交付前再次拒绝已撤销的范围权限', async () => {
    const { service, query, access } = setup();
    access.assert.mockRejectedValueOnce(new Error('denied-before-read'));
    await expect(service.list(query)).rejects.toThrow('denied-before-read');
    access.assert
      .mockResolvedValueOnce({ threadId: 'thread' })
      .mockRejectedValueOnce(new Error('revoked'));
    await expect(service.list(query)).rejects.toThrow('revoked');
  });

  it.each(['version', 'group', 'time'] as const)('锚点 %s 改变后要求重开画廊', async (field) => {
    const { service, query, anchor, rows, token } = setup();
    rows.anchor.mockResolvedValue({
      ...anchor,
      ...(field === 'version'
        ? { sourceVersion: 3 }
        : field === 'group'
          ? { groupKey: 9 }
          : { timeKey: 9 }),
    });
    await expect(service.list({ ...query, cursor: token() }, 'viewer')).rejects.toMatchObject({
      errorCode: ErrorCode.CONFLICT,
    });
    expect(rows.adjacent).not.toHaveBeenCalled();
  });

  it.each([
    { visible: null, eligible: true, errorCode: ErrorCode.NOT_FOUND },
    { visible: { kind: 'FLOOR' }, eligible: false, errorCode: ErrorCode.NOT_FOUND },
    { visible: { kind: 'BODY' }, eligible: false, errorCode: ErrorCode.CONFLICT },
    { visible: { kind: 'FLOOR' }, eligible: true, errorCode: ErrorCode.CONFLICT },
  ])('无图锚点先区分帖子可见性再决定重开：%j', async ({ visible, eligible, errorCode }) => {
    const { service, query, prisma, rows, access } = setup();
    rows.anchor.mockResolvedValue(null);
    access.eligibleAuthor.mockResolvedValue(eligible);
    prisma.post.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(visible);
    await expect(service.list({ ...query, authorId: 'author' }, 'viewer')).rejects.toMatchObject({
      errorCode,
    });
    expect(prisma.post.findFirst.mock.calls[1][0].where).toMatchObject({
      id: 'post',
      AND: [{ OR: [{ kind: 'BODY' }, { authorId: 'author' }] }],
    });
  });

  it('动态正文锚点必须属于本动态，已有来源失去图片则要求重开', async () => {
    const { service, query, rows } = setup(GalleryScope.MOMENT);
    rows.anchor.mockResolvedValue(null);
    await expect(service.list(query)).rejects.toMatchObject({ errorCode: ErrorCode.NOT_FOUND });
    await expect(service.list({ ...query, anchorId: 'moment' })).rejects.toMatchObject({
      errorCode: ErrorCode.CONFLICT,
    });
  });

  it.each([GalleryScope.MOMENT_COMMENTS, GalleryScope.MOMENT_REPLIES])(
    '评论来源不可见即拒绝，来源可见但失去图片则重开：%s',
    async (scope) => {
      const { service, query, rows, prisma } = setup(scope);
      rows.anchor.mockResolvedValue(null);
      await expect(service.list({ ...query, authorId: 'author' }, 'viewer')).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
      expect(prisma.momentComment.findFirst.mock.calls[0][0].where).toMatchObject({
        id: 'post',
        momentId: 'moment',
        authorId: 'author',
        deletedAt: null,
        parentCommentId: scope === GalleryScope.MOMENT_COMMENTS ? null : 'sub',
      });
      prisma.momentComment.findFirst.mockResolvedValue({ id: 'post' });
      await expect(service.list(query)).rejects.toMatchObject({ errorCode: ErrorCode.CONFLICT });
    },
  );

  it.each([
    { scope: GalleryScope.MOMENT, sourceId: 'moment', parentCommentId: null, prefix: 'moment' },
    {
      scope: GalleryScope.MOMENT_COMMENTS,
      sourceId: 'comment',
      parentCommentId: null,
      prefix: 'comment',
    },
    {
      scope: GalleryScope.MOMENT_REPLIES,
      sourceId: 'reply',
      parentCommentId: 'comment',
      prefix: 'comment',
    },
  ])('为不同来源保留导航身份：$scope', async ({ scope, sourceId, parentCommentId, prefix }) => {
    const { service, query, rows } = setup(scope);
    rows.anchor.mockResolvedValue(
      row(sourceId, { threadId: null, subthreadId: null, momentId: 'moment', parentCommentId }),
    );
    const result = await service.list({ ...query, anchorId: sourceId });
    expect(result.anchorItemId).toBe(`${prefix}:${sourceId}:2:0`);
    expect(result.items[0]).toMatchObject({ momentId: 'moment', parentCommentId });
    expect(rows.anchor.mock.calls[0][0].order).toBe(
      scope === GalleryScope.MOMENT_COMMENTS ? ReplyOrder.NEWEST : ReplyOrder.OLDEST,
    );
  });
});
