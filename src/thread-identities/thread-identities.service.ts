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

  async context(threadId: string, userId: string, db: Db = this.prisma, identityId?: string) {
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
      db.threadIdentity.findFirst({
        where: {
          threadId,
          userId,
          ...(identityId ? { id: identityId } : { compatibilityIdentity: true, deletedAt: null }),
        },
        include: { avatarMedia: true },
      }),
    ]);
    if (!thread) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
    if (!user) throw notFound(ErrorCode.USER_NOT_FOUND, '用户不存在');
    const eligible = eligibleIdentity(thread.ownerId, userId, member);
    const enabled = thread.rpIdentityEnabled;
    const usingIdentity = Boolean(
      enabled &&
      eligible &&
      identity &&
      !identity.deletedAt &&
      (identity.nickname || identity.avatarMediaId),
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
        identity?.id ?? null,
        identity?.version ?? 0,
        display,
        identity?.nickname ? null : user.username,
        identity?.avatarMediaId ? null : user.avatar,
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
      canEdit: viewerId === userId && enabled && eligible && !identity?.deletedAt,
      identity:
        identity && !identity.deletedAt && viewerId === userId
          ? {
              id: identity.id,
              nickname: identity.nickname,
              avatarMediaId: identity.avatarMediaId,
              version: identity.version,
            }
          : null,
      display,
      account: { id: user.id, username: user.username, avatar: user.avatar },
      identityToken: viewerId === userId && !identity?.deletedAt ? token : null,
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

  async update(
    threadId: string,
    userId: string,
    dto: UpdateThreadIdentityDto,
    identityId?: string,
    create = false,
  ) {
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
      const current = await this.context(threadId, userId, tx, identityId);
      if (identityId && (!current.identity || current.identity.deletedAt))
        throw notFound(ErrorCode.NOT_FOUND, '帖内身份不存在');
      if (create) {
        current.identity = null;
        current.display = null;
      }
      if (create && !dto.nickname && !dto.avatarMediaId)
        throw new BusinessException(ErrorCode.BAD_REQUEST, '新身份至少需要昵称或头像');
      if (!current.enabled || !current.eligible)
        throw forbidden('当前不能设置帖内身份', ErrorCode.NOT_PLAYER);
      // 主身份不存在时清除为无动作，不分配新的 ID 或占用角色名额。
      if (!create && !identityId && !current.identity && !dto.nickname && !dto.avatarMediaId)
        return this.stateResponse(current, userId);

      if (
        !current.identity &&
        (await tx.threadIdentity.count({ where: { threadId, userId, deletedAt: null } })) >= 10
      )
        throw new BusinessException(
          ErrorCode.RP_IDENTITY_LIMIT,
          '每个账号在本主题最多保留十个身份',
          HttpStatus.CONFLICT,
        );

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
      const compatibilityIdentity =
        !create ||
        !(await tx.threadIdentity.findFirst({
          where: { threadId, userId, compatibilityIdentity: true },
          select: { id: true },
        }));
      const fields = { nickname: dto.nickname, avatarMediaId: dto.avatarMediaId };
      const identity = current.identity
        ? await tx.threadIdentity.update({
            where: { id: current.identity.id },
            data: { ...fields, version: { increment: 1 } },
          })
        : await tx.threadIdentity.create({
            data: { threadId, userId, compatibilityIdentity, ...fields },
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
      const result = await this.context(threadId, userId, tx, identity.id);
      return identityId || create
        ? this.roleResponse(result, userId)
        : this.stateResponse(result, userId);
    });
  }

  private roleResponse(
    current: Awaited<ReturnType<ThreadIdentitiesService['context']>>,
    viewerId?: string,
  ) {
    return {
      ...this.stateResponse(current, viewerId),
      identityId: current.identity!.id,
      deleted: Boolean(current.identity!.deletedAt),
      canDelete: viewerId === current.userId && !current.identity!.deletedAt,
      compatibilityIdentity: current.identity!.compatibilityIdentity,
    };
  }

  async list(threadId: string, userId: string) {
    await this.access.assertAccessible(threadId, userId);
    const current = await this.context(threadId, userId);
    const identities = await this.prisma.threadIdentity.findMany({
      where: { threadId, userId, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    const rows = await Promise.all(
      identities.map(async (row) =>
        this.roleResponse(await this.context(threadId, userId, this.prisma, row.id), userId),
      ),
    );
    const available = rows.filter((row) => row.display !== null);
    return {
      threadId,
      userId,
      enabled: current.enabled,
      eligible: current.eligible,
      canEdit: current.enabled && current.eligible,
      activeCount: identities.length,
      limit: 10,
      compatibilityIdentityId: current.identity?.id ?? null,
      defaultIdentityId:
        available.find((row) => row.compatibilityIdentity)?.identityId ??
        available[0]?.identityId ??
        null,
      account: this.stateResponse(current, userId).account,
      identities: rows,
    };
  }

  async role(threadId: string, identityId: string, viewerId?: string) {
    await this.access.assertAccessible(threadId, viewerId);
    // 已删除角色允许读取卡片状态，但绝不暴露当前资料或令牌。
    const identity = await this.prisma.threadIdentity.findFirst({
      where: { id: identityId, threadId, user: visibleUserWhere(viewerId) },
      select: { userId: true },
    });
    if (!identity) throw notFound(ErrorCode.NOT_FOUND, '帖内身份不存在');
    return this.roleResponse(
      await this.context(threadId, identity.userId, this.prisma, identityId),
      viewerId,
    );
  }

  async remove(threadId: string, userId: string, identityId: string, version: number) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM threads WHERE id = ${threadId} FOR UPDATE`;
      await this.access.assertAccessible(threadId, userId, tx, true);
      const current = await this.context(threadId, userId, tx, identityId);
      if (!current.identity) throw notFound(ErrorCode.NOT_FOUND, '帖内身份不存在');
      if (current.identity.deletedAt) return this.roleResponse(current, userId);
      if (current.identity.version !== version)
        throw new BusinessException(
          ErrorCode.OPTIMISTIC_LOCK_CONFLICT,
          '帖内身份已修改，请刷新',
          HttpStatus.CONFLICT,
        );
      // 失去 RP 资格或关闭后仍可主动删除自己已存在的资料；不改变历史作者和媒体引用。
      await tx.threadIdentity.update({
        where: { id: identityId },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
      return this.roleResponse(await this.context(threadId, userId, tx, identityId), userId);
    });
  }

  async prepareAuthor(
    tx: Prisma.TransactionClient,
    threadId: string,
    userId: string,
    expected?: string,
    mode?: 'ACCOUNT' | 'RP',
    identityId?: string,
  ) {
    const identityRequestHash = identityToken([identityId ?? null, expected ?? null]);
    if (mode === 'ACCOUNT') return { identityCreateMode: mode, identityRequestHash };
    const current = await this.context(threadId, userId, tx, identityId);
    if (identityId && !current.display) assertIdentityToken(expected, current.token, false, 'RP');
    assertIdentityToken(expected, current.token, Boolean(current.display), mode);
    if (!current.display) return { identityRequestHash };
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
      identityCreateMode: mode ?? null,
      identityRequestHash,
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
        threadIdentities: {
          where: { threadId, compatibilityIdentity: true, deletedAt: null },
          include: { aliases: true },
        },
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
