import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { verifyIsolatedEnvironment } from './e2e-guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/moderation/audit.service';
import { ObjectStorageService } from '../src/storage/object-storage.service';
import { FontStorageService } from '../src/text-fonts/font-storage.service';
import { FontSandboxService } from '../src/text-fonts/font-sandbox.service';
import { FontWorkDirectoryService } from '../src/text-fonts/font-work-directory.service';
import { FontLegacyImportService } from '../src/text-fonts/font-legacy-import.service';
import { FONT_LEGACY_IMPORT } from '../src/text-fonts/font-legacy-map';
import { fontJson, lockFontState } from '../src/text-fonts/font-domain';
import { publishFontCatalog } from '../src/text-fonts/font-catalog-publisher';

export async function prepareFontReadiness(db: PrismaClient, processedVersionId: string, actorId: string) {
  await verifyIsolatedEnvironment();
  if (process.env.E2E_FONT_LEGACY_BUNDLE || process.env.E2E_FONT_LEGACY_SOURCES) {
    assert(process.env.E2E_FONT_LEGACY_BUNDLE && process.env.E2E_FONT_LEGACY_SOURCES);
    const first = await runLegacyImport(actorId);
    const repeated = await runLegacyImport(actorId);
    assert.equal(first.imported, 28); assert.equal(repeated.imported, 0); assert.equal(first.catalogRevision, repeated.catalogRevision);
    return 'verified-28-font-import';
  }
  // CI 无私人恢复材料：只构造历史就绪状态，复用本轮真实 Worker 的输出。
  // 新字体仍走真实上传/处理/发布；这里绝不作为 28 款导入或跨端原生兼容证据。
  const version = await db.textFontVersion.findUniqueOrThrow({ where: { id: processedVersionId } });
  assert(version.publishedAt && !version.withdrawnAt);
  await db.$transaction(async tx => {
    await lockFontState(tx);
    for (const row of FONT_LEGACY_IMPORT.fonts) {
      await tx.textFontFamily.create({ data: { id: row.familyId, legacyId: row.legacyId, configuration: fontJson(version.configuration), nextVersion: 2 } });
      await tx.textFontVersion.create({ data: { id: row.versionId, familyId: row.familyId, versionNumber: 1, artifactKey: version.artifactKey, configuration: fontJson(version.configuration), publishedAt: new Date() } });
      await tx.textFontFamily.update({ where: { id: row.familyId }, data: { currentVersionId: row.versionId } });
    }
    await publishFontCatalog(tx);
  }, { timeout: 30000 });
  return 'synthetic-legacy-readiness-only';
}

async function runLegacyImport(actorId: string) {
  const app = new PrismaClient({ datasourceUrl: process.env.TEXT_FONT_TEST_APP_URL, log: [] });
  const config = new ConfigService({
    textFonts: { storageRoot: process.env.TEXT_FONT_STORAGE_ROOT, bucket: process.env.TEXT_FONT_BUCKET, toolchainDir: process.env.TEXT_FONT_TOOLCHAIN_DIR },
    cos: { endpoint: process.env.COS_ENDPOINT, region: 'auto', bucket: '', accessKeyId: process.env.COS_ACCESS_KEY_ID, secretAccessKey: process.env.COS_SECRET_ACCESS_KEY },
  });
  const storage = new FontStorageService(config, new ObjectStorageService(config)), sandbox = new FontSandboxService(config);
  try {
    const service = new FontLegacyImportService(app as PrismaService, storage, sandbox, new FontWorkDirectoryService(storage), new AuditService(app as PrismaService));
    return await service.import(process.env.E2E_FONT_LEGACY_BUNDLE!, process.env.E2E_FONT_LEGACY_SOURCES!, actorId);
  } finally { sandbox.onModuleDestroy(); await app.$disconnect(); }
}

export async function verifyLegacyReplayPreservesState(db: PrismaClient, actorId: string) {
  if (!process.env.E2E_FONT_LEGACY_BUNDLE) return;
  await verifyIsolatedEnvironment();
  const snapshot = async () => ({
    families: await db.textFontFamily.findMany({ where: { legacyId: { not: null } }, orderBy: { id: 'asc' } }),
    versions: await db.textFontVersion.findMany({ where: { id: { in: FONT_LEGACY_IMPORT.fonts.map(row => row.versionId) } }, orderBy: { id: 'asc' } }),
    head: await db.textFontCatalogHead.findUniqueOrThrow({ where: { id: 1 } }),
    auditCount: await db.auditLog.count({ where: { action: 'TEXT_FONT_IMPORTED' } }),
  });
  const before = await snapshot();
  assert.equal((await runLegacyImport(actorId)).imported, 0);
  assert.deepEqual(await snapshot(), before, '重跑不能复活历史撤回、覆盖配置或当前版本、重新启用家族、推进目录或重复审计');
}
