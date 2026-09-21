import { assertIsolatedEnvironment, verifyIsolatedEnvironment } from './e2e-guard';
assertIsolatedEnvironment();
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { mock } from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCsrf from '@fastify/csrf-protection';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { AdminAuthService } from '../src/admin/admin-auth.service';
import { AdminAuthController } from '../src/admin/admin-auth.controller';
import { AdminGuard } from '../src/admin/guards/admin.guard';
import { EmailService } from '../src/email/email.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ErrorCode } from '../src/common/exceptions/error-codes';

const MIGRATION = '20260921010000_admin_session_remember_device';
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const PEPPER = 'isolated-admin-session-test';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

async function main() {
  await verifyIsolatedEnvironment();
  assert.equal(process.env.ADMIN_SESSION_TEST_ENV, 'test');
  const base = new URL(process.env.DATABASE_URL!);
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname));
  const dbName = 'wenyousite_admin_session_' + randomUUID().replaceAll('-', '');
  const control = new PrismaClient({ datasourceUrl: base.toString() });
  const url = new URL(base);
  url.pathname = '/' + dbName;
  const db = new PrismaClient({ datasourceUrl: url.toString() });
  const migrationRoot = await mkdtemp(join(dirname(process.env.E2E_MANIFEST!), 'admin-session-migration-'));
  let app: NestFastifyApplication | undefined;
  let created = false;
  const deploy = (schema?: string) =>
    execFileSync(
      'pnpm',
      ['exec', 'prisma', 'migrate', 'deploy', ...(schema ? ['--schema', schema] : [])],
      {
        env: { ...process.env, DATABASE_URL: url.toString(), DIRECT_DATABASE_URL: url.toString() },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  try {
    await control.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    created = true;
    await mkdir(join(migrationRoot, 'migrations'));
    await cp('prisma/schema.prisma', join(migrationRoot, 'schema.prisma'));
    for (const item of await readdir('prisma/migrations')) {
      if (item !== MIGRATION)
        await cp(join('prisma/migrations', item), join(migrationRoot, 'migrations', item), {
          recursive: true,
        });
    }
    deploy(join(migrationRoot, 'schema.prisma'));
    const password = 'Admin-session-test-only-20260921';
    const user = await db.user.create({
      data: {
        email: randomUUID() + '@admin-session.invalid',
        username: 'session-' + randomUUID().slice(0, 8),
        password: await argon2.hash(password),
        role: 'ADMIN',
      },
    });
    const oldId = randomUUID();
    const oldExpiry = new Date(Date.now() + 8 * 60 * MINUTE);
    const oldActive = new Date(Date.now() - 31 * MINUTE);
    await db.$executeRaw`INSERT INTO admin_sessions (id,user_id,token_hash,last_active_at,expires_at)
      VALUES (${oldId},${user.id},${hash('legacy-token')},${oldActive},${oldExpiry})`;
    deploy();
    const legacy = await db.adminSession.findUniqueOrThrow({ where: { id: oldId } });
    assert.equal(legacy.rememberDevice, false);
    assert.equal(legacy.expiresAt.getTime(), oldExpiry.getTime());
    assert.equal(legacy.lastActiveAt.getTime(), oldActive.getTime());

    const config = {
      get: (key: string) =>
        ({
          'admin.challengePepper': PEPPER,
          'admin.idleMinutes': 30,
          'admin.absoluteHours': 8,
          'admin.stepUpMinutes': 10,
          'app.nodeEnv': 'production',
        })[key],
    } as unknown as ConfigService;
    let sentCode = '';
    const email = {
      sendAdminVerification: async (_email: string, code: string) => {
        sentCode = code;
      },
      sendAdminSessionAlert: async () => {},
    };
    const service = new AdminAuthService(
      db as unknown as PrismaService,
      config,
      email as unknown as EmailService,
    );
    const module = await Test.createTestingModule({
      controllers: [AdminAuthController],
      providers: [
        AdminGuard,
        { provide: AdminAuthService, useValue: service },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
      logger: false,
    });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.register(fastifyCookie);
    await app.register(fastifyCsrf, {
      cookieKey: '__Secure-wenyou-admin-csrf',
      cookieOpts: { httpOnly: true, secure: true, sameSite: 'strict', path: '/api/v1/admin' },
      getToken: (req) => String(req.headers['x-csrf-token'] ?? ''),
    });
    const server = app.getHttpAdapter().getInstance();
    server.addHook('onRequest', (request, reply, done) => {
      const publicPaths = ['/api/v1/admin/auth/challenge', '/api/v1/admin/auth/verify'];
      if (
        ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) &&
        !publicPaths.includes(request.url.split('?', 1)[0])
      ) {
        server.csrfProtection(request, reply, done);
      } else done();
    });
    await app.init();
    await server.ready();
    await assert.rejects(service.validateSession('legacy-token'), {
      errorCode: ErrorCode.ADMIN_SESSION_EXPIRED,
    });

    async function challenge(purpose: 'LOGIN' | 'STEP_UP' = 'LOGIN') {
      const id = randomUUID();
      await db.adminAuthChallenge.create({
        data: {
          id,
          userId: user.id,
          purpose,
          codeHash: hash(id + ':123456:' + PEPPER),
          expiresAt: new Date(Date.now() + 10 * MINUTE),
        },
      });
      return { challengeId: id, code: '123456' };
    }
    const fixedNow = new Date();
    mock.timers.enable({ apis: ['Date'], now: fixedNow });
    for (const choice of [undefined, false, true]) {
      mock.timers.setTime(fixedNow.getTime());
      const input = await challenge();
      const result = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/auth/verify',
        payload: { ...input, ...(choice === undefined ? {} : { rememberDevice: choice }) },
      });
      assert.equal(result.statusCode, 200);
      const body = result.json();
      const seconds = choice ? (7 * DAY) / 1000 : (8 * 60 * MINUTE) / 1000;
      assert.equal(Date.parse(body.session.expiresAt), fixedNow.getTime() + seconds * 1000);
      assert.equal(body.session.idleMinutes, choice ? 10080 : 30);
      const cookie = result.cookies.find((c) => c.name === '__Secure-wenyou-admin-session')!;
      assert(cookie.httpOnly && cookie.secure);
      assert.equal(cookie.sameSite, 'Strict');
      assert.equal(cookie.path, '/api/v1/admin');
      assert.equal(Number(cookie.maxAge), seconds);
      const cookieHeader = cookie.name + '=' + cookie.value;
      mock.timers.setTime(fixedNow.getTime() + 31 * MINUTE);
      const reopened = await server.inject({
        method: 'GET',
        url: '/api/v1/admin/auth/session',
        headers: { cookie: cookieHeader },
      });
      assert.equal(reopened.statusCode, choice ? 200 : 401);
      if (choice) {
        const renewed = reopened.json();
        assert.equal(renewed.session.expiresAt, body.session.expiresAt);
        assert.equal(renewed.session.idleMinutes, 10080);
        assert.equal(
          reopened.cookies.some((c) => c.name === cookie.name),
          false,
        );
        const csrfCookie = reopened.cookies.find((c) => c.name === '__Secure-wenyou-admin-csrf')!;
        assert(csrfCookie && renewed.csrfToken);
        const both = cookieHeader + '; ' + csrfCookie.name + '=' + csrfCookie.value;
        for (const csrf of [undefined, 'invalid']) {
          const denied = await server.inject({
            method: 'POST',
            url: '/api/v1/admin/auth/logout',
            headers: { cookie: both, ...(csrf ? { 'x-csrf-token': csrf } : {}) },
          });
          assert.equal(denied.statusCode, 403);
        }
        mock.timers.setTime(fixedNow.getTime() + 7 * DAY - 1);
        assert.equal(
          (
            await server.inject({
              method: 'GET',
              url: '/api/v1/admin/auth/session',
              headers: { cookie: cookieHeader },
            })
          ).statusCode,
          200,
        );
        mock.timers.setTime(fixedNow.getTime() + 7 * DAY);
        assert.equal(
          (
            await server.inject({
              method: 'GET',
              url: '/api/v1/admin/auth/session',
              headers: { cookie: cookieHeader },
            })
          ).statusCode,
          401,
        );
      }
    }
    mock.timers.setTime(fixedNow.getTime());
    // 活跃请求只更新时间，不延长短会话绝对期限。
    const shortInput = await challenge();
    const short = await service.verifyLoginChallenge(shortInput.challengeId, shortInput.code, {});
    await db.adminSession.update({
      where: { id: short.session.id },
      data: { lastActiveAt: new Date(fixedNow.getTime() + 8 * 60 * MINUTE - 1) },
    });
    mock.timers.setTime(fixedNow.getTime() + 8 * 60 * MINUTE);
    await assert.rejects(service.validateSession(short.rawToken), {
      errorCode: ErrorCode.ADMIN_SESSION_EXPIRED,
    });
    mock.timers.setTime(fixedNow.getTime());

    for (const rememberDevice of [false, true]) {
      const input = await challenge();
      const logged = await service.verifyLoginChallenge(
        input.challengeId,
        input.code,
        {},
        rememberDevice,
      );
      const step = await challenge('STEP_UP');
      const elevated = await service.verifyStepUp(
        logged.session.id,
        user.id,
        step.challengeId,
        step.code,
        {},
      );
      assert.equal(elevated.elevatedUntil.getTime(), fixedNow.getTime() + 10 * MINUTE);
      mock.timers.setTime(fixedNow.getTime() + 10 * MINUTE);
      assert.throws(() => service.requireStepUp(elevated.elevatedUntil.toISOString()), {
        errorCode: ErrorCode.ADMIN_STEP_UP_REQUIRED,
      });
      mock.timers.setTime(fixedNow.getTime());
      await db.user.update({ where: { id: user.id }, data: { role: 'USER' } });
      await assert.rejects(service.validateSession(logged.rawToken), {
        errorCode: ErrorCode.ADMIN_SESSION_EXPIRED,
      });
      await db.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
      const nextInput = await challenge();
      const next = await service.verifyLoginChallenge(
        nextInput.challengeId,
        nextInput.code,
        {},
        rememberDevice,
      );
      await service.logout(next.session.id, {});
      await assert.rejects(service.validateSession(next.rawToken), {
        errorCode: ErrorCode.ADMIN_SESSION_EXPIRED,
      });
    }
    mock.timers.reset();
    assert.equal(
      (
        await server.inject({
          method: 'GET',
          url: '/api/v1/admin/auth/session',
          headers: { authorization: 'Bearer ordinary-user-token' },
        })
      ).statusCode,
      401,
    );
    const passwordChallenge = await server.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/challenge',
      payload: { account: user.email, password },
    });
    assert.equal(passwordChallenge.statusCode, 200);
    assert.match(sentCode, /^\d{6}$/);
    const signedIn = await server.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/verify',
      payload: {
        challengeId: passwordChallenge.json().challengeId,
        code: sentCode,
        rememberDevice: true,
      },
    });
    assert.equal(signedIn.statusCode, 200);
    const signedCookies = signedIn.cookies.map((c) => c.name + '=' + c.value).join('; ');
    const signedCsrf = signedIn.json().csrfToken;
    const wrongStepDto = await server.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/step-up/verify',
      headers: { cookie: signedCookies, 'x-csrf-token': signedCsrf },
      payload: { ...(await challenge('STEP_UP')), rememberDevice: true },
    });
    assert.equal(wrongStepDto.statusCode, 400);
    assert.equal(
      (
        await server.inject({
          method: 'POST',
          url: '/api/v1/admin/auth/logout',
          headers: { cookie: signedCookies, 'x-csrf-token': signedCsrf },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await server.inject({
          method: 'GET',
          url: '/api/v1/admin/auth/session',
          headers: { cookie: signedCookies },
        })
      ).statusCode,
      401,
    );
    for (const remember of [false, true]) {
      const input = await challenge();
      const session = await service.verifyLoginChallenge(
        input.challengeId,
        input.code,
        {},
        remember,
      );
      const sanction = await db.userSanction.create({
        data: {
          userId: user.id,
          createdById: user.id,
          type: 'BAN',
          reason: '隔离验证',
          startsAt: new Date(Date.now() - 1000),
        },
      });
      await assert.rejects(service.validateSession(session.rawToken), {
        errorCode: ErrorCode.ADMIN_SESSION_EXPIRED,
      });
      await db.userSanction.update({ where: { id: sanction.id }, data: { revokedAt: new Date() } });
      const deletedInput = await challenge();
      const deleted = await service.verifyLoginChallenge(
        deletedInput.challengeId,
        deletedInput.code,
        {},
        remember,
      );
      await db.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
      await assert.rejects(service.validateSession(deleted.rawToken), {
        errorCode: ErrorCode.ADMIN_SESSION_EXPIRED,
      });
      await db.user.update({ where: { id: user.id }, data: { deletedAt: null } });
    }
    const shared = await challenge();
    const replay = await Promise.allSettled(
      [false, true].map((remember) =>
        service.verifyLoginChallenge(shared.challengeId, shared.code, {}, remember),
      ),
    );
    assert.equal(replay.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(await db.adminSession.count({ where: { userId: user.id, revokedAt: null } }), 1);
    const [first, second] = await Promise.all([challenge(), challenge()]);
    const different = await Promise.all([
      service.verifyLoginChallenge(first.challengeId, first.code, {}, false),
      service.verifyLoginChallenge(second.challengeId, second.code, {}, true),
    ]);
    assert.equal(await db.adminSession.count({ where: { userId: user.id, revokedAt: null } }), 1);
    assert.equal(
      (await Promise.allSettled(different.map((s) => service.validateSession(s.rawToken)))).filter(
        (r) => r.status === 'fulfilled',
      ).length,
      1,
    );

    const resendInput = await challenge();
    const realResendRace = await Promise.allSettled([
      service.createLoginChallenge({ account: user.email, password }, {}),
      service.verifyLoginChallenge(resendInput.challengeId, resendInput.code, {}, true),
    ]);
    assert.equal(realResendRace[0].status, 'fulfilled');
    if (realResendRace[1].status === 'rejected') {
      assert.equal(realResendRace[1].reason.errorCode, ErrorCode.ADMIN_CHALLENGE_INVALID);
    }
    assert.equal(await db.adminSession.count({ where: { userId: user.id, revokedAt: null } }), 1);

    // 强制旧挑战先持锁；验证持用户锁后等待挑战，挑战创建仍可取得外键 KEY SHARE。
    const overlapping = await challenge();
    let release!: () => void;
    let locked!: () => void;
    const lockedPromise = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const resend = db.$transaction(
      async (tx) => {
        await tx.adminAuthChallenge.update({
          where: { id: overlapping.challengeId },
          data: { consumedAt: new Date() },
        });
        locked();
        await releasePromise;
        const id = randomUUID();
        await tx.adminAuthChallenge.create({
          data: {
            id,
            userId: user.id,
            purpose: 'LOGIN',
            codeHash: hash(id + ':123456:' + PEPPER),
            expiresAt: new Date(Date.now() + 10 * MINUTE),
          },
        });
      },
      { timeout: 10000 },
    );
    await lockedPromise;
    const blockedVerify = service
      .verifyLoginChallenge(overlapping.challengeId, overlapping.code, {})
      .then(
        () => {
          throw new Error('已废弃挑战不能成功');
        },
        (e: { errorCode?: number }) => {
          assert.equal(e.errorCode, ErrorCode.ADMIN_CHALLENGE_INVALID);
        },
      );
    // 等待数据库确认验证事务已在 challenge 行锁上阻塞，而非用睡眠猜测顺序。
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      const rows = await db.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'
      ) AS waiting`;
      if (rows[0].waiting) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    release();
    await Promise.all([resend, blockedVerify]);
    // 在 READ COMMITTED 中，普通读取可看旧快照，最终 challenge UPDATE 仍会等待。
    assert(waiting);
    const original = await db.adminSession.findFirstOrThrow({
      where: { userId: user.id, revokedAt: null },
    });
    const rollback = await challenge();
    await db.$executeRawUnsafe(`CREATE FUNCTION fail_test_session() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'isolated test failure'; END; $$`);
    await db.$executeRawUnsafe(
      `CREATE TRIGGER fail_test_session BEFORE INSERT ON admin_sessions FOR EACH ROW EXECUTE FUNCTION fail_test_session()`,
    );
    await assert.rejects(
      service.verifyLoginChallenge(rollback.challengeId, rollback.code, {}, true),
    );
    assert.equal(
      (await db.adminAuthChallenge.findUniqueOrThrow({ where: { id: rollback.challengeId } }))
        .consumedAt,
      null,
    );
    assert.equal(
      (await db.adminSession.findUniqueOrThrow({ where: { id: original.id } })).revokedAt,
      null,
    );
    console.log(
      'Admin session migration, fixed clocks, cookies/CSRF, revocation, replay/concurrency and rollback passed',
    );
  } finally {
    mock.timers.reset();
    if (app) await app.close();
    await db.$disconnect();
    if (created) await control.$executeRawUnsafe(`DROP DATABASE "${dbName}"`);
    await control.$disconnect();
    await rm(migrationRoot, { recursive: true, force: true });
  }
}
void main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
