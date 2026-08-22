import { execFileSync, spawn, ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const REFERENCE_USER_ID = 'cms5zycb900017q0azar1nag2';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function databaseUrl(base: URL, database: string) {
  const url = new URL(base);
  url.pathname = `/${database}`;
  url.searchParams.set('schema', 'public');
  return url.toString();
}

async function waitForHealth(url: string, child: ChildProcess) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`隔离后端提前退出 code=${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // 等待监听端口建立。
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(`隔离后端未在 30 秒内健康: ${url}`);
}

function waitForExit(child: ChildProcess, timeoutMs: number) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolveExit, reject) => {
      if (child.exitCode !== null) {
        resolveExit({ code: child.exitCode, signal: child.signalCode });
        return;
      }
      const timeout = setTimeout(() => reject(new Error('后端未在停机超时内退出')), timeoutMs);
      child.once('exit', (code, signal) => {
        clearTimeout(timeout);
        resolveExit({ code, signal });
      });
    },
  );
}

async function seedReferenceData(prisma: PrismaClient) {
  const category = await prisma.threadCategoryDefinition.findFirst({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  });
  assert(category, '迁移后缺少启用的主题分类');
  await prisma.user.create({
    data: {
      id: REFERENCE_USER_ID,
      email: 'testuser@e2e.invalid',
      username: 'testuser',
      password: 'unused-in-isolated-e2e',
    },
  });
  const thread = await prisma.thread.create({
    data: {
      title: '隔离 E2E 参考主题',
      ownerId: REFERENCE_USER_ID,
      category: category.slug,
      published: true,
      publishedAt: new Date(),
      members: {
        create: { userId: REFERENCE_USER_ID, role: 'OWNER', playerMarked: true },
      },
    },
  });
  const subthread = await prisma.subthread.create({
    data: {
      threadId: thread.id,
      title: '默认子贴',
      sortOrder: 0,
      postingPolicy: 'PARTICIPANTS',
    },
  });
  await prisma.post.create({
    data: {
      threadId: thread.id,
      subthreadId: subthread.id,
      authorId: REFERENCE_USER_ID,
      kind: 'BODY',
      content: '隔离 E2E 参考正文 test',
    },
  });
  await prisma.thread.update({
    where: { id: thread.id },
    data: { defaultSubthreadId: subthread.id },
  });
}

async function main() {
  assert(process.env.API_E2E_ISOLATED_ENV === 'test', 'API_E2E_ISOLATED_ENV 必须显式设为 test');
  const sourceUrl = process.env.DATABASE_URL;
  assert(sourceUrl, '隔离 E2E 缺少 DATABASE_URL');
  const base = new URL(sourceUrl);
  assert(LOOPBACK_HOSTS.has(base.hostname), '隔离 E2E 只允许连接 loopback PostgreSQL');
  const redisHost = process.env.REDIS_HOST ?? '127.0.0.1';
  const redisPort = Number(process.env.REDIS_PORT ?? 6379);
  assert(LOOPBACK_HOSTS.has(redisHost), '隔离 E2E 只允许连接 loopback Redis');
  assert(Number(process.env.REDIS_DB ?? 0) !== 15, 'Redis DB 15 已被运行环境占用，拒绝清空');

  const suffix = `${Date.now()}_${process.pid}_${randomBytes(3).toString('hex')}`;
  const testDatabase = `wenyousite_e2e_${suffix}`;
  assert(/^wenyousite_e2e_[a-z0-9_]+$/.test(testDatabase), '生成了非法测试数据库名');
  const admin = new PrismaClient({ datasourceUrl: databaseUrl(base, 'postgres') });
  const testUrl = databaseUrl(base, testDatabase);
  const redis = new Redis({ host: redisHost, port: redisPort, db: 15, lazyConnect: true });
  let app: ChildProcess | null = null;
  let output = '';
  let testError: unknown;

  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${testDatabase}"`);
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: testUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const prisma = new PrismaClient({ datasourceUrl: testUrl });
    try {
      await seedReferenceData(prisma);
    } finally {
      await prisma.$disconnect();
    }

    await redis.connect();
    assert((await redis.dbsize()) === 0, 'Redis DB 15 非空，拒绝覆盖非测试数据');
    const port = 31_000 + (process.pid % 1_000);
    const appEnv = {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      DATABASE_URL: testUrl,
      REDIS_HOST: redisHost,
      REDIS_PORT: String(redisPort),
      REDIS_DB: '15',
      JWT_ACCESS_SECRET: 'isolated-e2e-access-secret-at-least-32-characters',
      ADMIN_CHALLENGE_PEPPER: 'isolated-e2e-admin-challenge-pepper',
      ENABLE_API_DOCS: 'false',
      PUSH_ENABLED: 'false',
      SENTRY_DSN: '',
      COS_ENDPOINT: '',
      COS_BUCKET: '',
      COS_ACCESS_KEY_ID: '',
      COS_SECRET_ACCESS_KEY: '',
      LOG_LEVEL: 'info',
      BUILD_SHA: 'e'.repeat(40),
      APP_URL: `http://127.0.0.1:${port}`,
      CORS_ORIGINS: `http://127.0.0.1:${port}`,
      WEB_APP_URL: `http://127.0.0.1:${port}`,
    };
    app = spawn(process.execPath, [resolve('dist/main.js')], {
      cwd: process.cwd(),
      env: appEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const collect = (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-30_000);
    };
    app.stdout?.on('data', collect);
    app.stderr?.on('data', collect);
    const apiBase = `http://127.0.0.1:${port}/api/v1`;
    await waitForHealth(`${apiBase}/health`, app);

    execFileSync('pnpm', ['exec', 'tsx', 'scripts/api-e2e-test.ts'], {
      cwd: process.cwd(),
      env: {
        ...appEnv,
        API_E2E_ENV: 'test',
        API_BASE: apiBase,
      },
      stdio: 'inherit',
    });

    app.kill('SIGTERM');
    const exited = await waitForExit(app, 30_000);
    assert(
      exited.code === 0 || exited.signal === 'SIGTERM',
      `隔离后端未干净退出 code=${exited.code} signal=${exited.signal}`,
    );
    assert(output.includes('Application shutdown completed'), '停机日志缺少生命周期完成记录');
    app = null;
  } catch (error) {
    testError = error;
  } finally {
    if (app) {
      app.kill('SIGTERM');
      try {
        await waitForExit(app, 10_000);
      } catch {
        app.kill('SIGKILL');
      }
    }
    if (redis.status === 'ready') await redis.flushdb();
    redis.disconnect();
    await admin.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${testDatabase}'`,
    );
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${testDatabase}"`);
    await admin.$disconnect();
  }

  if (testError) {
    const message = testError instanceof Error ? testError.message : String(testError);
    throw new Error(`${message}\n隔离后端最近日志:\n${output}`);
  }
  console.log('Isolated API E2E and graceful shutdown passed');
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
