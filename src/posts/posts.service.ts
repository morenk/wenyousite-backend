import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { ThreadAccessService } from '../access/thread-access.service';
import { BlockFilterService } from '../access/block-filter.service';
import { NotificationProducer } from '../notifications/notification.producer';
import { MentionsService } from '../mentions/mentions.service';
import { ReadingProgressService } from '../reading-progress/reading-progress.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { ErrorCode } from '../common/exceptions/error-codes';
import { BusinessException, notFound, forbidden } from '../common/exceptions/business.exception';
import {
  notDeleted,
  authorSelect,
  includeDiceRolls,
} from '../common/prisma-helpers';
import { truncateMarkdown } from '../common/markdown-truncate';
import { hasVisibleMarkdownContent, normalizeMarkdownContent } from '../common/markdown-content';
import { DiceService } from '../dice/dice.service';
import { PostingPolicyService } from './posting-policy.service';
import { PostQueryService } from './post-query.service';
import { Prisma } from '@prisma/client';
import { OutboxService } from '../outbox/outbox.service';
import { reconcilePublishedDice } from '../dice/reconcile-published-dice';

/** 楼层服务：发帖（事务楼层编号 + FOR UPDATE）、楼中楼、编辑、软删除 */
@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
    private threadAccess: ThreadAccessService,
    private blockFilter: BlockFilterService,
    private notificationProducer: NotificationProducer,
    private mentionsService: MentionsService,
    private readingProgressService: ReadingProgressService,
    private diceService: DiceService,
    private postingPolicy: PostingPolicyService,
    private queries: PostQueryService,
    private outbox: OutboxService,
  ) {}

  async findAllBySubthread(subthreadId: string, cursor?: string, limit = 20, userId?: string) {
    return this.queries.findAllBySubthread(subthreadId, cursor, limit, userId);
  }

  async findReplies(postId: string, cursor?: string, limit = 20, userId?: string) {
    return this.queries.findReplies(postId, cursor, limit, userId);
  }

  /** 发帖：楼层或楼中楼回复。先校验访问权限与发帖策略，通过后才自动加入为参与人 */
  async create(subthreadId: string, dto: CreatePostDto, userId: string) {
    const parsedContent = this.diceService.parseContent(normalizeMarkdownContent(dto.content));
    const content = parsedContent.content;
    if (!hasVisibleMarkdownContent(parsedContent.contentWithoutDice) && parsedContent.nodes.length === 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '正文和骰子不能同时为空');
    }
    const subthread = await this.prisma.subthread.findUnique({
      where: { id: subthreadId, ...notDeleted },
      include: { thread: true },
    });
    if (!subthread) throw notFound(ErrorCode.SUBTHREAD_NOT_FOUND, '子贴不存在');

    // 校验主题帖访问权限（私密帖非参与人在此被拦截）
    await this.threadAccess.assertAccessible(subthread.threadId, userId);

    if (dto.clientRequestId) {
      const existingRequest = await this.findByClientRequestId(userId, dto.clientRequestId);
      if (existingRequest) {
        this.assertSameCreateRequest(existingRequest, subthreadId, dto, content);
        return existingRequest;
      }
    }

    // 先查当前参与人状态（未加入时按未参与处理）
    const member = await this.prisma.threadMember.findUnique({
      where: { threadId_userId: { threadId: subthread.threadId, userId } },
    });
    await this.postingPolicy.assertCanPost({
      ownerId: subthread.thread.ownerId,
      userId,
      postingPolicy: subthread.postingPolicy,
      member,
    });

    // 验证 parentPost 存在、属于同一子贴、且为主楼层
    if (dto.parentPostId) {
      const parent = await this.prisma.post.findUnique({
        where: { id: dto.parentPostId, ...notDeleted },
        select: { id: true, subthreadId: true, parentPostId: true },
      });
      if (!parent) throw notFound(ErrorCode.POST_NOT_FOUND, '父楼层不存在');
      if (parent.subthreadId !== subthreadId) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '不能跨子贴回复');
      }
      if (parent.parentPostId !== null) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '只能回复主楼层');
      }
    }

    // 验证 replyToPost 存在且属于同一子贴
    if (dto.replyToPostId) {
      const target = await this.prisma.post.findUnique({
        where: { id: dto.replyToPostId, ...notDeleted },
        select: { id: true, subthreadId: true },
      });
      if (!target) throw notFound(ErrorCode.POST_NOT_FOUND, '被回复的帖子不存在');
      if (target.subthreadId !== subthreadId) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '不能跨子贴回复');
      }
    }

    // 事务：SELECT FOR UPDATE 锁子贴行 → 读 MAX → 创建楼层 → 更新 lastPostAt
    let duplicateRequest = false;
    let post;
    try {
      post = await this.prisma.$transaction(async (tx) => {
        // 自动加入与发帖原子提交，后续任何校验或写入失败都不会残留成员记录。
        await tx.threadMember.upsert({
          where: { threadId_userId: { threadId: subthread.threadId, userId } },
          create: { threadId: subthread.threadId, userId, role: 'PARTICIPANT' },
          update: {},
        });

        let floorNumber: number | null = null;

        if (!dto.parentPostId) {
          await tx.$queryRaw`SELECT id FROM subthreads WHERE id = ${subthreadId} FOR UPDATE`;
          const maxFloor = await tx.post.aggregate({
            where: { subthreadId, kind: 'FLOOR', parentPostId: null },
            _max: { floorNumber: true },
          });
          floorNumber = (maxFloor._max.floorNumber ?? 0) + 1;
        }

        const p = await tx.post.create({
          data: {
            threadId: subthread.threadId,
            subthreadId,
            authorId: userId,
            kind: 'FLOOR',
            floorNumber,
            parentPostId: dto.parentPostId ?? null,
            replyToPostId: dto.replyToPostId ?? null,
            clientRequestId: dto.clientRequestId ?? null,
            content,
          },
          include: {
            author: { select: authorSelect },
          },
        });

        const generatedDice = subthread.thread.published
          ? this.diceService.rollNodes(parsedContent.nodes)
          : [];
        if (generatedDice.length > 0) {
          await tx.diceRoll.createMany({
            data: this.diceService.buildCreateData(p.id, generatedDice),
          });
        }

        const activityAt = new Date();
        await tx.subthread.update({
          where: { id: subthreadId },
          data: {
            lastPostAt: activityAt,
            // 只有帖子真正创建成功后才推进主题帖的最近活动时间。
            thread: { update: { data: { updatedAt: activityAt } } },
          },
        });

        const createdPost =
          generatedDice.length === 0
            ? { ...p, diceRolls: [] }
            : await tx.post.findUniqueOrThrow({
                where: { id: p.id },
                include: { author: { select: authorSelect }, ...includeDiceRolls() },
              });
        if (subthread.thread.published) {
          await this.outbox.enqueue(tx, {
            eventType: 'post.created',
            aggregateType: 'Post',
            aggregateId: p.id,
            eventKey: `post-created:${p.id}`,
            payload: {
              postId: p.id,
              content,
              userId,
              authorUsername: createdPost.author.username,
              threadId: subthread.threadId,
              subthreadId: subthread.id,
              subthreadTitle: subthread.title,
              parentPostId: dto.parentPostId ?? null,
              replyToPostId: dto.replyToPostId ?? null,
              isSubthreadBody: false,
              authorRole: member?.role ?? 'PARTICIPANT',
              authorPlayerMarked: member?.playerMarked ?? false,
              diceRolls: createdPost.diceRolls.map((roll) => ({
                nodeId: roll.nodeId,
                notation: roll.notation,
                total: roll.total,
              })),
            } as Prisma.InputJsonValue,
          });
        }
        return createdPost;
      });
    } catch (error) {
      if (dto.clientRequestId && (error as { code?: string })?.code === 'P2002') {
        const existingRequest = await this.findByClientRequestId(userId, dto.clientRequestId);
        if (existingRequest) {
          this.assertSameCreateRequest(existingRequest, subthreadId, dto, content);
          post = existingRequest;
          duplicateRequest = true;
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }

    if (duplicateRequest) return post;

    // 发帖人自己的阅读进度自动推进到此处（发帖即证明读到这里）
    this.readingProgressService.update(userId, subthreadId, post.id).catch((err) => {
      this.logger.error(`发帖后进度更新失败 userId=${userId} subthreadId=${subthreadId}`, err);
    });

    return post;
  }

  private findByClientRequestId(userId: string, clientRequestId: string) {
    return this.prisma.post.findFirst({
      where: { authorId: userId, clientRequestId },
      include: { author: { select: authorSelect }, ...includeDiceRolls() },
    });
  }

  private assertSameCreateRequest(
    post: {
      subthreadId: string;
      content: string;
      parentPostId: string | null;
      replyToPostId: string | null;
    },
    subthreadId: string,
    dto: CreatePostDto,
    content: string,
  ) {
    if (
      post.subthreadId !== subthreadId ||
      post.content !== content ||
      post.parentPostId !== (dto.parentPostId ?? null) ||
      post.replyToPostId !== (dto.replyToPostId ?? null)
    ) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        'clientRequestId 已用于另一条发帖请求',
        HttpStatus.CONFLICT,
      );
    }
  }

  /** 写入子贴正文；未发布节点保持待掷，已发布节点在同一事务内增删结果。 */
  async upsertBody(
    subthreadId: string,
    content: string,
    version: number | undefined,
    userId: string,
  ) {
    const parsedContent = this.diceService.parseContent(normalizeMarkdownContent(content));
    const normalizedContent = parsedContent.content;
    const subthread = await this.prisma.subthread.findUnique({
      where: { id: subthreadId, ...notDeleted },
      include: { thread: { select: { id: true, published: true, title: true } } },
    });
    if (!subthread) throw notFound(ErrorCode.SUBTHREAD_NOT_FOUND, '子贴不存在');
    const manager = await this.threadAccess.assertCanManage(subthread.threadId, userId);
    if (
      subthread.thread.published &&
      !hasVisibleMarkdownContent(parsedContent.contentWithoutDice)
    ) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '子贴正文必须包含可见文字');
    }

    const existing = await this.prisma.post.findFirst({
      where: { subthreadId, kind: 'BODY', ...notDeleted },
      orderBy: { createdAt: 'asc' },
      include: { ...includeDiceRolls() },
    });

    if (!existing) {
      const post = await this.prisma.$transaction(async (tx) => {
        const created = await tx.post.create({
          data: {
            threadId: subthread.threadId,
            subthreadId,
            authorId: userId,
            kind: 'BODY',
            content: normalizedContent,
          },
          include: { author: { select: authorSelect } },
        });
        if (subthread.thread.published) {
          await reconcilePublishedDice(tx, this.diceService, created.id, parsedContent.nodes, []);
        }
        const activityAt = new Date();
        await tx.subthread.update({
          where: { id: subthreadId },
          data: {
            lastPostAt: activityAt,
            thread: { update: { data: { updatedAt: activityAt } } },
          },
        });
        const post = await tx.post.findUniqueOrThrow({
          where: { id: created.id },
          include: { author: { select: authorSelect }, ...includeDiceRolls() },
        });
        if (subthread.thread.published) {
          await this.outbox.enqueue(tx, {
            eventType: 'post.created',
            aggregateType: 'Post',
            aggregateId: post.id,
            eventKey: `post-created:${post.id}`,
            payload: {
              postId: post.id,
              content: normalizedContent,
              userId,
              authorUsername: post.author.username,
              threadId: subthread.threadId,
              subthreadId: subthread.id,
              subthreadTitle: subthread.title,
              parentPostId: null,
              replyToPostId: null,
              isSubthreadBody: true,
              authorRole: manager.role,
              authorPlayerMarked: manager.playerMarked,
              diceRolls: (post.diceRolls ?? []).map((roll) => ({
                nodeId: roll.nodeId,
                notation: roll.notation,
                total: roll.total,
              })),
            } as Prisma.InputJsonValue,
          });
        }
        return post;
      });
      this.readingProgressService.update(userId, subthreadId, post.id).catch((err) => {
        this.logger.error(
          `正文创建后进度更新失败 userId=${userId} subthreadId=${subthreadId}`,
          err,
        );
      });
      return post;
    }

    if (version === undefined || version !== existing.version) {
      throw new BusinessException(
        ErrorCode.OPTIMISTIC_LOCK_CONFLICT,
        '正文已被修改，请刷新后重试',
        HttpStatus.CONFLICT,
      );
    }
    const oldContent = existing.content;
    const updated = await this.prisma
      .$transaction(async (tx) => {
        const post = await tx.post.update({
          where: { id: existing.id, version, ...notDeleted },
          data: { content: normalizedContent, version: { increment: 1 } },
        });
        if (subthread.thread.published) {
          await reconcilePublishedDice(
            tx,
            this.diceService,
            post.id,
            parsedContent.nodes,
            existing.diceRolls ?? [],
          );
        }
        return tx.post.findUniqueOrThrow({
          where: { id: post.id },
          include: { author: { select: authorSelect }, ...includeDiceRolls() },
        });
      })
      .catch((err) => {
        if (err?.code === 'P2025') {
          throw new BusinessException(
            ErrorCode.OPTIMISTIC_LOCK_CONFLICT,
            '正文已被修改，请刷新后重试',
            HttpStatus.CONFLICT,
          );
        }
        throw err;
      });

    if (normalizedContent !== oldContent) {
      this.mentionsService
        .syncMentions(updated.id, normalizedContent, userId, subthread.threadId, oldContent)
        .then(async (mentioned) => {
          if (mentioned.length === 0) return;
          const blockSets = await this.blockFilter.loadBlockSets(userId);
          const filteredIds = this.blockFilter.filterRecipients(
            mentioned.map((mentionedUser) => mentionedUser.userId),
            blockSets,
          );
          if (filteredIds.length === 0) return;
          const preview = truncateMarkdown(normalizedContent);
          this.notificationProducer
            .notify(
              'mention',
              filteredIds,
              `${updated.author.username} 在编辑后的正文里提到了你：${preview}`,
              {
                postId: updated.id,
                threadId: subthread.threadId,
                fromUserId: userId,
                eventKey: `mention:${updated.id}`,
                payload: { actorName: updated.author.username, action: 'mention', preview },
              },
            )
            .catch(() => {});
        })
        .catch(() => {});
    }

    this.eventEmitter.emit('post.updated', {
      postId: updated.id,
      threadId: subthread.threadId,
      parentPostId: updated.parentPostId,
    });
    return updated;
  }

  /** 编辑帖子 */
  async update(id: string, dto: UpdatePostDto, userId: string) {
    const parsedContent = this.diceService.parseContent(normalizeMarkdownContent(dto.content));
    const content = parsedContent.content;
    const postLight = await this.prisma.post.findUnique({
      where: { id, ...notDeleted },
      select: {
        id: true,
        authorId: true,
        threadId: true,
        content: true,
        version: true,
        thread: { select: { published: true } },
        diceRolls: { select: { id: true, nodeId: true, notation: true } },
        subthread: { select: { deletedAt: true } },
      },
    });
    if (!postLight) throw notFound(ErrorCode.POST_NOT_FOUND, '帖子不存在');
    if (postLight.subthread.deletedAt) throw notFound(ErrorCode.POST_NOT_FOUND, '帖子不存在');
    await this.threadAccess.assertAccessible(postLight.threadId, userId);
    if (postLight.authorId !== userId) throw forbidden('只能编辑自己的帖子');

    const threadPublished = postLight.thread?.published ?? true;
    if (
      !hasVisibleMarkdownContent(parsedContent.contentWithoutDice) &&
      parsedContent.nodes.length === 0
    ) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '正文和骰子不能同时为空');
    }

    const oldContent = postLight.content;
    const updated = await this.prisma
      .$transaction(async (tx) => {
        const post = await tx.post.update({
          where: { id, version: dto.version, ...notDeleted },
          data: { content, version: { increment: 1 } },
        });
        if (threadPublished) {
          await reconcilePublishedDice(
            tx,
            this.diceService,
            id,
            parsedContent.nodes,
            postLight.diceRolls ?? [],
          );
        }
        return tx.post.findUniqueOrThrow({
          where: { id: post.id },
          include: { author: { select: authorSelect }, ...includeDiceRolls() },
        });
      })
      .catch((err) => {
        if (err?.code === 'P2025') {
          throw new BusinessException(
            ErrorCode.OPTIMISTIC_LOCK_CONFLICT,
            '帖子已被编辑，请刷新后重试',
            HttpStatus.CONFLICT,
          );
        }
        throw err;
      });

    // 编辑同步 @提及快照：新增目标通知，移除目标不再保留；全体玩家沿用首次快照。
    if (content !== oldContent) {
      if (postLight.threadId) {
        this.mentionsService
          .syncMentions(updated.id, content, userId, postLight.threadId, oldContent)
          .then(async (mentioned) => {
            if (mentioned.length > 0) {
              const blockSets = await this.blockFilter.loadBlockSets(userId);
              const filteredIds = this.blockFilter.filterRecipients(
                mentioned.map((u) => u.userId),
                blockSets,
              );
              if (filteredIds.length === 0) return;
              const preview = truncateMarkdown(content);
              this.notificationProducer
                .notify(
                  'mention',
                  filteredIds,
                  `${updated.author.username} 在编辑后的帖子里提到了你：${preview}`,
                  {
                    postId: updated.id,
                    threadId: postLight.threadId,
                    fromUserId: userId,
                    eventKey: `mention:${updated.id}`,
                    payload: { actorName: updated.author.username, action: 'mention', preview },
                  },
                )
                .catch(() => {});
            }
          })
          .catch(() => {});
      }
    }

    // 缓存失效事件
    this.eventEmitter.emit('post.updated', {
      postId: updated.id,
      threadId: postLight.threadId,
      parentPostId: updated.parentPostId,
    });

    return updated;
  }

  /** 软删除帖子 */
  async remove(id: string, userId: string) {
    const postLight = await this.prisma.post.findUnique({
      where: { id, ...notDeleted },
      select: {
        id: true,
        authorId: true,
        kind: true,
        parentPostId: true,
        threadId: true,
        subthread: { select: { deletedAt: true } },
      },
    });
    if (!postLight) throw notFound(ErrorCode.POST_NOT_FOUND, '帖子不存在');
    if (postLight.subthread.deletedAt) throw notFound(ErrorCode.POST_NOT_FOUND, '帖子不存在');
    await this.threadAccess.assertAccessible(postLight.threadId, userId);
    if (postLight.authorId !== userId) {
      await this.threadAccess.assertCanManage(postLight.threadId, userId);
    }

    // 正文（kind=BODY）不可删除，由子贴生命周期管理
    if (postLight.kind === 'BODY') {
      throw forbidden('主体正文不可删除。如需修改请编辑帖子；如需移除请删除整个子贴。');
    }

    const result = await this.prisma.post.update({
      where: { id, ...notDeleted },
      data: { deletedAt: new Date() },
    });

    // 缓存失效 + 有序集合更新
    this.eventEmitter.emit('post.deleted', {
      postId: id,
      threadId: postLight.threadId,
      parentPostId: postLight.parentPostId,
    });

    return result;
  }

  async findById(id: string, userId?: string) {
    return this.queries.findById(id, userId);
  }

}
