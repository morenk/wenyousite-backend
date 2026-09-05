import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { publicUserSummarySelect } from '../common/user-summary';
import { OutboxService } from '../outbox/outbox.service';
import { notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { assertInteractionAllowed, lockInteractionUsers, visibleUserWhere } from '../access/block-visibility.where';

/** 用户关系用例：关注、粉丝与双向拉黑关系写入和查询。 */
@Injectable()
export class UserRelationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async follow(actor: { id: string; username?: string }, targetId: string) {
    if (actor.id === targetId) return { message: '不能关注自己' };
    await this.assertUserExists(targetId);

    const eventId = randomUUID();
    const created = await this.prisma.$transaction(async (tx) => {
      await assertInteractionAllowed(tx, actor.id, [targetId]);
      const result = await tx.userFollow.createMany({
        data: [{ followerId: actor.id, followingId: targetId }],
        skipDuplicates: true,
      });
      if (result.count > 0) {
        await this.outbox.enqueue(tx, {
          eventType: 'user.followed',
          aggregateType: 'UserFollow',
          aggregateId: targetId,
          eventKey: `user-followed:${actor.id}:${targetId}:${eventId}`,
          payload: {
            actorId: actor.id,
            actorUsername: actor.username ?? '有人',
            targetId,
            notificationEventKey: `follow:${actor.id}:${targetId}:${eventId}`,
          },
        });
      }
      return result;
    });
    if (created.count === 0) return { message: '已关注' };
    return { message: '已关注' };
  }

  async unfollow(userId: string, targetId: string) {
    await this.prisma.userFollow.deleteMany({
      where: { followerId: userId, followingId: targetId },
    });
    return { message: '已取消关注' };
  }

  following(userId: string, viewerId?: string) {
    return this.prisma.userFollow.findMany({
      where: { followerId: userId, following: visibleUserWhere(viewerId) },
      include: { following: { select: publicUserSummarySelect } },
    });
  }

  followers(userId: string, viewerId?: string) {
    return this.prisma.userFollow.findMany({
      where: { followingId: userId, follower: visibleUserWhere(viewerId) },
      include: { follower: { select: publicUserSummarySelect } },
    });
  }

  async userFollowing(userId: string, viewerId?: string) {
    await this.assertUserExists(userId, viewerId);
    return this.following(userId, viewerId);
  }

  async userFollowers(userId: string, viewerId?: string) {
    await this.assertUserExists(userId, viewerId);
    return this.followers(userId, viewerId);
  }

  async block(userId: string, targetId: string) {
    if (userId === targetId) return { message: '不能拉黑自己' };
    await this.prisma.$transaction(async (tx) => {
      await lockInteractionUsers(tx, [userId, targetId]);
      const target = await tx.user.findUnique({
        where: { id: targetId, deletedAt: null },
        select: { id: true },
      });
      if (!target) throw notFound(ErrorCode.USER_NOT_FOUND, '用户不存在');
      await tx.userBlock.upsert({
        where: { blockerId_blockedId: { blockerId: userId, blockedId: targetId } },
        create: { blockerId: userId, blockedId: targetId },
        update: {},
      });

    });
    return { message: '已拉黑' };
  }

  async unblock(userId: string, targetId: string) {
    await this.prisma.$transaction(async (tx) => {
      await lockInteractionUsers(tx, [userId, targetId]);
      await tx.userBlock.deleteMany({
        where: { blockerId: userId, blockedId: targetId },
      });
    });
    return { message: '已取消拉黑' };
  }

  blocks(userId: string) {
    return this.prisma.userBlock.findMany({
      where: { blockerId: userId },
      include: { blocked: { select: publicUserSummarySelect } },
    });
  }

  private async assertUserExists(id: string, viewerId?: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id, deletedAt: null, ...visibleUserWhere(viewerId) },
      select: { id: true },
    });
    if (!user) throw notFound(ErrorCode.USER_NOT_FOUND, '用户不存在');
  }

}
