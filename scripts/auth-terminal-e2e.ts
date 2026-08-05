import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { cp, copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';
import { VerificationCodeService } from '../src/auth/verification-code.service';
import { TransformInterceptor } from '../src/common/interceptors/response.interceptor';
import { VerifiedGuard } from '../src/common/guards/verified.guard';
import { EmailService } from '../src/email/email.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createOpenApiDocument } from '../src/common/swagger/openapi-document';

const TARGET_MIGRATIONS = new Set([
  '20260805130000_enforce_single_active_session_per_platform',
  '20260805143000_add_session_started_at',
  '20260805150000_scope_refresh_token_platform_check',
]);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function readEnvValue(source: string, key: string) {
  const match = source.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, '');
}

function testDatabaseUrl() {
  const fromProcess = process.env.DATABASE_URL;
  if (fromProcess) return fromProcess;
  const env = readFileSync(resolve('.env'), 'utf8');
  const fromFile = readEnvValue(env, 'DATABASE_URL');
  if (!fromFile) throw new Error('缺少 DATABASE_URL');
  return fromFile;
}

function schemaUrl(databaseUrl: string, schema: string) {
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schema);
  return url.toString();
}

async function prepareMigrationWorkspace() {
  const root = await mkdtemp(join(tmpdir(), 'wenyousite-auth-terminal-e2e-'));
  const prismaDir = join(root, 'prisma');
  const targetDir = join(prismaDir, 'migrations');
  const sourceDir = resolve('prisma');
  const sourceMigrations = join(sourceDir, 'migrations');
  await mkdir(targetDir, { recursive: true });
  await copyFile(join(sourceDir, 'schema.prisma'), join(prismaDir, 'schema.prisma'));
  await copyFile(
    join(sourceMigrations, 'migration_lock.toml'),
    join(targetDir, 'migration_lock.toml'),
  );

  const entries = await readdir(sourceMigrations, { withFileTypes: true });
  const migrationNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  for (const name of migrationNames) {
    if (TARGET_MIGRATIONS.has(name)) continue;
    await cp(join(sourceMigrations, name), join(targetDir, name), { recursive: true });
  }

  return {
    root,
    schemaPath: join(prismaDir, 'schema.prisma'),
    includeTargetMigrations: async () => {
      for (const name of TARGET_MIGRATIONS) {
        await cp(join(sourceMigrations, name), join(targetDir, name), { recursive: true });
      }
    },
  };
}

