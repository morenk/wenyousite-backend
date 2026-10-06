import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { verifyIsolatedEnvironment } from './e2e-guard';
import { identityToken } from '../src/thread-identities/identity-policy';
import { ThreadIdentitiesService } from '../src/thread-identities/thread-identities.service';

/** 迁移样本仅存在于本轮已核验隔离实例，finally 删除随机子库及文件。 */
export async function verifyRpProfileMigration(db: PrismaClient) {
  await verifyIsolatedEnvironment();
  const migration = '20261005160000_rp_identity_profile_post';
  const database = 'wenyousite_profile_' + randomUUID().replaceAll('-', '');
  const url = new URL(process.env.DATABASE_URL!); url.pathname = '/' + database;
  const legacy = new PrismaClient({ datasourceUrl: url.toString(), log: [] });
  const root = await mkdtemp(join(dirname(process.env.E2E_MANIFEST!), 'profile-migration-'));
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
    const user = await legacy.user.create({ data: { username: 'profile_migration_' + randomUUID(), email: randomUUID() + '@profile.invalid', password: 'unused' } });
    const thread = await legacy.thread.create({ data: { title: '资料引用迁移样本', ownerId: user.id, rpIdentityEnabled: true } });
    const id = randomUUID();
    await legacy.$executeRaw`INSERT INTO thread_identities (id, thread_id, user_id, nickname, version, updated_at) VALUES (${id}, ${thread.id}, ${user.id}, '旧角色', 7, NOW())`;
    const oldToken = identityToken([thread.id, user.id, true, thread.rpIdentityVersion, true, id, 7,
      { id, nickname: '旧角色', avatar: null, avatarDisplay: null }, null, null]);
    await cp(join('prisma/migrations', migration), join(root, 'migrations', migration), { recursive: true });
    deploy();
    const role = await legacy.threadIdentity.findUniqueOrThrow({ where: { id } });
    const identities = new ThreadIdentitiesService(legacy as never, {} as never, {} as never);
    assert.equal((await identities.context(thread.id, user.id, legacy as never, id)).token, oldToken);
    assert.equal(role.version, 7); assert.equal(role.authorVersion, 7); assert.equal(role.profilePostId, null);
    const sub = await legacy.subthread.create({ data: { threadId: thread.id, title: '资料' } });
    const post = await legacy.post.create({ data: { threadId: thread.id, subthreadId: sub.id, authorId: user.id, content: '保留原文', floorNumber: 1 } });
    await legacy.threadIdentity.update({ where: { id }, data: { profilePostId: post.id, version: { increment: 1 } } });
    await legacy.threadIdentity.create({ data: { threadId: thread.id, userId: user.id, nickname: '共享资料', profilePostId: post.id } });
    deploy();
    const after = await legacy.threadIdentity.findUniqueOrThrow({ where: { id } });
    assert.equal(after.profilePostId, post.id); assert.equal(after.version, 8); assert.equal(after.authorVersion, 7);
    await assert.rejects(legacy.threadIdentity.update({ where: { id }, data: { profilePostId: randomUUID() } }));
    await legacy.post.delete({ where: { id: post.id } });
    assert.equal((await legacy.threadIdentity.findUniqueOrThrow({ where: { id } })).profilePostId, null);
  } finally {
    await legacy.$disconnect();
    if (created) await db.$executeRawUnsafe(`DROP DATABASE "${database}"`);
    await rm(root, { recursive: true });
  }
}
