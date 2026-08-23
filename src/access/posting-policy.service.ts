import { Injectable } from '@nestjs/common';
import { MemberRole, PostingPolicy } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ErrorCode } from '../common/exceptions/error-codes';
import { forbidden } from '../common/exceptions/business.exception';

export type PostingDenialReason =
  'AUTHENTICATION_REQUIRED' | 'BLOCKED_RELATION' | 'COLLABORATOR_REQUIRED' | 'PLAYER_REQUIRED';

export interface PostingCapability {
  canPost: boolean;
  denialReason: PostingDenialReason | null;
}

export interface PostingMemberSnapshot {
  role: MemberRole;
  playerMarked: boolean;
}

interface CapabilityInput {
  ownerId: string;
  userId?: string;
  postingPolicy: PostingPolicy;
  member: PostingMemberSnapshot | null;
  blockedRelation: boolean;
}

interface ThreadWithPostingPolicies {
  ownerId: string;
  subthreads: Array<{ postingPolicy: PostingPolicy }>;
}

/** 发言策略：统一计算详情展示能力，并为楼层与回复写入执行同一判定。 */
@Injectable()
export class PostingPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  evaluate(input: CapabilityInput): PostingCapability {
    const { ownerId, userId, postingPolicy, member, blockedRelation } = input;
    if (!userId) {
      return { canPost: false, denialReason: 'AUTHENTICATION_REQUIRED' };
    }
    if (blockedRelation) {
      return { canPost: false, denialReason: 'BLOCKED_RELATION' };
    }

    const isManager =
      ownerId === userId || member?.role === 'OWNER' || member?.role === 'COLLABORATOR';
    if (isManager || postingPolicy === 'PARTICIPANTS') {
      return { canPost: true, denialReason: null };
    }
    if (postingPolicy === 'COLLABORATORS') {
      return { canPost: false, denialReason: 'COLLABORATOR_REQUIRED' };
    }
    if (member?.playerMarked) {
      return { canPost: true, denialReason: null };
    }
    return { canPost: false, denialReason: 'PLAYER_REQUIRED' };
  }

  /**
   * 在共享主题详情之外附加查看者能力。每个详情请求至多读取一次双向拉黑关系，
   * 并浅拷贝子贴，避免把用户态写回共享缓存。
   */
  async attachToThread<T extends ThreadWithPostingPolicies>(
    thread: T,
    userId?: string,
    member: PostingMemberSnapshot | null = null,
  ): Promise<
    Omit<T, 'subthreads'> & {
      subthreads: Array<T['subthreads'][number] & { postingCapability: PostingCapability }>;
    }
  > {
    const blockedRelation = userId ? await this.hasBlockedRelation(thread.ownerId, userId) : false;
    return {
      ...thread,
      subthreads: thread.subthreads.map((subthread) => ({
        ...subthread,
        postingCapability: this.evaluate({
          ownerId: thread.ownerId,
          userId,
          postingPolicy: subthread.postingPolicy,
          member,
          blockedRelation,
        }),
      })),
    };
  }

  async assertCanPost(input: {
    ownerId: string;
    userId: string;
    postingPolicy: PostingPolicy;
    member: PostingMemberSnapshot | null;
  }): Promise<void> {
    const blockedRelation = await this.hasBlockedRelation(input.ownerId, input.userId);
    const capability = this.evaluate({ ...input, blockedRelation });
    if (capability.canPost) return;

    switch (capability.denialReason) {
      case 'BLOCKED_RELATION':
        throw forbidden('你与该主题帖楼主存在拉黑关系，无法发帖');
      case 'COLLABORATOR_REQUIRED':
        throw forbidden('该子贴仅限协作者发帖', ErrorCode.NOT_COLLABORATOR);
      case 'PLAYER_REQUIRED':
        throw forbidden('该子贴仅限玩家发帖', ErrorCode.NOT_PLAYER);
      default:
        throw forbidden('无法在该子贴发帖');
    }
  }

  private async hasBlockedRelation(ownerId: string, userId: string): Promise<boolean> {
    if (ownerId === userId) return false;
    const blocked = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: ownerId, blockedId: userId },
          { blockerId: userId, blockedId: ownerId },
        ],
      },
      select: { id: true },
    });
    return Boolean(blocked);
  }
}
