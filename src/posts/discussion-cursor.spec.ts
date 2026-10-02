import {
  decodeDiscussionCursor,
  encodeDiscussionCursor,
  DiscussionCursorContext,
} from './discussion-cursor';
const context: DiscussionCursorContext = {
  scope: 'replies',
  scopeId: 'root',
  order: 'OLDEST',
  authorId: null,
  viewerId: 'viewer',
};
describe('讨论定位游标', () => {
  const token = encodeDiscussionCursor(
    { ...context, version: 1, number: 2800, direction: 'after' },
    'secret',
  );
  it('只在同一查看者、范围、顺序、筛选下往返', () => {
    expect(decodeDiscussionCursor(token, context, 'secret').number).toBe(2800);
    for (const changed of [
      { scopeId: 'another' },
      { order: 'NEWEST' },
      { authorId: 'author' },
      { viewerId: null },
      { scope: 'floors' as const },
    ]) {
      expect(() => decodeDiscussionCursor(token, { ...context, ...changed }, 'secret')).toThrow();
    }
  });
  it('拒绝篡改、错误签名、无效边界和超长游标', () => {
    for (const value of [
      token + 'x',
      token + '.extra',
      'x'.repeat(2049),
      encodeDiscussionCursor({ ...context, version: 1, number: -1, direction: 'after' }, 'secret'),
    ]) {
      expect(() => decodeDiscussionCursor(value, context, 'secret')).toThrow();
    }
    expect(() => decodeDiscussionCursor(token, context, 'another-secret')).toThrow();
  });
});
