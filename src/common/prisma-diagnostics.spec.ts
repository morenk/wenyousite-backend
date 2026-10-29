import { Prisma } from '@prisma/client';
import { prismaDiagnostics, safeErrorFrames } from './prisma-diagnostics';

describe('数据库诊断白名单', () => {
  it('未知代码、任意 meta、嵌套 cause 和伪造结构都不能进入日志', () => {
    const error = new Prisma.PrismaClientKnownRequestError('private', {
      code: 'SECRET',
      clientVersion: 'private',
      meta: { code: 'SECRET', prismaCode: 'P2028', cause: { code: '40001' } },
    });
    expect(prismaDiagnostics(error)).toEqual({});
    expect(
      prismaDiagnostics({ code: 'P2010', meta: { code: '40001' }, dbStage: 'private' }),
    ).toEqual({});
    error.code = 'P2010';
    expect(prismaDiagnostics(error)).toEqual({ prismaCode: 'P2010' });
    const getter = jest.fn(() => {
      throw new Error('secret');
    });
    Object.defineProperty(error, 'meta', { get: getter });
    expect(prismaDiagnostics(error)).toEqual({ prismaCode: 'P2010' });
    expect(getter).not.toHaveBeenCalled();
  });
  it('多行 message、SQL、函数名和任意路径都不能冒充安全堆栈', () => {
    const error = new Error('private');
    error.stack =
      'Error: private\npassword=secret\n at secret (https://secret:44:55)\n' +
      '    at secret (/private/src/threads/thread-aggregate.service.ts:120:8)\n' +
      '    at secret (/private/src/secret.ts:12:3)\n    at secret (/private/src/secret.ts?token=secret:12:3)';
    expect(safeErrorFrames(error)).toBe(
      '    at thread-aggregate.service:120:8\n    at application:12:3',
    );
  });
});
