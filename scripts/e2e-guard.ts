import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import assert from 'node:assert/strict';

export interface E2EManifest {
  version: 1; runId: string; state: 'ready'; backendURL: string; apiBase: string;
  privateEnvPath: string; resourcesPath: string; uploadPath: string;
  postgres: { host: '127.0.0.1'; port: number; database: string; clusterName: string };
  redis: { host: '127.0.0.1'; port: number; instanceId: string };
}
function registration<T>(path: string): T {
  try { return JSON.parse(readFileSync(path, 'utf8')) as T; } catch { throw new Error('隔离登记文件读取或解析失败'); }
}
function safeURL(value: string) {
  try { return new URL(value); } catch { throw new Error('隔离连接地址非法（输入已隐藏）'); }
}
export function assertIsolatedEnvironment(env: NodeJS.ProcessEnv = process.env): E2EManifest {
  assert(env.E2E_MANIFEST && env.E2E_RUN_ID, '必须由隔离 runner 提供 E2E_MANIFEST/E2E_RUN_ID');
  const path = realpathSync(env.E2E_MANIFEST);
  const stat = lstatSync(env.E2E_MANIFEST);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid?.() && (stat.mode & 0o077) === 0, 'manifest 必须是本身份的私有普通文件');
  const m = registration<E2EManifest>(path);
  assert(m.version === 1 && m.state === 'ready' && /^e2e_[a-f0-9]{24}$/.test(m.runId) && m.runId === env.E2E_RUN_ID, '隔离登记身份不匹配');
  const root = dirname(path);
  assert((lstatSync(root).mode & 0o777) === 0o700, '隔离目录必须为 0700');
  assert(m.resourcesPath === join(root, 'resources.json') && m.privateEnvPath === join(root, 'private.env.json') && m.uploadPath === join(root, 'uploads'), 'manifest 路径必须限定于本次目录');
  assert(m.postgres.host === '127.0.0.1' && m.postgres.clusterName === m.runId && m.redis.host === '127.0.0.1', '数据服务身份不匹配');
  const own = registration<{ runId: string; root: string; uid: number }>(join(root, 'ownership.json'));
  assert(own.runId === m.runId && own.root === realpathSync(root) && own.uid === process.getuid?.(), '隔离资源所有权不匹配');
  const resources = registration<{ runId: string; root: string; pgPort: number; redisPort: number; redisInstance: string }>(m.resourcesPath);
  assert(resources.runId === m.runId && resources.root === root && resources.pgPort === m.postgres.port && resources.redisPort === m.redis.port && resources.redisInstance === m.redis.instanceId, '隔离资源登记漂移');
  const url = safeURL(env.DATABASE_URL ?? '');
  assert(url.hostname === '127.0.0.1' && +url.port === m.postgres.port && m.postgres.port !== 5432 && url.pathname === `/${m.postgres.database}`, '数据库必须属于本次独立进程');
  assert(url.username === 'e2e_owner' || url.username === 'wenyousite_app', '非法隔离数据库身份');
  assert(env.DIRECT_DATABASE_URL === env.DATABASE_URL, '禁止继承线上 migration 凭据');
  assert(env.REDIS_HOST === '127.0.0.1' && Number(env.REDIS_PORT) === m.redis.port && m.redis.port !== 6379 && env.REDIS_DB === '0' && env.REDIS_PASSWORD, 'Redis 必须属于本次独立进程');
  assert(env.NODE_ENV === 'test' && env.PUSH_ENABLED === 'false' && !env.SENTRY_DSN && !env.COS_ENDPOINT && !env.SES_SMTP_PASS && !env.GOOGLE_APPLICATION_CREDENTIALS, '测试副作用配置不安全');
  const api = safeURL(m.backendURL);
  assert(api.hostname === '127.0.0.1' && api.protocol === 'http:' && api.port && api.port !== '3000', '非法测试后端地址');
  assert(env.API_BASE === m.apiBase && m.apiBase === `${m.backendURL}/api/v1`, 'API 地址未绑定本次登记');
  return m;
}
/** 在测试首次写入之前验证实际数据进程，不能仅凭配置文件、名称或 loopback 放行。 */
export async function verifyIsolatedEnvironment() {
  const m = assertIsolatedEnvironment();
  const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL, log: [] });
  const redis = new Redis({ host: '127.0.0.1', port: m.redis.port, password: process.env.REDIS_PASSWORD, lazyConnect: true, retryStrategy: () => null, maxRetriesPerRequest: 1 });
  redis.on('error', () => undefined);
  try {
    const rows = await prisma.$queryRaw<Array<{ cluster_name: string }>>`SHOW cluster_name`;
    assert.equal(rows[0]?.cluster_name, m.runId, 'PostgreSQL 进程身份不匹配');
    await redis.connect();
    assert((await redis.info('server')).includes(`run_id:${m.redis.instanceId}\r\n`), 'Redis 实例不匹配');
    assert.equal(await redis.get('e2e:ownership'), m.runId, 'Redis 所有权不匹配');
  } finally { redis.disconnect(); await prisma.$disconnect(); }
}
