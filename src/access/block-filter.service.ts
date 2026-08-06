import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** 双向拉黑关系集合 */
export interface BlockSets {
  /** 拉黑了 author 的用户 ID 集合 */
  blockedByUser: Set<string>;
  /** author 拉黑了的用户 ID 集合 */
  blockedByAuthor: Set<string>;
}
/** 拉黑过滤服务：统一加载双向拉黑关系，供通知投递复用 */
@Injectable()
export class BlockFilterService {
  constructor(private prisma: PrismaService) {}

  /** 加载用户的双向拉黑关系（一次 DB 查询） */
  async loadBlockSets(userId: string): Promise<BlockSets> {
    const [blockedBy, blocksOf] = await Promise.all([
      this.prisma.userBlock.findMany({
        where: { blockedId: userId },
        select: { blockerId: true },
      }),
      this.prisma.userBlock.findMany({
        where: { blockerId: userId },
        select: { blockedId: true },
      }),
    ]);
    return {
      blockedByUser: new Set(blockedBy.map(b => b.blockerId)),
      blockedByAuthor: new Set(blocksOf.map(b => b.blockedId)),
    };
  }

  /** 双向过滤接收者：排除拉黑者和被拉黑者 */
  filterRecipients(recipientIds: string[], sets: BlockSets): string[] {
    return recipientIds.filter(
      id => !sets.blockedByUser.has(id) && !sets.blockedByAuthor.has(id),
    );
  }
}
