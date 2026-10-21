import { FontWorkDirectoryService } from './font-work-directory.service';
import { Injectable } from '@nestjs/common';
import { Prisma, TextFontArtifact, TextFontBuildJob } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../moderation/audit.service';
import { FontStorageService } from './font-storage.service';
import { FontProcessingFailure, FontSandboxService } from './font-sandbox.service';
import { fontBuildIdentity } from './font-build-identity';
import {
  fontConfiguration,
  fontJson,
  fontSha,
  lockFontState,
  newFontId,
  requireFontRights,
} from './font-domain';
import { FONT_DOCUMENT_MAX_BYTES, fontManifestAssets, validateFontManifest } from './font-manifest';
import { FontAssetDto } from './dto/font-public.dto';

type ArtifactData = Prisma.TextFontArtifactUncheckedCreateInput;
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
          leaseExpiresAt: new Date(Date.now() + 660000),
          failureCode: null,
        },
      });
    });
    if (!job) return;
    try {
      requireFontRights(fontConfiguration(job.configuration));
      const build = await fontBuildIdentity(job.sourceSha256, fontConfiguration(job.configuration));
      if (!job.buildKey || job.buildKey !== build.key)
        throw new FontProcessingFailure('processing-failed');
      let artifact: TextFontArtifact | ArtifactData | null =
        await this.prisma.textFontArtifact.findUnique({ where: { buildKey: build.key } });
      if (artifact) await this.storage.verifyAssets(artifact.assets as unknown as FontAssetDto[]);
      else artifact = await this.build(job, build);
      const complete = artifact;
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
        let version = await tx.textFontVersion.findUnique({
          where: { familyId_artifactKey: { familyId: job.familyId, artifactKey: build.key } },
        });
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
              configuration: fontJson(job.configuration),
            },
          });
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
          },
        });
      });
    } catch (error) {
      const failure =
        error instanceof FontProcessingFailure
          ? error
          : new FontProcessingFailure('processing-failed');
      await this.prisma.textFontBuildJob
        .updateMany({
          where: { id: jobId, attempt, claimToken: claim, status: 'PROCESSING' },
          data: {
            status: 'FAILED',
            claimToken: null,
            leaseExpiresAt: null,
            failureCode: failure.code,
          },
        })
        .catch(() => {
          /* 原任务租约留待恢复；队列可重试，原始数据库错误不入日志。 */
        });
      throw failure;
    }
  }

  private async build(
    job: TextFontBuildJob,
    build: Awaited<ReturnType<typeof fontBuildIdentity>>,
  ): Promise<ArtifactData> {
    const ticket = await this.work.create(job.id, job.attempt, job.claimToken!);
    const root = ticket.root;
    try {
      const input = join(root, 'input'),
        output = join(root, 'output');
      await mkdir(input, { mode: 0o700 });
      await mkdir(output, { mode: 0o700 });
      const source = await this.storage.readSource(job.sourceKey, job.sourceSha256, job.sourceBytes);
      if (fontSha(source) !== job.sourceSha256) throw new FontProcessingFailure('invalid-font');
      await writeFile(join(input, 'source'), source, { flag: 'wx', mode: 0o400 });
      await writeFile(
        join(input, 'parameters.json'),
        JSON.stringify({
          sourceSha256: job.sourceSha256,
          buildKey: build.key,
          configuration: fontConfiguration(job.configuration),
        }),
        { flag: 'wx', mode: 0o400 },
      );
      await this.sandbox.run(input, output);
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
        const bytes = await this.storage.readChecked(
          join(output, `${asset.sha256}.${asset.format}`),
          asset.bytes,
        );
        if (fontSha(bytes) !== asset.sha256) throw new FontProcessingFailure('processing-failed');
        validateMagic(asset, bytes);
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
      await this.work.remove(ticket, true);
    }
  }
}
