import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubthreadsService } from './subthreads.service';

/** 子贴标签定义与关联用例。 */
@Injectable()
export class SubthreadTagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subthreads: SubthreadsService,
  ) {}

  async findAll(subthreadId: string, userId?: string) {
    await this.subthreads.findById(subthreadId, userId);
    return this.prisma.subthreadTag.findMany({
      where: { subthreadId },
      include: { tag: true },
    });
  }

  async add(subthreadId: string, input: { name: string; color?: string }, userId: string) {
    const subthread = await this.subthreads.findById(subthreadId, userId);
    await this.subthreads.assertCanManage(subthread.threadId, userId);
    const tag = await this.prisma.subthreadTagDef.upsert({
      where: { threadId_name: { threadId: subthread.threadId, name: input.name } },
      create: { threadId: subthread.threadId, name: input.name, color: input.color },
      update: {},
    });
    await this.prisma.subthreadTag.upsert({
      where: { subthreadId_tagId: { subthreadId, tagId: tag.id } },
      create: { subthreadId, tagId: tag.id },
      update: {},
    });
    return tag;
  }

  async remove(subthreadId: string, tagId: string, userId: string) {
    const subthread = await this.subthreads.findById(subthreadId, userId);
    await this.subthreads.assertCanManage(subthread.threadId, userId);
    await this.prisma.subthreadTag.deleteMany({ where: { subthreadId, tagId } });
    return { message: '标签已移除' };
  }
}
