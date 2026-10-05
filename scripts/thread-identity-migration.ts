import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { verifyIsolatedEnvironment } from './e2e-guard';

/** 仅在已核验的本轮隔离 PostgreSQL 中建立随机迁移子库，finally 回收。 */
export async function verifyThreadIdentityMigration(db: PrismaClient) {
  await verifyIsolatedEnvironment();
  const migration = '20261005050000_multiple_thread_identities';
  const database = 'wenyousite_roles_' + randomUUID().replaceAll('-', '');
  const url = new URL(process.env.DATABASE_URL!); url.pathname = '/' + database;
  const legacy = new PrismaClient({ datasourceUrl: url.toString(), log: [] });
  const root = await mkdtemp(join(dirname(process.env.E2E_MANIFEST!), 'roles-migration-'));
  let created = false;
  const deploy = () => execFileSync(process.execPath,
    [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(root, 'schema.prisma')],
    { cwd: root, env: { ...process.env, DATABASE_URL: url.toString(), DIRECT_DATABASE_URL: url.toString() }, stdio: 'pipe' });
  try {
    await db.$executeRawUnsafe(`CREATE DATABASE "${database}"`); created = true;
    await mkdir(join(root, 'migrations'));
    await cp('prisma/schema.prisma', join(root, 'schema.prisma'));
    for (const name of await readdir('prisma/migrations'))
      if (name !== migration) await cp(join('prisma/migrations', name), join(root, 'migrations', name), { recursive: true });
    deploy();
    const user = await legacy.user.create({ data: { username: 'migration_' + randomUUID(), email: randomUUID() + '@roles.invalid', password: 'unused' } });
    const thread = await legacy.thread.create({ data: { title: '单身份迁移样本', ownerId: user.id } });
    const id = randomUUID();
    await legacy.$executeRaw`INSERT INTO thread_identities (id, thread_id, user_id, nickname, version, updated_at) VALUES (${id}, ${thread.id}, ${user.id}, '旧角色', 7, NOW())`;
    await legacy.$executeRaw`INSERT INTO thread_identity_aliases (id, identity_id, nickname) VALUES (${randomUUID()}, ${id}, '更早的角色名')`;
    await cp(join('prisma/migrations', migration), join(root, 'migrations', migration), { recursive: true });
    deploy();
    const role = await legacy.threadIdentity.findUniqueOrThrow({ where: { id }, include: { aliases: true } });
    assert.equal(role.compatibilityIdentity, true); assert.equal(role.deletedAt, null);
    assert.equal(role.nickname, '旧角色'); assert.equal(role.version, 7); assert.equal(role.aliases[0].nickname, '更早的角色名');
    await legacy.threadIdentity.create({ data: { threadId: thread.id, userId: user.id, nickname: '第二角色' } });
    await assert.rejects(legacy.threadIdentity.create({ data: { threadId: thread.id, userId: user.id, compatibilityIdentity: true, nickname: '不能双主身份' } }));
    await legacy.threadIdentity.update({ where: { id }, data: { deletedAt: new Date() } });
    const next = await legacy.threadIdentity.create({ data: { threadId: thread.id, userId: user.id, compatibilityIdentity: true, nickname: '显式新主身份' } });
    assert.notEqual(next.id, id);
    deploy();
    assert.equal((await legacy.threadIdentity.findUniqueOrThrow({ where: { id } })).nickname, '旧角色');
  } finally {
    await legacy.$disconnect();
    if (created) await db.$executeRawUnsafe(`DROP DATABASE "${database}"`);
    await rm(root, { recursive: true });
  }
}
