import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { parse } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { auditAudioResources } from './audio-resource-audit';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('只读音频聚合核验：--env /absolute/private/backend.env。无apply，不连接对象存储/Redis，不启动应用或回收；仅输出数量、年龄与明确开关。');
    return;
  }
  if (args.length !== 2 || args[0] !== '--env' || !isAbsolute(args[1])) throw new Error('INVALID_ARGUMENTS');
  const stat = lstatSync(args[1]);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o027) !== 0 || ![0,process.getuid?.()].includes(stat.uid)) throw new Error('PRIVATE_ENV_REQUIRED');
  const config = parse(readFileSync(args[1]));
  const url = new URL(config.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.username !== 'wenyousite_app') throw new Error('APPLICATION_ROLE_REQUIRED');
  const flag = config.MEDIA_COMPLETED_ORPHAN_CLEANUP_ENABLED;
  if (flag !== undefined && flag !== 'true' && flag !== 'false') throw new Error('INVALID_CLEANUP_FLAG');
  const db = new PrismaClient({ datasourceUrl: config.DATABASE_URL, log: [] });
  try { console.log(JSON.stringify(await auditAudioResources(db, flag === 'true'))); }
  finally { await db.$disconnect(); }
}
void main().catch(() => { console.error('AUDIO_RESOURCE_AUDIT_FAILED：配置、权限或只读查询未通过；未执行回收。'); process.exitCode = 1; });
