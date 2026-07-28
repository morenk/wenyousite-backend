import { Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** 主题帖成员服务：加入、邀请、踢出、角色修改、玩家标记 */
@Injectable()
export class ThreadMembersService {
  constructor(private prisma: PrismaService) {}

  /** 获取成员列表 */
  async findAll(threadId: string) {
    const thread = await this.prisma.thread.findUnique({ where: { id: threadId } });
    if (!thread) throw new NotFoundException('主题帖不存在');

    return this.prisma.threadMember.findMany({
      where: { threadId },
      include: {
        user: { select: { id: true, username: true, nickname: true, avatar: true } },
      },
      orderBy: { joinedAt: 'asc' },
    });
  }

  /** 自由加入（任何人）。私密帖禁止自由加入，仅允许通过邀请链接加入。 */
  async join(threadId: string, userId: string) {
    const thread = await this.prisma.thread.findUnique({ where: { id: threadId } });
    if (!thread) throw new NotFoundException('主题帖不存在');
    if (thread.visibility === 'PRIVATE') {
      throw new ForbiddenException('私密帖子仅可通过邀请链接加入');
    }

    const existing = await this.prisma.threadMember.findUnique({
      where: { threadId_userId: { threadId, userId } },
    });
    if (existing) throw new ConflictException('已是该主题帖成员');

    return this.prisma.threadMember.create({
      data: { threadId, userId, role: 'PARTICIPANT' },
      include: {
        user: { select: { id: true, username: true, nickname: true, avatar: true } },
      },
    });
  }

  /** 邀请成员（仅 OWNER/COLLABORATOR） */
  async invite(threadId: string, targetUserId: string, actorId: string) {
    await this.assertCanManage(threadId, actorId);

    const targetUser = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!targetUser) throw new NotFoundException('用户不存在');

    const existing = await this.prisma.threadMember.findUnique({
      where: { threadId_userId: { threadId, userId: targetUserId } },
    });
    if (existing) throw new ConflictException('该用户已是成员');

    return this.prisma.threadMember.create({
      data: { threadId, userId: targetUserId, role: 'PARTICIPANT' },
      include: {
        user: { select: { id: true, username: true, nickname: true, avatar: true } },
      },
    });
  }

  /** 修改成员角色或玩家标记（仅 OWNER/COLLABORATOR）
   *  - role: COLLABORATOR（协作者）或 PARTICIPANT
   *  - playerMarked: 标记为玩家
   *  不能修改 OWNER 角色 */
  async updateMember(threadId: string, targetUserId: string, dto: { role?: string; playerMarked?: boolean }, actorId: string) {
    await this.assertCanManage(threadId, actorId);

    const member = await this.prisma.threadMember.findUnique({
      where: { threadId_userId: { threadId, userId: targetUserId } },
    });
    if (!member) throw new NotFoundException('该用户不是此主题帖成员');
    if (member.role === 'OWNER') throw new ForbiddenException('不能修改楼主角色');

    return this.prisma.threadMember.update({
      where: { threadId_userId: { threadId, userId: targetUserId } },
      data: dto as any,
      include: {
        user: { select: { id: true, username: true, nickname: true, avatar: true } },
      },
    });
  }

  /** 踢出成员（仅 OWNER/COLLABORATOR）。私密帖中踢出仅取消玩家标记，不删除成员。 */
  async removeMember(threadId: string, targetUserId: string, actorId: string) {
    await this.assertCanManage(threadId, actorId);

    const member = await this.prisma.threadMember.findUnique({
      where: { threadId_userId: { threadId, userId: targetUserId } },
    });
    if (!member) throw new NotFoundException('该用户不是此主题帖成员');
    if (member.role === 'OWNER') throw new ForbiddenException('不能踢出楼主');

    const thread = await this.prisma.thread.findUnique({ where: { id: threadId } });

    // 私密帖：踢出仅取消玩家标记，成员身份保留（通过邀请链接加入的成员不可完全移除）
    if (thread?.visibility === 'PRIVATE') {
      return this.prisma.threadMember.update({
        where: { threadId_userId: { threadId, userId: targetUserId } },
        data: { playerMarked: false },
        include: {
          user: { select: { id: true, username: true, nickname: true, avatar: true } },
        },
      });
    }

    return this.prisma.threadMember.delete({
      where: { threadId_userId: { threadId, userId: targetUserId } },
    });
  }

  /** 检查管理权限 */
  private async assertCanManage(threadId: string, userId: string) {
    const member = await this.prisma.threadMember.findUnique({
      where: { threadId_userId: { threadId, userId } },
    });
    if (!member || (member.role !== 'OWNER' && member.role !== 'COLLABORATOR')) {
      throw new ForbiddenException('无管理权限');
    }
    return member;
  }
}
