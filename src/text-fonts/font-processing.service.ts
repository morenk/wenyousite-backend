import { FontWorkDirectoryService } from './font-work-directory.service';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, TextFontArtifact, TextFontBuildJob } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../moderation/audit.service';
import { FontStorageService } from './font-storage.service';
import { FontProcessingFailure, FontSandboxService } from './font-sandbox.service';
import { fontBuildIdentity, fontVersionReuseKey } from './font-build-identity';
import { requireFontAuthorization } from './font-authorization';
import { FONT_UPLOAD_RULE_VERSION } from './font-management-contract';
import {
  fontConfiguration,
  fontJson,
  fontSha,
  lockFontState,
  newFontId,
  bumpFontListing,
} from './font-domain';
import { FONT_DOCUMENT_MAX_BYTES, fontManifestAssets, validateFontManifest } from './font-manifest';
import { FontAssetDto } from './dto/font-public.dto';
import { fontCompilerDiagnostic, FontProcessingStage } from './font-processing-diagnostics';

type ArtifactData = Prisma.TextFontArtifactUncheckedCreateInput;
const LEASE_MS = 660000;
function manifestDescriptor(value: unknown): FontAssetDto {
  const item = value as Partial<FontAssetDto> | null;
  if (
    !item ||
    typeof item.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(item.sha256) ||
    item.format !== 'json' ||
    !Number.isSafeInteger(item.bytes) ||
    item.bytes! < 1 ||
    item.bytes! > FONT_DOCUMENT_MAX_BYTES
  )
    throw new FontProcessingFailure('processing-failed');
  return item as FontAssetDto;
}
function validateMagic(asset: FontAssetDto, bytes: Buffer) {
  const expected = { ttf: '00010000', otf: '4f54544f', woff2: '774f4632', png: '89504e47' };
  if (asset.format === 'json') {
    JSON.parse(bytes.toString('utf8'));
    return;
  }
  if (bytes.subarray(0, 4).toString('hex') !== expected[asset.format])
    throw new FontProcessingFailure('invalid-font');
}

@Injectable()
export class FontProcessingService {
  private readonly logger = new Logger(FontProcessingService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FontStorageService,
    private readonly sandbox: FontSandboxService,
    private readonly audit: AuditService,
    private readonly work: FontWorkDirectoryService,
  ) {}

