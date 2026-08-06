import { Injectable, HttpStatus } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { ThreadAccessService } from '../access/thread-access.service';
import { CreateSubthreadDto } from './dto/create-subthread.dto';
import { ErrorCode } from '../common/exceptions/error-codes';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { notDeleted, countNonDeletedPosts } from '../common/prisma-helpers';
import { DiceService } from '../dice/dice.service';
import { hasVisibleMarkdownContent, normalizeMarkdownContent } from '../common/markdown-content';
import { Prisma } from '@prisma/client';
import { OutboxService } from '../outbox/outbox.service';

/** 子贴服务：CRUD、排序、权限校验 */
@Injectable()
export class SubthreadsService {
  constructor(
    private prisma: PrismaService,
    private threadAccess: ThreadAccessService,
    private eventEmitter: EventEmitter2,
    private diceService: DiceService,
    private outbox: OutboxService,
  ) {}

  /** 获取主题帖下的子贴列表 */
  async findAll(threadId: string, userId?: string) {
    await this.threadAccess.assertAccessible(threadId, userId);

    return this.prisma.subthread.findMany({
      where: { threadId, ...notDeleted },
      orderBy: { sortOrder: 'asc' },
      include: {
        tags: { include: { tag: true } },
        ...countNonDeletedPosts(),
      },
    });
  }

  /** 获取单个子贴详情 */
  async findById(id: string, userId?: string) {
    const subthread = await this.prisma.subthread.findUnique({
      where: { id, ...notDeleted },
      include: {
        thread: { select: { id: true, title: true, ownerId: true, visibility: true } },
        tags: { include: { tag: true } },
        ...countNonDeletedPosts(),
      },
    });
    if (!subthread) throw notFound(ErrorCode.SUBTHREAD_NOT_FOUND, '子贴不存在');
    await this.threadAccess.assertAccessible(subthread.threadId, userId);
    return subthread;
  }

