import { AuditAction, AuditTargetType, Prisma, PrismaClient } from '@prisma/client';

export interface ReleaseIdentity {
  platform: 'android';
  versionName: string;
  buildNumber: number;
}
export interface ReleasePromotionInput extends ReleaseIdentity {
  confirmedRevision: number;
  operationId: string;
  apkSha256: string;
  apkSize: string;
  updateUrl: string;
}
function assertReady(condition: unknown): asserts condition {
  if (!condition) throw new Error('MOBILE_RELEASE_NOT_READY');
}

/** 仅由已部署受限 CLI 使用；不引入 Nest 启动、队列或配置副作用。 */
export class MobileReleasePublication {
  constructor(private readonly prisma: PrismaClient) {}

  preflight(identity: ReleaseIdentity) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const row = await tx.mobileRelease.findUnique({
        where: {
          platform_buildNumber: { platform: identity.platform, buildNumber: identity.buildNumber },
        },
      });
      assertReady(
        row &&
          row.versionName === identity.versionName &&
          row.confirmedRevision === row.revision &&
          !row.promotionId,
      );
      return {
        schemaVersion: 1,
        platform: row.platform,
        versionName: row.versionName,
        buildNumber: row.buildNumber,
        confirmedRevision: row.confirmedRevision,
      };
    });
  }

  begin(input: ReleasePromotionInput) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM mobile_releases WHERE platform = ${input.platform} AND build_number = ${input.buildNumber} FOR UPDATE`;
      const row = await tx.mobileRelease.findUnique({
        where: {
          platform_buildNumber: { platform: input.platform, buildNumber: input.buildNumber },
        },
      });
      assertReady(
        row &&
          row.versionName === input.versionName &&
          row.revision === input.confirmedRevision &&
          row.confirmedRevision === input.confirmedRevision,
      );
      const prior = await tx.mobileReleasePromotion.findUnique({
        where: { id: input.operationId },
      });
      if (prior) {
        assertReady(
          prior.releaseId === row.id &&
            prior.revision === input.confirmedRevision &&
            prior.apkSha256 === input.apkSha256 &&
            prior.apkSize === input.apkSize &&
            prior.updateUrl === input.updateUrl &&
            prior.status !== 'ABORTED',
        );
        return { status: prior.status };
      }
      assertReady(!row.promotionId);
      // 同 build 重试也要固定 APK 身份，不能以 /meta 已推荐为由绕过登记。
      const previous = await tx.mobileReleasePromotion.findFirst({
        where: { releaseId: row.id, status: 'SUCCEEDED' },
      });
      if (previous)
        assertReady(
          previous.apkSha256 === input.apkSha256 &&
            previous.apkSize === input.apkSize &&
            previous.updateUrl === input.updateUrl,
        );
      await tx.mobileReleasePromotion.create({
        data: {
          id: input.operationId,
          releaseId: row.id,
          revision: input.confirmedRevision,
          apkSha256: input.apkSha256,
          apkSize: input.apkSize,
          updateUrl: input.updateUrl,
          previousPublishedRevision: row.publishedRevision,
        },
      });
      await tx.mobileRelease.update({
        where: { id: row.id },
        data: { promotionId: input.operationId },
      });
      await this.audit(tx, row.id, 'prepare', input.operationId, input.confirmedRevision);
      return { status: 'PREPARED' };
    });
  }

  async status(operationId: string) {
    const row = await this.prisma.mobileReleasePromotion.findUnique({ where: { id: operationId } });
    return { status: row?.status ?? 'ABSENT' };
  }

  transition(operationId: string, action: 'publish' | 'commit' | 'finish' | 'abort') {
    return this.prisma.$transaction(async (tx) => {
      const initial = await tx.mobileReleasePromotion.findUnique({ where: { id: operationId } });
      if (!initial && action === 'abort') return { status: 'ABSENT' };
      assertReady(initial);
      await tx.$queryRaw`SELECT id FROM mobile_releases WHERE id = ${initial.releaseId} FOR UPDATE`;
      const operation = await tx.mobileReleasePromotion.findUniqueOrThrow({
        where: { id: operationId },
      });
      const row = await tx.mobileRelease.findUniqueOrThrow({ where: { id: operation.releaseId } });
      if (operation.status === 'SUCCEEDED') {
        assertReady(action === 'finish');
        return { status: 'SUCCEEDED' };
      }
      if (operation.status === 'ABORTED') {
        assertReady(action === 'abort');
        return { status: 'ABORTED' };
      }
      assertReady(
        row.promotionId === operationId &&
          row.revision === operation.revision &&
          row.confirmedRevision === operation.revision,
      );
      let status: string;
      if (action === 'publish') {
        assertReady(['PREPARED', 'STAGED'].includes(operation.status));
        // 此阶段只登记策略/TSV已生效，尚不改变公开快照；kill 后不会泄漏待提交说明。
        status = 'STAGED';
      } else if (action === 'commit') {
        assertReady(['STAGED', 'COMMITTED'].includes(operation.status));
        if (!row.publishedAt)
          await tx.mobileRelease.update({
            where: { id: row.id },
            data: {
              publishedAt: new Date(),
              publishedRevision: row.confirmedRevision,
              publishedSummary: row.confirmedSummary,
              publishedItems: row.confirmedItems,
            },
          });
        // 与公开快照同事务提交；保留编辑锁直到公开读回核验，以允许失败补偿。
        status = 'COMMITTED';
      } else if (action === 'finish') {
        assertReady(
          operation.status === 'COMMITTED' && row.publishedRevision === operation.revision,
        );
        await tx.mobileRelease.update({ where: { id: row.id }, data: { promotionId: null } });
        status = 'SUCCEEDED';
      } else {
        await tx.mobileRelease.update({
          where: { id: row.id },
          data: {
            promotionId: null,
            ...(operation.previousPublishedRevision === null
              ? {
                  publishedAt: null,
                  publishedRevision: null,
                  publishedSummary: null,
                  publishedItems: [],
                }
              : {}),
          },
        });
        status = 'ABORTED';
      }
      await tx.mobileReleasePromotion.update({ where: { id: operationId }, data: { status } });
      await this.audit(tx, row.id, action, operationId, operation.revision);
      return { status };
    });
  }
  private audit(
    tx: Prisma.TransactionClient,
    releaseId: string,
    operation: string,
    operationId: string,
    revision: number,
  ) {
    return tx.auditLog.create({
      data: {
        action: AuditAction.MOBILE_RELEASE_UPDATED,
        targetType: AuditTargetType.MOBILE_RELEASE,
        targetId: releaseId,
        metadata: { operation, operationId, revision, channel: 'restricted-cli' },
      },
    });
  }
}