  async process(jobId: string, attempt: number): Promise<void> {
    const claim = randomBytes(16).toString('hex');
    const job = await this.prisma.$transaction(async (tx) => {
      await lockFontState(tx);
      const current = await tx.textFontBuildJob.findUnique({ where: { id: jobId } });
      if (!current || current.attempt !== attempt || !['QUEUED', 'FAILED'].includes(current.status))
        return null;
      return tx.textFontBuildJob.update({
        where: { id: jobId },
        data: {
          status: 'PROCESSING',
          claimToken: claim,
          leaseExpiresAt: new Date(Date.now() + LEASE_MS),
          failureCode: null,
          failureReason: null,
        },
      });
    });
    if (!job) return;
    const stopLease = this.maintainLease(jobId, attempt, claim);
    const context: { stage: FontProcessingStage } = { stage: 'authorization' };
    try {
      requireFontAuthorization(
        fontConfiguration(job.configuration),
        job.sourceSha256,
        job.parametersVersion,
        job.uploadAuthorization,
      );
      context.stage = 'build-identity';
      const build = await fontBuildIdentity(
        job.sourceSha256,
        fontConfiguration(job.configuration),
        job.parametersVersion,
      );
      if (!job.buildKey || job.buildKey !== build.key)
        throw new FontProcessingFailure('processing-failed');
      context.stage = 'cached-assets';
      let artifact: TextFontArtifact | ArtifactData | null =
        await this.prisma.textFontArtifact.findUnique({ where: { buildKey: build.key } });
      if (artifact) await this.storage.verifyAssets(artifact.assets as unknown as FontAssetDto[]);
      else artifact = await this.build(job, build, context);
      const complete = artifact;
      context.stage = 'persist';
      await this.prisma.$transaction(async (tx) => {
        await lockFontState(tx);
        const current = await tx.textFontBuildJob.findUnique({ where: { id: jobId } });
        if (
          !current ||
          current.claimToken !== claim ||
          current.attempt !== attempt ||
          current.status !== 'PROCESSING'
        )
          return;
        const stored = await tx.textFontArtifact.upsert({
          where: { buildKey: build.key },
          create: {
            buildKey: build.key,
            sourceSha256: job.sourceSha256,
            toolchain: fontJson(complete.toolchain),
            manifest: fontJson(complete.manifest),
            assets: fontJson(complete.assets),
            manifestSha: complete.manifestSha,
            manifestSize: complete.manifestSize,
            specimenSha: complete.specimenSha,
            specimenSize: complete.specimenSize,
          },
          update: {},
        });
        if (stored.manifestSha !== complete.manifestSha)
          throw new FontProcessingFailure('processing-failed');
        const reuseKey = fontVersionReuseKey(
          build.key,
          fontConfiguration(job.configuration),
          job.parametersVersion,
        );
        let version = await tx.textFontVersion.findUnique({
          where: { familyId_reuseKey: { familyId: job.familyId, reuseKey } },
        });
        if (version?.withdrawnAt) throw new FontProcessingFailure('processing-failed');
        if (!version) {
          const family = await tx.textFontFamily.update({
            where: { id: job.familyId },
            data: { nextVersion: { increment: 1 } },
          });
          version = await tx.textFontVersion.create({
            data: {
              id: newFontId('tfv'),
              familyId: job.familyId,
              versionNumber: family.nextVersion - 1,
              artifactKey: build.key,
              reuseKey,
              parametersVersion: job.parametersVersion,
              uploadAuthorization: job.uploadAuthorization ?? Prisma.DbNull,
              configuration: fontJson(job.configuration),
            },
          });
          await bumpFontListing(tx);
          await this.audit.record(
            {
              action: 'TEXT_FONT_VERSION_READY',
              targetType: 'TEXT_FONT',
              targetId: version.id,
              metadata: { jobId, buildKey: build.key },
            },
            tx,
          );
        }
        await tx.textFontBuildJob.update({
          where: { id: jobId },
          data: {
            status: 'READY',
            versionId: version.id,
            claimToken: null,
            leaseExpiresAt: null,
            failureCode: null,
            failureReason: null,
          },
        });
      });
    } catch (error) {
      const failure =
        error instanceof FontProcessingFailure
          ? error
          : new FontProcessingFailure('processing-failed');
      const diagnostic = fontCompilerDiagnostic(failure.diagnostic);
      this.logger.warn({
        event: 'font_build_failed',
        jobId,
        attempt,
        failureCode: failure.code,
        stage: diagnostic?.stage ?? context.stage,
        category: diagnostic?.category ?? 'unexpected-error',
      });
      await this.prisma.textFontBuildJob
        .updateMany({
          where: { id: jobId, attempt, claimToken: claim, status: 'PROCESSING' },
          data: {
            status: 'FAILED',
            claimToken: null,
            leaseExpiresAt: null,
            failureCode: failure.code,
            failureReason: failure.reason ?? null,
          },
        })
        .catch(() => {
          /* 原任务租约留待恢复；队列可重试，原始数据库错误不入日志。 */
        });
      throw failure;
    } finally {
      await stopLease();
    }
  }

