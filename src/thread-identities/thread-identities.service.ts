import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, MediaPurpose } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ThreadAccessService } from '../access/thread-access.service';
import { visibleUserWhere } from '../access/block-visibility.where';
import { BusinessException, forbidden, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { MediaReferenceService } from '../media/media-reference.service';
import { mediaPurposeAllowed } from '../media/media-policy';
import { readMediaDisplay } from '../media/media-display';
import { UpdateThreadIdentityDto } from './thread-identity.dto';
import {
  assertIdentityToken,
  canonicalMentions,
  eligibleIdentity,
  identityToken,
  readMentions,
} from './identity-policy';

type Db = PrismaService | Prisma.TransactionClient;
@Injectable()
export class ThreadIdentitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ThreadAccessService,
    private readonly mediaReferences: MediaReferenceService,
  ) {}

  async context(threadId: string, userId: string, db: Db = this.prisma) {
    const [thread, user, member, identity] = await Promise.all([
      db.thread.findUnique({
        where: { id: threadId, deletedAt: null },
        select: { ownerId: true, rpIdentityEnabled: true, rpIdentityVersion: true },
      }),
      db.user.findUnique({
        where: { id: userId, deletedAt: null },
        select: { id: true, username: true, avatar: true, avatarMediaId: true },
      }),
      db.threadMember.findUnique({ where: { threadId_userId: { threadId, userId } } }),
      db.threadIdentity.findUnique({
        where: { threadId_userId: { threadId, userId } },
        include: { avatarMedia: true },
      }),
    ]);
    if (!thread) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
    if (!user) throw notFound(ErrorCode.USER_NOT_FOUND, '用户不存在');
    const eligible = eligibleIdentity(thread.ownerId, userId, member);
    const enabled = thread.rpIdentityEnabled;
    const usingIdentity = Boolean(
      enabled && eligible && identity && (identity.nickname || identity.avatarMediaId),
    );
    const media = identity?.avatarMedia;
    const avatar = identity?.avatarMediaId
      ? media?.status === 'COMPLETED' && !media.deletionClaimedAt
        ? media.url
        : null
      : user.avatar;
    const display =
      usingIdentity && identity
        ? {
            id: identity.id,
            nickname: identity.nickname ?? user.username,
            avatar,
            avatarDisplay:
              identity.avatarMediaId && media?.status === 'COMPLETED' && !media.deletionClaimedAt
                ? readMediaDisplay(media.displayAsset)
                : null,
          }
        : null;
    return {
      threadId,
      userId,
      enabled,
      eligible,
      identity,
      user,
      display,
      token: identityToken([
        threadId,
        userId,
        enabled,
        thread.rpIdentityVersion,
        eligible,
        identity?.version ?? 0,
        display,
        user.username,
        user.avatar,
      ]),
    };
  }

  async state(threadId: string, targetId: string, viewerId?: string) {
    await this.access.assertAccessible(threadId, viewerId);
    const visible = await this.prisma.user.findFirst({
      where: { id: targetId, ...visibleUserWhere(viewerId) },
      select: { id: true },
    });
    if (!visible) throw notFound(ErrorCode.USER_NOT_FOUND, '用户不存在');
    const current = await this.context(threadId, targetId);
    return this.stateResponse(current, viewerId);
  }

  private stateResponse(
    current: Awaited<ReturnType<ThreadIdentitiesService['context']>>,
    viewerId?: string,
  ) {
    const { threadId, userId, enabled, eligible, identity, user, display, token } = current;
    return {
      threadId,
      userId,
      enabled,
      eligible,
      canEdit: viewerId === userId && enabled && eligible,
      identity:
        identity && viewerId === userId
          ? {
              id: identity.id,
              nickname: identity.nickname,
              avatarMediaId: identity.avatarMediaId,
              version: identity.version,
            }
          : null,
      display,
      account: { id: user.id, username: user.username, avatar: user.avatar },
      identityToken: viewerId === userId ? token : null,
    };
  }

  async setEnabled(threadId: string, userId: string, enabled: boolean) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM threads WHERE id = ${threadId} FOR UPDATE`;
      await this.access.assertAccessible(threadId, userId, tx, true);
      const thread = await tx.thread.findUniqueOrThrow({ where: { id: threadId } });
      if (thread.ownerId !== userId)
        throw forbidden('仅楼主可以开关帖内身份', ErrorCode.NOT_THREAD_OWNER);
      if (thread.rpIdentityEnabled !== enabled)
        await tx.thread.update({
          where: { id: threadId },
          data: { rpIdentityEnabled: enabled, rpIdentityVersion: { increment: 1 } },
        });
      return { enabled };
    });
  }

  async update(threadId: string, userId: string, dto: UpdateThreadIdentityDto) {
    if ((dto.clearNickname && dto.nickname) || (dto.clearAvatar && dto.avatarMediaId))
      throw new BusinessException(ErrorCode.BAD_REQUEST, '同一项不能同时设置和清除');
    dto = {
      ...dto,
      ...(dto.clearNickname ? { nickname: null } : {}),
      ...(dto.clearAvatar ? { avatarMediaId: null } : {}),
    };
    if (dto.nickname === undefined && dto.avatarMediaId === undefined)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请提供昵称或头像');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM threads WHERE id = ${threadId} FOR UPDATE`;
      await this.access.assertAccessible(threadId, userId, tx, true);
      const current = await this.context(threadId, userId, tx);
      if (!current.enabled || !current.eligible)
        throw forbidden('当前不能设置帖内身份', ErrorCode.NOT_PLAYER);
      if (dto.version !== undefined && dto.version !== current.identity?.version)
        throw new BusinessException(
          ErrorCode.OPTIMISTIC_LOCK_CONFLICT,
          '帖内身份已修改，请刷新',
          HttpStatus.CONFLICT,
        );
      if (dto.avatarMediaId) {
        await tx.$queryRaw`SELECT id FROM media WHERE id = ${dto.avatarMediaId} FOR UPDATE`;
        const media = await tx.media.findUnique({ where: { id: dto.avatarMediaId } });
        if (
          !media ||
          media.userId !== userId ||
          media.status !== 'COMPLETED' ||
          media.deletionClaimedAt ||
          !mediaPurposeAllowed(media.purpose, MediaPurpose.AVATAR)
        ) {
          throw new BusinessException(ErrorCode.BAD_REQUEST, '只能使用本人已完成处理的头像图片');
        }
      }
      const identity = await tx.threadIdentity.upsert({
        where: { threadId_userId: { threadId, userId } },
        create: { threadId, userId, nickname: dto.nickname, avatarMediaId: dto.avatarMediaId },
        update: {
          nickname: dto.nickname,
          avatarMediaId: dto.avatarMediaId,
          version: { increment: 1 },
        },
      });
      // 留存已选过的昵称，保证插入候选之后对方改名仍能验证旧标签归属。
      const names = [current.display?.nickname, identity.nickname ?? current.user.username].filter(
        (name): name is string => Boolean(name),
      );
      for (const nickname of new Set(names))
        await tx.threadIdentityAlias.upsert({
          where: { identityId_nickname: { identityId: identity.id, nickname } },
          create: { identityId: identity.id, nickname },
          update: {},
        });
      await this.mediaReferences.reconcileMediaIds(
        tx,
        [current.identity?.avatarMediaId, identity.avatarMediaId].filter((id): id is string =>
          Boolean(id),
        ),
      );
      return this.stateResponse(await this.context(threadId, userId, tx), userId);
    });
  }

  async prepareAuthor(
    tx: Prisma.TransactionClient,
    threadId: string,
    userId: string,
    expected?: string,
  ) {
    const current = await this.context(threadId, userId, tx);
    assertIdentityToken(expected, current.token, Boolean(current.display));
    if (!current.display) return {};
    const mediaId = current.identity?.avatarMediaId ?? current.user.avatarMediaId;
    if (mediaId) {
      await tx.$queryRaw`SELECT id FROM media WHERE id = ${mediaId} FOR UPDATE`;
      const media = await tx.media.findUnique({ where: { id: mediaId } });
      if (!media || media.status !== 'COMPLETED' || media.deletionClaimedAt) {
        throw new BusinessException(
          ErrorCode.RP_IDENTITY_CHANGED,
          '头像已变化，请重新确认发言身份',
          HttpStatus.CONFLICT,
        );
      }
    }
    await tx.threadIdentityAlias.upsert({
      where: {
        identityId_nickname: { identityId: current.display.id, nickname: current.display.nickname },
      },
      create: { identityId: current.display.id, nickname: current.display.nickname },
      update: {},
    });
    if (mediaId) await tx.media.update({ where: { id: mediaId }, data: { orphanedAt: null } });
    return {
      authorIdentitySnapshot: {
        id: current.display.id,
        nickname: current.display.nickname,
        avatar: current.display.avatar,
        avatarMediaId: mediaId ?? null,
      },
      identityAvatarMediaId: mediaId,
    };
  }

  async prepareMentions(
    tx: Prisma.TransactionClient,
    threadId: string,
    content: string,
    previous?: unknown,
    previousContent?: string,
  ): Promise<Prisma.InputJsonArray> {
    const tokens = canonicalMentions(content);
    if (!tokens.length) return [];
    const thread = await tx.thread.findUniqueOrThrow({
      where: { id: threadId },
      select: { rpIdentityEnabled: true },
    });
    const old = readMentions(previous);
    for (const token of canonicalMentions(previousContent ?? ''))
      if (!old.some((row) => row.userId === token.userId && row.label === token.label))
        old.push({ ...token, identityId: null });
    const users = await tx.user.findMany({
      where: { id: { in: [...new Set(tokens.map((token) => token.userId))] }, deletedAt: null },
      select: {
        id: true,
        username: true,
        threadIdentities: { where: { threadId }, include: { aliases: true } },
      },
    });
    return tokens.map(({ userId, label }) => {
      const existing = old.find((row) => row.userId === userId && row.label === label);
      if (existing) return existing;
      const user = users.find((row) => row.id === userId);
      const identity = user?.threadIdentities[0];
      const belongsToIdentity =
        identity &&
        (identity.nickname === label || identity.aliases.some((alias) => alias.nickname === label));
      if (thread.rpIdentityEnabled && user && label !== user.username && !belongsToIdentity) {
        throw new BusinessException(
          ErrorCode.RP_MENTION_CHANGED,
          '提及名字已变化或不属于此账号，请重新选择该用户',
          HttpStatus.CONFLICT,
        );
      }
      return {
        userId,
        label,
        identityId: thread.rpIdentityEnabled && belongsToIdentity ? identity.id : null,
      };
    });
  }
}
