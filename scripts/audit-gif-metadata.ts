import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { gifAuditConfiguration } from '../src/config/gif-audit-configuration';
import { auditGifMetadata } from '../src/media/media-gif-metadata-audit';
import { ObjectStorageService } from '../src/storage/object-storage.service';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      '只读 GIF 元数据审计：pnpm media:gif-metadata:audit [--limit 1..1000] [--after mediaId]',
    );
    console.log('默认最多 100 条，输出 JSONL 审核计划；不支持 --apply，不修改数据库或对象。');
    console.log('--check-config 仅校验 DB/S3 配置并构造客户端，不连接数据库或对象存储。');
    return;
  }
  const checkConfig = args.length === 1 && args[0] === '--check-config';
  const options: { limit?: number; after?: string } = {};
  for (let i = 0; !checkConfig && i < args.length; i += 2) {
    const value = args[i + 1];
    if (!value || !['--limit', '--after'].includes(args[i]))
      throw new Error('AUDIT_ARGUMENT_INVALID');
    if (args[i] === '--limit') {
      options.limit = Number(value);
      if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 1000)
        throw new Error('AUDIT_LIMIT_INVALID');
    } else {
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new Error('AUDIT_CURSOR_INVALID');
      options.after = value;
    }
  }
  const config = gifAuditConfiguration(process.env);
  const prisma = new PrismaClient({ datasourceUrl: config.database.url });
  try {
    const storage = new ObjectStorageService(new ConfigService(config));
    if (checkConfig) {
      console.log('GIF_METADATA_AUDIT_CONFIG_VALID');
      return;
    }
    const summary = await auditGifMetadata(
      prisma,
      storage,
      (record) => console.log(JSON.stringify(record)),
      options,
    );
    console.log(JSON.stringify(summary));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch(() => {
  // 配置、SQL 或 S3 原始错误可能含连接或对象信息，终端只输出固定错误码。
  process.stderr.write('GIF_METADATA_AUDIT_FAILED\n');
  process.exitCode = 1;
});
