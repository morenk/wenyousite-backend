import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import configuration from '../config/configuration';
import { ObjectStorageService } from '../storage/object-storage.service';
import { resolve } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../moderation/audit.service';
import { loadLegacyBundle, readLegacyAsset } from './font-legacy-bundle';
import { FontLegacyImportService } from './font-legacy-import.service';
import { FONT_LEGACY_IMPORT } from './font-legacy-map';
import { FontSandboxService } from './font-sandbox.service';
import { FontStorageService } from './font-storage.service';
import { FontWorkDirectoryService } from './font-work-directory.service';

export async function runLegacyFontImport(args = process.argv.slice(2)) {
  const value = (flag: string) => {
    const at = args.indexOf(flag);
    if (at < 0 || !args[at + 1] || args[at + 1].startsWith('--'))
      throw new Error('font_import_arguments');
    return args[at + 1];
  };
  const bundleRoot = resolve(value('--bundle'));
  const rawRoot = resolve(value('--raw-sources'));
  const storage = new FontStorageService(new ConfigService());
  const bundle = await loadLegacyBundle();
  for (const font of bundle.fonts) {
    for (const asset of [
      ...font.notices,
      ...font.shards.flatMap((shard) => [shard.web, shard.mobile]),
    ])
      await readLegacyAsset(storage, bundleRoot, asset);
  }
  if (!args.includes('--apply')) {
    console.log(
      JSON.stringify({
        mode: 'plan',
        sourceManifestSha256: FONT_LEGACY_IMPORT.sourceManifestSha256,
        fonts: FONT_LEGACY_IMPORT.fonts,
        assetsVerified: true,
        databaseConnected: false,
      }),
    );
    return;
  }
  const actor = value('--actor');
  const config = new ConfigService(configuration());
  const privateStorage = new FontStorageService(config, new ObjectStorageService(config));
  const prisma = new PrismaService();
  const sandbox = new FontSandboxService(config);
  try {
    await prisma.$connect();
    const service = new FontLegacyImportService(
      prisma,
      privateStorage,
      sandbox,
      new FontWorkDirectoryService(privateStorage),
      new AuditService(prisma),
    );
    const result = await service.import(bundleRoot, rawRoot, actor);
    console.log(
      JSON.stringify({
        mode: 'applied',
        ...result,
        sourceManifestSha256: FONT_LEGACY_IMPORT.sourceManifestSha256,
      }),
    );
  } finally {
    sandbox.onModuleDestroy();
    await prisma.$disconnect();
  }
}
export function legacyFontImportMain() {
  return runLegacyFontImport().catch(() => {
    console.error('字体历史包导入失败；未完成验收，检查锁定材料、私有存储及应用角色配置。');
    process.exitCode = 1;
  });
}
if (require.main === module) void legacyFontImportMain();
