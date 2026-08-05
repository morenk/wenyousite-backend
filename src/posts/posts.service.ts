import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { ThreadAccessService } from '../common/services/thread-access.service';
import { BlockFilterService } from '../common/services/block-filter.service';
import { NotificationProducer } from '../jobs/notification.producer';
import { MentionsService } from '../mentions/mentions.service';
import { ReadingProgressService } from '../reading-progress/reading-progress.service';
import { RedisService } from '../redis/redis.service';
import { CacheService } from '../redis/cache.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { ErrorCode } from '../common/exceptions/error-codes';
import { BusinessException, notFound, forbidden } from '../common/exceptions/business.exception';
import { paginate } from '../common/dto/paginated-result';
import {
  notDeleted,
  authorSelect,
  countNonDeletedReplies,
  includeDiceRolls,
} from '../common/prisma-helpers';
import { truncateMarkdown } from '../common/markdown-truncate';
import { hasVisibleMarkdownContent, normalizeMarkdownContent } from '../common/markdown-content';
import { DiceService } from '../dice/dice.service';

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
    private redis: RedisService,
    private cache: CacheService,
    private diceService: DiceService,
  ) {}

  /** 获取子贴的楼层列表（Cursor 分页），内嵌每个楼层的前 5 条楼中楼回复。已软删子贴返回 404 */
  async findAllBySubthread(subthreadId: string, cursor?: string, limit = 20, userId?: string) {
    const subthread = await this.prisma.subthread.findUnique({
      where: { id: subthreadId, ...notDeleted },
      select: { id: true, threadId: true },
    });
    if (!subthread) throw notFound(ErrorCode.SUBTHREAD_NOT_FOUND, '子贴不存在');
    await this.threadAccess.assertAccessible(subthread.threadId, userId);

    const take = Math.min(limit, 50);
    const posts = await this.prisma.post.findMany({
      where: { subthreadId, kind: 'FLOOR', parentPostId: null, ...notDeleted },
      orderBy: { floorNumber: 'asc' },
      take: take + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      include: {
        author: { select: authorSelect },
        ...includeDiceRolls(),
        _count: { select: { replies: { where: notDeleted } } },
      },
    });

    const hasMore = posts.length > take;
    if (hasMore) posts.pop();

    // 为有回复的楼层批量获取前 5 条楼中楼回复
    const floorIdsWithReplies = posts.filter((p) => p._count.replies > 0).map((p) => p.id);
    if (floorIdsWithReplies.length > 0) {
      const repliesMap = new Map<string, any[]>();
      await Promise.all(
        floorIdsWithReplies.map(async (floorId) => {
          const replies = await this.prisma.post.findMany({
            where: { parentPostId: floorId, ...notDeleted },
            orderBy: { createdAt: 'asc' },
            take: 5,
            include: {
              author: { select: authorSelect },
              ...includeDiceRolls(),
              replyToPost: {
                select: { id: true, authorId: true, author: { select: authorSelect } },
              },
            },
          });
          repliesMap.set(floorId, replies);
        }),
      );
      for (const post of posts) {
        (post as any).replies = repliesMap.get(post.id) || [];
      }
    } else {
      for (const post of posts) {
        (post as any).replies = [];
      }
    }

    return paginate(posts, {
      cursor: posts.length > 0 ? posts[posts.length - 1].id : null,
      hasMore,
    });
  }

  /** 获取主楼层的楼中楼回复列表（cursor 分页）。已软删子贴或非主楼层返回 404 */
  async findReplies(postId: string, cursor?: string, limit = 20, userId?: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId, deletedAt: null },
      select: {
        id: true,
        threadId: true,
        kind: true,
        parentPostId: true,
        subthread: { select: { deletedAt: true } },
      },
    });
    if (!post) throw notFound(ErrorCode.POST_NOT_FOUND, '楼层不存在');
    if (post.subthread.deletedAt) throw notFound(ErrorCode.POST_NOT_FOUND, '楼层不存在');
    if (post.kind !== 'FLOOR' || post.parentPostId !== null) {
      throw notFound(ErrorCode.POST_NOT_FOUND, '楼层不存在');
    }
    await this.threadAccess.assertAccessible(post.threadId, userId);

    const take = Math.min(limit, 50);
    const replies = await this.prisma.post.findMany({
      where: { parentPostId: postId, ...notDeleted },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: take + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      include: {
        author: { select: authorSelect },
        ...includeDiceRolls(),
        replyToPost: { select: { id: true, authorId: true, author: { select: authorSelect } } },
      },
    });
    const hasMore = replies.length > take;
    if (hasMore) replies.pop();
    return paginate(replies, {
      cursor: replies.length > 0 ? replies[replies.length - 1].id : null,
      hasMore,
    });
  }

  /** 发帖：楼层或楼中楼回复。先校验访问权限与发帖策略，通过后才自动加入为参与人 */
  async create(subthreadId: string, dto: CreatePostDto, userId: string) {
    const content = normalizeMarkdownContent(dto.content);
    const parsedDice = this.diceService.validateNotations(dto.diceNotations ?? []);
    const canonicalDice = parsedDice.map((dice) => dice.notation);
    if (!hasVisibleMarkdownContent(content) && canonicalDice.length === 0) {
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
        this.assertSameCreateRequest(existingRequest, subthreadId, dto, content, canonicalDice);
        return existingRequest;
      }
    }

    // 先查当前参与人状态（未加入时按未参与处理）
    const member = await this.prisma.threadMember.findUnique({
      where: { threadId_userId: { threadId: subthread.threadId, userId } },
    });
    const authorIsManager = member?.role === 'OWNER' || member?.role === 'COLLABORATOR';

    // 检查发帖权限（通过后才自动加入，避免被拒时仍写入参与人记录）
    if (subthread.postingPolicy === 'COLLABORATORS') {
      if (!member || (member.role !== 'OWNER' && member.role !== 'COLLABORATOR')) {
        throw forbidden('该子贴仅限协作者发帖', ErrorCode.NOT_COLLABORATOR);
      }
    } else if (subthread.postingPolicy === 'PLAYERS') {
      if (!authorIsManager && (!member || !member.playerMarked)) {
        throw forbidden('该子贴仅限玩家发帖', ErrorCode.NOT_PLAYER);
      }
    }

    // 权限校验通过，自动加入主题帖
    await this.prisma.threadMember.upsert({
      where: { threadId_userId: { threadId: subthread.threadId, userId } },
      create: { threadId: subthread.threadId, userId, role: 'PARTICIPANT' },
      update: {},
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

    const generatedDice = subthread.thread.published ? this.diceService.rollAll(parsedDice) : [];

    // 事务：SELECT FOR UPDATE 锁子贴行 → 读 MAX → 创建楼层 → 更新 lastPostAt
    let duplicateRequest = false;
    let post;
    try {
      post = await this.prisma.$transaction(async (tx) => {
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
            pendingDiceNotations: subthread.thread.published ? [] : canonicalDice,
          },
          include: {
            author: { select: authorSelect },
          },
        });

        if (generatedDice.length > 0) {
          await tx.diceRoll.createMany({
            data: this.diceService.buildCreateData(p.id, generatedDice),
          });
        }

        await tx.subthread.update({
          where: { id: subthreadId },
          data: { lastPostAt: new Date() },
        });

        if (generatedDice.length === 0) return { ...p, diceRolls: [] };
        return tx.post.findUniqueOrThrow({
          where: { id: p.id },
          include: { author: { select: authorSelect }, ...includeDiceRolls() },
        });
      });
    } catch (error) {
      if (dto.clientRequestId && (error as { code?: string })?.code === 'P2002') {
        const existingRequest = await this.findByClientRequestId(userId, dto.clientRequestId);
        if (existingRequest) {
          this.assertSameCreateRequest(existingRequest, subthreadId, dto, content, canonicalDice);
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

    // 发帖后通过事件解耦：@提及、通知由 PostEventsListener 处理（仅已发布帖）
    if (subthread.thread.published) {
      this.eventEmitter.emit('post.created', {
        postId: post.id,
        content,
        userId,
        authorUsername: post.author.username,
        threadId: subthread.threadId,
        subthreadId: subthread.id,
        subthreadTitle: subthread.title,
        parentPostId: dto.parentPostId ?? null,
        replyToPostId: dto.replyToPostId ?? null,
        isSubthreadBody: false,
        authorRole: member?.role ?? 'PARTICIPANT',
        authorPlayerMarked: member?.playerMarked ?? false,
        diceRolls: post.diceRolls,
      });
    }

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
      pendingDiceNotations?: string[];
      diceRolls?: { notation: string }[];
    },
    subthreadId: string,
    dto: CreatePostDto,
    content: string,
    canonicalDice: string[],
  ) {
    const storedDice = post.diceRolls?.length
      ? post.diceRolls.map((roll) => roll.notation)
      : (post.pendingDiceNotations ?? []);
    if (
      post.subthreadId !== subthreadId ||
      post.content !== content ||
      post.parentPostId !== (dto.parentPostId ?? null) ||
      post.replyToPostId !== (dto.replyToPostId ?? null) ||
      storedDice.length !== canonicalDice.length ||
      storedDice.some((notation, index) => notation !== canonicalDice[index])
    ) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        'clientRequestId 已用于另一条发帖请求',
        HttpStatus.CONFLICT,
      );
    }
  }

  /** 写入子贴正文；草稿保存待掷意图，已发布正文只追加服务端结果。 */
  async upsertBody(
    subthreadId: string,
    content: string,
    version: number | undefined,
    userId: string,
    diceNotations?: string[],
  ) {
    const normalizedContent = normalizeMarkdownContent(content);
    const subthread = await this.prisma.subthread.findUnique({
      where: { id: subthreadId, ...notDeleted },
      include: { thread: { select: { id: true, published: true, title: true } } },
    });
    if (!subthread) throw notFound(ErrorCode.SUBTHREAD_NOT_FOUND, '子贴不存在');
    const manager = await this.threadAccess.assertCanManage(subthread.threadId, userId);
    if (subthread.thread.published && !hasVisibleMarkdownContent(normalizedContent)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '子贴正文必须包含可见文字');
    }

    const existing = await this.prisma.post.findFirst({
      where: { subthreadId, kind: 'BODY', ...notDeleted },
      orderBy: { createdAt: 'asc' },
      include: { ...includeDiceRolls() },
    });
    const existingRollCount = existing?.diceRolls?.length ?? 0;
    const parsedDice = this.diceService.validateNotations(
      diceNotations ?? [],
      subthread.thread.published ? existingRollCount : 0,
    );
    const canonicalDice = parsedDice.map((dice) => dice.notation);
    const generatedDice = subthread.thread.published ? this.diceService.rollAll(parsedDice) : [];

    if (!existing) {
      const createPost = async (client: any) =>
        client.post.create({
          data: {
            threadId: subthread.threadId,
            subthreadId,
            authorId: userId,
            kind: 'BODY',
            content: normalizedContent,
            pendingDiceNotations: subthread.thread.published ? [] : canonicalDice,
          },
          include:
            generatedDice.length === 0
              ? { author: { select: authorSelect }, ...includeDiceRolls() }
              : undefined,
        });
      const post =
        generatedDice.length === 0
          ? await (async () => {
              const created = await createPost(this.prisma);
              await this.prisma.subthread.update({
                where: { id: subthreadId },
                data: { lastPostAt: new Date() },
              });
              return created;
            })()
          : await this.prisma.$transaction(async (tx) => {
              const created = await createPost(tx);
              await tx.diceRoll.createMany({
                data: this.diceService.buildCreateData(created.id, generatedDice),
              });
              await tx.subthread.update({
                where: { id: subthreadId },
                data: { lastPostAt: new Date() },
              });
              return tx.post.findUniqueOrThrow({
                where: { id: created.id },
                include: { author: { select: authorSelect }, ...includeDiceRolls() },
              });
            });

      if (subthread.thread.published) {
        this.eventEmitter.emit('post.created', {
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
          diceRolls: post.diceRolls,
        });
      }
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
    const updatePost = async (client: any) =>
      client.post.update({
        where: { id: existing.id, version, ...notDeleted },
        data: {
          content: normalizedContent,
          version: { increment: 1 },
          ...(!subthread.thread.published && diceNotations !== undefined
            ? { pendingDiceNotations: canonicalDice }
            : {}),
        },
        include:
          generatedDice.length === 0
            ? { author: { select: authorSelect }, ...includeDiceRolls() }
            : undefined,
      });
    const updated = await (
      generatedDice.length === 0
        ? updatePost(this.prisma)
        : this.prisma.$transaction(async (tx) => {
            const post = await updatePost(tx);
            await tx.diceRoll.createMany({
              data: this.diceService.buildCreateData(post.id, generatedDice, existingRollCount),
            });
            return tx.post.findUniqueOrThrow({
              where: { id: post.id },
              include: { author: { select: authorSelect }, ...includeDiceRolls() },
            });
          })
    ).catch((err) => {
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
    const content = normalizeMarkdownContent(dto.content);
    const postLight = await this.prisma.post.findUnique({
      where: { id, ...notDeleted },
      select: {
        id: true,
        authorId: true,
        threadId: true,
        content: true,
        pendingDiceNotations: true,
        version: true,
        thread: { select: { published: true } },
        diceRolls: { select: { id: true } },
        subthread: { select: { deletedAt: true } },
      },
    });
    if (!postLight) throw notFound(ErrorCode.POST_NOT_FOUND, '帖子不存在');
    if (postLight.subthread.deletedAt) throw notFound(ErrorCode.POST_NOT_FOUND, '帖子不存在');
    await this.threadAccess.assertAccessible(postLight.threadId, userId);
    if (postLight.authorId !== userId) throw forbidden('只能编辑自己的帖子');

    const existingRollCount = postLight.diceRolls?.length ?? 0;
    const threadPublished = postLight.thread?.published ?? true;
    const parsedDice = this.diceService.validateNotations(
      dto.diceNotations ?? [],
      threadPublished ? existingRollCount : 0,
    );
    const canonicalDice = parsedDice.map((dice) => dice.notation);
    const effectivePending = threadPublished
      ? []
      : dto.diceNotations === undefined
        ? (postLight.pendingDiceNotations ?? [])
        : canonicalDice;
    if (
      !hasVisibleMarkdownContent(content) &&
      existingRollCount === 0 &&
      effectivePending.length === 0 &&
      parsedDice.length === 0
    ) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '正文和骰子不能同时为空');
    }
    const generatedDice = threadPublished ? this.diceService.rollAll(parsedDice) : [];

    const oldContent = postLight.content;
    const updatePost = async (client: any) =>
      client.post.update({
        where: { id, version: dto.version, ...notDeleted },
        data: {
          content,
          version: { increment: 1 },
          ...(!threadPublished && dto.diceNotations !== undefined
            ? { pendingDiceNotations: canonicalDice }
            : {}),
        },
        include:
          generatedDice.length === 0
            ? { author: { select: authorSelect }, ...includeDiceRolls() }
            : undefined,
      });
    const updated = await (
      generatedDice.length === 0
        ? updatePost(this.prisma)
        : this.prisma.$transaction(async (tx) => {
            const post = await updatePost(tx);
            await tx.diceRoll.createMany({
              data: this.diceService.buildCreateData(id, generatedDice, existingRollCount),
            });
            return tx.post.findUniqueOrThrow({
              where: { id: post.id },
              include: { author: { select: authorSelect }, ...includeDiceRolls() },
            });
          })
    ).catch((err) => {
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

  /** 获取单条帖子 + 导航上下文。已软删子贴返回 404 */
  async findById(id: string, userId?: string) {
    const postLight = await this.prisma.post.findUnique({
      where: { id, ...notDeleted },
      select: { id: true, threadId: true, subthread: { select: { deletedAt: true } } },
    });
    if (!postLight) throw notFound(ErrorCode.POST_NOT_FOUND, '帖子不存在');
    if (postLight.subthread.deletedAt) throw notFound(ErrorCode.POST_NOT_FOUND, '帖子不存在');
    await this.threadAccess.assertAccessible(postLight.threadId, userId);

    const post = await this.prisma.post.findUnique({
      where: { id, ...notDeleted },
      include: {
        author: { select: { id: true, username: true, avatar: true } },
        ...includeDiceRolls(),
        thread: { select: { id: true, title: true } },
        subthread: { select: { id: true, title: true } },
        parentPost: { select: { id: true, floorNumber: true } },
        ...countNonDeletedReplies(),
      },
    });
    if (!post) throw notFound(ErrorCode.POST_NOT_FOUND, '帖子不存在');
    return post;
  }
}
