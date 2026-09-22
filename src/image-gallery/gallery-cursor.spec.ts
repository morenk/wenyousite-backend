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
      snapshotTx: '1:2:',
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
  it('允许的最长快照和置顶集合生成的游标小于查询参数上限', () => {
    const large = { ...cursor, session: { ...cursor.session, snapshotTx: '1:2:' + '3,'.repeat(1022),
      scopeId: 's'.repeat(64), viewerId: 'v'.repeat(64), authorId: 'a'.repeat(64), pinnedIds: Array.from({ length: 10 }, () => 'p'.repeat(64)) } };
    const token = encodeGalleryCursor(large, 'secret');
    expect(token.length).toBeLessThan(8192);
    expect(decodeGalleryCursor(token, 'secret')).toEqual(large);
    expect(() => decodeGalleryCursor(encodeGalleryCursor({ ...large, session: { ...large.session, snapshotTx: '1'.repeat(2049) } }, 'secret'), 'secret')).toThrow();
  });

});
