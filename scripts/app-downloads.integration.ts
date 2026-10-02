import { assertIsolatedEnvironment, verifyIsolatedEnvironment } from './e2e-guard';
assertIsolatedEnvironment();
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { readFileSync, mkdtempSync, mkdirSync, cpSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { MobileReleasePublication } from '../src/mobile-releases/mobile-release-publication';
import { DownloadPublisher } from '../src/app-downloads/download-publisher';
import { isolatedFiles, apkFixture } from './download-tests/fixture';
import { privateObjectStore } from './download-tests/object-store';

async function migration() {
  const owner = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL!, log: [] });
  const name = 'download_upgrade_' + randomUUID().replaceAll('-', ''), url = new URL(process.env.DATABASE_URL!); url.pathname = '/' + name;
  const db = new PrismaClient({ datasourceUrl: url.toString(), log: [] });
  const root = mkdtempSync(join(dirname(process.env.E2E_MANIFEST!), 'download-upgrade-')), target = '20261002160000_app_download_artifacts';
  try {
    await owner.$executeRawUnsafe(`CREATE DATABASE "${name}"`); mkdirSync(join(root, 'migrations'));
    cpSync('prisma/schema.prisma', join(root, 'schema.prisma'));
    for (const entry of readdirSync('prisma/migrations')) if (entry.replace(/^zzz_/, '') < target || entry === 'migration_lock.toml') cpSync(join('prisma/migrations', entry), join(root, 'migrations', entry), { recursive: true });
    const deploy = () => execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(root, 'schema.prisma')], { cwd: root, env: { PATH: process.env.PATH, DATABASE_URL: url.toString(), DIRECT_DATABASE_URL: url.toString() }, stdio: 'pipe' });
    deploy();
    const user = await db.user.create({ data: { username: 'download-' + randomUUID().slice(0, 8), email: randomUUID() + '@e2e.invalid', password: randomUUID() } });
    const wallet = await db.wallet.create({ data: { kind: 'USER', userId: user.id, balance: 321n } });
    const release = await db.mobileRelease.create({ data: { platform: 'android', versionName: 'before', buildNumber: 900, summary: '迁移前审计', items: ['保留'], confirmedItems: [], publishedItems: [] } });
    const promotion = await db.mobileReleasePromotion.create({ data: { id: randomUUID(), releaseId: release.id, revision: 1, status: 'SUCCEEDED', apkSha256: 'c'.repeat(64), apkSize: '100', updateUrl: 'https://wenyou-apk.cn-nb1.rains3.com/mobile/android/old.apk' } });
    cpSync(join('prisma/migrations', target), join(root, 'migrations', target), { recursive: true }); deploy(); deploy();
    assert.deepEqual(await db.user.findUniqueOrThrow({ where: { id: user.id } }), user); assert.deepEqual(await db.wallet.findUniqueOrThrow({ where: { id: wallet.id } }), wallet); assert.deepEqual(await db.mobileReleasePromotion.findUniqueOrThrow({ where: { id: promotion.id } }), promotion);
    assert.equal(await db.mobileDownloadArtifact.count(), 0);
  } finally { await db.$disconnect(); await owner.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`); await owner.$disconnect(); await rm(root, { recursive: true, force: true }); }
}
async function main() {
  await verifyIsolatedEnvironment(); assert.equal(process.env.APP_DOWNLOADS_TEST_ENV, 'test'); await migration();
  const db = new PrismaClient({ datasourceUrl: process.env.BOOKMARK_MANAGEMENT_TEST_APP_URL!, log: [] });
  const { root, config } = await isolatedFiles(dirname(process.env.E2E_MANIFEST!)), objectStore = await privateObjectStore(root);
  const releaseIds:string[]=[];
  try {
    const { artifact, buffer } = apkFixture(494, 128 * 1024); await objectStore.upload(artifact, buffer);
    const release = await db.mobileRelease.create({ data: { platform: 'android', versionName: artifact.versionName, buildNumber: artifact.buildNumber, summary: '下载隔离样本', items: ['样本'], confirmedRevision: 1, confirmedSummary: '下载隔离样本', confirmedItems: ['样本'], confirmedAt: new Date(), publishedItems: [] } });
    releaseIds.push(release.id);
    const publication = new MobileReleasePublication(db), operationId = randomUUID();
    await publication.begin({ platform: 'android', versionName: artifact.versionName, buildNumber: artifact.buildNumber, confirmedRevision: 1, operationId, apkSha256: artifact.sha256, apkSize: String(artifact.sizeBytes), updateUrl: artifact.legacyUpdateUrl });
    await publication.transition(operationId, 'publish'); await publication.transition(operationId, 'commit'); await publication.transition(operationId, 'finish');
    const original = await db.mobileReleasePromotion.findUniqueOrThrow({ where: { id: operationId } });
    await Promise.all([publication.registerDownload(artifact), publication.registerDownload(artifact)]);
    assert.equal(await db.mobileDownloadArtifact.count({ where: { releaseId: release.id } }), 1);
    await assert.rejects(publication.registerDownload({ ...artifact, sha256: 'e'.repeat(64) }));
    const publisher = new DownloadPublisher(config); await publisher.register(artifact); await assert.rejects(publisher.publish(artifact.buildNumber, '2026-10-02T00:00:00.000Z'));
    await publisher.warm(artifact.buildNumber, objectStore.origin);
    const proof = await publication.downloadProof({ platform: 'android', versionName: artifact.versionName, buildNumber: artifact.buildNumber });
    await publisher.publish(artifact.buildNumber, proof.publishedAt);
    assert.deepEqual(await db.mobileReleasePromotion.findUniqueOrThrow({ where: { id: operationId } }), original);
    const location = await db.mobileDownloadArtifact.findUniqueOrThrow({ where: { releaseId: release.id } }); assert.equal(location.publicUrl, `https://wenyou.site/api/v1/app-downloads/android/${artifact.buildNumber}/file`); assert.equal(original.updateUrl, artifact.legacyUpdateUrl);
    const before = await db.auditLog.count({ where: { targetId: release.id } }); await publication.registerDownload(artifact); assert.equal(await db.auditLog.count({ where: { targetId: release.id } }), before);
    const catalog = JSON.parse(readFileSync(join(config.DOWNLOAD_CATALOG_DIR, 'catalog.json'), 'utf8')); assert.equal(catalog.state, 'available');
    const fresh=apkFixture(495), identity={platform:'android' as const,versionName:fresh.artifact.versionName,buildNumber:495};
    const freshRelease=await db.mobileRelease.create({data:{...identity,summary:'首次网关发布',items:['样本'],confirmedRevision:1,confirmedSummary:'首次网关发布',confirmedItems:['样本'],confirmedAt:new Date(),publishedItems:[]}});
    releaseIds.push(freshRelease.id);
    await publication.registerDownload(fresh.artifact); await assert.rejects(publication.downloadProof(identity));
    const freshOperation=randomUUID();
    await publication.begin({...identity,confirmedRevision:1,operationId:freshOperation,apkSha256:fresh.artifact.sha256,apkSize:String(fresh.artifact.sizeBytes),updateUrl:fresh.artifact.legacyUpdateUrl});
    await publication.transition(freshOperation,'publish'); await assert.rejects(publication.downloadProof(identity));
    await publication.transition(freshOperation,'commit'); assert.equal((await publication.downloadProof(identity)).operationId,freshOperation);
    await publication.transition(freshOperation,'abort'); await assert.rejects(publication.downloadProof(identity));
    console.log(JSON.stringify({ event: 'download-integration-passed', migrationPreserved: true, legacyAuditPreserved: true, privateOrigin: true }));
  } finally {
    try {
      await db.$transaction([
        db.mobileDownloadArtifact.deleteMany({where:{releaseId:{in:releaseIds}}}),
        db.mobileReleasePromotion.deleteMany({where:{releaseId:{in:releaseIds}}}),
        db.auditLog.deleteMany({where:{targetType:'MOBILE_RELEASE',targetId:{in:releaseIds}}}),
        db.mobileRelease.deleteMany({where:{id:{in:releaseIds}}}),
      ]);
    } finally { await objectStore.close(); await db.$disconnect(); await rm(root, { recursive: true, force: true }); }
  }
}
if (require.main === module) void main().catch((error: unknown) => { const e=error as {name?:string;code?:string;stack?:string}; console.error(JSON.stringify({event:'APP_DOWNLOAD_INTEGRATION_FAILED',name:e.name,code:e.code,sites:e.stack?.split('\n').filter(line=>line.trim().startsWith('at ')&&line.includes('app-downloads.integration.ts:'))})); process.exitCode = 1; });
