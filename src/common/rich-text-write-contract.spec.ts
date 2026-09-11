import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mockDeep } from 'jest-mock-extended';
import { PrismaService } from '../prisma/prisma.service';
import { ThreadAccessService } from '../access/thread-access.service';
import { DiceService } from '../dice/dice.service';
import { PostsService } from '../posts/posts.service';
import { ThreadsService } from '../threads/threads.service';
import { ThreadAggregateService } from '../threads/thread-aggregate.service';
import { SubthreadsService } from '../subthreads/subthreads.service';
import { DraftsService } from '../drafts/drafts.service';
import { OutboxService } from '../outbox/outbox.service';
import { MediaReferenceService } from '../media/media-reference.service';
import { StickerContentService } from '../stickers/sticker-content.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RedisService } from '../redis/redis.service';
import { CreateThreadDto } from '../threads/dto/create-thread.dto';

const fixture = JSON.parse(readFileSync(resolve(__dirname,
  '../../contracts/rich-text-behavior-v1-fixtures.json'), 'utf8')) as {
  rejected: Array<{ id: string; markdown: string; errorCode: number }>;
};

async function setup<T>(target: Type<T>) {
  const prisma = mockDeep<PrismaService>();
  const access = mockDeep<ThreadAccessService>();
  access.assertCanManage.mockResolvedValue({ role: 'OWNER' } as Awaited<ReturnType<ThreadAccessService['assertCanManage']>>);
  prisma.thread.findUnique.mockResolvedValue({ published: false, title: '合成主题' } as never);
  const persisted = { id: 'synthetic-draft', userId: 'synthetic-user', slot: 1, content: '最后有效合成正文', version: 1 };
  prisma.draft.findFirst.mockResolvedValue(persisted as never);
  const dice = new DiceService();
  const roll = jest.spyOn(dice, 'rollNodes');
  const outbox = mockDeep<OutboxService>();
  const media = mockDeep<MediaReferenceService>();
  const stickers = mockDeep<StickerContentService>();
  const events = mockDeep<EventEmitter2>();
  const redis = mockDeep<RedisService>();
  const fixed = new Map<unknown, unknown>([
    [PrismaService, prisma], [ThreadAccessService, access], [DiceService, dice],
    [OutboxService, outbox], [MediaReferenceService, media], [StickerContentService, stickers],
    [EventEmitter2, events], [RedisService, redis],
  ]);
  const dependencies = Reflect.getMetadata('design:paramtypes', target) as Type<unknown>[];
  const module = await Test.createTestingModule({ providers: [target,
    ...dependencies.map((provide) => ({ provide, useValue: fixed.get(provide) ?? mockDeep<object>() })),
  ] }).compile();
  return { service: module.get(target), module, prisma, persisted, roll, outbox, media, stickers, events, redis };
}

const routes: Array<{ name: string; target: Type<unknown>; invoke: (service: unknown, content: string) => Promise<unknown> }> = [
  { name: '主题创建', target: ThreadsService, invoke: (s, content) => (s as ThreadsService).create({ content } as CreateThreadDto, 'synthetic-user') },
  { name: '主题聚合保存', target: ThreadAggregateService, invoke: (s, content) => (s as ThreadAggregateService).save('synthetic-thread', { content, tagNames: [], version: 1, defaultSubthreadVersion: 1 }, 'synthetic-user') },
  { name: '楼层/回复创建', target: PostsService, invoke: (s, content) => (s as PostsService).create('synthetic-subthread', { content }, 'synthetic-user') },
  { name: '楼层/回复编辑', target: PostsService, invoke: (s, content) => (s as PostsService).update('synthetic-post', { content, version: 1 }, 'synthetic-user') },
  { name: '子贴正文 upsert', target: PostsService, invoke: (s, content) => (s as PostsService).upsertBody('synthetic-subthread', content, 1, 'synthetic-user') },
  { name: '子贴创建', target: SubthreadsService, invoke: (s, content) => (s as SubthreadsService).create('synthetic-thread', { title: '合成子贴', content }, 'synthetic-user') },
  { name: '云草稿创建', target: DraftsService, invoke: (s, content) => (s as DraftsService).create({ content }, 'synthetic-user') },
  { name: '云草稿编辑', target: DraftsService, invoke: (s, content) => (s as DraftsService).update('synthetic-draft', content, 1, 'synthetic-user') },
];

describe.each(routes)('共享拒绝反例保护实际 $name 用例', (route) => {
  it.each(fixture.rejected)('$id 拒绝且不进入写事务/派生副作用，重试也保留最后正文', async ({ markdown, errorCode }) => {
    const context = await setup(route.target);
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        await expect(route.invoke(context.service, markdown)).rejects.toMatchObject({ errorCode });
      }
      expect(context.prisma.$transaction).not.toHaveBeenCalled();
      expect(context.prisma.post.create).not.toHaveBeenCalled();
      expect(context.prisma.post.update).not.toHaveBeenCalled();
      expect(context.prisma.draft.create).not.toHaveBeenCalled();
      expect(context.prisma.draft.update).not.toHaveBeenCalled();
      expect(context.roll).not.toHaveBeenCalled();
      expect(context.media.syncPostContent).not.toHaveBeenCalled();
      expect(context.media.syncDraftContent).not.toHaveBeenCalled();
      expect(context.stickers.assertContentAllowed).not.toHaveBeenCalled();
      expect(context.events.emit).not.toHaveBeenCalled();
      expect(context.persisted.content).toBe('最后有效合成正文');
    } finally { await context.module.close(); }
  });
});
