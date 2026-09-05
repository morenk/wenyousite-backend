import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TagsService } from '../tags/tags.service';
import { ThreadAccessService } from '../access/thread-access.service';

/** 主题帖标签关联用例。 */
@Injectable()
export class ThreadTagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tags: TagsService,
    private readonly access: ThreadAccessService,
  ) {}

  async findAll(threadId: string, userId?: string) {
    await this.access.assertAccessible(threadId, userId);
    return this.prisma.threadTopicTag.findMany({
      where: { threadId },
      include: { tag: true },
    });
  }

  async add(threadId: string, name: string, userId: string) {
    await this.access.assertCanManage(threadId, userId);
    const tag = await this.prisma.$transaction(async (tx) => {
      await this.access.lockInteraction(tx, threadId, userId);
      const [tag] = await this.tags.findOrCreate([name], tx);
      await tx.threadTopicTag.upsert({
      where: { threadId_tagId: { threadId, tagId: tag.id } },
      create: { threadId, tagId: tag.id },
      update: {},
    });
      return tag;
    });
    await this.tags.invalidateCache();
    return tag;
  }

  async remove(threadId: string, tagId: string, userId: string) {
    await this.access.assertCanManage(threadId, userId);
    await this.prisma.$transaction(async (tx) => {
      await this.access.lockInteraction(tx, threadId, userId);
      await tx.threadTopicTag.deleteMany({ where: { threadId, tagId } });
    });
    return { message: '标签已移除' };
  }
}
