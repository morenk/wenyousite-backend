import { decodeGalleryCursor, encodeGalleryCursor, GalleryCursor } from './gallery-cursor';
import { GalleryScope } from './gallery.dto';
import { ReplyOrder } from '../common/dto/reply-query.dto';
describe('图片图集游标签名', () => {
  const cursor: GalleryCursor = {
    version: 1,
    session: {
      scope: GalleryScope.SUBTHREAD,
      scopeId: 'sub',
      viewerId: 'viewer',
      authorId: null,
      order: ReplyOrder.OLDEST,
      snapshot: Date.now(),
      pinnedIds: ['pin'],
    },
    boundary: { sourceId: 'post', sourceVersion: 2, imageIndex: 1, groupKey: 2, timeKey: 5 },
    direction: 'after',
  };
  it('往返保留快照、账号和边界，不接受伪造/跨密钥', () => {
    const token = encodeGalleryCursor(cursor, 'secret');
    expect(decodeGalleryCursor(token, 'secret')).toEqual(cursor);
    expect(() => decodeGalleryCursor(token, 'other')).toThrow();
    expect(() => decodeGalleryCursor(token + 'x', 'secret')).toThrow();
    expect(() => decodeGalleryCursor(token + '.extra', 'secret')).toThrow();
    expect(() => decodeGalleryCursor('invalid', 'secret')).toThrow();
  });
  it('过期会话必须重新打开', () => {
    const expired = {
      ...cursor,
      session: { ...cursor.session, snapshot: Date.now() - 25 * 3600000 },
    };
    expect(() => decodeGalleryCursor(encodeGalleryCursor(expired, 'secret'), 'secret')).toThrow();
  });
});
