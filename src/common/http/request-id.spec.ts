import { requestIdFromHeader } from './request-id';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('requestIdFromHeader', () => {
  it('透传合法的客户端请求号', () => {
    expect(requestIdFromHeader('mobile:01J5_TRACE-1')).toBe('mobile:01J5_TRACE-1');
    expect(requestIdFromHeader(['flutter-request-1'])).toBe('flutter-request-1');
  });

  it.each([undefined, '', '含 空格', 'a'.repeat(129), 42])('拒绝异常值并生成 UUID: %p', (value) => {
    expect(requestIdFromHeader(value)).toMatch(UUID_PATTERN);
  });
});
