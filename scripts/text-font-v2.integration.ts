import { assertIsolatedEnvironment, verifyIsolatedEnvironment } from './e2e-guard';
assertIsolatedEnvironment();
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { fontSha } from '../src/text-fonts/font-domain';
import { prepareFontReadiness, verifyLegacyReplayPreservesState } from './font-legacy-readiness.fixture';
import { FONT_LEGACY_IMPORT } from '../src/text-fonts/font-legacy-map';
import { verifyFontSandbox } from './font-sandbox.integration';
import { verifyFontManagement } from './font-management.integration';
import { verifyVariableFonts } from './font-variable.integration';
import { verifyFontManagementMigration } from './font-management-migration.integration';
import { verifyFontLease, verifyFontWorkerRecovery } from './font-worker-faults.integration';

type Data = Record<string, any>;
const db = new PrismaClient();
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  await verifyIsolatedEnvironment();
  assert.equal(process.env.TEXT_FONT_V2_TEST_ENV, 'test');
  await verifyFontSandbox();
  await verifyFontManagementMigration(db);
  const root = dirname(process.env.E2E_MANIFEST!);
  const fixtures = JSON.parse(readFileSync(process.env.E2E_ADMIN_FIXTURES!, 'utf8'));
  assert.equal(fixtures.runId, process.env.E2E_RUN_ID);
  const admin = fixtures.accounts.find((account: Data) => account.role === 'ADMIN');
  const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
  const userHeaders = { authorization: 'Bearer ' + jwt.sign({ sub: process.env.E2E_USER_ID, jti: randomUUID() }, { expiresIn: '20m' }), 'X-Text-Font-Version': '2' };
  let adminHeaders: Record<string, string> = {};
  const request = async (path: string, method = 'GET', body?: unknown, status = 200, headers = adminHeaders): Promise<Data> => {
    await pause(140);
    const response = await fetch(process.env.API_BASE + path, {
      method, headers: { ...(body === undefined ? {} : { 'content-type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json' }), ...headers },
      body: body === undefined ? undefined : Buffer.isBuffer(body) ? new Uint8Array(body) : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    assert.equal(response.status, status, `${method} ${path} HTTP 状态`);
    const result = await response.json() as Data;
    return status < 400 ? result.data : result;
  };
  const challengeCode = (before: Set<string>): string => {
    for (const name of readdirSync(fixtures.mailboxPath).filter(name => !before.has(name))) {
      const mail = JSON.parse(readFileSync(join(fixtures.mailboxPath, name), 'utf8'));
      if (mail.to === admin.email) return String(mail.html).match(/>([0-9]{6})</)![1];
    }
    throw new Error('本轮管理验证码缺失');
  };
  const before = new Set<string>(readdirSync(fixtures.mailboxPath));
  const challenge = await request('/admin/auth/challenge', 'POST', { account: admin.email, password: admin.password });
  const verified = await fetch(process.env.API_BASE + '/admin/auth/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challengeId: challenge.challengeId, code: challengeCode(before) }) });
  assert.equal(verified.status, 200);
  const session = await verified.json() as Data;
  adminHeaders = { cookie: verified.headers.getSetCookie().map(value => value.split(';')[0]).join('; '), 'x-csrf-token': session.data.csrfToken };
  const config = { name: '隔离几何字体', designLanguage: 'zh', sortOrder: 0, author: 'Wenyou test fixture', sourceUrl: 'https://example.invalid/self-authored', licenseName: 'CC0-1.0', licenseText: 'Self-authored geometric test glyphs dedicated to the public domain under CC0-1.0.', specimenText: 'AB 中文', rights: { redistribution: true, conversion: true, subsetting: true } };
  await request('/admin/text-fonts', 'GET', undefined, 401, {});
  await request('/admin/text-fonts', 'GET', undefined, 401, userHeaders);
  await request('/admin/text-fonts', 'POST', config, 403, userHeaders);
  await request('/admin/text-fonts', 'POST', config, 403, { cookie: adminHeaders.cookie });
  let family = await request('/admin/text-fonts', 'POST', config, 201);
  execFileSync('/usr/bin/python3.12', [join(__dirname, 'fonts/dynamic/make-fixtures.py'), '--toolchain', process.env.TEXT_FONT_TOOLCHAIN_DIR!, '--output', join(root, 'font-fixtures')], { stdio: 'pipe' });
  const upload = async (source: Buffer, target = family) => request(`/admin/text-fonts/${target.familyId}/sources?format=ttf&expectedFamilyRevision=${target.revision}`, 'POST', source, 201);
  const build = async (source: Buffer, target = family, failure?: string) => {
    const job = await upload(source, target);
    assert.equal(job.status, 'draft');
    await request(`/admin/text-fonts/jobs/${job.jobId}/process`, 'POST', undefined, 201);
    for (let attempt = 0; attempt < 180; attempt++) {
      const current = await request(`/admin/text-fonts/jobs/${job.jobId}`);
      if (current.status === 'failed') { assert.equal(current.failureCode, failure, '字体处理失败类别'); return current; }
      if (current.status === 'ready') { assert.equal(failure, undefined); return current; }
      await pause(400);
    }
    throw new Error('独立 Worker 处理未完成');
  };
  const bytes = readFileSync(join(root, 'font-fixtures/fixture-large.ttf'));
  assert(bytes.length > 10 * 1024 * 1024, '大字体回归必须越过 API 默认 1 MiB 和旧网关 10 MB 限额');
  const draft = await request('/admin/text-fonts', 'POST', { ...config, author: '', sourceUrl: '', licenseName: '', licenseText: '', rights: { ...config.rights, conversion: false } }, 201);
  const pending = await upload(bytes, draft);
  await request(`/admin/text-fonts/jobs/${pending.jobId}/process`, 'POST', undefined, 409);
  assert.equal((await request(`/admin/text-fonts/jobs/${pending.jobId}`)).status, 'draft');
  await build(Buffer.from('PK\x03\x04not-a-font'), family, 'unsupported-font');
  await build(Buffer.from('ttcf-not-a-single-font'), family, 'unsupported-font');
  await build(Buffer.from('\x00\x01\x00\x00truncated'), family, 'invalid-font');
  await build(readFileSync(join(root, 'font-fixtures/fixture-no-subsetting.ttf')), family, 'rights-required');
  await build(readFileSync(join(root, 'font-fixtures/fixture-color.ttf')), family, 'unsupported-font');
  const first = await build(bytes);
  assert.match(first.versionId, /^tfv_[a-f0-9]{32}$/);
  const preview = await request(`/admin/text-fonts/versions/${first.versionId}/preview`);
  assert.equal(preview.status, 'preview');
  await request(`/meta/text-fonts/v2/versions/${first.versionId}`, 'GET', undefined, 404, {});
  assert.equal((await request('/meta/text-fonts/v2', 'GET', undefined, 200, {})).items.length, 0);
  const duplicate = await build(bytes);
  assert.equal(duplicate.versionId, first.versionId, '相同输入与工具链必须去重');
  const publish = async (versionId: string) => {
    const head = await request('/meta/text-fonts/v2', 'GET', undefined, 200, {});
    family = await request(`/admin/text-fonts/${family.familyId}/publish`, 'POST', { versionId, expectedFamilyRevision: family.revision, expectedCatalogRevision: head.revision }, 201);
  };
  const artifact = await db.textFontVersion.findUniqueOrThrow({ where: { id: first.versionId }, include: { artifact: true } });
  const unavailable = (artifact.artifact.assets as unknown as Data[]).find(asset => asset.format === 'woff2')!;
  const registration = assertIsolatedEnvironment();
  const objectRoot = registration.fontObjectStore!;
  const assetPath = join(objectRoot.directory, objectRoot.bucket, 'text-fonts/v2/assets', `${unavailable.sha256}.woff2`);
  assert.equal((await fetch(objectRoot.endpoint + '/' + objectRoot.bucket + '/text-fonts/v2/assets/' + unavailable.sha256 + '.woff2')).status, 403, '私有对象不能匿名下载');
  const beforeFailure = await request('/meta/text-fonts/v2', 'GET', undefined, 200, {});
  renameSync(assetPath, assetPath + '.fault');
  try {
    await request(`/admin/text-fonts/${family.familyId}/publish`, 'POST', { versionId: first.versionId, expectedFamilyRevision: family.revision, expectedCatalogRevision: beforeFailure.revision }, 503);
    assert.equal((await db.textFontVersion.findUniqueOrThrow({ where: { id: first.versionId } })).publishedAt, null);
    assert.equal((await db.textFontFamily.findUniqueOrThrow({ where: { id: family.familyId } })).currentVersionId, null);
    assert.equal((await request('/meta/text-fonts/v2', 'GET', undefined, 200, {})).revision, beforeFailure.revision);
  } finally { renameSync(assetPath + '.fault', assetPath); }
  await publish(first.versionId);
  await request(`/admin/text-fonts/${family.familyId}/publish`, 'POST', { versionId: first.versionId, expectedFamilyRevision: family.revision, expectedCatalogRevision: beforeFailure.revision }, 409);
  const descriptor = await request(`/meta/text-fonts/v2/versions/${first.versionId}`, 'GET', undefined, 200, {});
  assert.equal(descriptor.selectable, true);
  const manifestUrl = process.env.E2E_BACKEND_URL + descriptor.assetBasePath + descriptor.manifest.sha256 + '.json';
  const manifestResponse = await fetch(manifestUrl);
  assert.equal(manifestResponse.status, 200);
  const manifestBytes = Buffer.from(await manifestResponse.arrayBuffer());
  assert.equal(fontSha(manifestBytes), descriptor.manifest.sha256);
  const manifest = JSON.parse(manifestBytes.toString());
  assert.equal(manifest.manifestVersion, 2);
  for (const asset of [manifest.specimen, ...manifest.notices, ...manifest.shards.flatMap((row: Data) => [row.web, row.mobile])]) {
    const response = await fetch(process.env.E2E_BACKEND_URL + descriptor.assetBasePath + asset.sha256 + '.' + asset.format);
    assert.equal(response.status, 200);
    const data = Buffer.from(await response.arrayBuffer());
    assert.equal(data.length, asset.bytes); assert.equal(fontSha(data), asset.sha256);
    await pause(140);
  }
  const unavailableUrl = process.env.E2E_BACKEND_URL + descriptor.assetBasePath + unavailable.sha256 + '.woff2';
  const originalAsset = readFileSync(assetPath);
  renameSync(assetPath, assetPath + '.fault');
  try { assert.equal((await fetch(unavailableUrl)).status, 503); }
  finally { renameSync(assetPath + '.fault', assetPath); }
  writeFileSync(assetPath, Buffer.alloc(originalAsset.length));
  try { assert.equal((await fetch(unavailableUrl)).status, 503, '损坏的远端对象不能作为成功字节返回'); }
  finally { writeFileSync(assetPath, originalAsset); }
  const catalogResponse = await fetch(process.env.API_BASE + '/meta/text-fonts/v2');
  const etag = catalogResponse.headers.get('etag'); assert(etag); await catalogResponse.arrayBuffer();
  assert.equal((await fetch(process.env.API_BASE + '/meta/text-fonts/v2', { headers: { 'if-none-match': etag } })).status, 304);
  const subthread = await db.subthread.findFirstOrThrow({ where: { thread: { ownerId: process.env.E2E_USER_ID } } });
  const content = `<span data-wenyou-font-v2="${first.versionId}">AB 中文</span>`;
  assert.equal((await request('/meta', 'GET', undefined, 200, {})).capabilities.textFontV2WriteEnabled, false);
  await request(`/subthreads/${subthread.id}/posts`, 'POST', { content, textFontVersion: 2 }, 409, userHeaders);
  const thread = await db.thread.findUniqueOrThrow({ where: { id: subthread.threadId } });
  const body = await db.post.findFirstOrThrow({ where: { subthreadId: subthread.id, kind: 'BODY', deletedAt: null } });
  const blockedWrites: Array<[string, string, Data]> = [
    ['/drafts', 'POST', { content, textFontVersion: 2 }],
    ['/threads', 'POST', { title: '尚未就绪', content, textFontVersion: 2 }],
    [`/threads/${thread.id}/subthreads`, 'POST', { title: '尚未就绪', content, textFontVersion: 2 }],
    [`/posts/${body.id}`, 'PATCH', { content, version: body.version, textFontVersion: 2 }],
    [`/threads/${thread.id}/aggregate`, 'PATCH', { content, textFontVersion: 2, version: thread.version, defaultSubthreadVersion: subthread.version, bodyVersion: body.version, tagNames: [] }],
  ];
  for (const [path, method, payload] of blockedWrites) {
    assert.equal((await request(path, method, payload, 409, userHeaders)).code, 40020, '所有正文写入口必须通过历史就绪门禁');
  }
  assert.equal((await db.post.findUniqueOrThrow({ where: { id: body.id } })).content, body.content);
  const legacyEvidence = await prepareFontReadiness(db, first.versionId, admin.userId);
  for (let attempt = 0; !(await request('/meta', 'GET', undefined, 200, {})).capabilities.textFontV2WriteEnabled; attempt++) { assert(attempt < 60, '历史就绪状态未启用'); await pause(500); }
  const post = await request(`/subthreads/${subthread.id}/posts`, 'POST', { content, textFontVersion: 2 }, 201, userHeaders);
  assert.equal(post.content, content);
  assert.equal((await request(`/posts/${post.id}`, 'GET', undefined, 200, { ...userHeaders, 'X-Text-Font-Version': '1' })).content, 'AB 中文');
  await request(`/posts/${post.id}`, 'PATCH', { content: '旧端覆盖', version: post.version, textFontVersion: 1 }, 409, { ...userHeaders, 'X-Text-Font-Version': '1' });
  const second = await build(readFileSync(join(root, 'font-fixtures/fixture-2.ttf')));
  assert.notEqual(second.versionId, first.versionId);
  await publish(second.versionId);
  const historical = await request(`/meta/text-fonts/v2/versions/${first.versionId}`, 'GET', undefined, 200, {});
  assert.equal(historical.selectable, false); assert.equal(historical.pasteAllowed, true); assert.equal(historical.renderAllowed, true);
  await publish(first.versionId);
  assert.equal((await request(`/posts/${post.id}`, 'GET', undefined, 200, userHeaders)).content, content);
  const setEnabled = async (enabled: boolean) => {
    const head = await request('/meta/text-fonts/v2', 'GET', undefined, 200, {});
    family = await request(`/admin/text-fonts/${family.familyId}/enabled`, 'PATCH', { enabled, expectedFamilyRevision: family.revision, expectedCatalogRevision: head.revision });
  };
  await setEnabled(false);
  const disabled = await request(`/meta/text-fonts/v2/versions/${first.versionId}`, 'GET', undefined, 200, {});
  assert.equal(disabled.pasteAllowed, false); assert.equal(disabled.renderAllowed, true);
  await request(`/subthreads/${subthread.id}/posts`, 'POST', { content, textFontVersion: 2 }, 409, userHeaders);
  const preserved = await request(`/posts/${post.id}`, 'PATCH', { content: content + ' 保留原样式', version: post.version, textFontVersion: 2 }, 200, userHeaders);
  await setEnabled(true);
  const head = await request('/meta/text-fonts/v2', 'GET', undefined, 200, {});
  const withdraw = { expectedCatalogRevision: head.revision, reason: '隔离撤回验证' };
  await request(`/admin/text-fonts/versions/${first.versionId}/withdraw`, 'POST', withdraw, 403);
  const stepBefore = new Set<string>(readdirSync(fixtures.mailboxPath));
  const step = await request('/admin/auth/step-up/challenge', 'POST');
  await request('/admin/auth/step-up/verify', 'POST', { challengeId: step.challengeId, code: challengeCode(stepBefore) });
  const tombstone = await request(`/admin/text-fonts/versions/${first.versionId}/withdraw`, 'POST', withdraw, 201);
  assert.equal(tombstone.status, 'withdrawn'); assert.equal(tombstone.renderAllowed, false); assert.equal(tombstone.manifest, null);
  assert.equal((await fetch(manifestUrl)).status, 410);
  assert.equal((await request(`/posts/${post.id}`, 'GET', undefined, 200, userHeaders)).content, preserved.content);
  await request(`/subthreads/${subthread.id}/posts`, 'POST', { content, textFontVersion: 2 }, 409, userHeaders);
  assert.equal((await db.textFontVersion.findUniqueOrThrow({ where: { id: first.versionId } })).publishedAt !== null, true);
  assert.equal(readdirSync(join(process.env.TEXT_FONT_STORAGE_ROOT!, 'work')).length, 0);
  assert(await db.auditLog.count({ where: { action: 'TEXT_FONT_WITHDRAWN', targetId: first.versionId } }));
  const legacy = FONT_LEGACY_IMPORT.fonts.at(-1)!;
  const legacyContent = `<span data-wenyou-font-v1="${legacy.legacyId}">AB</span>`;
  const legacyPost = await request(`/subthreads/${subthread.id}/posts`, 'POST', { content: legacyContent, textFontVersion: 2 }, 201, userHeaders);
  let legacyFamily = await request(`/admin/text-fonts/${legacy.familyId}`);
  const legacyHead = await request('/meta/text-fonts/v2', 'GET', undefined, 200, {});
  legacyFamily = await request(`/admin/text-fonts/${legacy.familyId}/enabled`, 'PATCH', { enabled: false, expectedFamilyRevision: legacyFamily.revision, expectedCatalogRevision: legacyHead.revision });
  await request(`/subthreads/${subthread.id}/posts`, 'POST', { content: legacyContent, textFontVersion: 2 }, 409, userHeaders);
  await request(`/posts/${legacyPost.id}`, 'PATCH', { content: legacyContent + ' 保源', version: legacyPost.version, textFontVersion: 2 }, 200, userHeaders);
  const legacyDisabledHead = await request('/meta/text-fonts/v2', 'GET', undefined, 200, {});
  await request(`/admin/text-fonts/versions/${legacy.versionId}/withdraw`, 'POST', { expectedCatalogRevision: legacyDisabledHead.revision, reason: '隔离历史撤回验证' }, 201);
  assert.equal((await request(`/meta/text-fonts/v2/versions/${legacy.versionId}`, 'GET', undefined, 200, {})).status, 'withdrawn');
  assert.equal((await request('/meta', 'GET', undefined, 200, {})).capabilities.textFontV2Supported, true);
  await request(`/subthreads/${subthread.id}/posts`, 'POST', { content: legacyContent, textFontVersion: 2 }, 409, userHeaders);
  await verifyLegacyReplayPreservesState(db, admin.userId);
  await verifyFontManagement(db, request, root, admin.userId, userHeaders);
  await verifyVariableFonts(db, request, root);
  await verifyFontLease(db, request, config, bytes);
  await verifyFontWorkerRecovery(db, request, config, [bytes, readFileSync(join(root, 'font-fixtures/fixture-2.ttf'))]);
  console.log(JSON.stringify({ event: 'dynamic-font-functional-passed', runId: process.env.E2E_RUN_ID, sourceBytes: bytes.length, leaseRenewal: true, sameSessionConsumerAcceptance: false, legacyEvidence }));
}
void main().finally(() => db.$disconnect()).catch(error => { console.error(error); process.exitCode = 1; });
