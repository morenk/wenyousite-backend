import { acquireSuperAdminBootstrapLock } from './bootstrap-super-admin-lock';

describe('acquireSuperAdminBootstrapLock', () => {
  it('只查询可反序列化的 integer，不直接返回 PostgreSQL void', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ locked: 1 }]);

    await expect(
      acquireSuperAdminBootstrapLock({ $queryRaw: queryRaw }),
    ).resolves.toBeUndefined();

    const [strings] = queryRaw.mock.calls[0] as [TemplateStringsArray, number];
    expect(strings.join('?')).toContain('SELECT 1::integer AS locked');
    expect(strings.join('?')).toContain('pg_advisory_xact_lock(?)');
  });

  it('锁查询没有返回预期行时拒绝继续初始化', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    await expect(
      acquireSuperAdminBootstrapLock({ $queryRaw: queryRaw }),
    ).rejects.toThrow('无法获取超级管理员初始化锁');
  });
});
