import { execFileSync, ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { withResources, unusedPort, stopChild } from './e2e-resources';
import { ensure } from './webe2e-cleanup';
import { createDiscussionFixtures } from './discussion-fixtures';
import type { E2EManifest } from './e2e-guard';
import { MobileReleasePublication } from '../src/mobile-releases/mobile-release-publication';
import { MobileReleasesService } from '../src/mobile-releases/mobile-releases.service';
import { AuditService } from '../src/moderation/audit.service';
import { PrismaService } from '../src/prisma/prisma.service';

const SUITES: Record<string, [string, string]> = {
  'thread-identity': ['thread-identity.integration.ts', 'THREAD_IDENTITY_TEST_ENV'],
  'app-downloads': ['app-downloads.integration.ts', 'APP_DOWNLOADS_TEST_ENV'],
  'discussion-navigation': ['discussion-navigation.integration.ts', 'DISCUSSION_NAVIGATION_TEST_ENV'],
  'private-invite-reuse': ['private-invite-reuse.integration.ts', 'PRIVATE_INVITE_REUSE_TEST_ENV'],
  'profile-follow-counts': ['profile-follow-counts.integration.ts', 'PROFILE_FOLLOW_COUNTS_TEST_ENV'],
  'post-edited-time': ['post-edited-time.integration.ts', 'POST_EDITED_TIME_TEST_ENV'],
  'mobile-releases': ['mobile-releases.integration.ts', 'MOBILE_RELEASE_TEST_ENV'],
  gallery: ['image-gallery.integration.ts', 'IMAGE_GALLERY_TEST_ENV'],
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
  ensure(options.every((o) => ['--api', '--full', '--block-search-only', '--admin-fixtures', '--mobile-release-fixtures', '--source', '--discussion-fixtures'].includes(o) || (o.startsWith('--suite=') && Object.hasOwn(SUITES, o.slice(8)))), '非法 runner 参数');
  ensure(command.length > 0 || options.length > 0, '使用 --api / --full 或 -- <测试命令>');
  ensure(!options.includes('--admin-fixtures') || command.length > 0, '--admin-fixtures 必须配合本轮消费者命令');
  ensure(!options.includes('--mobile-release-fixtures') || options.includes('--admin-fixtures'), '--mobile-release-fixtures 需要 --admin-fixtures');
  ensure(!options.includes('--discussion-fixtures') || (command.length > 0 && !options.some(o => o === '--full' || o.startsWith('--suite='))), '--discussion-fixtures 仅配合独立消费者命令');
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
      let adminFixturesPath: string | undefined;
      let adminMailboxPath: string | undefined;
      if (options.includes('--admin-fixtures')) {
        adminMailboxPath = join(r.root, 'admin-mailbox'); mkdirSync(adminMailboxPath, { mode: 0o700 });
        const accounts = [];
        for (const role of ['ADMIN', 'SUPER_ADMIN'] as const) {
          const adminName = `e2e_${role.toLowerCase()}_${randomBytes(6).toString('hex')}`;
          const adminPassword = `E2e!${randomBytes(20).toString('hex')}`;
          const adminEmail = `${adminName}@e2e.invalid`;
          const account = await db.user.create({ data: { username: adminName, email: adminEmail, password: await argon2.hash(adminPassword), role } });
          accounts.push({ role, userId: account.id, email: adminEmail, password: adminPassword });
        }
        adminFixturesPath = join(r.root, 'admin-fixtures.json');
        writeFileSync(adminFixturesPath, JSON.stringify({ version: 1, runId: r.runId, mailboxPath: adminMailboxPath, accounts }), { mode: 0o600, flag: 'wx' });
      }
      const category = await db.threadCategoryDefinition.findFirstOrThrow({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
      const thread = await db.thread.create({ data: { ownerId: user.id, title: '隔离参考主题', category: category.slug, published: true, publishedAt: new Date(), members: { create: { userId: user.id, role: 'OWNER', playerMarked: true } } } });
      const sub = await db.subthread.create({ data: { threadId: thread.id, title: '默认子贴' } });
      await db.post.create({ data: { authorId: user.id, threadId: thread.id, subthreadId: sub.id, kind: 'BODY', content: '隔离参考正文 test' } });
      await db.thread.update({ where: { id: thread.id }, data: { defaultSubthreadId: sub.id } });
      const port = await unusedPort(); const backendURL = `http://127.0.0.1:${port}`;
      const manifestPath = join(r.root, 'manifest.json'); const privateEnvPath = join(r.root, 'private.env.json');
      const appUrl = new URL(ownerUrl); appUrl.username = 'wenyousite_app'; appUrl.password = appPassword;
      let discussionFixturesPath: string | undefined;
      if (options.includes('--discussion-fixtures')) {
        await r.verify();
        const fixtureDb = new PrismaClient({ datasourceUrl: appUrl.toString(), log: [] });
        try {
          const fixture = await createDiscussionFixtures(fixtureDb, user.id);
          discussionFixturesPath = join(r.root, 'discussion-fixtures.json');
          writeFileSync(discussionFixturesPath, JSON.stringify({ version: 1, runId: r.runId, ...fixture }), { mode: 0o600, flag: 'wx' });
        } finally { await fixtureDb.$disconnect(); }
      }
      let releaseFixturesPath: string | undefined;
      if (options.includes('--mobile-release-fixtures')) {
        await r.verify();
        const fixtureDb = new PrismaClient({ datasourceUrl: appUrl.toString(), log: [] });
        try {
          const superAdmin = await fixtureDb.user.findFirstOrThrow({ where: { role: 'SUPER_ADMIN' } });
          const actor = { id: superAdmin.id, username: superAdmin.username, role: 'SUPER_ADMIN' as const };
          const releaseService = new MobileReleasesService(fixtureDb as unknown as PrismaService, new AuditService(fixtureDb as unknown as PrismaService));
          const published = await releaseService.create(actor, { platform: 'android', versionName: '0.0.0-e2e.100', buildNumber: 100, summary: '已发布隔离摘要', items: ['已发布隔离条目'] }, {});
          await releaseService.confirm(actor, published.id, published.revision, {});
          const publication = new MobileReleasePublication(fixtureDb); const operationId = randomUUID();
          await publication.begin({ platform: 'android', versionName: published.versionName, buildNumber: published.buildNumber, confirmedRevision: 1, operationId, apkSha256: 'a'.repeat(64), apkSize: '1', updateUrl: 'https://wenyou-apk.cn-nb1.rains3.com/mobile/android/wenyou-0.0.0-e2e.100-100.apk' });
          await publication.transition(operationId, 'publish'); await publication.transition(operationId, 'commit'); await publication.transition(operationId, 'finish');
          const draft = await releaseService.create(actor, { platform: 'android', versionName: '0.0.0-e2e.101', buildNumber: 101, summary: '待确认隔离摘要', items: ['待确认隔离条目'] }, {});
          releaseFixturesPath = join(r.root, 'mobile-release-fixtures.json');
          writeFileSync(releaseFixturesPath, JSON.stringify({ version: 1, runId: r.runId, published: await releaseService.get(published.id), draft }), { mode: 0o600, flag: 'wx' });
        } finally { await fixtureDb.$disconnect(); }
      }
      const env: NodeJS.ProcessEnv = {
        ...r.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port),
        DATABASE_URL: appUrl.toString(), DIRECT_DATABASE_URL: appUrl.toString(),
        REDIS_HOST: '127.0.0.1', REDIS_PORT: String(r.redisPort), REDIS_DB: '0', REDIS_PASSWORD: r.redisPassword,
        JWT_ACCESS_SECRET: randomBytes(32).toString('hex'), ADMIN_CHALLENGE_PEPPER: randomBytes(32).toString('hex'),
        PREVIEW_MAILBOX_DIR: adminMailboxPath ?? '',
        E2E_ADMIN_FIXTURES: adminFixturesPath ?? '',
        E2E_MOBILE_RELEASE_FIXTURES: releaseFixturesPath ?? '',
        E2E_DISCUSSION_FIXTURES: discussionFixturesPath ?? '',
        PUSH_ENABLED: 'false', SENTRY_DSN: '', SES_SMTP_HOST: '', SES_SMTP_USER: '', SES_SMTP_PASS: '',
        COS_ENDPOINT: '', COS_BUCKET: '', COS_ACCESS_KEY_ID: '', COS_SECRET_ACCESS_KEY: '', GOOGLE_APPLICATION_CREDENTIALS: '',
        ENABLE_API_DOCS: 'false', LOG_LEVEL: 'info', BUILD_SHA: 'e'.repeat(40),
        APP_URL: backendURL, WEB_APP_URL: backendURL, CORS_ORIGINS: backendURL,
        E2E_RUN_ID: r.runId, E2E_MANIFEST: manifestPath, E2E_PRIVATE_ENV: privateEnvPath,
        E2E_BACKEND_URL: backendURL, API_BASE: `${backendURL}/api/v1`, API_E2E_ENV: 'test',
        E2E_USERNAME: username, E2E_EMAIL: email, E2E_PASSWORD: password, E2E_USER_ID: user.id,
      };
      const webEnv = Object.fromEntries(['E2E_RUN_ID', 'E2E_MANIFEST', 'E2E_PRIVATE_ENV', 'E2E_BACKEND_URL', 'API_BASE', 'E2E_USERNAME', 'E2E_EMAIL', 'E2E_PASSWORD', 'E2E_USER_ID', 'E2E_ADMIN_FIXTURES', 'E2E_MOBILE_RELEASE_FIXTURES', 'E2E_DISCUSSION_FIXTURES'].map((key) => [key, env[key]]));
      writeFileSync(privateEnvPath, JSON.stringify(webEnv), { flag: 'wx', mode: 0o600 });
      const app = r.spawn(process.execPath, options.includes('--source') ? ['--require', require.resolve('ts-node/register/transpile-only'), join(REPOSITORY, 'src/main.ts')] : [join(REPOSITORY, 'dist/main.js')], { ...env, TS_NODE_PROJECT: join(REPOSITORY, 'tsconfig.json') });
      try { await health(backendURL, app); } catch (error) {
        const failureLog = `/tmp/wenyousite-e2e-startup-${r.runId}.log`;
        writeFileSync(failureLog, readFileSync(r.logPath(app)), { flag: 'wx', mode: 0o600 });
        console.error(JSON.stringify({event:'startup-failed',runId:r.runId,privateLog:failureLog})); throw error;
      }
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
          // 清理隔离资源前保留同轮后端诊断；仅私有文件，不把响应内部信息输出到终端。
          writeFileSync(`/tmp/wenyousite-e2e-backend-failure-${r.runId}.log`, readFileSync(r.logPath(app)), { flag: 'wx', mode: 0o600 });
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
      const httpSuites = ['thread-identity', 'discussion-navigation', 'private-invite-reuse', 'gallery', 'profile-follow-counts', 'post-edited-time'];
      for (const key of suites.filter(key => httpSuites.includes(key))) {
        const [script, flag] = SUITES[key];
        await runScript(script, { [flag]: 'test' });
      }
      if (suites.length) await stopChild(app);
      for (const key of suites.filter(key => !httpSuites.includes(key))) {
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
