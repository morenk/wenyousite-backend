import { assertIsolatedEnvironment, verifyIsolatedEnvironment } from './e2e-guard';
assertIsolatedEnvironment();
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Prisma, PrismaClient } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AdminContentQueryService } from '../src/moderation/admin-content-query.service';
import { AdminContentTaxonomyService } from '../src/moderation/admin-content-taxonomy.service';
import { AdminModerationQueryService } from '../src/moderation/admin-moderation-query.service';
import { AdminDashboardService } from '../src/admin/admin-dashboard.service';
import { ModerationService } from '../src/moderation/moderation.service';
import { AdminPolicyService } from '../src/moderation/admin-policy.service';
import { ModerationProjectionService } from '../src/moderation/moderation-projection.service';
import { AuditService } from '../src/moderation/audit.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CacheService } from '../src/redis/cache.service';
import { ErrorCode } from '../src/common/exceptions/error-codes';
import { AdminContentType } from '../src/admin/dto/admin-content.dto';

async function main() {
  await verifyIsolatedEnvironment();
  assert.equal(process.env.ADMIN_CONSOLE_TEST_ENV, 'test');
  const base = new URL(process.env.DATABASE_URL!);
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), '只允许回环测试数据库');
  const name = `wenyousite_admin_console_${Date.now()}_${process.pid}`;
  const control = new PrismaClient({ datasourceUrl: base.toString() });
  const url = new URL(base);
  url.pathname = '/' + name;
  const client = new PrismaClient({ datasourceUrl: url.toString() });
  try {
    await control.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url.toString(), DIRECT_DATABASE_URL: url.toString() },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const prisma = client as unknown as PrismaService;
    const queries = new AdminContentQueryService(prisma);
    const users = new AdminModerationQueryService(prisma);
    const audit = new AuditService(prisma);
    const invalidated: string[] = [];
    const cache = {
      buildKey: (...parts: string[]) => ['cache', ...parts].join(':'),
      delByPattern: async (key: string) => {
        invalidated.push(key);
      },
    } as unknown as CacheService;
    const taxonomy = new AdminContentTaxonomyService(prisma, audit, cache, new EventEmitter2());
    const author = await client.user.create({
      data: { email: 'author@admin-console.invalid', username: 'author', password: 'unused' },
    });
    const admin = await client.user.create({
      data: {
        email: 'admin@admin-console.invalid',
        username: 'admin',
        password: 'unused',
        role: 'ADMIN',
      },
    });
    const category = await client.threadCategoryDefinition.create({
      data: { name: '测试分类', slug: 'CONSOLE' },
    });
    const nextCategory = await client.threadCategoryDefinition.create({
      data: { name: '新分类', slug: 'NEXT' },
    });
    const inactive = await client.threadCategoryDefinition.create({
      data: { name: '停用分类', slug: 'INACTIVE', isActive: false },
    });
    const tag = await client.topicTag.create({ data: { name: '启用标签' } });
    const inactiveTag = await client.topicTag.create({
      data: { name: '停用标签', isActive: false },
    });
    const now = new Date();
    async function thread(
      kind: 'active' | 'hidden' | 'deleted' | 'draft' | 'private',
      suffix = '',
    ) {
      const row = await client.thread.create({
        data: {
          ownerId: author.id,
          title: kind + suffix,
          published: kind !== 'draft',
          visibility: kind === 'private' ? 'PRIVATE' : 'PUBLIC',
          publishedAt: now,
          category: category.slug,
          ...(kind === 'hidden' || kind === 'deleted'
            ? { deletedAt: now, removalSource: kind === 'hidden' ? 'ADMIN' : 'AUTHOR' }
            : {}),
        },
      });
      const sub = await client.subthread.create({
        data: { threadId: row.id, title: '正文', sortOrder: 0 },
      });
      await client.thread.update({ where: { id: row.id }, data: { defaultSubthreadId: sub.id } });
      await client.post.create({
        data: {
          threadId: row.id,
          subthreadId: sub.id,
          authorId: author.id,
          kind: 'BODY',
          content: '正文',
        },
      });
      const post = await client.post.create({
        data: {
          threadId: row.id,
          subthreadId: sub.id,
          authorId: author.id,
          floorNumber: 1,
          content: '**楼层**',
        },
      });
      return { ...row, sub, post };
    }
    const active = await thread('active');
    const hidden = await thread('hidden');
    const excluded = await Promise.all([thread('deleted'), thread('draft'), thread('private')]);
    for (const row of excluded) {
      assert.equal((await queries.list({ type: 'thread', id: row.id })).items.length, 0);
      assert.equal((await queries.list({ type: 'post', id: row.post.id })).items.length, 0);
      await assert.rejects(queries.detail('thread', row.id), { errorCode: ErrorCode.NOT_FOUND });
      await assert.rejects(queries.detail('post', row.post.id), { errorCode: ErrorCode.NOT_FOUND });
      await assert.rejects(
        taxonomy.update(
          row.id,
          { version: 1, reason: '不能整理', category: nextCategory.slug },
          admin.id,
          {},
        ),
        { errorCode: ErrorCode.THREAD_NOT_FOUND },
      );
    }
    const activeBody = await client.post.findFirstOrThrow({
      where: { threadId: active.id, kind: 'BODY' },
    });
    assert.equal((await queries.detail('post', activeBody.id)).content, '正文');
    for (const row of excluded) {
      const excludedBody = await client.post.findFirstOrThrow({
        where: { threadId: row.id, kind: 'BODY' },
      });
      await assert.rejects(queries.detail('post', excludedBody.id), {
        errorCode: ErrorCode.NOT_FOUND,
      });
    }
    assert.equal((await queries.detail('thread', active.id)).content, '正文');
    assert.equal((await queries.detail('post', active.post.id)).summary, '楼层');
    assert.equal((await queries.detail('post', hidden.post.id)).parentHidden, true);
    const blockedReply = await client.post.create({
      data: {
        threadId: active.id,
        subthreadId: active.sub.id,
        authorId: author.id,
        parentPostId: active.post.id,
        content: '回复',
        deletedAt: now,
        removalSource: 'ADMIN',
      },
    });
    await client.post.update({
      where: { id: active.post.id },
      data: { deletedAt: now, removalSource: 'ADMIN' },
    });
    assert.equal((await queries.detail('post', blockedReply.id)).canRestore, false);
    assert.equal(
      (await users.listHiddenContent({ targetType: 'POST' })).items.find(
        (row) => row.targetId === blockedReply.id,
      )?.canRestore,
      false,
    );
    const moderation = new ModerationService(
      prisma,
      new AdminPolicyService(),
      audit,
      { finalizeContent: async () => undefined } as unknown as ModerationProjectionService,
      users,
    );
    await assert.rejects(
      moderation.restoreContent(
        { id: admin.id, role: 'ADMIN' },
        'POST',
        blockedReply.id,
        '恢复',
        {},
      ),
      { errorCode: ErrorCode.CONTENT_STATE_CONFLICT },
    );
    await client.post.update({ where: { id: active.post.id }, data: { removalSource: 'AUTHOR' } });
    await assert.rejects(queries.detail('post', blockedReply.id), {
      errorCode: ErrorCode.NOT_FOUND,
    });
    await client.post.update({
      where: { id: active.post.id },
      data: { deletedAt: null, removalSource: null },
    });
    const removedSub = await client.subthread.create({
      data: { threadId: active.id, title: '删除子贴', sortOrder: 1, deletedAt: now },
    });
    const removedSubPost = await client.post.create({
      data: {
        threadId: active.id,
        subthreadId: removedSub.id,
        authorId: author.id,
        floorNumber: 1,
        content: '不应泄漏',
      },
    });
    await assert.rejects(queries.detail('post', removedSubPost.id), {
      errorCode: ErrorCode.NOT_FOUND,
    });

    const moment = await client.moment.create({
      data: {
        title: '动态',
        content: '动态正文',
        authorId: author.id,
        clientRequestId: randomUUID(),
        createRequestHash: 'fixture',
      },
    });
    const comment = await client.momentComment.create({
      data: {
        momentId: moment.id,
        authorId: author.id,
        content: '评论',
        clientRequestId: randomUUID(),
        createRequestHash: 'fixture',
      },
    });
    const reply = await client.momentComment.create({
      data: {
        momentId: moment.id,
        authorId: author.id,
        parentCommentId: comment.id,
        content: '回复评论',
        clientRequestId: randomUUID(),
        createRequestHash: 'fixture',
        deletedAt: now,
        removalSource: 'ADMIN',
      },
    });
    await client.momentComment.update({
      where: { id: comment.id },
      data: { deletedAt: now, removalSource: 'ADMIN' },
    });
    assert.equal((await queries.detail('moment_comment', reply.id)).parentHidden, true);
    await assert.rejects(
      moderation.restoreContent(
        { id: admin.id, role: 'ADMIN' },
        'MOMENT_COMMENT',
        reply.id,
        '恢复',
        {},
      ),
      { errorCode: ErrorCode.CONTENT_STATE_CONFLICT },
    );
    await client.momentComment.update({
      where: { id: comment.id },
      data: { removalSource: 'AUTHOR' },
    });
    await assert.rejects(queries.detail('moment_comment', reply.id), {
      errorCode: ErrorCode.NOT_FOUND,
    });
    await client.moment.update({
      where: { id: moment.id },
      data: { deletedAt: now, removalSource: 'AUTHOR' },
    });
    await assert.rejects(queries.detail('moment', moment.id), { errorCode: ErrorCode.NOT_FOUND });
    await client.momentComment.update({
      where: { id: comment.id },
      data: { deletedAt: null, removalSource: null },
    });
    await assert.rejects(queries.detail('moment_comment', comment.id), {
      errorCode: ErrorCode.NOT_FOUND,
    });
    await client.moment.update({ where: { id: moment.id }, data: { removalSource: 'ADMIN' } });
    assert.equal((await queries.detail('moment_comment', comment.id)).parentHidden, true);
    const media = await client.media.create({
      data: {
        userId: author.id,
        url: 'https://example.invalid/owned.webp',
        key: 'owned',
        status: 'COMPLETED',
      },
    });
    await client.momentImage.create({
      data: { momentId: moment.id, mediaId: media.id, sortOrder: 0 },
    });
    assert.deepEqual((await queries.detail('moment', moment.id)).mediaIds, [media.id]);
    await client.media.update({ where: { id: media.id }, data: { deletionClaimedAt: now } });
    assert.deepEqual((await queries.detail('moment', moment.id)).media, []);

    const sticker = await client.stickerAsset.create({
      data: {
        url: 'https://example.invalid/sticker.webp',
        key: 'sticker',
        thumbnailUrl: 'https://example.invalid/sticker-thumb.webp',
        thumbnailKey: 'sticker-thumb',
        contentHash: 'admin-console-fixture',
        size: 100,
        width: 10,
        height: 10,
      },
    });
    await client.momentComment.update({
      where: { id: comment.id },
      data: { stickerAssetId: sticker.id },
    });
    const stickerDetail = await queries.detail('moment_comment', comment.id);
    assert.deepEqual(stickerDetail.mediaIds, []);
    assert.equal(stickerDetail.media[0].id, sticker.id);
    await client.userDailyActivity.create({ data: { userId: author.id, dateKey: '2026-09-20' } });
    const userDetail = await users.getUser(author.id);
    assert.equal(userDetail.lastActiveDate, '2026-09-20');
    assert.equal((await users.getUser(admin.id)).lastActiveDate, null);
    for (const type of ['thread', 'post', 'moment', 'moment_comment'] as AdminContentType[]) {
      assert.equal(
        userDetail.contentCounts[type],
        (await queries.list({ type, authorId: author.id, limit: 50 })).items.length,
      );
    }
    assert.equal((await users.listUsers({ id: author.id })).items[0].id, author.id);
    assert.equal((await queries.list({ type: 'thread', status: 'HIDDEN' })).items.length, 1);
    await assert.rejects(queries.list({ cursor: 'garbage' }), {
      errorCode: ErrorCode.INVALID_CURSOR,
    });
    await assert.rejects(
      queries.list({ createdAfter: '2026-09-21', createdBefore: '2026-09-20' }),
      { errorCode: ErrorCode.BAD_REQUEST },
    );
    await Promise.all(
      Array.from({ length: 23 }, (_, index) =>
        client.thread.create({
          data: {
            ownerId: author.id,
            title: '分页' + index,
            published: true,
            category: category.slug,
            createdAt: now,
          },
        }),
      ),
    );
    const first = await queries.list({ q: '分页' });
    const second = await queries.list({ q: '分页', cursor: first.pagination.cursor! });
    assert.equal(first.items.length, 20);
    assert.equal(second.items.length, 3);
    assert.equal(new Set([...first.items, ...second.items].map((row) => row.id)).size, 23);
    await assert.rejects(queries.list({ q: '新筛选', cursor: first.pagination.cursor! }), {
      errorCode: ErrorCode.INVALID_CURSOR,
    });

    await assert.rejects(
      taxonomy.update(
        active.id,
        { version: 1, reason: '停用分类', category: inactive.slug },
        admin.id,
        {},
      ),
      { errorCode: ErrorCode.BAD_REQUEST },
    );
    await assert.rejects(
      taxonomy.update(
        active.id,
        { version: 1, reason: '停用标签', tagIds: [inactiveTag.id] },
        admin.id,
        {},
      ),
      { errorCode: ErrorCode.BAD_REQUEST },
    );
    const outcomes = await Promise.allSettled([
      taxonomy.update(
        active.id,
        { version: 1, reason: '整理A', category: nextCategory.slug, tagIds: [tag.id] },
        admin.id,
        {},
      ),
      taxonomy.update(
        active.id,
        { version: 1, reason: '整理B', category: nextCategory.slug, tagIds: [tag.id] },
        admin.id,
        {},
      ),
    ]);
    assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter((result) => result.status === 'rejected').length, 1);
    assert.equal((await client.thread.findUniqueOrThrow({ where: { id: active.id } })).version, 2);
    const log = await client.auditLog.findFirstOrThrow({
      where: { targetId: active.id, action: 'THREAD_TAXONOMY_UPDATED' },
    });
    assert.deepEqual(log.metadata, {
      before: { category: category.slug, tagIds: [], version: 1 },
      after: { category: nextCategory.slug, tagIds: [tag.id], version: 2 },
    });
    assert(invalidated.includes('cache:threads:list:*') && invalidated.includes('cache:thread:*'));
    await assert.rejects(
      taxonomy.update(active.id, { version: 1, reason: '重复提交', tagIds: [] }, admin.id, {}),
      { errorCode: ErrorCode.OPTIMISTIC_LOCK_CONFLICT },
    );
    const failing = new AdminContentTaxonomyService(
      prisma,
      {
        record: async () => {
          throw new Error('审计失败');
        },
      } as unknown as AuditService,
      cache,
      new EventEmitter2(),
    );
    await assert.rejects(
      failing.update(
        active.id,
        { version: 2, reason: '回滚', category: category.slug, tagIds: [] },
        admin.id,
        {},
      ),
      /审计失败/,
    );
    const retained = await queries.detail('thread', active.id);
    assert.equal(retained.version, 2);
    assert.equal(retained.category, nextCategory.slug);
    assert.deepEqual(
      retained.tags.map((row) => row.id),
      [tag.id],
    );
    await client.topicTag.update({ where: { id: tag.id }, data: { isActive: false } });
    await client.threadCategoryDefinition.update({
      where: { id: nextCategory.id },
      data: { isActive: false },
    });
    await taxonomy.update(
      active.id,
      { version: 2, reason: '保留历史停用项', category: nextCategory.slug, tagIds: [tag.id] },
      admin.id,
      {},
    );
    await taxonomy.update(active.id, { version: 3, reason: '清空标签', tagIds: [] }, admin.id, {});
    assert.equal((await queries.detail('thread', active.id)).tags.length, 0);

    const failingCache = new CacheService({
      stores: [
        {
          iterator: async function* () {
            throw new Error('测试缓存不可用');
          },
        },
      ],
    } as never);
    const tolerantTaxonomy = new AdminContentTaxonomyService(
      prisma,
      audit,
      failingCache,
      new EventEmitter2(),
    );
    await tolerantTaxonomy.update(
      active.id,
      { version: 4, reason: '缓存故障仍提交', tagIds: [] },
      admin.id,
      {},
    );
    assert.equal((await queries.detail('thread', active.id)).version, 5);

    const dashboard = new AdminDashboardService(prisma);
    const result = await dashboard.overview({});
    assert(result.current.newMoments >= 1 && result.current.newMomentComments >= 2);
    const points = await dashboard.timeseries({});
    assert(points.items.some((row) => row.newMoments >= 1 && row.newMomentComments >= 2));
    console.log(
      '管理后台集成通过：隔离迁移、四类可见性/父级/媒体、用户计数、游标、并发版本、审计回滚、停用分类标签、动态统计',
    );
  } finally {
    await client.$disconnect();
    await control.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await control.$disconnect();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : '管理后台集成失败');
  process.exitCode = 1;
});
