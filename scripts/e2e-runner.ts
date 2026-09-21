import { execFileSync, ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { withResources, unusedPort, stopChild } from './e2e-resources';
import { ensure } from './webe2e-cleanup';
import type { E2EManifest } from './e2e-guard';

const SUITES: Record<string, [string, string]> = {
  auth: ['auth-terminal-e2e.ts', 'AUTH_TERMINAL_E2E_ENV'],
  economy: ['economy-terminal-e2e.ts', 'ECONOMY_TERMINAL_E2E_ENV'],
  media: ['media-reclamation.integration.ts', 'MEDIA_RECLAMATION_TEST_ENV'],
  ranking: ['thread-ranking.integration.ts', 'THREAD_RANKING_TEST_ENV'],
  admin: ['admin-console.integration.ts', 'ADMIN_CONSOLE_TEST_ENV'],
  'admin-session': ['admin-session.integration.ts', 'ADMIN_SESSION_TEST_ENV'],
  display: ['media-display.integration.ts', 'MEDIA_DISPLAY_TEST_ENV'],
  bookmarks: ['bookmark-folder-management.integration.ts', 'BOOKMARK_MANAGEMENT_TEST_ENV'],
  'bookmark-count': ['bookmark-visible-count.integration.ts', 'BOOKMARK_COUNT_TEST_ENV'],
  search: ['search-benchmark.ts', 'SEARCH_BENCHMARK_ENV'],
};
const REPOSITORY = resolve(__dirname, '..');
function exited(child: ChildProcess) {
  return new Promise<number | null>((ok, fail) => {
    if (child.exitCode !== null || child.signalCode !== null) return ok(child.exitCode);
    child.once('error', fail); child.once('exit', ok);
  });
}
async function health(url: string, child: ChildProcess) {
  for (let attempt = 0; attempt < 120; attempt++) {
    ensure(child.exitCode === null && child.signalCode === null, '隔离后端提前退出');
    try { if ((await fetch(`${url}/api/v1/health`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* 等待独立进程就绪。 */ }
    await new Promise((ok) => setTimeout(ok, 500));
  }
  throw new Error('隔离后端启动超时');
}
export async function run(args = process.argv.slice(2)) {
  const boundary = args.indexOf('--');
  const options = boundary < 0 ? args : args.slice(0, boundary);
  const command = boundary < 0 ? [] : args.slice(boundary + 1);
  ensure(options.every((o) => ['--api', '--full', '--block-search-only'].includes(o) || (o.startsWith('--suite=') && Object.hasOwn(SUITES, o.slice(8)))), '非法 runner 参数');
  ensure(command.length > 0 || options.length > 0, '使用 --api / --full 或 -- <测试命令>');
  const completedRunId = await withResources(async (r) => {
    const owner = new PrismaClient({ datasourceUrl: r.databaseUrl, log: [] });
    const databaseName = `wenyousite_${r.runId}`;
    const ownerUrl = new URL(r.databaseUrl); ownerUrl.pathname = `/${databaseName}`;
    const appPassword = randomBytes(32).toString('hex');
    const db = new PrismaClient({ datasourceUrl: ownerUrl.toString(), log: [] });
    try {
      await r.verify();
      ensure(/^wenyousite_e2e_[a-f0-9]+$/.test(databaseName), '非法随机库名');
      await owner.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
      execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(REPOSITORY, 'prisma/schema.prisma')], {
        cwd: r.root, env: { ...r.env, DATABASE_URL: ownerUrl.toString(), DIRECT_DATABASE_URL: ownerUrl.toString() }, stdio: 'pipe',
      });
      // 口令由本进程产生为 hex，无法引入 SQL；应用角色无 superuser/createdb 权限。
      await owner.$executeRawUnsafe(`CREATE ROLE wenyousite_app LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
      await db.$executeRaw`GRANT USAGE ON SCHEMA public TO wenyousite_app`;
      await db.$executeRaw`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wenyousite_app`;
      await db.$executeRaw`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO wenyousite_app`;
      const username = `e2e_${randomBytes(6).toString('hex')}`;
      const password = `E2e!${randomBytes(20).toString('hex')}`;
      const email = `${username}@e2e.invalid`;
      const user = await db.user.create({ data: { username, email, password: await argon2.hash(password) } });
      const category = await db.threadCategoryDefinition.findFirstOrThrow({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
      const thread = await db.thread.create({ data: { ownerId: user.id, title: '隔离参考主题', category: category.slug, published: true, publishedAt: new Date(), members: { create: { userId: user.id, role: 'OWNER', playerMarked: true } } } });
      const sub = await db.subthread.create({ data: { threadId: thread.id, title: '默认子贴' } });
      await db.post.create({ data: { authorId: user.id, threadId: thread.id, subthreadId: sub.id, kind: 'BODY', content: '隔离参考正文 test' } });
      await db.thread.update({ where: { id: thread.id }, data: { defaultSubthreadId: sub.id } });
      const port = await unusedPort(); const backendURL = `http://127.0.0.1:${port}`;
      const manifestPath = join(r.root, 'manifest.json'); const privateEnvPath = join(r.root, 'private.env.json');
      const appUrl = new URL(ownerUrl); appUrl.username = 'wenyousite_app'; appUrl.password = appPassword;
      const env: NodeJS.ProcessEnv = {
        ...r.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port),
        DATABASE_URL: appUrl.toString(), DIRECT_DATABASE_URL: appUrl.toString(),
        REDIS_HOST: '127.0.0.1', REDIS_PORT: String(r.redisPort), REDIS_DB: '0', REDIS_PASSWORD: r.redisPassword,
        JWT_ACCESS_SECRET: randomBytes(32).toString('hex'), ADMIN_CHALLENGE_PEPPER: randomBytes(32).toString('hex'),
        PUSH_ENABLED: 'false', SENTRY_DSN: '', SES_SMTP_HOST: '', SES_SMTP_USER: '', SES_SMTP_PASS: '',
        COS_ENDPOINT: '', COS_BUCKET: '', COS_ACCESS_KEY_ID: '', COS_SECRET_ACCESS_KEY: '', GOOGLE_APPLICATION_CREDENTIALS: '',
        ENABLE_API_DOCS: 'false', LOG_LEVEL: 'info', BUILD_SHA: 'e'.repeat(40),
        APP_URL: backendURL, WEB_APP_URL: backendURL, CORS_ORIGINS: backendURL,
        E2E_RUN_ID: r.runId, E2E_MANIFEST: manifestPath, E2E_PRIVATE_ENV: privateEnvPath,
        E2E_BACKEND_URL: backendURL, API_BASE: `${backendURL}/api/v1`, API_E2E_ENV: 'test',
        E2E_USERNAME: username, E2E_EMAIL: email, E2E_PASSWORD: password, E2E_USER_ID: user.id,
      };
      const webEnv = Object.fromEntries(['E2E_RUN_ID', 'E2E_MANIFEST', 'E2E_PRIVATE_ENV', 'E2E_BACKEND_URL', 'API_BASE', 'E2E_USERNAME', 'E2E_EMAIL', 'E2E_PASSWORD', 'E2E_USER_ID'].map((key) => [key, env[key]]));
      writeFileSync(privateEnvPath, JSON.stringify(webEnv), { flag: 'wx', mode: 0o600 });
      const app = r.spawn(process.execPath, [join(REPOSITORY, 'dist/main.js')], env);
      await health(backendURL, app);
      const resources = JSON.parse(readFileSync(join(r.root, 'resources.json'), 'utf8'));
      const manifest: E2EManifest = { version: 1, runId: r.runId, state: 'ready', backendURL, apiBase: env.API_BASE!,
        privateEnvPath, resourcesPath: join(r.root, 'resources.json'), uploadPath: join(r.root, 'uploads'),
        postgres: { host: '127.0.0.1', port: +ownerUrl.port, database: databaseName, clusterName: r.runId },
        redis: { host: '127.0.0.1', port: r.redisPort, instanceId: resources.redisInstance },
      };
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
      console.log(JSON.stringify({ event: 'ready', runId: r.runId, manifestPath, backendURL }));
      const backendTestEnv = { ...env, DATABASE_URL: ownerUrl.toString(), DIRECT_DATABASE_URL: ownerUrl.toString(), BOOKMARK_COUNT_TEST_APP_URL: appUrl.toString(), BOOKMARK_MANAGEMENT_TEST_APP_URL: appUrl.toString() };
      const runScript = async (script: string, extra: NodeJS.ProcessEnv = {}) => {
        await r.verify();
        console.log(`验证：${script}`);
        const child = r.spawn(process.execPath, ['--require', require.resolve('ts-node/register/transpile-only'), join(REPOSITORY, 'scripts', script)], { ...backendTestEnv, ...extra, TS_NODE_PROJECT: join(REPOSITORY, 'tsconfig.json') }, REPOSITORY);
        const code = await exited(child);
        if (code !== 0) {
          const failureLog = `/tmp/wenyousite-e2e-failure-${r.runId}.log`;
          writeFileSync(failureLog, readFileSync(r.logPath(child)), { flag: 'wx', mode: 0o600 });
          console.error(`隔离验证失败：${script}；私有诊断 ${failureLog}`);
          throw new Error('测试失败');
        }
        console.log(`通过：${script}`);
      };
      if (options.includes('--api') || options.includes('--full') || options.includes('--block-search-only')) {
        for (const script of options.includes('--block-search-only') ? ['block-search.e2e.ts'] : ['api-e2e-test.ts', 'block-search.e2e.ts', 'main-post-policy.e2e.ts']) await runScript(script);
      }
      const suites = options.includes('--full') ? Object.keys(SUITES).filter((key) => key !== 'search')
        : options.filter((o) => o.startsWith('--suite=')).map((o) => o.slice(8));
      if (suites.length) await stopChild(app);
      for (const key of suites) {
        const [script, flag] = SUITES[key];
        await runScript(script, { [flag]: 'test' });
      }
      if (command.length) {
        await r.verify();
        // 外部消费者只获得网页账号及 manifest，不获得数据库 owner 或应用密钥。
        const child = r.spawn(command[0], command.slice(1), { ...r.env, ...webEnv }, REPOSITORY);
        ensure(await exited(child) === 0, '消费者测试命令失败');
      }
      await stopChild(app);
      const lifecycleObserved = readFileSync(r.logPath(app), 'utf8').includes('Application shutdown completed');
      if (!(app.exitCode === 0 || app.signalCode === 'SIGTERM') || !lifecycleObserved) {
        const log = `/tmp/wenyousite-e2e-shutdown-${r.runId}.log`;
        writeFileSync(log, readFileSync(r.logPath(app)), { flag: 'wx', mode: 0o600 });
        console.error(JSON.stringify({ event: 'shutdown-failed', code: app.exitCode, signal: app.signalCode, lifecycleObserved, privateLog: log }));
        throw new Error('隔离后端未完成正常停机');
      }
      return r.runId;
    } finally { await db.$disconnect(); await owner.$disconnect(); }
  });
  console.log(JSON.stringify({ event: 'passed', runId: completedRunId, resourcesCleaned: true }));
}
if (require.main === module) void run().catch(() => { console.error('隔离运行未完成验收；核对失败或残留登记，禁止回退到线上地址'); process.exitCode = 1; });
