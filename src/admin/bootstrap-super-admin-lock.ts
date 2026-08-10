const SUPER_ADMIN_BOOTSTRAP_LOCK_KEY = 864208081;

interface AdvisoryLockClient {
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

/** 获取事务级 advisory lock，并只返回 Prisma 可反序列化的 integer。 */
export async function acquireSuperAdminBootstrapLock(client: AdvisoryLockClient) {
  const rows = await client.$queryRaw<Array<{ locked: number }>>`
    SELECT 1::integer AS locked
    FROM pg_advisory_xact_lock(${SUPER_ADMIN_BOOTSTRAP_LOCK_KEY})
  `;
  if (rows[0]?.locked !== 1) throw new Error('无法获取超级管理员初始化锁');
}
