import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { apply, digest, dryRun, ensure, invalidate, Manifest } from './webe2e-cleanup';

async function hashFile(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
function privateFile(path: string) {
  const stat = lstatSync(path);
  ensure(stat.isFile() && !stat.isSymbolicLink() && stat.uid === 0 && (stat.mode & 0o077) === 0, '备份与证明必须为 root 所有的私有普通文件');
}
async function main() {
  const { values } = parseArgs({ options: {
    apply: { type: 'boolean', default: false }, manifest: { type: 'string' },
    sha256: { type: 'string' }, 'backup-proof': { type: 'string' },
  }, strict: true });
  ensure(values.manifest, '必须指定 --manifest 的私有输出路径');
  const source = process.env.CLEANUP_DATABASE_URL;
  ensure(source, '必须由管理入口显式注入 CLEANUP_DATABASE_URL；不读取仓库 .env');
  const prisma = new PrismaClient({ datasourceUrl: source, log: [] });
  let redis: Redis | undefined;
  try {
    const path = resolve(values.manifest);
    if (!values.apply) {
      const manifest = await dryRun(prisma);
      writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      console.log(JSON.stringify({ mode: 'dry-run', sha256: digest(manifest), counts: manifest.counts }));
      return;
    }
    ensure(process.getuid?.() === 0, 'apply 仅允许治理管理身份执行');
    ensure(values.sha256 && values['backup-proof'], 'apply 必须提供原 --sha256 与 --backup-proof');
    privateFile(path);
    privateFile(values['backup-proof']);
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as Manifest;
    ensure(digest(manifest) === values.sha256, 'manifest 校验值不匹配');
    const proof = JSON.parse(readFileSync(values['backup-proof'], 'utf8')) as {
      version: number; manifestSha256: string; dumpPath: string; dumpSha256: string;
      restoreVerified: boolean; restoreEvidencePath: string; restoreEvidenceSha256: string;
    };
    ensure(proof.version === 1 && proof.manifestSha256 === values.sha256 && proof.restoreVerified === true, '备份证明未绑定原 manifest 或缺少恢复演练');
    privateFile(proof.dumpPath);
    privateFile(proof.restoreEvidencePath);
    ensure(await hashFile(proof.dumpPath) === proof.dumpSha256, '备份文件校验失败');
    ensure(await hashFile(proof.restoreEvidencePath) === proof.restoreEvidenceSha256, '恢复证据校验失败');
    ensure(process.env.CLEANUP_REDIS_URL, '必须显式注入 CLEANUP_REDIS_URL 用于定向缓存失效');
    redis = new Redis(process.env.CLEANUP_REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null });
    redis.on('error', () => undefined);
    await redis.connect();
    const result = await apply(prisma, manifest, values.sha256, proof.dumpSha256);
    await invalidate(prisma, redis, manifest, values.sha256);
    console.log(JSON.stringify({ mode: 'apply', ...result, cacheInvalidation: 'complete' }));
  } finally {
    redis?.disconnect();
    await prisma.$disconnect();
  }
}
void main().catch(() => {
  // Prisma/Redis 异常可能带连接信息；管理入口使用私有证据定位，不输出异常对象。
  console.error('清理失败，未完成验收；检查私有 manifest/备份证明、范围漂移或缓存重试。禁止改换范围强行重试。');
  process.exitCode = 1;
});
