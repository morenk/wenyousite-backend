import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { verifyIsolatedEnvironment } from './e2e-guard';
import { fontSha } from '../src/text-fonts/font-domain';
import { fontManifestAssets, validateFontManifest } from '../src/text-fonts/font-manifest';
import { FontSandboxService } from '../src/text-fonts/font-sandbox.service';

type Data = Record<string, any>;
type Request = (path: string, method?: string, body?: unknown, status?: number, headers?: Record<string, string>) => Promise<Data>;

/** 两版编译器均经真实上传/队列/发布；字体解析和轮廓比较始终留在沙箱内。 */
export async function verifyVariableFonts(db: PrismaClient, request: Request, root: string) {
  await verifyIsolatedEnvironment();
  const samples = [1, 2].flatMap(version => ['ttf', 'otf'].map(format => ({
    version, format, source: join(root, 'font-fixtures', `fixture-variable.${format}`), privateRepro: false,
  })));
  const privateSource = process.env.E2E_FONT_REPRO_SOURCE;
  if (privateSource) {
    assert.match(process.env.E2E_FONT_REPRO_SHA256 ?? '', /^[a-f0-9]{64}$/);
    assert.equal(fontSha(await readFile(privateSource)), process.env.E2E_FONT_REPRO_SHA256, '私有复现源身份');
    samples.push({ version: 2, format: 'ttf', source: privateSource, privateRepro: true });
  }
  const sandbox = new FontSandboxService(new ConfigService({ textFonts: { toolchainDir: process.env.TEXT_FONT_TOOLCHAIN_DIR } }));
  try {
    for (const [index, sample] of samples.entries()) {
      const source = await readFile(sample.source);
      const name = '可变字体隔离-' + randomUUID();
      let familyId: string, revision: number, submissionId: string | undefined;
      if (sample.version === 1) {
        const family = await request('/admin/text-fonts', 'POST', {
          name, designLanguage: 'en', sortOrder: 0, author: 'Wenyou fixture',
          sourceUrl: 'https://example.invalid/self-authored', licenseName: 'CC0-1.0',
          licenseText: 'Self-authored geometric fixture.', specimenText: 'AB',
          rights: { redistribution: true, conversion: true, subsetting: true },
        }, 201);
        familyId = family.familyId; revision = family.revision;
      } else {
        const submission = await request('/admin/text-fonts/submissions', 'POST', { submissionId: randomUUID(), name, language: 'en' }, 201);
        familyId = submission.familyId; revision = submission.familyRevision; submissionId = submission.submissionId;
      }
      const uploaded = await request(`/admin/text-fonts/${familyId}/sources?format=${sample.format}&expectedFamilyRevision=${revision}${submissionId ? '&submissionId=' + submissionId : ''}`, 'POST', source, 201);
      if (submissionId) await request(`/admin/text-fonts/submissions/${submissionId}/process`, 'POST', { requestId: randomUUID() }, 201);
      else await request(`/admin/text-fonts/jobs/${uploaded.jobId}/process`, 'POST', undefined, 201);
      let job: Data = {};
      for (let attempt = 0; attempt < 180; attempt++) {
        job = await request(`/admin/text-fonts/jobs/${uploaded.jobId}`);
        assert.notEqual(job.status, 'failed', `可变字体 v${sample.version}/${sample.format} 处理失败`);
        if (job.status === 'ready') break;
        await new Promise(done => setTimeout(done, 300));
      }
      assert.equal(job.status, 'ready');
      const stored = await db.textFontBuildJob.findUniqueOrThrow({ where: { id: job.jobId } });
      assert.equal(stored.parametersVersion, sample.version);
      if (sample.version === 2) {
        assert.deepEqual((stored.configuration as Data).rights, { redistribution: false, conversion: false, subsetting: false });
        assert.equal((stored.uploadAuthorization as Data).sourceSha256, fontSha(source));
      }
      assert.equal((await request(`/admin/text-fonts/versions/${job.versionId}/preview`)).status, 'preview');
      await request(`/meta/text-fonts/v2/versions/${job.versionId}`, 'GET', undefined, 404, {});
      const family = await request(`/admin/text-fonts/${familyId}`), catalog = await request('/meta/text-fonts/v2');
      await request(`/admin/text-fonts/${familyId}/publish`, 'POST', {
        versionId: job.versionId, expectedFamilyRevision: family.revision, expectedCatalogRevision: catalog.revision,
      }, 201);
      const descriptor = await request(`/meta/text-fonts/v2/versions/${job.versionId}`, 'GET', undefined, 200, {});
      assert.equal(descriptor.selectable, true);
      const download = async (asset: Data) => {
        await new Promise(done => setTimeout(done, 140));
        const response = await fetch(process.env.E2E_BACKEND_URL + descriptor.assetBasePath + asset.sha256 + '.' + asset.format);
        assert.equal(response.status, 200);
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.equal(bytes.length, asset.bytes); assert.equal(fontSha(bytes), asset.sha256);
        return bytes;
      };
      const document = await download(descriptor.manifest);
      const manifest = validateFontManifest(JSON.parse(document.toString()), stored.buildKey!, fontSha(source));
      assert(manifest.shards.every(shard => shard.mobile.format === sample.format));
      const directory = join(root, `variable-font-${index}`), input = join(directory, 'input'), output = join(directory, 'output');
      await mkdir(input, { recursive: true, mode: 0o700 }); await mkdir(output, { mode: 0o700 });
      await writeFile(join(input, 'manifest.json'), document, { mode: 0o600 });
      await writeFile(join(input, 'source'), source, { mode: 0o600 });
      const products = new Map<string, Buffer>([[descriptor.manifest.sha256 + '.json', document]]);
      for (const asset of fontManifestAssets(manifest)) {
        const name = asset.sha256 + '.' + asset.format, bytes = await download(asset);
        await writeFile(join(input, name), bytes, { mode: 0o600 }); products.set(name, bytes);
      }
      await sandbox.run(input, output, { script: resolve(__dirname, 'fonts/dynamic/verify-products.py') });
      const evidence = JSON.parse(await readFile(join(output, 'evidence.json'), 'utf8'));
      assert.equal(evidence.defaultInstanceOutlines, true);
      const record = { ...evidence, runId: process.env.E2E_RUN_ID, parametersVersion: sample.version,
        sourceSha256: fontSha(source), buildKey: stored.buildKey, manifest: descriptor.manifest,
        jobId: job.jobId, versionId: job.versionId, published: true, privateRepro: sample.privateRepro,
        sameSessionConsumerAcceptance: false };
      if (sample.privateRepro && process.env.E2E_FONT_REPRO_ARTIFACTS) {
        // 只导出本轮已验证产物和固定证据，不复制原件、凭据或后台响应。
        const target = join(process.env.E2E_FONT_REPRO_ARTIFACTS, process.env.E2E_RUN_ID!);
        await mkdir(target, { mode: 0o700 });
        for (const [name, bytes] of products) await writeFile(join(target, name), bytes, { mode: 0o600, flag: 'wx' });
        await writeFile(join(target, 'evidence.json'), JSON.stringify(record, null, 2), { mode: 0o600, flag: 'wx' });
      }
      console.log(JSON.stringify({ event: 'variable-font-passed', ...record }));
    }
  } finally { sandbox.onModuleDestroy(); }
}
