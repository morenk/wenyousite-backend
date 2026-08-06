import { Injectable } from '@nestjs/common';
import { MemberRole, PostingPolicy } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ErrorCode } from '../common/exceptions/error-codes';
import { forbidden } from '../common/exceptions/business.exception';

export interface PostingMemberSnapshot {
  role: MemberRole;
  playerMarked: boolean;
}

/** 发帖策略：统一校验楼主双向拉黑、成员角色和子贴发帖规则。 */
@Injectable()
export class PostingPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async assertCanPost(input: {
    ownerId: string;
    userId: string;
    postingPolicy: PostingPolicy;
    member: PostingMemberSnapshot | null;
  }): Promise<void> {
    const { ownerId, userId, postingPolicy, member } = input;

    if (ownerId !== userId) {
      const blocked = await this.prisma.userBlock.findFirst({
        where: {
          OR: [
            { blockerId: ownerId, blockedId: userId },
            { blockerId: userId, blockedId: ownerId },
          ],
        },
        select: { id: true },
      });
      if (blocked) {
        throw forbidden('你与该主题帖楼主存在拉黑关系，无法发帖');
      }
    }

    const isManager = member?.role === 'OWNER' || member?.role === 'COLLABORATOR';
    if (postingPolicy === 'COLLABORATORS' && !isManager) {
      throw forbidden('该子贴仅限协作者发帖', ErrorCode.NOT_COLLABORATOR);
    }
    if (postingPolicy === 'PLAYERS' && !isManager && !member?.playerMarked) {
      throw forbidden('该子贴仅限玩家发帖', ErrorCode.NOT_PLAYER);
    }
  }
}