  /** 创建子贴（仅 OWNER/COLLABORATOR）。sortOrder 计算和冲突检查在事务内 FOR UPDATE 锁后执行 */
  async create(threadId: string, dto: CreateSubthreadDto, userId: string) {
    const manager = await this.threadAccess.assertCanManage(threadId, userId);

    // 检查线程是否已发布（用于决定是否发射事件）
    const thread = await this.prisma.thread.findUnique({
      where: { id: threadId, ...notDeleted },
      select: { published: true, title: true },
    });
    if (!thread) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');

    const parsedContent = this.diceService.parseContent(
      normalizeMarkdownContent(dto.content ?? ''),
    );
    const content = parsedContent.content;
    const hasText = hasVisibleMarkdownContent(parsedContent.contentWithoutDice);
    if (thread.published && parsedContent.nodes.length > 0 && !hasText) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '子贴正文必须包含可见文字');
    }
    const hasBody = hasText || parsedContent.nodes.length > 0;
    const generatedDice = thread.published
      ? this.diceService.rollNodes(parsedContent.nodes)
      : [];
    const postingPolicy = dto.postingPolicy ?? ('PARTICIPANTS' as any);

    const result = await this.prisma
      .$transaction(async (tx) => {
        // 锁主题帖行，防止并发创建子贴时 sortOrder 竞态
        await tx.$queryRaw`SELECT id FROM threads WHERE id = ${threadId} FOR UPDATE`;

        // 事务内计算 sortOrder
        let sortOrder = dto.sortOrder;
        if (sortOrder === undefined) {
          const max = await tx.subthread.aggregate({
            where: { threadId, ...notDeleted },
            _max: { sortOrder: true },
          });
          sortOrder = (max._max.sortOrder ?? -1) + 1;
        } else {
          const existing = await tx.subthread.findFirst({
            where: { threadId, sortOrder, ...notDeleted },
          });
          if (existing) {
            throw new BusinessException(
              ErrorCode.CONFLICT,
              `排序序号 ${sortOrder} 已被占用`,
              HttpStatus.CONFLICT,
            );
          }
        }

        const subthread = await tx.subthread.create({
          data: { threadId, title: dto.title, sortOrder, postingPolicy },
        });

        let bodyPost: any = null;
        if (hasBody) {
          bodyPost = await tx.post.create({
            data: {
              threadId,
              subthreadId: subthread.id,
              authorId: userId,
              kind: 'BODY',
              content,
            },
            include: { author: { select: { username: true } } },
          });
          if (generatedDice.length > 0) {
            await tx.diceRoll.createMany({
              data: this.diceService.buildCreateData(bodyPost.id, generatedDice),
            });
            bodyPost = await tx.post.findUniqueOrThrow({
              where: { id: bodyPost.id },
              include: {
                author: { select: { username: true } },
                diceRolls: { orderBy: { createdAt: 'asc' } },
              },
            });
          } else {
            bodyPost.diceRolls = [];
          }
        }

        const full = await tx.subthread.findUnique({
          where: { id: subthread.id },
          include: {
            tags: { include: { tag: true } },
            ...countNonDeletedPosts(),
          },
        });

        // 默认子贴指针与子贴创建原子提交；并发创建时仅首个成功写入。
        await tx.thread.updateMany({
          where: { id: threadId, defaultSubthreadId: null, ...notDeleted },
          data: { defaultSubthreadId: subthread.id },
        });

        if (thread.published && bodyPost) {
          await this.outbox.enqueue(tx, {
            eventType: 'post.created',
            aggregateType: 'Post',
            aggregateId: bodyPost.id,
            eventKey: `post-created:${bodyPost.id}`,
            payload: {
              postId: bodyPost.id,
              content,
              userId,
              authorUsername: bodyPost.author.username,
              threadId,
              subthreadId: subthread.id,
              subthreadTitle: dto.title,
              parentPostId: null,
              replyToPostId: null,
              isSubthreadBody: true,
              authorRole: manager.role,
              authorPlayerMarked: manager.playerMarked,
              diceRolls: bodyPost.diceRolls.map((roll: { nodeId: string; notation: string; total: number }) => ({
                nodeId: roll.nodeId,
                notation: roll.notation,
                total: roll.total,
              })),
            } as Prisma.InputJsonValue,
          });
        }

        return { subthread: full, bodyPost };
      })
      .catch((err) => {
        if (err instanceof BusinessException) throw err;
        if (err?.code === 'P2002') {
          // Prisma UNIQUE 约束冲突（并发创建撞 sortOrder）
          throw new BusinessException(
            ErrorCode.CONFLICT,
            '排序序号冲突，请刷新后重试',
            HttpStatus.CONFLICT,
          );
        }
        throw err;
      });

    // 缓存失效事件（仅已发布帖）
    if (thread.published && result.subthread) {
      this.eventEmitter.emit('subthread.created', {
        threadId: result.subthread.threadId,
        subthreadId: result.subthread.id,
      });
    }

    return result.subthread!;
  }

  /** 批量重排子贴：按 ids 数组顺序分配 sortOrder（首发须为默认子贴） */
  async reorder(threadId: string, ids: string[], userId: string) {
    await this.assertCanManage(threadId, userId);

    if (!ids || ids.length === 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请提供要排序的子贴列表');
    }

    // 验证所有子贴属于该帖且未删除
    const subthreads = await this.prisma.subthread.findMany({
      where: { threadId, id: { in: ids }, ...notDeleted },
      select: { id: true },
    });
    if (subthreads.length !== ids.length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '子贴列表包含不存在或已删除的子贴');
    }

    // 列表第一项必须是默认子贴
    const thread = await this.prisma.thread.findUnique({
      where: { id: threadId, ...notDeleted },
      select: { defaultSubthreadId: true },
    });
    if (thread?.defaultSubthreadId && ids[0] !== thread.defaultSubthreadId) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '默认子贴必须排在第一位');
    }

    // 两轮更新：先设临时负值避免 UNIQUE 冲突，再设最终值
    await this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < ids.length; i++) {
        await tx.subthread.update({
          where: { id: ids[i] },
          data: { sortOrder: -(i + 1) },
        });
      }
      for (let i = 0; i < ids.length; i++) {
        await tx.subthread.update({
          where: { id: ids[i] },
          data: { sortOrder: i },
        });
      }
    });

    return this.prisma.subthread.findMany({
      where: { threadId, ...notDeleted },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, title: true, sortOrder: true },
    });
  }

  /** 修改子贴（仅 OWNER/COLLABORATOR）。默认子贴不可修改 sortOrder */
  async update(
    id: string,
    dto: { title?: string; sortOrder?: number; postingPolicy?: string; version: number },
    userId: string,
  ) {
    const subthread = await this.prisma.subthread.findUnique({ where: { id, ...notDeleted } });
    if (!subthread) throw notFound(ErrorCode.SUBTHREAD_NOT_FOUND, '子贴不存在');
    await this.threadAccess.assertCanManage(subthread.threadId, userId);

    const { version, sortOrder, ...data } = dto;

    // 默认子贴不可修改排序
    if (sortOrder !== undefined) {
      const thread = await this.prisma.thread.findUnique({
        where: { id: subthread.threadId, ...notDeleted },
        select: { defaultSubthreadId: true },
      });
      if (thread?.defaultSubthreadId === id) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '默认子贴不可修改排序',
          HttpStatus.BAD_REQUEST,
        );
      }
      // 检查是否冲突
      const conflict = await this.prisma.subthread.findFirst({
        where: { threadId: subthread.threadId, sortOrder, ...notDeleted, id: { not: id } },
      });
      if (conflict) {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          `排序序号 ${sortOrder} 已被占用`,
          HttpStatus.CONFLICT,
        );
      }
    }

    const updateData: any = { ...data, version: { increment: 1 } };
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;

    const updated = await this.prisma.subthread
      .update({
        where: { id, version, ...notDeleted },
        data: updateData,
        include: {
          tags: { include: { tag: true } },
          ...countNonDeletedPosts(),
        },
      })
      .catch((err) => {
        if (err?.code === 'P2025')
          throw new BusinessException(
            ErrorCode.OPTIMISTIC_LOCK_CONFLICT,
            '子贴已被修改，请刷新后重试',
            HttpStatus.CONFLICT,
          );
        throw err;
      });

    // 缓存失效事件
    this.eventEmitter.emit('subthread.updated', {
      threadId: updated.threadId,
      subthreadId: updated.id,
    });

    return updated;
  }

  /** 软删除子贴（仅 OWNER/COLLABORATOR）。默认子贴不可单独删除 */
  async remove(id: string, userId: string) {
    const subthread = await this.prisma.subthread.findUnique({ where: { id, ...notDeleted } });
    if (!subthread) throw notFound(ErrorCode.SUBTHREAD_NOT_FOUND, '子贴不存在');
    await this.threadAccess.assertCanManage(subthread.threadId, userId);

    // 默认子贴不可删除
    const thread = await this.prisma.thread.findUnique({
      where: { id: subthread.threadId, ...notDeleted },
      select: { defaultSubthreadId: true },
    });
    if (thread?.defaultSubthreadId === id) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '默认子贴不可删除，请删除整个主题帖',
        HttpStatus.BAD_REQUEST,
      );
    }

    const result = await this.prisma.subthread.update({
      where: { id, ...notDeleted },
      data: { deletedAt: new Date() },
    });

    this.eventEmitter.emit('subthread.deleted', {
      threadId: subthread.threadId,
      subthreadId: id,
    });

    return result;
  }

  /** 检查是否有管理权限（公开方法，供标签控制器调用） */
  async assertCanManage(threadId: string, userId: string) {
    return this.threadAccess.assertCanManage(threadId, userId);
  }
}
