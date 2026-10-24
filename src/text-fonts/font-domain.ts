import { createHash, randomBytes } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import { Prisma, TextFontBuildJob, TextFontFamily } from '@prisma/client';
import { BusinessException, forbidden, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { FontConfigurationDto, FontFamilyDto, FontJobDto } from './dto/font-admin.dto';

export type FontActor = { actorId: string; ip?: string; requestId?: string };
export const newFontId = (prefix: 'tff' | 'tfv' | 'tfj' | 'tfc') =>
  `${prefix}_${randomBytes(16).toString('hex')}`;
export const fontSha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
export const fontJson = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export function fontConflict(): never {
  throw new BusinessException(
    ErrorCode.TEXT_FONT_STATE_CONFLICT,
    '字体状态已变化，请刷新后重试',
    HttpStatus.CONFLICT,
  );
}
export function fontIdentity(id: string, prefix: 'tff' | 'tfv' | 'tfj'): void {
  if (!new RegExp(`^${prefix}_[a-f0-9]{32}$`).test(id)) throw notFound();
}
export function fontConfiguration(value: Prisma.JsonValue): FontConfigurationDto {
  return value as unknown as FontConfigurationDto;
}
export function requireFontRights(value: FontConfigurationDto): void {
  if (
    !value.author.trim() ||
    !value.sourceUrl.trim() ||
    !value.licenseName.trim() ||
    !value.licenseText.trim() ||
    !value.rights.redistribution ||
    !value.rights.conversion ||
    !value.rights.subsetting
  ) {
    throw new BusinessException(
      ErrorCode.TEXT_FONT_RIGHTS_REQUIRED,
      '请补齐授权材料并确认字体使用权利',
      HttpStatus.CONFLICT,
    );
  }
}
/** 统一锁顺序：业务用户/主题锁之后取字体共享锁；字体管理先取排他锁再读状态。 */
export async function lockFontState(tx: Prisma.TransactionClient, shared = false): Promise<void> {
  if (shared) await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(190776, 2)::text`;
  else await tx.$queryRaw`SELECT pg_advisory_xact_lock(190776, 2)::text`;
}
export function fontFamilyDto(family: TextFontFamily, catalogRevision: number): FontFamilyDto {
  return {
    ...fontConfiguration(family.configuration),
    familyId: family.id,
    revision: family.revision,
    enabled: family.enabled,
    currentVersionId: family.currentVersionId,
    catalogRevision,
  };
}
export function fontJobDto(job: TextFontBuildJob, submissionId: string | null = null): FontJobDto {
  return {
    jobId: job.id,
    submissionId,
    familyId: job.familyId,
    status: job.status.toLowerCase() as FontJobDto['status'],
    sourceSha256: job.sourceSha256,
    sourceBytes: job.sourceBytes,
    versionId: job.versionId,
    failureCode: job.failureCode,
    ...(job.failureReason
      ? { failureReason: job.failureReason as FontJobDto['failureReason'] }
      : {}),
  };
}

/** 调用者持有字体排他锁；一项领域写入只递增一次，任务心跳不调用。 */
export async function bumpFontListing(tx: Prisma.TransactionClient): Promise<number> {
  const head = await tx.textFontCatalogHead.update({
    where: { id: 1 },
    data: { listingRevision: { increment: 1 } },
  });
  return head.listingRevision;
}

/** 审计 actor 外键按用户→字体顺序取锁，避免与持有用户排他锁的草稿写入形成环。 */
export async function lockFontActor(tx: Prisma.TransactionClient, actorId: string): Promise<void> {
  const rows = await tx.$queryRaw<
    Array<{ id: string }>
  >`SELECT id FROM users WHERE id = ${actorId} AND deleted_at IS NULL FOR KEY SHARE`;
  if (!rows.length) throw forbidden();
}
