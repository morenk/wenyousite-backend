import { Injectable, HttpStatus } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PostingPolicy, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ThreadAccessService } from '../access/thread-access.service';
import { CreateSubthreadDto } from './dto/create-subthread.dto';
import { ErrorCode } from '../common/exceptions/error-codes';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { notDeleted, countNonDeletedPosts } from '../common/prisma-helpers';
import { DiceService } from '../dice/dice.service';
import { hasVisibleMarkdownContent, prepareMarkdownContent } from '../common/markdown-content';
import { OutboxService } from '../outbox/outbox.service';
import { StickerContentService } from '../stickers/sticker-content.service';
import { hashIdempotencyPayload } from '../common/idempotency';
import { MediaReferenceService } from '../media/media-reference.service';

const subthreadBodyPostInclude = {
  author: { select: { username: true } },
  diceRolls: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.PostInclude;

type SubthreadBodyPost = Prisma.PostGetPayload<{
  include: typeof subthreadBodyPostInclude;
}>;

/** 子贴服务：CRUD、排序、权限校验 */
@Injectable()
export class SubthreadsService {
  constructor(
    private prisma: PrismaService,
    private threadAccess: ThreadAccessService,
    private eventEmitter: EventEmitter2,
    private diceService: DiceService,
    private outbox: OutboxService,
    private stickerContent: StickerContentService,
    private mediaReferences: MediaReferenceService,
  ) {}

  /** 获取主题帖下的子贴列表 */
  async findAll(threadId: string, userId?: string) {
    await this.threadAccess.assertAccessible(threadId, userId);

    return this.prisma.subthread.findMany({
      where: { threadId, ...notDeleted },
      orderBy: { sortOrder: 'asc' },
      include: countNonDeletedPosts(),
    });
  }

  /** 获取单个子贴详情 */
  async findById(id: string, userId?: string) {
    const subthread = await this.prisma.subthread.findUnique({
      where: { id, ...notDeleted },
      include: {
        thread: { select: { id: true, title: true, ownerId: true, visibility: true } },
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

    const parsedContent = this.diceService.parseContent(prepareMarkdownContent(dto.content ?? ''));
    const content = parsedContent.content;
    const stickerAssetIds = await this.stickerContent.assertContentAllowed(userId, content);
    const hasText = hasVisibleMarkdownContent(parsedContent.contentWithoutDice);
    if (thread.published && parsedContent.nodes.length > 0 && !hasText) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '子贴正文必须包含可见文字');
    }
    const hasBody = hasText || parsedContent.nodes.length > 0;
    const generatedDice = thread.published ? this.diceService.rollNodes(parsedContent.nodes) : [];
    const postingPolicy = dto.postingPolicy ?? PostingPolicy.PARTICIPANTS;
    const requestHash = hashIdempotencyPayload({
      actorId: userId,
      title: dto.title,
      content,
      sortOrder: dto.sortOrder ?? null,
      postingPolicy,
    });
    if (dto.clientRequestId) {
      const existing = await this.prisma.subthread.findFirst({
        where: { threadId, clientRequestId: dto.clientRequestId },
        select: { id: true, createRequestHash: true },
      });
      if (existing) {
        if (existing.createRequestHash !== requestHash) {
          throw new BusinessException(
            ErrorCode.IDEMPOTENCY_KEY_REUSED,
            'clientRequestId 已用于不同的子贴创建请求',
            HttpStatus.CONFLICT,
          );
        }
        return this.prisma.subthread.findUniqueOrThrow({
          where: { id: existing.id },
          include: countNonDeletedPosts(),
        });
      }
    }

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
          data: {
            threadId,
            title: dto.title,
            sortOrder,
            postingPolicy,
            clientRequestId: dto.clientRequestId,
            createRequestHash: dto.clientRequestId ? requestHash : undefined,
          },
        });

        let bodyPost: SubthreadBodyPost | null = null;
        if (hasBody) {
          bodyPost = await tx.post.create({
            data: {
              threadId,
              subthreadId: subthread.id,
              authorId: userId,
              kind: 'BODY',
              content,
            },
            include: subthreadBodyPostInclude,
          });
          await this.mediaReferences.syncPostContent(tx, bodyPost.id, content);
          if (generatedDice.length > 0) {
            await tx.diceRoll.createMany({
              data: this.diceService.buildCreateData(bodyPost.id, generatedDice),
            });
            bodyPost = await tx.post.findUniqueOrThrow({
              where: { id: bodyPost.id },
              include: subthreadBodyPostInclude,
            });
          }
        }

        const full = await tx.subthread.findUnique({
          where: { id: subthread.id },
          include: countNonDeletedPosts(),
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
              occurredAt: new Date().toISOString(),
              threadId,
              subthreadId: subthread.id,
              subthreadTitle: dto.title,
              parentPostId: null,
              replyToPostId: null,
              isSubthreadBody: true,
              authorRole: manager.role,
              authorPlayerMarked: manager.playerMarked,
              diceRolls: bodyPost.diceRolls.map(
                (roll: { nodeId: string; notation: string; total: number }) => ({
                  nodeId: roll.nodeId,
                  notation: roll.notation,
                  total: roll.total,
                }),
              ),
            },
          });
        }

        return { subthread: full, bodyPost, replayed: false };
      })
      .catch((err) => {
        if (err instanceof BusinessException) throw err;
        if (err?.code === 'P2002') {
          if (dto.clientRequestId) {
            return this.prisma.subthread
              .findFirst({
                where: { threadId, clientRequestId: dto.clientRequestId },
                include: countNonDeletedPosts(),
              })
              .then((existing) => {
                if (existing?.createRequestHash === requestHash) {
                  return { subthread: existing, bodyPost: null, replayed: true };
                }
                if (existing) {
                  throw new BusinessException(
                    ErrorCode.IDEMPOTENCY_KEY_REUSED,
                    'clientRequestId 已用于不同的子贴创建请求',
                    HttpStatus.CONFLICT,
                  );
                }
                throw new BusinessException(
                  ErrorCode.CONFLICT,
                  '排序序号冲突，请刷新后重试',
                  HttpStatus.CONFLICT,
                );
              });
          }
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
    if (thread.published && result.subthread && !result.replayed) {
      this.eventEmitter.emit('subthread.created', {
        threadId: result.subthread.threadId,
        subthreadId: result.subthread.id,
      });
    }
    if (thread.published && !result.replayed) {
      await this.stickerContent.recordUsage(userId, stickerAssetIds);
    }

    return result.subthread!;
  }

  /** 批量重排子贴：按 ids 数组顺序分配 sortOrder（首发须为默认子贴） */
  async reorder(threadId: string, ids: string[], userId: string) {
    await this.assertCanManage(threadId, userId);

    if (!ids || ids.length === 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请提供要排序的子贴列表');
    }
    if (new Set(ids).size !== ids.length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '子贴列表不能包含重复项');
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // 与创建子贴共用主题帖行锁，完整集合校验和两轮更新不可被并发插入打断。
        await tx.$queryRaw`SELECT id FROM threads WHERE id = ${threadId} FOR UPDATE`;
        const thread = await tx.thread.findUnique({
          where: { id: threadId, ...notDeleted },
          select: { defaultSubthreadId: true },
        });
        if (!thread) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');

        const active = await tx.subthread.findMany({
          where: { threadId, ...notDeleted },
          select: { id: true },
        });
        const requested = new Set(ids);
        if (active.length !== ids.length || active.some((item) => !requested.has(item.id))) {
          throw new BusinessException(
            ErrorCode.BAD_REQUEST,
            '排序列表必须包含该主题帖的全部未删除子贴',
          );
        }
        if (thread.defaultSubthreadId && ids[0] !== thread.defaultSubthreadId) {
          throw new BusinessException(ErrorCode.BAD_REQUEST, '默认子贴必须排在第一位');
        }

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
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          '子贴排序已发生变化，请刷新后重试',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }

    return this.prisma.subthread.findMany({
      where: { threadId, ...notDeleted },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, title: true, sortOrder: true },
    });
  }

  /** 修改子贴（仅 OWNER/COLLABORATOR）。默认子贴不可修改 sortOrder */
  async update(
    id: string,
    dto: { title?: string; sortOrder?: number; postingPolicy?: PostingPolicy; version: number },
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

    const updateData: Prisma.SubthreadUpdateInput = { ...data, version: { increment: 1 } };
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;

    const updated = await this.prisma.subthread
      .update({
        where: { id, version, ...notDeleted },
        data: updateData,
        include: countNonDeletedPosts(),
      })
      .catch((err) => {
        if (err?.code === 'P2025')
          throw new BusinessException(
            ErrorCode.OPTIMISTIC_LOCK_CONFLICT,
            '子贴已被修改，请刷新后重试',
            HttpStatus.CONFLICT,
          );
        if (err?.code === 'P2002')
          throw new BusinessException(
            ErrorCode.CONFLICT,
            '排序序号已被占用，请刷新后重试',
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

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM threads WHERE id = ${subthread.threadId} FOR UPDATE`;
      const current = await tx.subthread.findUnique({
        where: { id, ...notDeleted },
        select: { id: true },
      });
      if (!current) throw notFound(ErrorCode.SUBTHREAD_NOT_FOUND, '子贴不存在');
      await this.mediaReferences.releaseSubthreadContent(tx, id);
      const removed = await tx.subthread.update({
        where: { id, ...notDeleted },
        data: { deletedAt: new Date() },
      });
      await tx.notification.updateMany({
        where: { post: { subthreadId: id }, isRead: false },
        data: { isRead: true },
      });
      return removed;
    });

    this.eventEmitter.emit('subthread.deleted', {
      threadId: subthread.threadId,
      subthreadId: id,
    });

    return result;
  }

  /** 复用主题帖管理权限校验。 */
  async assertCanManage(threadId: string, userId: string) {
    return this.threadAccess.assertCanManage(threadId, userId);
  }
}