function deployMigrations(schemaPath: string, databaseUrl: string) {
  execFileSync(
    'pnpm',
    ['exec', 'prisma', 'migrate', 'deploy', '--schema', schemaPath],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

async function seedLegacyTerminalRows(admin: PrismaClient, schema: string) {
  const table = `"${schema}"`;
  await admin.$executeRawUnsafe(
    `INSERT INTO ${table}."users" ("id", "email", "username", "password", "updated_at")
     VALUES ('migration-user', 'migration@example.test', 'migration-user', 'unused', CURRENT_TIMESTAMP)`,
  );
  await admin.$executeRawUnsafe(
    `INSERT INTO ${table}."refresh_tokens"
      ("id", "user_id", "token_hash", "family", "platform", "device_info", "expires_at", "revoked_at", "created_at")
     VALUES
      ('history-web', 'migration-user', 'hash-history', 'family-web', 'web', NULL, CURRENT_TIMESTAMP + INTERVAL '1 day', CURRENT_TIMESTAMP - INTERVAL '90 minutes', CURRENT_TIMESTAMP - INTERVAL '2 hours'),
      ('web-old', 'migration-user', 'hash-web-old', 'family-old', 'web', NULL, CURRENT_TIMESTAMP + INTERVAL '1 day', NULL, CURRENT_TIMESTAMP - INTERVAL '1 hour'),
      ('web-new', 'migration-user', 'hash-web-new', 'family-web', 'web', NULL, CURRENT_TIMESTAMP + INTERVAL '1 day', NULL, CURRENT_TIMESTAMP - INTERVAL '10 minutes'),
      ('web-unknown', 'migration-user', 'hash-unknown', 'family-unknown', 'tablet', NULL, CURRENT_TIMESTAMP + INTERVAL '1 day', NULL, CURRENT_TIMESTAMP - INTERVAL '30 minutes'),
      ('web-expired', 'migration-user', 'hash-expired', 'family-expired', 'web', NULL, CURRENT_TIMESTAMP - INTERVAL '1 minute', NULL, CURRENT_TIMESTAMP - INTERVAL '5 minutes'),
      ('mobile-live', 'migration-user', 'hash-mobile', 'family-mobile', 'mobile', NULL, CURRENT_TIMESTAMP + INTERVAL '1 day', NULL, CURRENT_TIMESTAMP - INTERVAL '20 minutes')`,
  );
}

async function verifyTerminalMigrations(admin: PrismaClient, schema: string) {
  const rows = await admin.$queryRawUnsafe<Array<{
    id: string;
    platform: string;
    revoked_at: Date | null;
    created_at: Date;
    session_started_at: Date;
  }>>(
    `SELECT "id", "platform", "revoked_at", "created_at", "session_started_at"
     FROM "${schema}"."refresh_tokens" ORDER BY "id"`,
  );
  const active = rows.filter((row) => row.revoked_at === null);
  assert(active.filter((row) => row.platform === 'web').length === 1, '迁移后应只保留一个 Web 登录终端');
  assert(active.filter((row) => row.platform === 'mobile').length === 1, '迁移后应只保留一个移动端登录终端');
  assert(active.some((row) => row.id === 'web-new'), 'Web 端应保留最近登录的终端');
  assert(rows.every((row) => ['web', 'mobile'].includes(row.platform)), '历史平台值应规范化');
  assert(rows.every((row) => row.session_started_at instanceof Date), '登录时间应完成非空回填');

  const history = rows.find((row) => row.id === 'history-web');
  const current = rows.find((row) => row.id === 'web-new');
  assert(history && current, '应保留同 family 的历史和当前记录');
  assert(
    current.session_started_at.getTime() === history.created_at.getTime(),
    '同 family 轮转记录应回填最早登录时间',
  );

  const columns = await admin.$queryRawUnsafe<Array<{ is_nullable: string }>>(
    `SELECT is_nullable FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = 'refresh_tokens' AND column_name = 'session_started_at'`,
    schema,
  );
  assert(columns[0]?.is_nullable === 'NO', 'session_started_at 应为 NOT NULL');

  const indexes = await admin.$queryRawUnsafe<Array<{ indexname: string }>>(
    `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'refresh_tokens'`,
    schema,
  );
  assert(
    indexes.some((index) => index.indexname === 'refresh_tokens_user_id_platform_active_key'),
    '应创建每用户/平台唯一活跃终端索引',
  );

  await admin.$executeRawUnsafe(
    `INSERT INTO "${schema}"."users" ("id", "email", "username", "password", "updated_at")
     VALUES ('constraint-user', 'constraint@example.test', 'constraint-user', 'unused', CURRENT_TIMESTAMP)`,
  );
  let invalidPlatformRejected = false;
  try {
    await admin.$executeRawUnsafe(
      `INSERT INTO "${schema}"."refresh_tokens"
        ("id", "user_id", "token_hash", "family", "platform", "expires_at")
       VALUES ('invalid-platform', 'constraint-user', 'hash-invalid', 'family-invalid', 'tablet', CURRENT_TIMESTAMP + INTERVAL '1 day')`,
    );
  } catch {
    invalidPlatformRejected = true;
  }
  assert(invalidPlatformRejected, '数据库应拒绝未知终端平台');

  await admin.$executeRawUnsafe(
    `INSERT INTO "${schema}"."refresh_tokens"
      ("id", "user_id", "token_hash", "family", "platform", "expires_at")
     VALUES ('unique-web-1', 'constraint-user', 'hash-unique-1', 'family-unique-1', 'web', CURRENT_TIMESTAMP + INTERVAL '1 day')`,
  );
  let duplicatePlatformRejected = false;
  try {
    await admin.$executeRawUnsafe(
      `INSERT INTO "${schema}"."refresh_tokens"
        ("id", "user_id", "token_hash", "family", "platform", "expires_at")
       VALUES ('unique-web-2', 'constraint-user', 'hash-unique-2', 'family-unique-2', 'web', CURRENT_TIMESTAMP + INTERVAL '1 day')`,
    );
  } catch {
    duplicatePlatformRejected = true;
  }
  assert(duplicatePlatformRejected, '数据库应拒绝同用户的第二个活跃 Web 登录终端');
}

function refreshCookie(headers: Record<string, string | string[] | undefined>) {
  const raw = headers['set-cookie'];
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const value of values) {
    const match = value.match(/(?:^|,\s*)refreshToken=([^;]*)/);
    if (match?.[1]) return `refreshToken=${match[1]}`;
  }
  return null;
}

async function verifyRuntime(databaseUrl: string) {
  const jwtSecret = 'auth-terminal-e2e-access-secret-at-least-32-chars';
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const configValues: Record<string, unknown> = {
    'jwt.accessSecret': jwtSecret,
    'argon2.timeCost': 1,
    'argon2.memoryCost': 8192,
  };
  const config = { get: <T>(key: string) => configValues[key] as T };
  const moduleRef = await Test.createTestingModule({
    imports: [
      PassportModule.register({ defaultStrategy: 'jwt' }),
      JwtModule.register({ secret: jwtSecret, signOptions: { expiresIn: '15m' } }),
    ],
    controllers: [AuthController],
    providers: [
      AuthService,
      JwtStrategy,
      JwtAuthGuard,
      VerifiedGuard,
      { provide: PrismaService, useValue: prisma },
      { provide: ConfigService, useValue: config },
      { provide: EmailService, useValue: {} },
      { provide: VerificationCodeService, useValue: {} },
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    logger: false,
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalInterceptors(new TransformInterceptor());
  await app.register(fastifyCookie as never);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  try {
    const password = 'TerminalE2e123!';
    const user = await prisma.user.create({
      data: {
        email: `auth-terminal-${Date.now()}@example.test`,
        username: `terminal${Date.now()}`.slice(0, 24),
        password: await argon2.hash(password, { timeCost: 1, memoryCost: 8192 }),
        emailVerified: true,
      },
    });
    const server = app.getHttpAdapter().getInstance();
    const loginPayload = { account: user.email, password };

    const firstWebLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'x-client-platform': 'web', 'user-agent': 'E2E-Web/1.0' },
      payload: loginPayload,
    });
    assert(firstWebLogin.statusCode === 200, 'Web 登录应成功');
    const firstWebBody = firstWebLogin.json();
    assert(typeof firstWebBody.data?.accessToken === 'string', 'Web 登录应返回 access token');
    assert(!('refreshToken' in firstWebBody.data), 'Web 响应体不得暴露 refresh token');
    const firstWebCookie = refreshCookie(firstWebLogin.headers);
    assert(firstWebCookie, 'Web 登录应写入 httpOnly refresh cookie');

    const mobileLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'x-client-platform': 'mobile', 'user-agent': 'E2E-Mobile/1.0' },
      payload: loginPayload,
    });
    assert(mobileLogin.statusCode === 200, '移动端登录应成功');
    const mobileBody = mobileLogin.json();
    assert(typeof mobileBody.data?.refreshToken === 'string', '移动端响应体应返回 refresh token');
    assert(!refreshCookie(mobileLogin.headers), '移动端登录不应设置 Web refresh cookie');

    const mobileSessions = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: { authorization: `Bearer ${mobileBody.data.accessToken}` },
    });
    assert(mobileSessions.statusCode === 200, '移动端应能读取登录终端');
    const initialSessions = mobileSessions.json().data as Array<Record<string, unknown>>;
    assert(initialSessions.length === 2, '应同时存在 Web 和移动端两个登录终端');
    assert(initialSessions.some((session) => session.platform === 'web'), '列表应包含 Web 端');
    assert(
      initialSessions.some((session) => session.platform === 'mobile' && session.isCurrent === true),
      '移动端 access token 应正确标记当前终端',
    );

    const mobileBeforeRefresh = initialSessions.find((session) => session.platform === 'mobile');
    const mobileRefresh = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: mobileBody.data.refreshToken },
    });
    assert(mobileRefresh.statusCode === 200, '移动端 refresh 应成功');
    const refreshedMobileBody = mobileRefresh.json();
    assert(typeof refreshedMobileBody.data?.refreshToken === 'string', '移动端 refresh 应返回新 refresh token');
    assert(!refreshCookie(mobileRefresh.headers), '移动端 refresh 不应设置 Web cookie');

    const secondWebLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'x-client-platform': 'web', 'user-agent': 'E2E-Web/2.0' },
      payload: loginPayload,
    });
    assert(secondWebLogin.statusCode === 200, '第二次 Web 登录应成功');
    const secondWebBody = secondWebLogin.json();
    const secondWebCookie = refreshCookie(secondWebLogin.headers);
    assert(secondWebCookie, '第二次 Web 登录应返回新 cookie');

    const replacedWebRequest = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: { authorization: `Bearer ${firstWebBody.data.accessToken}` },
    });
    assert(replacedWebRequest.statusCode === 401, '同端新登录后旧 Web access token 应立即失效');

    const currentWebSessions = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: {
        authorization: `Bearer ${secondWebBody.data.accessToken}`,
        cookie: secondWebCookie,
      },
    });
    const webSessions = currentWebSessions.json().data as Array<Record<string, unknown>>;
    const webBeforeRefresh = webSessions.find((session) => session.platform === 'web');
    assert(webBeforeRefresh?.isCurrent === true, '新 Web access token 应正确标记当前终端');

    const webRefresh = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: secondWebCookie },
      payload: {},
    });
    assert(webRefresh.statusCode === 200, 'Web refresh 应成功');
    const webRefreshBody = webRefresh.json();
    assert(!('refreshToken' in webRefreshBody.data), 'Web refresh 响应体不得暴露 refresh token');
    const refreshedWebCookie = refreshCookie(webRefresh.headers);
    assert(refreshedWebCookie, 'Web refresh 应轮转 cookie');

    const sessionsAfterRefresh = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: {
        authorization: `Bearer ${webRefreshBody.data.accessToken}`,
        cookie: refreshedWebCookie,
      },
    });
    const refreshedSessions = sessionsAfterRefresh.json().data as Array<Record<string, unknown>>;
    const webAfterRefresh = refreshedSessions.find((session) => session.platform === 'web');
    assert(webAfterRefresh?.id === webBeforeRefresh?.id, 'Web refresh 后稳定终端 ID 不应变化');
    assert(
      webAfterRefresh?.signedInAt === webBeforeRefresh?.signedInAt,
      'Web refresh 后登录时间不应漂移',
    );
    const mobileTerminalId = mobileBeforeRefresh?.id;
    assert(typeof mobileTerminalId === 'string', '应取得移动端稳定终端 ID');

    const revokeMobile = await server.inject({
      method: 'DELETE',
      url: `/api/v1/auth/sessions/${mobileTerminalId}`,
      headers: { authorization: `Bearer ${webRefreshBody.data.accessToken}` },
    });
    assert(revokeMobile.statusCode === 200, 'Web 端应能退出移动端登录终端');

    const revokedMobileRequest = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: { authorization: `Bearer ${refreshedMobileBody.data.accessToken}` },
    });
    assert(revokedMobileRequest.statusCode === 401, '移动端被退出后 access token 应立即失效');

    const activeRows = await prisma.refreshToken.groupBy({
      by: ['platform'],
      where: { userId: user.id, revokedAt: null },
      _count: { _all: true },
    });
    assert(
      activeRows.length === 1 && activeRows[0].platform === 'web' && activeRows[0]._count._all === 1,
      '远程退出后数据库应只剩一个活跃 Web 登录终端',
    );

    const document = createOpenApiDocument(app);
    const schemas = document.components?.schemas as Record<string, { required?: string[] }> | undefined;
    assert(schemas?.SessionResponseDto?.required?.includes('signedInAt'), 'OpenAPI 应声明 signedInAt');
    assert(schemas?.SessionResponseDto?.required?.includes('lastActiveAt'), 'OpenAPI 应声明 lastActiveAt');
    assert(!schemas?.AuthResponseDto?.required?.includes('refreshToken'), 'OpenAPI 中 refreshToken 应为可选');
  } finally {
    await app.close();
    await prisma.$disconnect().catch(() => undefined);
  }
}

