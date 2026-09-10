import { MediaPurpose } from '@prisma/client';
import { mapMomentCard, mapMomentComment, mapMomentDetail, type MomentCardRow } from './moment.mapper';

const author = { id: 'user-1', username: '作者', avatar: null, level: 1, deletedAt: null };
const gif = {
  id: 'media-1', url: 'https://cdn.example.test/master.gif',
  status: 'COMPLETED', contentType: 'image/gif', animated: true,
  width: 320, height: 240, purpose: MediaPurpose.MOMENT,
};
const expectedGif = {
  id: gif.id, url: gif.url, contentType: gif.contentType, animated: true, width: 320, height: 240,
  thumbnailUrl: 'https://cdn.example.test/master_thumb.webp', feedUrl: null, mediumUrl: null,
};

function moment(): MomentCardRow {
  return {
    id: 'moment-1', authorId: author.id, author, title: '动态图', content: '正文',
    textCoverTheme: 'ROSE', coverMedia: gif, likeCount: 0, commentCount: 0,
    bookmarkCount: 0, tipTotal: 0n, version: 1,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'), likes: [], bookmarks: [], _count: { images: 1 },
  };
}

function comment(parentCommentId: string | null = null) {
  return {
    id: 'comment-1', momentId: 'moment-1', authorId: author.id, author, content: '评论',
    media: { ...gif, purpose: MediaPurpose.MOMENT_COMMENT }, sticker: null,
    parentCommentId, replyToComment: null, deletedAt: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
  };
}

describe('动态媒体响应中的静态预览与动画原件', () => {
  it('列表封面和详情配图保留同一原件，只提供实际生成的静态缩略图', () => {
    expect(mapMomentCard(moment()).coverMedia).toEqual(expectedGif);
    const detail = mapMomentDetail({ ...moment(), images: [{ media: gif, sortOrder: 0 }] });
    expect(detail.coverMedia).toEqual(expectedGif);
    expect(detail.images).toEqual([expectedGif]);
  });

  it.each([null, 'root-1'])('评论与楼中楼 parent=%s 同样区分原件和缩略图', (parentId) => {
    expect(mapMomentComment(comment(parentId)).media).toEqual(expectedGif);
  });

  it.each(['PROCESSING', 'FAILED'])('状态 %s 不发布派生地址', (status) => {
    const source = { ...gif, status };
    const card = { ...moment(), coverMedia: source };
    expect(mapMomentCard(card).coverMedia).toEqual(expect.objectContaining({
      url: gif.url, animated: true, thumbnailUrl: null, feedUrl: null, mediumUrl: null,
    }));
    expect(mapMomentDetail({ ...card, images: [{ media: source, sortOrder: 0 }] }).images[0])
      .toEqual(expect.objectContaining({ thumbnailUrl: null, feedUrl: null, mediumUrl: null }));
  });

  it('缺少可推导派生地址的历史记录不伪造静态 URL', () => {
    expect(mapMomentCard({ ...moment(), coverMedia: { ...gif, url: 'https://cdn.example.test/opaque' } })
      .coverMedia).toEqual(expect.objectContaining({
        url: 'https://cdn.example.test/opaque', thumbnailUrl: null, feedUrl: null, mediumUrl: null,
      }));
  });

  it('静态动态图片保留原有三档派生地址与尺寸', () => {
    expect(mapMomentCard({ ...moment(), coverMedia: {
      ...gif, url: 'https://cdn.example.test/master.webp', contentType: 'image/webp', animated: false,
    } }).coverMedia).toEqual(expect.objectContaining({
      animated: false, width: 320, height: 240,
      thumbnailUrl: 'https://cdn.example.test/master_thumb.webp',
      feedUrl: 'https://cdn.example.test/master_feed.webp',
      mediumUrl: 'https://cdn.example.test/master_md.webp',
    }));
  });

  it('动态表情保留动画资产和独立静态缩略图，删除评论不泄漏媒体', () => {
    const sticker = {
      id: 'sticker-1', url: 'https://cdn.example.test/sticker.webp',
      thumbnailUrl: 'https://cdn.example.test/sticker-thumb.webp',
      width: 100, height: 100, animated: true, frameCount: 2, durationMs: 300,
    };
    const source = { ...comment(), media: null, sticker };
    expect(mapMomentComment(source).sticker).toEqual({ ...sticker, mediumUrl: sticker.url });
    expect(mapMomentComment({ ...source, deletedAt: new Date() })).toEqual(
      expect.objectContaining({ media: null, sticker: null }),
    );
  });
});
