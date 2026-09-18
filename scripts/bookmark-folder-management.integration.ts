import 'reflect-metadata';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { BookmarksService } from '../src/bookmarks/bookmarks.service';
import { MomentBookmarksService } from '../src/moments/moment-bookmarks.service';
import { MomentAccessService } from '../src/moments/moment-access.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { BusinessException } from '../src/common/exceptions/business.exception';

async function main() {
  assert.equal(process.env.BOOKMARK_MANAGEMENT_TEST_ENV, 'test');
  const base = new URL(process.env.DATABASE_URL!);
  const appBase = new URL(process.env.BOOKMARK_MANAGEMENT_TEST_APP_URL!);
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname));
  assert.equal(base.host, appBase.host);
  assert.equal(appBase.username, 'wenyousite_app');
  const database = `wenyousite_folder_test_${randomUUID().replaceAll('-', '')}`;
  const adminUrl = new URL(base); adminUrl.pathname = '/postgres';
  base.pathname = `/${database}`; appBase.pathname = `/${database}`;
  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  const db = new PrismaClient({ datasourceUrl: base.toString() });
  const app = new PrismaClient({ datasourceUrl: appBase.toString() });
  const prisma = app as unknown as PrismaService;
  let created = false;
  const rejects = (promise: Promise<unknown>, status: number) => assert.rejects(promise,
    (error: unknown) => error instanceof BusinessException && error.getStatus() === status);
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    created = true;
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: base.toString(), DIRECT_DATABASE_URL: base.toString() }, stdio: 'pipe',
    });
    await db.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO wenyousite_app');
    await db.$executeRawUnsafe('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wenyousite_app');
    await db.$executeRawUnsafe('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO wenyousite_app');
    for (const id of ['owner', 'other']) await db.user.create({ data: {
      id, email: `${id}@folder-test.invalid`, username: id, password: 'unused-test-only',
    } });
    const threads = new BookmarksService(prisma);
    const moments = new MomentBookmarksService(prisma, new MomentAccessService(prisma));
    const sameThread = await threads.createFolder('owner', '两类同名');
    const sameMoment = await moments.createFolder('owner', '两类同名');
    assert.notEqual(sameThread.id, sameMoment.id);
    await rejects(moments.renameFolder('owner', sameThread.id, '不得映射'), 404);
    await rejects(moments.deleteFolder('owner', sameThread.id), 404);
    for (const isMoment of [false, true]) {
      const service = isMoment ? moments : threads;
      const folders = isMoment ? app.momentBookmarkFolder : app.bookmarkFolder;
      const source = isMoment ? sameMoment : sameThread;
      const defaults = await folders.findFirstOrThrow({ where: { userId: 'owner', isDefault: true } });
      assert.equal((await service.renameFolder('owner', source.id, '  重命名  ')).name, '重命名');
      assert.equal((await service.renameFolder('owner', source.id, '重命名')).name, '重命名');
      await rejects(service.renameFolder('owner', source.id, '   '), 400);
      await rejects(service.renameFolder('owner', source.id, '名'.repeat(25)), 400);
      const duplicate = await service.createFolder('owner', '重复');
      await rejects(service.renameFolder('owner', source.id, '重复'), 409);
      for (const id of [source.id, defaults.id, 'missing']) {
        await rejects(service.renameFolder('other', id, '越权'), 404);
        await rejects(service.deleteFolder('other', id), 404);
      }
      await rejects(service.renameFolder('owner', defaults.id, '默认保护'), 409);
      await rejects(service.deleteFolder('owner', defaults.id), 409);
      assert.deepEqual(await service.deleteFolder('owner', duplicate.id), { deletedFolderId: duplicate.id, destinationFolderId: defaults.id });
      await rejects(service.deleteFolder('owner', duplicate.id), 404);

      const add = async (folderId: string, hidden = false, bookmarkUserId = 'owner') => {
        const id = randomUUID();
        if (isMoment) {
          await app.moment.create({ data: {
            id, authorId: 'owner', title: '测试动态', clientRequestId: id, createRequestHash: 'fixture', bookmarkCount: 1,
            ...(hidden ? { deletedAt: new Date() } : {}),
          } });
          return app.momentBookmark.create({ data: { userId: bookmarkUserId, momentId: id, folderId } });
        }
        await app.thread.create({ data: { id, ownerId: 'owner', title: '测试主题', published: !hidden } });
        return app.userBookmark.create({ data: { userId: bookmarkUserId, threadId: id, folderId } });
      };
      const records = (folderId: string) => isMoment
        ? app.momentBookmark.findMany({ where: { folderId }, select: { id: true, createdAt: true, folderId: true }, orderBy: { id: 'asc' } })
        : app.userBookmark.findMany({ where: { folderId }, select: { id: true, createdAt: true, folderId: true }, orderBy: { id: 'asc' } });
      await add(source.id);
      await add(source.id, true);
      const before = await records(source.id);
      const total = await app.moment.aggregate({ _sum: { bookmarkCount: true } });
      const result = await service.deleteFolder('owner', source.id);
      assert.deepEqual(result, { deletedFolderId: source.id, destinationFolderId: defaults.id });
      assert.deepEqual(await records(defaults.id), before.map((row) => ({ ...row, folderId: defaults.id })));
      assert.equal(await folders.findUnique({ where: { id: source.id } }), null);
      assert.deepEqual(await app.moment.aggregate({ _sum: { bookmarkCount: true } }), total);

      const rollback = await service.createFolder('other', '事务回滚');
      await add(rollback.id, false, 'other');
      await add(rollback.id, true, 'other');
      const rollbackBefore = await records(rollback.id);
      // 让删除事务负责补建缺失的默认夹，并在最后一步失败，验证补建和迁移均回滚。
      await folders.deleteMany({ where: { userId: 'other', isDefault: true } });
      const failClient = new Proxy(prisma, { get(target, key) {
        if (key !== '$transaction') return Reflect.get(target, key);
        return (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => app.$transaction(async (tx) => {
          const model = isMoment ? 'momentBookmarkFolder' : 'bookmarkFolder';
          const wrapped = new Proxy(tx, { get(inner, field) {
            if (field !== model) return Reflect.get(inner, field);
            return new Proxy(Reflect.get(inner, field), { get(delegate, action) {
              if (action === 'delete') return () => { throw new Error('injected-delete-failure'); };
              return Reflect.get(delegate, action);
            } });
          } });
          return run(wrapped);
        }, options);
      } });
      const failService = isMoment ? new MomentBookmarksService(failClient, new MomentAccessService(failClient)) : new BookmarksService(failClient);
      await assert.rejects(failService.deleteFolder('other', rollback.id), /injected-delete-failure/);
      assert(await folders.findUnique({ where: { id: rollback.id } }));
      assert.equal(await folders.count({ where: { userId: 'other', isDefault: true } }), 0);
      assert.deepEqual(await records(rollback.id), rollbackBefore);
      const retried = await service.deleteFolder('other', rollback.id);
      assert.equal((await folders.findUniqueOrThrow({ where: { id: retried.destinationFolderId } })).isDefault, true);
      assert.deepEqual(await records(retried.destinationFolderId), rollbackBefore.map((row) => ({ ...row, folderId: retried.destinationFolderId })));

      const concurrent = await service.createFolder('owner', '并发迁入');
      await add(concurrent.id);
      const concurrentBefore = await records(concurrent.id);
      let entered = false;
      const raceClient = new Proxy(prisma, { get(target, key) {
        if (key !== '$transaction') return Reflect.get(target, key);
        return (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => app.$transaction(async (tx) => {
          const model = isMoment ? 'momentBookmarkFolder' : 'bookmarkFolder';
          return run(new Proxy(tx, { get(inner, field) {
            if (field !== model) return Reflect.get(inner, field);
            return new Proxy(Reflect.get(inner, field), { get(delegate, action) {
              if (action === 'delete') return async (args: object) => {
                entered = true;
                await add(concurrent.id); // 另一连接在迁移后、删除前提交新收藏，触发真实外键/串行化冲突。
                return delegate.delete(args);
              };
              return Reflect.get(delegate, action);
            } });
          } }));
        }, options);
      } });
      const raceService = isMoment ? new MomentBookmarksService(raceClient, new MomentAccessService(raceClient)) : new BookmarksService(raceClient);
      await rejects(raceService.deleteFolder('owner', concurrent.id), 409);
      assert(entered);
      const afterConflict = await records(concurrent.id);
      assert.equal(afterConflict.length, 2);
      assert(afterConflict.some((row) => row.id === concurrentBefore[0].id));
      assert.deepEqual(await records(defaults.id), before.map((row) => ({ ...row, folderId: defaults.id })));
      assert(await folders.findUnique({ where: { id: concurrent.id } }));
      await service.deleteFolder('owner', concurrent.id);
      assert.equal((await records(defaults.id)).length, 4);
      console.log(`${isMoment ? '动态' : '主题帖'}：真实名称唯一/归属/默认保护、空夹、不可见项迁移、原时间/计数保留、补建回滚、并发外键冲突及重试通过`);
    }
  } finally {
    await app.$disconnect(); await db.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP DATABASE "${database}"`);
    await admin.$disconnect();
  }
}
main().catch((error: unknown) => {
  console.error(error instanceof assert.AssertionError ? error.message : '收藏夹管理隔离集成失败；未输出数据库连接或请求详情');
  process.exitCode = 1;
});
