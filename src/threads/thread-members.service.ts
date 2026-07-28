import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ThreadAccessService } from '../common/services/thread-access.service';
import { ErrorCode } from '../common/exceptions/error-codes';
import { BusinessException, notFound, forbidden } from '../common/exceptions/business.exception';

/** 主题帖成员服务：加入、邀请、踢出、角色修改、玩家标记 */
@Injectable()
export class ThreadMembersService {
  constructor(
    private prisma: PrismaService,
    private threadAccess: ThreadAccessService,
  ) {}

  /** 获取成员列表 */
  async findAll(threadId: string) {
    const thread = await this.prisma.thread.findUnique({ where: { id: threadId, deletedAt: null } });
    if (!thread) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');

    return this.prisma.threadMember.findMany({
      where: { threadId },
      include: {
        user: { select: { id: true, username: true, avatar: true } },
      },
      orderBy: { joinedAt: 'asc' },
    });
  }

  /** 自由加入（任何人）。未发布帖和私密帖禁止自由加入。 */
  async join(threadId: string, userId: string) {
    const thread = await this.prisma.thread.findUnique({ where: { id: threadId, deletedAt: null } });
    if (!thread) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
    if (!thread.published) throw forbidden('该主题帖尚未发布');
    if (thread.visibility === 'PRIVATE') {
      throw forbidden('私密帖子仅可通过邀请链接加入');
    }

    const existing = await this.prisma.threadMember.findUnique({
      where: { threadId_userId: { threadId, userId } },
    });
    if (existing) throw new BusinessException(ErrorCode.ALREADY_MEMBER, '已是该主题帖成员', HttpStatus.CONFLICT);

    return this.prisma.threadMember.create({
      data: { threadId, userId, role: 'PARTICIPANT' },
      include: {
        user: { select: { id: true, username: true, avatar: true } },
      },
    });
  }

  /** 邀请成员（仅 OWNER/COLLABORATOR，需已发布） */
  async invite(threadId: string, targetUserId: string, actorId: string) {
    await this.threadAccess.assertCanManage(threadId, actorId);

    const thread = await this.prisma.thread.findUnique({ where: { id: threadId, deletedAt: null } });
    if (!thread) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
    if (!thread.published) throw forbidden('请先发布主题帖后再邀请成员');

    const targetUser = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!targetUser) throw notFound(ErrorCode.USER_NOT_FOUND, '用户不存在');

    const existing = await this.prisma.threadMember.findUnique({
      where: { threadId_userId: { threadId, userId: targetUserId } },
    });
    if (existing) throw new BusinessException(ErrorCode.ALREADY_MEMBER, '该用户已是成员', HttpStatus.CONFLICT);

    return this.prisma.threadMember.create({
      data: { threadId, userId: targetUserId, role: 'PARTICIPANT' },
      include: {
        user: { select: { id: true, username: true, avatar: true } },
      },
    });
  }

  /** 修改成员角色或玩家标记（仅 OWNER/COLLABORATOR）
   *  - role: COLLABORATOR（协作者）或 PARTICIPANT
   *  - playerMarked: 标记为玩家
   *  不能修改 OWNER 角色 */
  async updateMember(threadId: string, targetUserId: string, dto: { role?: string; playerMarked?: boolean }, actorId: string) {
    await this.threadAccess.assertCanManage(threadId, actorId);

    const member = await this.prisma.threadMember.findUnique({
      where: { threadId_userId: { threadId, userId: targetUserId } },
    });
    if (!member) throw notFound(ErrorCode.USER_NOT_FOUND, '该用户不是此主题帖成员');
    if (member.role === 'OWNER') throw forbidden('不能修改楼主角色', ErrorCode.CANNOT_MODERATE_OWNER);

    return this.prisma.threadMember.update({
      where: { threadId_userId: { threadId, userId: targetUserId } },
      data: dto as any,
      include: {
        user: { select: { id: true, username: true, avatar: true } },
      },
    });
  }

  /** 踢出成员：取消该用户的玩家标记（公开/私密帖统一逻辑） */
  async removeMember(threadId: string, targetUserId: string, actorId: string) {
    await this.threadAccess.assertCanManage(threadId, actorId);

    const member = await this.prisma.threadMember.findUnique({
      where: { threadId_userId: { threadId, userId: targetUserId } },
    });
    if (!member) throw notFound(ErrorCode.USER_NOT_FOUND, '该用户不是此主题帖成员');
    if (member.role === 'OWNER') throw forbidden('不能踢出楼主', ErrorCode.CANNOT_MODERATE_OWNER);

    return this.prisma.threadMember.update({
      where: { threadId_userId: { threadId, userId: targetUserId } },
      data: { playerMarked: false },
      include: {
        user: { select: { id: true, username: true, avatar: true } },
      },
    });
  }

  /** 主动退出：取消自己的玩家标记，从"我参与的"列表移除 */
  async exitMember(threadId: string, userId: string) {
    const member = await this.prisma.threadMember.findUnique({
      where: { threadId_userId: { threadId, userId } },
    });
    if (!member) throw notFound(ErrorCode.USER_NOT_FOUND, '您不是此主题帖成员');
    if (member.role === 'OWNER') throw forbidden('楼主不能退出', ErrorCode.CANNOT_MODERATE_OWNER);

    return this.prisma.threadMember.update({
      where: { threadId_userId: { threadId, userId } },
      data: { playerMarked: false },
    });
  }
}
