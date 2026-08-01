import { CUID_REGEX } from './is-cuid.decorator';

describe('IsCuid 校验器', () => {
  test('CUID_REGEX 匹配 Prisma cuid() 生成的 ID（cms 前缀 25 字符）', () => {
    expect(CUID_REGEX.test('cms7rnyij000z7qdyg6zbge8e')).toBe(true);
    expect(CUID_REGEX.test('clxthread001abcedfgh12345')).toBe(true);
  });

  test('CUID_REGEX 拒绝 UUID 格式（含连字符）', () => {
    expect(CUID_REGEX.test('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
  });

  test('CUID_REGEX 拒绝过短/非法字符', () => {
    expect(CUID_REGEX.test('abc')).toBe(false);
    expect(CUID_REGEX.test('CUID-TEST-1234')).toBe(false);
    expect(CUID_REGEX.test('')).toBe(false);
  });
});
