import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { artifactSchema } from '../app-downloads/download-model';
import { MobileReleasePublication } from './mobile-release-publication';

export const identitySchema = z.object({
  platform: z.literal('android'),
  versionName: z.string().regex(/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/),
  buildNumber: z.number().int().min(1).max(2100000000),
});
const operationSchema = z.object({ operationId: z.string().uuid() }).strict();
const promotionSchema = identitySchema
  .extend({
    confirmedRevision: z.number().int().positive(),
    operationId: z.string().uuid(),
    apkSha256: z.string().regex(/^[0-9a-f]{64}$/),
    apkSize: z.string().regex(/^[1-9][0-9]*$/),
    updateUrl: z.string(),
  })
  .strict();

export async function runReleaseCommand(
  store: MobileReleasePublication,
  action: string,
  input: unknown,
) {
  if (action === 'register-download') return store.registerDownload(artifactSchema.parse(input));
  if (action === 'download-proof') return store.downloadProof(identitySchema.strict().parse(input));
  if (action === 'preflight') return store.preflight(identitySchema.strict().parse(input));
  if (action === 'begin') {
    const data = promotionSchema.parse(input);
    if (
      data.updateUrl !==
      `https://wenyou-apk.cn-nb1.rains3.com/mobile/android/wenyou-${data.versionName}-${data.buildNumber}.apk`
    )
      throw new Error('INVALID_RELEASE_URL');
    return store.begin(data);
  }
  const { operationId } = operationSchema.parse(input);
  if (action === 'status') return store.status(operationId);
  if (action === 'publish' || action === 'commit' || action === 'finish' || action === 'abort')
    return store.transition(operationId, action);
  throw new Error('INVALID_RELEASE_COMMAND');
}
async function main() {
  // 此入口只能由 root 所有的固定 shell 调用；只取应用 URL，不载入 owner 或启动 AppModule。
  const [action, envFile] = process.argv.slice(2);
  if (process.argv.length !== 4) throw new Error('INVALID_ARGUMENTS');
  const env = parse(readFileSync(envFile));
  const url = new URL(env.DATABASE_URL);
  if (url.username !== 'wenyousite_app') throw new Error('INVALID_DATABASE_ROLE');
  const prisma = new PrismaClient({ datasourceUrl: url.toString(), log: [] });
  try {
    const input: unknown = JSON.parse(readFileSync(0, 'utf8'));
    const result = await runReleaseCommand(new MobileReleasePublication(prisma), action, input);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}
if (require.main === module)
  void main().catch(() => {
    // Prisma/连接失败不得把连接串、私密正文或 SQL 写到 SSH 机器输出。
    process.stderr.write('MOBILE_RELEASE_COMMAND_FAILED\n');
    process.exitCode = 1;
  });