async function main() {
  if (process.env.AUTH_TERMINAL_E2E_ENV !== 'test') {
    throw new Error('AUTH_TERMINAL_E2E_ENV 必须显式设为 test');
  }
  const originalDatabaseUrl = testDatabaseUrl();
  const parsedDatabaseUrl = new URL(originalDatabaseUrl);
  if (!LOOPBACK_HOSTS.has(parsedDatabaseUrl.hostname)) {
    throw new Error('登录终端 E2E 只允许使用本机 PostgreSQL');
  }

  const schema = `auth_terminal_e2e_${process.pid}_${Date.now()}`;
  const isolatedUrl = schemaUrl(originalDatabaseUrl, schema);
  const admin = new PrismaClient({ datasourceUrl: originalDatabaseUrl });
  const workspace = await prepareMigrationWorkspace();
  let schemaCreated = false;
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    deployMigrations(workspace.schemaPath, isolatedUrl);
    await seedLegacyTerminalRows(admin, schema);
    await workspace.includeTargetMigrations();
    deployMigrations(workspace.schemaPath, isolatedUrl);
    await verifyTerminalMigrations(admin, schema);
    await verifyRuntime(isolatedUrl);
    process.stdout.write('登录终端 PostgreSQL 迁移与双端 API E2E 通过\n');
  } finally {
    if (schemaCreated && process.env.AUTH_TERMINAL_E2E_KEEP_SCHEMA !== '1') {
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
    await admin.$disconnect();
    await rm(workspace.root, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
