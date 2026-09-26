import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditAction, AuditTargetType, MobileRelease, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../moderation/audit.service';
import { AdminActor } from '../moderation/admin-policy.service';
import { AdminRequestContext } from '../moderation/moderation.service';
import { BusinessException, forbidden, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { paginate } from '../common/dto/paginated-result';
import {
  CreateMobileReleaseDto,
  MobileReleaseQueryDto,
  UpdateMobileReleaseDto,
} from './mobile-release.dto';

export function releaseConflict(): never {
  throw new BusinessException(
    ErrorCode.CONFLICT,
    '版本说明已变化、正在发布或确认记录不匹配，请刷新后重试',
    HttpStatus.CONFLICT,
  );
}
export function publicRelease(row: MobileRelease) {
  return {
    platform: row.platform,
    versionName: row.versionName,
    buildNumber: row.buildNumber,
    summary: row.publishedSummary!,
    items: row.publishedItems,
    revision: row.publishedRevision!,
    publishedAt: row.publishedAt!.toISOString(),
  };
}
function adminRelease(row: MobileRelease) {
  return {
    id: row.id,
    platform: row.platform,
    versionName: row.versionName,
    buildNumber: row.buildNumber,
    summary: row.summary,
    items: row.items,
    revision: row.revision,
    status: row.publishedAt
      ? 'PUBLISHED'
      : row.confirmedRevision === row.revision
        ? 'READY'
        : 'DRAFT',
    hasUnconfirmedChanges: row.confirmedRevision !== row.revision,
    publishing: row.promotionId !== null,
    confirmed: row.confirmedAt
      ? {
          summary: row.confirmedSummary!,
          items: row.confirmedItems,
          revision: row.confirmedRevision!,
          confirmedAt: row.confirmedAt.toISOString(),
        }
      : null,
    published: row.publishedAt ? publicRelease(row) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class MobileReleasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: MobileReleaseQueryDto, admin = false) {
    let before: number | undefined;
    if (query.cursor) {
      try {
        const decoded = Buffer.from(query.cursor, 'base64url').toString();
        const [platform, build] = decoded.split(':');
        if (
          platform !== query.platform ||
          !/^[1-9][0-9]*$/.test(build) ||
          decoded !== `${platform}:${build}` ||
          Number(build) > 2100000000
        )
          throw new Error();
        before = Number(build);
      } catch {
        throw new BusinessException(ErrorCode.INVALID_CURSOR, '分页游标无效');
      }
    }
    const limit = query.limit ?? 20;
    const rows = await this.prisma.mobileRelease.findMany({
      where: {
        platform: query.platform,
        ...(admin ? {} : { publishedAt: { not: null } }),
        ...(before ? { buildNumber: { lt: before } } : {}),
      },
      orderBy: { buildNumber: 'desc' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    return paginate(
      page.map((row) => (admin ? adminRelease(row) : publicRelease(row))),
      {
        hasMore,
        cursor: hasMore
          ? Buffer.from(`${query.platform}:${page.at(-1)!.buildNumber}`).toString('base64url')
          : null,
      },
    );
  }

  async published(platform: string, buildNumber: number) {
    const row = await this.prisma.mobileRelease.findFirst({
      where: { platform, buildNumber, publishedAt: { not: null } },
    });
    if (!row) throw notFound();
    return publicRelease(row);
  }
  async get(id: string) {
    const row = await this.prisma.mobileRelease.findUnique({ where: { id } });
    if (!row) throw notFound();
    return adminRelease(row);
  }
  async create(actor: AdminActor, dto: CreateMobileReleaseDto, context: AdminRequestContext) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.mobileRelease.create({
          data: {
            ...dto,
            summary: dto.summary.trim(),
            items: dto.items.map((x) => x.trim()),
            confirmedItems: [],
            publishedItems: [],
          },
        });
        await this.record(tx, actor, row, 'create', context);
        return adminRelease(row);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        releaseConflict();
      throw error;
    }
  }
  async update(
    actor: AdminActor,
    id: string,
    dto: UpdateMobileReleaseDto,
    context: AdminRequestContext,
  ) {
    return this.mutate(actor, id, dto.revision, context, 'edit', async (tx, row) => {
      if (row.publishedAt && actor.role !== 'SUPER_ADMIN')
        throw forbidden('已发布版本说明仅超级管理员可以修正');
      if (dto.versionName && dto.versionName !== row.versionName && row.confirmedAt)
        releaseConflict();
      return tx.mobileRelease.update({
        where: { id },
        data: {
          ...(dto.versionName ? { versionName: dto.versionName } : {}),
          summary: dto.summary.trim(),
          items: dto.items.map((x) => x.trim()),
          revision: { increment: 1 },
        },
      });
    });
  }
  async confirm(actor: AdminActor, id: string, revision: number, context: AdminRequestContext) {
    if (actor.role !== 'SUPER_ADMIN') throw forbidden('仅超级管理员可以确认版本说明');
    return this.mutate(actor, id, revision, context, 'confirm', (tx, row) =>
      tx.mobileRelease.update({
        where: { id },
        data: {
          confirmedRevision: row.revision,
          confirmedSummary: row.summary,
          confirmedItems: row.items,
          confirmedAt: new Date(),
          ...(row.publishedAt
            ? {
                publishedRevision: row.revision,
                publishedSummary: row.summary,
                publishedItems: row.items,
              }
            : {}),
        },
      }),
    );
  }
  private async mutate(
    actor: AdminActor,
    id: string,
    revision: number,
    context: AdminRequestContext,
    operation: string,
    change: (tx: Prisma.TransactionClient, row: MobileRelease) => Promise<MobileRelease>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // 行锁序列化编辑、确认与发布领取，读取后再以 revision 校验，避免旧草稿被并发确认。
      await tx.$queryRaw`SELECT id FROM mobile_releases WHERE id = ${id} FOR UPDATE`;
      const row = await tx.mobileRelease.findUnique({ where: { id } });
      if (!row) throw notFound();
      if (row.revision !== revision || row.promotionId) releaseConflict();
      const result = await change(tx, row);
      await this.record(tx, actor, result, operation, context);
      return adminRelease(result);
    });
  }
  private record(
    tx: Prisma.TransactionClient,
    actor: AdminActor,
    row: MobileRelease,
    operation: string,
    context: AdminRequestContext,
  ) {
    return this.audit.record(
      {
        actorId: actor.id,
        action: AuditAction.MOBILE_RELEASE_UPDATED,
        targetType: AuditTargetType.MOBILE_RELEASE,
        targetId: row.id,
        metadata: {
          operation,
          revision: row.revision,
          platform: row.platform,
          buildNumber: row.buildNumber,
        },
        ...context,
      },
      tx,
    );
  }
}
