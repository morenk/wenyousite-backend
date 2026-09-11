import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import configuration from '../src/config/configuration';
import { redisConnectionOptions } from '../src/redis/redis-connection';
import { parseDisplayBackfillArgs, planDisplayBackfill } from '../src/media/media-display-backfill';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('pnpm media:display:backfill [--limit 1..1000] [--after mediaId] [--apply]');
    console.log('默认只读计划；--apply 只向独立 image Worker 入队，累计最多三次，不删除来源。');
    return;
  }
  const options = parseDisplayBackfillArgs(args);
  const config = new ConfigService(configuration());
  const databaseUrl = config.get<string>('database.url');
  if (!databaseUrl) throw new Error('DISPLAY_BACKFILL_CONFIGURATION_REQUIRED');
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const queue = options.apply ? new Queue('image', { connection: redisConnectionOptions(config) }) : null;
  try {
    console.log(JSON.stringify(await planDisplayBackfill(prisma, queue, options,
      (record) => console.log(JSON.stringify(record)))));
  } finally {
    await queue?.close();
    await prisma.$disconnect();
  }
}
void main().catch(() => {
  process.stderr.write('MEDIA_DISPLAY_BACKFILL_FAILED\n', () => process.exit(1));
});
