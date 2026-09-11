import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { BookmarksService } from '../src/bookmarks/bookmarks.service';
import { MomentBookmarksService } from '../src/moments/moment-bookmarks.service';
import { MomentAccessService } from '../src/moments/moment-access.service';

// 仅在新建临时数据库造数；服务查询使用应用角色，不读取运行环境凭据。
async function main() {
  assert.equal(process.env.BOOKMARK_COUNT_TEST_ENV, 'test');
  const base = new URL(process.env.DATABASE_URL!);
  const appBase = new URL(process.env.BOOKMARK_COUNT_TEST_APP_URL!);
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname));
  assert.equal(appBase.host, base.host);
  assert.equal(appBase.username, 'wenyousite_app');
  const database = `wenyousite_bookmark_test_${randomUUID().replaceAll('-', '')}`;
  const adminUrl = new URL(base); adminUrl.pathname = '/postgres';
  base.pathname = `/${database}`;
  appBase.pathname = `/${database}`;
  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  const db = new PrismaClient({ datasourceUrl: base.toString() });
  const app = new PrismaClient({ datasourceUrl: appBase.toString() });
  const prisma = app as unknown as PrismaService;
  const threads = new BookmarksService(prisma);
  const moments = new MomentBookmarksService(prisma, new MomentAccessService(prisma));
  let created = false;
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    created = true;
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: base.toString(), DIRECT_DATABASE_URL: base.toString() },
      stdio: 'pipe',
    });
    await db.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO wenyousite_app');
    await db.$executeRawUnsafe('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wenyousite_app');
    await db.$executeRawUnsafe('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO wenyousite_app');
    for (const id of ['viewer', 'owner', 'outblocked', 'inblocked', 'deleted-author', 'other']) {
      await db.user.create({ data: {
        id, email: `${id}@bookmark-test.invalid`, username: id, password: 'unused-test-only',
        ...(id === 'deleted-author' ? { deletedAt: new Date() } : {}),
      } });
    }
    const defaultThread = (await threads.findFolders('viewer'))[0];
    const defaultMoment = (await moments.listFolders('viewer'))[0];
    const addThread = async (id: string, folderId: string, extra = {}) => {
      await db.thread.create({ data: { id, ownerId: 'owner', title: id, published: true, ...extra } });
      await db.userBookmark.create({ data: { userId: 'viewer', threadId: id, folderId } });
    };
    const addMoment = async (id: string, folderId: string, extra = {}) => {
      await db.moment.create({ data: {
        id, authorId: 'owner', title: id, bookmarkCount: 1, clientRequestId: randomUUID(), createRequestHash: 'fixture', ...extra,
      } });
      await db.momentBookmark.create({ data: { userId: 'viewer', momentId: id, folderId } });
    };
    await addThread('hidden-only', defaultThread.id, { deletedAt: new Date() });
    await addMoment('hidden-moment-only', defaultMoment.id, { deletedAt: new Date() });
    assert.equal(await db.userBookmark.count({ where: { folderId: defaultThread.id } }), 1);
    assert.equal(await db.momentBookmark.count({ where: { folderId: defaultMoment.id } }), 1);
    assert.equal((await threads.findAll('viewer', undefined, 1, defaultThread.id)).items.length, 0);
    assert.equal((await moments.listMine(undefined, 1, { id: 'viewer' }, defaultMoment.id)).items.length, 0);
    console.log('复现场景：默认主题夹原始记录 1，可见列表 0；默认动态夹原始记录 1，可见列表 0');
    assert.equal((await threads.findFolders('viewer'))[0].bookmarkCount, 0, '隐藏记录不应计入默认主题夹');
    assert.equal((await threads.findFolders('viewer'))[0].momentBookmarkCount, 0);
    assert.equal((await moments.listFolders('viewer'))[0].momentBookmarkCount, 0);

    await db.thread.update({ where: { id: 'hidden-only' }, data: { deletedAt: null } });
    await db.moment.update({ where: { id: 'hidden-moment-only' }, data: { deletedAt: null } });
    assert.equal((await threads.findFolders('viewer'))[0].bookmarkCount, 1);
    assert.equal((await threads.findAll('viewer', undefined, 1, defaultThread.id)).items.length, 1);
    assert.equal((await moments.listFolders('viewer'))[0].momentBookmarkCount, 1);
    assert.equal((await moments.listMine(undefined, 1, { id: 'viewer' }, defaultMoment.id)).items.length, 1);
    await db.thread.update({ where: { id: 'hidden-only' }, data: { deletedAt: new Date() } });
    await db.moment.update({ where: { id: 'hidden-moment-only' }, data: { deletedAt: new Date() } });

    const threadFolder = await threads.createFolder('viewer', '混合');
    const momentFolder = await moments.createFolder('viewer', '混合');
    assert.notEqual(threadFolder.id, momentFolder.id);
    await addThread('public-a', threadFolder.id);
    await addThread('public-b', threadFolder.id);
    await addThread('member', threadFolder.id, { visibility: 'PRIVATE' });
    await db.threadMember.create({ data: { threadId: 'member', userId: 'viewer' } });
    await addThread('former', threadFolder.id, { visibility: 'PRIVATE' });
    await addThread('draft', threadFolder.id, { published: false });
    await addThread('deleted', threadFolder.id, { deletedAt: new Date() });
    await addThread('outblocked', threadFolder.id, { ownerId: 'outblocked' });
    await addThread('inblocked', threadFolder.id, { ownerId: 'inblocked' });
    await addMoment('visible-a', momentFolder.id);
    await addMoment('visible-b', momentFolder.id);
    await addMoment('historical', momentFolder.id, { authorId: 'deleted-author' });
    await addMoment('deleted', momentFolder.id, { deletedAt: new Date() });
    await addMoment('outblocked', momentFolder.id, { authorId: 'outblocked' });
    await addMoment('inblocked', momentFolder.id, { authorId: 'inblocked' });
    await db.userBlock.createMany({ data: [
      { blockerId: 'viewer', blockedId: 'outblocked' },
      { blockerId: 'inblocked', blockedId: 'viewer' },
    ] });

    const verify = async (threadIds: string[], momentIds: string[]) => {
      const threadFolders = await threads.findFolders('viewer');
      const momentFolders = await moments.listFolders('viewer');
      assert.equal(threadFolders[0].isDefault, true);
      assert.equal(momentFolders[0].isDefault, true);
      assert.equal(threadFolders.find((f) => f.id === threadFolder.id)?.bookmarkCount, threadIds.length);
      assert.equal(threadFolders.find((f) => f.id === threadFolder.id)?.momentBookmarkCount, momentIds.length);
      assert.equal(momentFolders.find((f) => f.id === momentFolder.id)?.momentBookmarkCount, momentIds.length);
      const threadItems: string[] = [];
      const momentItems: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await threads.findAll('viewer', cursor, 1, threadFolder.id);
        threadItems.push(...page.items.map((item) => item.id));
        cursor = page.pagination.hasMore ? page.pagination.cursor! : undefined;
        assert(threadItems.length <= 10, '分页必须终止');
      } while (cursor);
      do {
        const page = await moments.listMine(cursor, 1, { id: 'viewer' }, momentFolder.id);
        momentItems.push(...page.items.map((item) => item.id));
        cursor = page.pagination.hasMore ? page.pagination.cursor! : undefined;
        assert(momentItems.length <= 10, '分页必须终止');
      } while (cursor);
      assert.deepEqual(threadItems.sort(), [...threadIds].sort());
      assert.deepEqual(momentItems.sort(), [...momentIds].sort());
    };
    const visibleThreads = ['public-a', 'public-b', 'member'];
    const visibleMoments = ['visible-a', 'visible-b', 'historical'];
    await verify(visibleThreads, visibleMoments);
    await db.threadMember.delete({ where: { threadId_userId: { threadId: 'member', userId: 'viewer' } } });
    await verify(['public-a', 'public-b'], visibleMoments);
    await db.threadMember.create({ data: { threadId: 'member', userId: 'viewer' } });
    await db.thread.update({ where: { id: 'public-a' }, data: { published: false } });
    await db.moment.update({ where: { id: 'visible-a' }, data: { deletedAt: new Date() } });
    await verify(['public-b', 'member'], ['visible-b', 'historical']);
    await db.thread.update({ where: { id: 'public-a' }, data: { published: true } });
    await db.moment.update({ where: { id: 'visible-a' }, data: { deletedAt: null } });
    await verify(visibleThreads, visibleMoments);
    await db.userBlock.deleteMany();
    await verify([...visibleThreads, 'outblocked', 'inblocked'], [...visibleMoments, 'outblocked', 'inblocked']);

    const bookmark = await db.userBookmark.findUniqueOrThrow({ where: { userId_threadId: { userId: 'viewer', threadId: 'public-a' } } });
    await threads.move(bookmark.id, 'viewer', defaultThread.id);
    await moments.move('visible-a', 'viewer', defaultMoment.id);
    await verify(['public-b', 'member', 'outblocked', 'inblocked'], ['visible-b', 'historical', 'outblocked', 'inblocked']);
    assert.equal((await threads.findFolders('viewer'))[0].bookmarkCount, 1);
    assert.equal((await moments.listFolders('viewer'))[0].momentBookmarkCount, 1);
    await threads.remove(bookmark.id, 'viewer');
    await moments.set('visible-a', { id: 'viewer' }, false);
    assert.equal((await threads.findFolders('viewer'))[0].bookmarkCount, 0);
    assert.equal((await moments.listFolders('viewer'))[0].momentBookmarkCount, 0);
    await threads.create('viewer', 'public-a', defaultThread.id);
    await moments.set('visible-a', { id: 'viewer' }, true, defaultMoment.id);
    assert.equal((await threads.findFolders('viewer'))[0].bookmarkCount, 1);
    assert.equal((await threads.findFolders('viewer'))[0].momentBookmarkCount, 1);

    const otherFolder = await threads.createFolder('other', '混合');
    const otherMomentFolder = await moments.createFolder('other', '混合');
    assert.equal(otherFolder.bookmarkCount, 0);
    assert.equal((await threads.findFolders('other')).find((f) => f.id === otherFolder.id)?.bookmarkCount, 0);
    assert.equal((await moments.listFolders('other')).find((f) => f.id === otherMomentFolder.id)?.momentBookmarkCount, 0);
    await assert.rejects(threads.findAll('other', undefined, 1, threadFolder.id), /收藏夹不存在/);
    await assert.rejects(moments.listMine(undefined, 1, { id: 'other' }, momentFolder.id), /收藏夹不存在/);
    await db.user.update({ where: { id: 'viewer' }, data: { showBookmarks: false } });
    await assert.rejects(threads.findByUserId('viewer', 'other'), /未公开收藏/);
    await assert.rejects(moments.listPublic('viewer', 'other'), /未公开收藏/);
    assert.equal((await threads.findFolders('viewer')).find((f) => f.id === threadFolder.id)?.bookmarkCount, 4);
    assert.equal(await db.userBookmark.count({ where: { threadId: 'hidden-only' } }), 1, '隐藏收藏不能被删除');
    console.log('通过：分页总数、默认/独立目录、删除/草稿/成员变化、双向拉黑及恢复、已注销作者历史动态、移动/取消/新增、归属和公开隐私拒绝');
  } finally {
    await app.$disconnect();
    await db.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP DATABASE "${database}"`);
    await admin.$disconnect();
  }
}

main().catch((error: unknown) => {
  // 避免输出连接串或 Prisma 请求上下文。
  console.error(error instanceof assert.AssertionError ? error.message : '收藏计数隔离集成失败；请核对测试数据库和迁移条件');
  process.exitCode = 1;
});
