import { hasPrismaErrorCode, isRecordNotFound, isUniqueConstraintViolation } from './prisma-errors';

describe('prisma error helpers', () => {
  it('只识别匹配的结构化 Prisma 错误码', () => {
    expect(isUniqueConstraintViolation({ code: 'P2002' })).toBe(true);
    expect(isRecordNotFound({ code: 'P2025' })).toBe(true);
    expect(hasPrismaErrorCode({ code: 'P2034' }, 'P2034')).toBe(true);
    expect(isUniqueConstraintViolation(new Error('P2002'))).toBe(false);
    expect(isRecordNotFound(null)).toBe(false);
  });
});