  private maintainLease(jobId: string, attempt: number, claim: string): () => Promise<void> {
    let pending: Promise<void> | undefined;
    const timer = setInterval(() => {
      if (pending) return;
      pending = this.prisma
        .$transaction(async (tx) => {
          // 与恢复器共用状态锁；解析及远端存储期间只续租当前 claim。
          await lockFontState(tx);
          await tx.textFontBuildJob.updateMany({
            where: { id: jobId, attempt, claimToken: claim, status: 'PROCESSING' },
            data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
          });
        })
        .catch(() => {
          /* 短暂数据库故障留待下次续租；持续失败仍由过期恢复处理。 */
        })
        .finally(() => {
          pending = undefined;
        });
    }, 30000);
    timer.unref();
    return async () => {
      clearInterval(timer);
      await pending;
    };
  }

  private async build(
    job: TextFontBuildJob,
    build: Awaited<ReturnType<typeof fontBuildIdentity>>,
    context: { stage: FontProcessingStage },
  ): Promise<ArtifactData> {
    context.stage = 'workspace';
    const ticket = await this.work.create(job.id, job.attempt, job.claimToken!);
    const root = ticket.root;
    try {
      const input = join(root, 'input'),
        output = join(root, 'output');
      await mkdir(input, { mode: 0o700 });
      await mkdir(output, { mode: 0o700 });
      context.stage = 'source-read';
      const source = await this.storage.readSource(
        job.sourceKey,
        job.sourceSha256,
        job.sourceBytes,
      );
      if (fontSha(source) !== job.sourceSha256) throw new FontProcessingFailure('invalid-font');
      await writeFile(join(input, 'source'), source, { flag: 'wx', mode: 0o400 });
      await writeFile(
        join(input, 'parameters.json'),
        JSON.stringify({
          sourceSha256: job.sourceSha256,
          buildKey: build.key,
          ...(job.parametersVersion === 2
            ? {
                parametersVersion: 2,
                authorizationRuleVersion: FONT_UPLOAD_RULE_VERSION,
                configuration: { specimenText: fontConfiguration(job.configuration).specimenText },
              }
            : { configuration: fontConfiguration(job.configuration) }),
        }),
        { flag: 'wx', mode: 0o400 },
      );
      context.stage = 'compiler';
      await this.sandbox.run(input, output, { script: build.script });
      context.stage = 'manifest-validation';
      const resultStat = await lstat(join(output, 'result.json'));
      if (resultStat.size > 4096) throw new FontProcessingFailure('resource-limit');
      const result = JSON.parse(
        (await this.storage.readChecked(join(output, 'result.json'), resultStat.size)).toString(
          'utf8',
        ),
      ) as { manifest?: unknown };
      const descriptor = manifestDescriptor(result.manifest);
      const manifestBytes = await this.storage.readChecked(
        join(output, `${descriptor.sha256}.json`),
        descriptor.bytes,
      );
      if (fontSha(manifestBytes) !== descriptor.sha256)
        throw new FontProcessingFailure('processing-failed');
      const manifest = validateFontManifest(
        JSON.parse(manifestBytes.toString('utf8')),
        build.key,
        job.sourceSha256,
      );
      const assets = [...fontManifestAssets(manifest), descriptor];
      for (const asset of assets) {
        context.stage = 'asset-validation';
        const bytes = await this.storage.readChecked(
          join(output, `${asset.sha256}.${asset.format}`),
          asset.bytes,
        );
        if (fontSha(bytes) !== asset.sha256) throw new FontProcessingFailure('processing-failed');
        validateMagic(asset, bytes);
        context.stage = 'asset-write';
        await this.storage.putAsset(bytes, asset.format);
      }
      return {
        buildKey: build.key,
        sourceSha256: job.sourceSha256,
        toolchain: fontJson(build.toolchain),
        manifest: fontJson(manifest),
        assets: fontJson(assets),
        manifestSha: descriptor.sha256,
        manifestSize: descriptor.bytes,
        specimenSha: manifest.specimen.sha256,
        specimenSize: manifest.specimen.bytes,
      };
    } finally {
      await this.work.remove(ticket, true).catch((error: unknown) => {
        context.stage = 'workspace-cleanup';
        throw error;
      });
    }
  }
}
