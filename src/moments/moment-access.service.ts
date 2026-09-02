import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { momentViewerVisibility } from '../access/moment-visibility.where';

export type VisibleMoment = {
  id: string;
  authorId: string;
  title: string;
  author: { deletedAt: Date | null };
};

type MomentClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class MomentAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async assertVisible(id: string, viewerId?: string, client: MomentClient = this.prisma) {
    const moment = await client.moment.findFirst({
      where: { id, deletedAt: null, ...momentViewerVisibility(viewerId) },
      select: {
        id: true,
        authorId: true,
        title: true,
        author: { select: { deletedAt: true } },
      },
    });
    if (!moment) {
      throw new BusinessException(
        ErrorCode.MOMENT_NOT_FOUND,
        '动态不存在',
        HttpStatus.NOT_FOUND,
      );
    }
    return moment satisfies VisibleMoment;
  }

  async lockVisible(
    tx: Prisma.TransactionClient,
    id: string,
    viewerId: string,
    additionalUserIds: string[] = [],
  ) {
    const target = await tx.moment.findUnique({
      where: { id },
      select: { authorId: true },
    });
    if (!target) {
      throw new BusinessException(
        ErrorCode.MOMENT_NOT_FOUND,
        '动态不存在',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.lockUsers(tx, [viewerId, target.authorId, ...additionalUserIds]);
    await this.assertActiveUser(tx, viewerId);
    await tx.$queryRaw`SELECT "id" FROM "moments" WHERE "id" = ${id} FOR UPDATE`;
    return this.assertVisible(id, viewerId, tx);
  }

  assertCanAddInteraction(moment: VisibleMoment) {
    if (moment.author.deletedAt) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '已注销作者的历史动态仅供阅读',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  async lockActiveUser(tx: Prisma.TransactionClient, userId: string) {
    await this.lockUsers(tx, [userId]);
    await this.assertActiveUser(tx, userId);
  }

  private async assertActiveUser(tx: Prisma.TransactionClient, userId: string) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { deletedAt: true },
    });
    if (!user || user.deletedAt) {
      throw new BusinessException(
        ErrorCode.ACCOUNT_DEACTIVATED,
        '账号已注销',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  async lockUsers(tx: Prisma.TransactionClient, userIds: string[]) {
    const ids = [...new Set(userIds)].sort();
    if (ids.length === 0) return;
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "users"
      WHERE "id" IN (${Prisma.join(ids)})
      ORDER BY "id" FOR UPDATE
    `);
  }
}
