import { assertIsolatedEnvironment, verifyIsolatedEnvironment } from './e2e-guard';
assertIsolatedEnvironment();
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import csrf from '@fastify/csrf-protection';
import { PrismaClient } from '@prisma/client';
import { AdminAuthController } from '../src/admin/admin-auth.controller';
import { AdminAuthService } from '../src/admin/admin-auth.service';
import { AdminGuard } from '../src/admin/guards/admin.guard';
import { EmailService } from '../src/email/email.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/moderation/audit.service';
import { TransformInterceptor } from '../src/common/interceptors/response.interceptor';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { AdminMobileReleasesController, MobileReleasesController } from '../src/mobile-releases/mobile-releases.controller';
import { MobileReleasesService } from '../src/mobile-releases/mobile-releases.service';
import { MobileReleasePublication, ReleasePromotionInput } from '../src/mobile-releases/mobile-release-publication';

async function verifyIncrementalMigration() {
  const control=new PrismaClient({datasourceUrl:process.env.DATABASE_URL!,log:[]});
  const name='release_upgrade_'+randomUUID().replaceAll('-','');
  const url=new URL(process.env.DATABASE_URL!);url.pathname='/'+name;
  const db=new PrismaClient({datasourceUrl:url.toString(),log:[]});
  const root=mkdtempSync(join(dirname(process.env.E2E_MANIFEST!),'release-upgrade-'));
  const migration='20260927200000_mobile_release_notes';
  const repo=resolve(__dirname,'..');
  try {
    await control.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    mkdirSync(join(root,'migrations'));
    cpSync(join(repo,'prisma/schema.prisma'),join(root,'schema.prisma'));
    // zzz_ 是既有八月补齐迁移的排序标记，历史基线仍须包含它；不能引入未来依赖本表的迁移。
    for(const entry of readdirSync(join(repo,'prisma/migrations'))) if(entry.replace(/^zzz_/,'')<migration||entry==='migration_lock.toml') cpSync(join(repo,'prisma/migrations',entry),join(root,'migrations',entry),{recursive:true});
    const deploy=()=>execFileSync(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','deploy','--schema',join(root,'schema.prisma')],{cwd:root,env:{PATH:process.env.PATH,DATABASE_URL:url.toString(),DIRECT_DATABASE_URL:url.toString()},stdio:'pipe'});
    deploy();
    const user=await db.user.create({data:{username:'migration-'+randomUUID().slice(0,8),email:randomUUID()+'@e2e.invalid',password:randomUUID()}});
    const wallet=await db.wallet.create({data:{kind:'USER',userId:user.id,balance:12345n}});
    const audit=await db.auditLog.create({data:{actorId:user.id,action:'SITE_SETTINGS_UPDATED',targetType:'SITE_SETTINGS',metadata:{migrationFixture:true}}});
    const category=await db.threadCategoryDefinition.findFirstOrThrow({where:{isActive:true}});
    // 该基线特意停在旧迁移，固定旧表列，避免新版 Prisma 自动读取未来新增字段。
    const threadId=randomUUID();
    await db.$executeRaw`INSERT INTO threads (id, owner_id, title, category, updated_at) VALUES (${threadId}, ${user.id}, '迁移前保留的隔离内容', ${category.slug}, ${new Date()})`;
    const [thread]=await db.$queryRaw<Array<Record<string,unknown>>>`SELECT * FROM threads WHERE id=${threadId}`;
    cpSync(join(repo,'prisma/migrations',migration),join(root,'migrations',migration),{recursive:true});
    deploy();deploy();
    assert.deepEqual(await db.user.findUniqueOrThrow({where:{id:user.id}}),user);
    assert.deepEqual(await db.wallet.findUniqueOrThrow({where:{id:wallet.id}}),wallet);
    assert.deepEqual(await db.auditLog.findUniqueOrThrow({where:{id:audit.id}}),audit);
    assert.deepEqual((await db.$queryRaw<Array<Record<string,unknown>>>`SELECT * FROM threads WHERE id=${threadId}`)[0],thread);
    assert.equal(await db.mobileRelease.count(),0);
  } finally { await db.$disconnect();await control.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`);await control.$disconnect(); }
}

async function main() {
  await verifyIsolatedEnvironment();
  assert.equal(process.env.MOBILE_RELEASE_TEST_ENV, 'test');
  await verifyIncrementalMigration();
  const db = new PrismaClient({ datasourceUrl: process.env.BOOKMARK_MANAGEMENT_TEST_APP_URL!, log: [] });
  const store = new MobileReleasePublication(db);
  let app: NestFastifyApplication | undefined;
  try {
    const before = await db.user.findUniqueOrThrow({ where: { id: process.env.E2E_USER_ID! } });
    const config = { get: (key: string) => key === 'app.nodeEnv' ? 'test' : undefined } as ConfigService;
    const audit = new AuditService(db as unknown as PrismaService);
    const service = new MobileReleasesService(db as unknown as PrismaService, audit);
    const auth = new AdminAuthService(db as unknown as PrismaService, config, {} as EmailService);
    const mod = await Test.createTestingModule({ controllers: [AdminAuthController, AdminMobileReleasesController, MobileReleasesController], providers: [AdminGuard,
      { provide: AdminAuthService, useValue: auth }, { provide: ConfigService, useValue: config }, { provide: MobileReleasesService, useValue: service },
    ] }).compile();
    app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.register(cookie);
    await app.register(csrf, { cookieKey: 'wenyou-admin-csrf', cookieOpts: { path: '/api/v1/admin', httpOnly: true, sameSite: 'strict' }, getToken: req => String(req.headers['x-csrf-token'] ?? '') });
    const server = app.getHttpAdapter().getInstance();
    server.addHook('onRequest', (req, reply, done) => {
      if (['POST','PATCH','PUT','DELETE'].includes(req.method) && req.url.startsWith('/api/v1/admin/')) server.csrfProtection(req, reply, done); else done();
    });
    await app.init(); await server.ready();
    const session = async (role: 'ADMIN' | 'SUPER_ADMIN' | 'USER'): Promise<Record<string,string>> => {
      const token = randomUUID();
      const user = await db.user.create({ data: { username: 'mr-' + randomUUID().slice(0, 12), email: randomUUID() + '@e2e.invalid', password: 'isolated-unused-hash', role } });
      await db.adminSession.create({ data: { userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 3600000) } });
      const cookieHeader = `wenyou-admin-session=${token}`;
      const response = await server.inject({ method: 'GET', url: '/api/v1/admin/auth/session', headers: { cookie: cookieHeader } });
      if (role === 'USER') { assert.equal(response.statusCode, 401); return {}; }
      assert.equal(response.statusCode, 200);
      const c = response.cookies.find(x => x.name === 'wenyou-admin-csrf')!;
      return { cookie: `${cookieHeader}; ${c.name}=${c.value}`, 'x-csrf-token': response.json().data.csrfToken as string };
    };
    const admin = await session('ADMIN'); const root = await session('SUPER_ADMIN'); await session('USER');
    const path = '/api/v1/admin/mobile-releases';
    const call = (method: 'GET'|'POST'|'PATCH', url: string, headers: Record<string,string> = {}, payload?: object) => server.inject({ method, url, headers, payload });
    assert.equal((await call('GET', path)).statusCode, 401);
    assert.equal((await call('POST', path, { cookie: admin.cookie! }, {})).statusCode, 403);
    assert.equal((await call('POST', path, { ...admin, 'x-csrf-token': 'bad' }, {})).statusCode, 403);
    const draft = { platform: 'android' as const, versionName: '1.0.0', buildNumber: 77, summary: '草稿摘要', items: ['草稿正文'] };
    for (const invalid of [{ summary: '' }, { items: [] }, { items: [' '.repeat(5)] }, { summary: '字'.repeat(201) }, { items: ['字'.repeat(501)] }, { items: Array(31).fill('条') }]) {
      assert.equal((await call('POST', path, admin, { ...draft, ...invalid })).statusCode, 400);
    }
    const created = await call('POST', path, admin, draft); assert.equal(created.statusCode, 201); const id = created.json().data.id;
    const duplicate = await call('POST', path, admin, { ...draft, versionName: 'other' }); assert.equal(duplicate.statusCode, 409); assert.equal(duplicate.json().code, 40900);
    assert.equal((await call('GET', '/api/v1/mobile-releases/android/77')).statusCode, 404);
    assert.deepEqual((await call('GET', '/api/v1/mobile-releases?platform=android')).json().data, []);
    assert.equal((await call('GET', '/api/v1/mobile-releases?platform=android&cursor=invalid')).json().code, 40007);
    assert.equal((await call('POST', `${path}/${id}/confirm`, admin, { revision: 1 })).statusCode, 403);
    assert.equal((await call('POST', `${path}/${id}/confirm`, root, { revision: 1 })).statusCode, 201);
    const identity = { platform: 'android' as const, versionName: '1.0.0', buildNumber: 77 };
    assert.equal((await store.preflight(identity)).confirmedRevision, 1);
    await assert.rejects(store.preflight({ ...identity, versionName: 'other' }));
    const raced = await Promise.all([call('PATCH', `${path}/${id}`, admin, { revision: 1, summary: '甲', items: ['甲'] }), call('PATCH', `${path}/${id}`, admin, { revision: 1, summary: '乙', items: ['乙'] })]);
    assert.deepEqual(raced.map(x => x.statusCode).sort(), [200, 409]);
    assert.equal(raced.find(x=>x.statusCode===409)!.json().code, 40900);
    await assert.rejects(store.preflight(identity));
    await call('POST', `${path}/${id}/confirm`, root, { revision: 2 });
    const promotion: ReleasePromotionInput = { ...identity, confirmedRevision: 2, operationId: randomUUID(), apkSha256: 'a'.repeat(64), apkSize: '123', updateUrl: 'https://wenyou-apk.cn-nb1.rains3.com/mobile/android/wenyou-1.0.0-77.apk' };
    await assert.rejects(store.begin({ ...promotion, confirmedRevision: 1 }));
    await store.begin(promotion); await store.begin(promotion);
    assert.equal((await call('PATCH', `${path}/${id}`, root, { revision: 2, summary: '禁止', items: ['禁止'] })).json().code, 40900);
    await assert.rejects(store.preflight(identity));
    await store.transition(promotion.operationId, 'publish');
    assert.equal((await call('GET', '/api/v1/mobile-releases/android/77')).statusCode, 404);
    // 模拟进程中断后的持久恢复：另一个客户端能撤销，重复补偿幂等。
    await new MobileReleasePublication(db).transition(promotion.operationId, 'abort');
    await store.transition(promotion.operationId, 'abort');
    assert.equal((await store.preflight(identity)).confirmedRevision, 2);
    const retry = { ...promotion, operationId: randomUUID() };
    await store.begin(retry); await store.transition(retry.operationId, 'publish'); await store.transition(retry.operationId, 'commit');
    assert.equal((await call('GET', '/api/v1/mobile-releases/android/77')).json().data.revision, 2);
    await store.transition(retry.operationId, 'abort');
    assert.equal((await call('GET', '/api/v1/mobile-releases/android/77')).statusCode, 404);
    const final = { ...retry, operationId: randomUUID() };
    await store.begin(final); await store.transition(final.operationId, 'publish'); await store.transition(final.operationId, 'commit'); await store.transition(final.operationId, 'finish');
    const publicBefore = (await call('GET', '/api/v1/mobile-releases/android/77')).json().data;
    assert.equal((await call('PATCH', `${path}/${id}`, admin, { revision: 2, summary: '禁止', items: ['禁止'] })).statusCode, 403);
    assert.equal((await call('PATCH', `${path}/${id}`, root, { revision: 2, summary: '修正', items: ['修正'] })).statusCode, 200);
    assert.deepEqual((await call('GET', '/api/v1/mobile-releases/android/77')).json().data, publicBefore);
    assert.equal((await call('POST', `${path}/${id}/confirm`, root, { revision: 3 })).statusCode, 201);
    const corrected = (await call('GET', '/api/v1/mobile-releases/android/77')).json().data;
    assert.equal(corrected.summary, '修正'); assert.equal(corrected.publishedAt, publicBefore.publishedAt);
    await assert.rejects(store.begin({ ...final, operationId: randomUUID(), confirmedRevision: 3, apkSha256: 'b'.repeat(64) }));
    const sameBuild = { ...final, operationId: randomUUID(), confirmedRevision: 3 };
    await store.begin(sameBuild); await store.transition(sameBuild.operationId, 'abort');
    assert.deepEqual((await call('GET', '/api/v1/mobile-releases/android/77')).json().data, corrected);
    // 真实受限 shell + 编译后的 DB CLI；只对外部对象、systemctl 和进程重启使用本地替身。
    const release78 = await service.create({ id: before.id, username: before.username, role: 'SUPER_ADMIN' }, { ...identity, buildNumber: 78, summary:'真实CLI隔离测试',items:['失败后重试'] }, {});
    await service.confirm({ id: before.id, username: before.username, role: 'SUPER_ADMIN' }, release78.id, 1, {});
    const shellRoot=mkdtempSync(join(dirname(process.env.E2E_MANIFEST!), 'release-shell-'));
    const repo=resolve(__dirname,'..');const envFile=join(shellRoot,'backend.env');const curl=join(shellRoot,'curl.cjs');
    const original=`DATABASE_URL=${process.env.BOOKMARK_MANAGEMENT_TEST_APP_URL!}\nMOBILE_ANDROID_RECOMMENDED_BUILD=\nMOBILE_ANDROID_UPDATE_URL=\n`;
    writeFileSync(envFile,original,{mode:0o600});
    const releaseUrl='https://wenyou-apk.cn-nb1.rains3.com/mobile/android/wenyou-1.0.0-78.apk';
    writeFileSync(curl, `#!${process.execPath}
const fs=require('node:fs'); const load=require('node:module').createRequire(${JSON.stringify(join(repo,'package.json'))});
const root=__dirname;const argv=process.argv.slice(2),url=argv.at(-1);
if(argv.includes('--head')) console.log('content-type: application/vnd.android.package-archive\\ncontent-length: 123\\ncache-control: public, max-age=31536000, immutable\\ncontent-disposition: attachment; filename="wenyou-1.0.0-78.apk"\\nx-amz-meta-apk-sha256: ${'a'.repeat(64)}\\nx-amz-meta-application-id: site.wenyou.app\\nx-amz-meta-version-name: 1.0.0\\nx-amz-meta-version-code: 78');
else if(url.endsWith('.sha256')) console.log('${'a'.repeat(64)}  wenyou-1.0.0-78.apk');
else if(url.includes('/mobile-releases/')) {
 if(fs.existsSync(root+'/fail-public')) process.exit(1);
 const {PrismaClient}=load('@prisma/client'),{parse}=load('dotenv');const db=new PrismaClient({datasourceUrl:parse(fs.readFileSync(root+'/backend.env')).DATABASE_URL,log:[]});
 db.mobileRelease.findFirst({where:{platform:'android',buildNumber:78,publishedAt:{not:null}}}).then(row=>{if(!row)process.exitCode=1;else console.log(JSON.stringify({data:{platform:row.platform,versionName:row.versionName,buildNumber:row.buildNumber,revision:row.publishedRevision}}));}).finally(()=>db.$disconnect());
} else if(url.endsWith('/meta')) {
 const e=load('dotenv').parse(fs.readFileSync(root+'/backend.env'));
 console.log(JSON.stringify({data:{mobileCompatibility:{android:{recommendedBuild:Number(e.MOBILE_ANDROID_RECOMMENDED_BUILD)||null,minimumSupportedBuild:null,updateUrl:e.MOBILE_ANDROID_UPDATE_URL||null}}}}));
} else console.log('{}');
`,{mode:0o700});
    writeFileSync(join(shellRoot,'systemctl'),'#!/bin/sh\nexit 0\n',{mode:0o700});
    const runShell=(args:string[])=>execFileSync('bash',[join(repo,'scripts/promote-android-release.sh'),...args],{env:{PATH:shellRoot+':'+process.env.PATH,BACKEND_ENV_FILE:envFile,MOBILE_RELEASE_HISTORY_FILE:join(shellRoot,'history.tsv'),MOBILE_RELEASE_CURL_BIN:curl,MOBILE_RELEASE_NODE_BINARY:process.execPath,MOBILE_RELEASE_NOTES_HELPER:join(repo,'dist/mobile-releases/mobile-release-cli.js')},stdio:['ignore','pipe','pipe']});
    const preflight=JSON.parse(runShell(['--preflight','--version','1.0.0','--build','78']).toString());assert.equal(preflight.confirmedRevision,1);
    const promoteArgs=['--version','1.0.0','--build','78','--url',releaseUrl,'--size','123','--sha256','a'.repeat(64),'--notes-revision','1'];
    writeFileSync(join(shellRoot,'fail-public'),'1');assert.throws(()=>runShell(promoteArgs));
    assert.equal(readFileSync(envFile,'utf8'),original);
    assert.equal((await call('GET','/api/v1/mobile-releases/android/78')).statusCode,404);
    assert.equal(await db.mobileReleasePromotion.count({where:{releaseId:release78.id,status:'ABORTED'}}),1);
    const {unlinkSync}=await import('node:fs');unlinkSync(join(shellRoot,'fail-public'));
    runShell(promoteArgs);runShell(promoteArgs);
    assert.equal((await call('GET','/api/v1/mobile-releases/android/78')).statusCode,200);
    assert.equal(readFileSync(join(shellRoot,'history.tsv'),'utf8').trim().split('\n').length,1);
    assert.equal(await db.mobileReleasePromotion.count({where:{releaseId:release78.id,status:'SUCCEEDED'}}),2);
    const audits = await db.auditLog.findMany({ where: { targetId: id } });
    assert(audits.length > 10); assert(!JSON.stringify(audits).includes('草稿正文'));
    assert.deepEqual(await db.user.findUniqueOrThrow({ where: { id: before.id } }), before);
    console.log('mobile releases: guards/CSRF/validation/CAS/snapshots/publication recovery passed');
  } finally { await app?.close(); await db.$disconnect(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
