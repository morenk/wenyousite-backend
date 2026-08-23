import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ThreadAccessService } from '../access/thread-access.service';
import { ErrorCode } from '../common/exceptions/error-codes';
import { BusinessException, notFound, forbidden } from '../common/exceptions/business.exception';
import { publicUserSummarySelect } from '../common/user-summary';
import { UpdateMemberDto } from './dto/update-member.dto';
import { randomUUID } from 'node:crypto';
import { OutboxService } from '../outbox/outbox.service';
import { DOMAIN_EVENTS } from '../outbox/domain-events';

/** 主题帖参与人服务：候选池加入、角色修改、玩家标记 */
@Injectable()
export class ThreadMembersService {
  constructor(
    private prisma: PrismaService,
    private threadAccess: ThreadAccessService,
    private outbox: OutboxService,
  ) {}

  /** 获取参与人列表 */
  async findAll(threadId: string, userId?: string) {
    await this.threadAccess.assertAccessible(threadId, userId);

    return this.prisma.threadMember.findMany({
      where: { threadId },
      include: {
        user: { select: publicUserSummarySelect },
      },
      orderBy: { joinedAt: 'asc' },
    });
  }

  /** 自由加入（任何人）。未发布帖和私密帖禁止自由加入。 */
  async join(threadId: string, userId: string) {
    const thread = await this.prisma.thread.findUnique({
      where: { id: threadId, deletedAt: null },
    });
    if (!thread) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
    if (!thread.published) throw forbidden('该主题帖尚未发布');
    if (thread.visibility === 'PRIVATE') {
      throw forbidden('私密帖子仅可通过邀请链接加入');
    }

    const existing = await this.prisma.threadMember.findUnique({
      where: { threadId_userId: { threadId, userId } },
    });
    if (existing)
      throw new BusinessException(
        ErrorCode.ALREADY_MEMBER,
        '已是该主题帖参与人',
        HttpStatus.CONFLICT,
      );

    return this.prisma.threadMember.create({
      data: { threadId, userId, role: 'PARTICIPANT' },
      include: {
        user: { select: publicUserSummarySelect },
      },
    });
  }

  /** 修改参与人角色或玩家标记（仅 OWNER/COLLABORATOR）
   *  - role: COLLABORATOR（协作者）或 PARTICIPANT（参与人）
   *  - playerMarked: 标记为玩家
   *  不能修改 OWNER 角色 */
  async updateMember(
    threadId: string,
    targetUserId: string,
    dto: UpdateMemberDto,
    actorId: string,
  ) {
    const actor = await this.threadAccess.assertCanManage(threadId, actorId);
    if (dto.role === undefined && dto.playerMarked === undefined) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请至少提供一项要修改的成员信息');
    }
    if (dto.role !== undefined && actor.role !== 'OWNER') {
      throw forbidden('仅楼主可任免协作者', ErrorCode.NOT_THREAD_OWNER);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "thread_members" WHERE "thread_id" = ${threadId} AND "user_id" = ${targetUserId} FOR UPDATE`;
      const member = await tx.threadMember.findUnique({
        where: { threadId_userId: { threadId, userId: targetUserId } },
        include: { thread: { select: { title: true } } },
      });
      if (!member) throw notFound(ErrorCode.USER_NOT_FOUND, '该用户不是此主题帖参与人');
      if (member.role === 'OWNER') {
        throw forbidden('不能修改楼主角色', ErrorCode.CANNOT_MODERATE_OWNER);
      }

      const updated = await tx.threadMember.update({
        where: { threadId_userId: { threadId, userId: targetUserId } },
        data: dto,
        include: {
          user: { select: publicUserSummarySelect },
        },
      });

      if (dto.role === 'COLLABORATOR') {
        await tx.subscription.deleteMany({
          where: {
            threadId,
            OR: [{ userId: targetUserId }, { type: 'USER', targetUserId }],
          },
        });
      } else if (dto.playerMarked === false) {
        await tx.subscription.deleteMany({
          where: { threadId, type: 'USER', targetUserId },
        });
      }

      const newRole = dto.role ?? member.role;
      if (newRole !== member.role) {
        const actorUser = await tx.user.findUnique({
          where: { id: actorId },
          select: { username: true },
        });
        if (!actorUser) throw notFound(ErrorCode.USER_NOT_FOUND, '操作者不存在');
        const eventId = randomUUID();
        await this.outbox.enqueue(tx, {
          eventType: DOMAIN_EVENTS.THREAD_COLLABORATOR_ROLE_CHANGED,
          aggregateType: 'ThreadMember',
          aggregateId: member.id,
          eventKey: `thread-collaborator-role:${eventId}`,
          payload: {
            eventId,
            threadId,
            threadTitle: member.thread.title ?? '未命名主题',
            actorId,
            actorName: actorUser.username,
            targetUserId,
            oldRole: member.role,
            newRole,
          },
        });
      }

      return updated;
    });
  }

  /** 主动退出：取消自己的玩家标记，从"我参与的"列表移除 */
  async exitMember(threadId: string, userId: string) {
    await this.threadAccess.assertAccessible(threadId, userId);
    const member = await this.prisma.threadMember.findUnique({
      where: { threadId_userId: { threadId, userId } },
    });
    if (!member) throw notFound(ErrorCode.USER_NOT_FOUND, '您不是此主题帖参与人');
    if (member.role === 'OWNER') throw forbidden('楼主不能退出', ErrorCode.CANNOT_MODERATE_OWNER);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.threadMember.update({
        where: { threadId_userId: { threadId, userId } },
        data: { playerMarked: false },
      });
      await tx.subscription.deleteMany({
        where: { threadId, type: 'USER', targetUserId: userId },
      });
      return updated;
    });
  }
}
