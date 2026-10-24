import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { FontSandboxService, FontProcessingFailure } from '../src/text-fonts/font-sandbox.service';
import { fontBuildIdentity } from '../src/text-fonts/font-build-identity';
import { fontSha } from '../src/text-fonts/font-domain';
import { fontManifestAssets, validateFontManifest } from '../src/text-fonts/font-manifest';
import { FONT_LANGUAGE_SPECIMENS } from '../src/text-fonts/font-management-contract';
import { FontConfigurationDto } from '../src/text-fonts/dto/font-admin.dto';

type Sample = {
  id: string;
  path: string;
  language: keyof typeof FONT_LANGUAGE_SPECIMENS;
  fixture: boolean;
  sha256?: string;
  license?: string;
  reject?: string;
};

/** 不连接 API/数据库；真实字体仅在已有限额的非 root、无网络沙箱解析。 */
async function main() {
  const toolchain = resolve(process.env.TEXT_FONT_TOOLCHAIN_DIR ?? '.cache/thread-font-toolchain');
  await mkdir('.cache', { recursive: true });
  const root = await mkdtemp(resolve('.cache/font-formats-'));
  const sandbox = new FontSandboxService(
    new ConfigService({ textFonts: { toolchainDir: toolchain } }),
  );
  const records: unknown[] = [];
  let passed = false;
  try {
    if (process.env.FONT_FORMAT_ARTIFACTS)
      await mkdir(resolve(process.env.FONT_FORMAT_ARTIFACTS), { recursive: true, mode: 0o700 });
    const fixtures = join(root, 'fixtures');
    execFileSync(
      '/usr/bin/python3.12',
      [
        resolve('scripts/fonts/dynamic/make-fixtures.py'),
        '--toolchain',
        toolchain,
        '--output',
        fixtures,
      ],
      { stdio: 'pipe' },
    );
    const samples: Sample[] = ['ttf', 'otf'].flatMap((format) =>
      ['static', 'variable-1', 'variable-2'].map((kind) => ({
        id: `${kind}-${format}`,
        path: join(fixtures, `format-${kind}.${format}`),
        language: 'en' as const,
        fixture: true,
      })),
    );
    samples.push(
      ...[
        ['fixture-collection.ttc', 'unsupported-font'],
        ['fixture-color.ttf', 'unsupported-font'],
        ['fixture-svg.ttf', 'unsupported-font'],
        ['fixture-truncated.ttf', 'invalid-font'],
        ['fixture-empty-cmap.ttf', 'invalid-font'],
        ['fixture-restricted.ttf', 'rights-required'],
      ].map(([name, reject]) => ({
        id: name,
        path: join(fixtures, name),
        language: 'en' as const,
        fixture: false,
        reject,
      })),
    );
    if (process.env.FONT_FORMAT_SOURCE_ROOT) {
      const sources = JSON.parse(
        await readFile(resolve('scripts/fonts/dynamic/regression-sources.json'), 'utf8'),
      );
      for (const item of sources.fonts) {
        const path = join(
          resolve(process.env.FONT_FORMAT_SOURCE_ROOT),
          item.sha256 + '.' + item.format,
        );
        const source = await readFile(path);
        const license: Buffer = await readFile(
          join(resolve(process.env.FONT_FORMAT_SOURCE_ROOT), item.licenseSha256),
        );
        assert.equal(source.length, item.bytes);
        assert.equal(fontSha(source), item.sha256);
        assert.equal(fontSha(license), item.licenseSha256);
        samples.push({
          id: item.id,
          path,
          language: item.language,
          fixture: false,
          sha256: item.sha256,
          license: license.toString('utf8'),
        });
      }
    }
    for (const version of [1, 2])
      for (const [index, sample] of samples.entries()) {
        const directory = join(root, `v${version}-${index}`),
          input = join(directory, 'input'),
          output = join(directory, 'output'),
          verified = join(directory, 'verified');
        await mkdir(input, { recursive: true, mode: 0o700 });
        await mkdir(output, { mode: 0o700 });
        await mkdir(verified, { mode: 0o700 });
        const source = await readFile(sample.path),
          sha256 = fontSha(source);
        if (sample.sha256) assert.equal(sha256, sample.sha256);
        const configuration: FontConfigurationDto = {
          name: '字体格式回归',
          designLanguage: sample.language,
          sortOrder: 0,
          author: sample.fixture ? 'Wenyou fixture' : 'Official regression source',
          sourceUrl: 'https://example.invalid/font-regression',
          licenseName: sample.license ? 'OFL-1.1' : 'CC0-1.0',
          licenseText: sample.license ?? 'Self-authored geometric fixture.',
          specimenText: FONT_LANGUAGE_SPECIMENS[sample.language],
          rights: { redistribution: true, conversion: true, subsetting: true },
        };
        const build = await fontBuildIdentity(sha256, configuration, version);
        await copyFile(sample.path, join(input, 'source'));
        await writeFile(
          join(input, 'parameters.json'),
          JSON.stringify({
            sourceSha256: sha256,
            buildKey: build.key,
            configuration,
            parametersVersion: version,
            authorizationRuleVersion: 'admin-font-upload-v1',
          }),
          { mode: 0o600 },
        );
        if (sample.reject) {
          await assert.rejects(
            sandbox.run(input, output, { script: build.script }),
            (error) => error instanceof FontProcessingFailure && error.code === sample.reject,
          );
          records.push({ sample: sample.id, parametersVersion: version, rejected: sample.reject });
        } else {
          console.log(
            JSON.stringify({
              event: 'font-format-start',
              sample: sample.id,
              parametersVersion: version,
            }),
          );
          await sandbox.run(input, output, { script: build.script });
          const result = JSON.parse(await readFile(join(output, 'result.json'), 'utf8'));
          const document = await readFile(join(output, result.manifest.sha256 + '.json'));
          assert.equal(fontSha(document), result.manifest.sha256);
          const manifest = validateFontManifest(JSON.parse(document.toString()), build.key, sha256);
          assert(
            manifest.shards.every(
              (shard) => shard.mobile.format === (sample.path.endsWith('.otf') ? 'otf' : 'ttf'),
            ),
          );
          await writeFile(join(output, 'manifest.json'), document, { mode: 0o600 });
          await copyFile(sample.path, join(output, 'source'));
          await writeFile(
            join(output, 'verification.json'),
            JSON.stringify({ specimenText: configuration.specimenText, fixture: sample.fixture }),
            { mode: 0o600 },
          );
          try {
            await sandbox.run(output, verified, {
              script: resolve('scripts/fonts/dynamic/verify-products.py'),
            });
          } catch (error) {
            const failure = await readFile(
              join(verified, 'verification-failure.json'),
              'utf8',
            ).catch(() => '{"check":"verifier-failed"}');
            console.error(
              JSON.stringify({
                sample: sample.id,
                parametersVersion: version,
                failure: JSON.parse(failure),
              }),
            );
            throw error;
          }
          const evidence = JSON.parse(await readFile(join(verified, 'evidence.json'), 'utf8'));
          const record = {
            sample: sample.id,
            parametersVersion: version,
            sourceSha256: sha256,
            pipelineSha256: build.toolchain.pipelineSha256,
            ...evidence,
          };
          records.push(record);
          console.log(JSON.stringify({ event: 'font-format-passed', ...record }));
          if (process.env.FONT_FORMAT_ARTIFACTS) {
            const target = join(
              resolve(process.env.FONT_FORMAT_ARTIFACTS),
              `v${version}-${sample.id}`,
            );
            await mkdir(target, { mode: 0o700, recursive: true });
            for (const asset of [result.manifest, ...fontManifestAssets(manifest)]) {
              const name = asset.sha256 + '.' + asset.format;
              await copyFile(join(output, name), join(target, name));
            }
            await writeFile(
              join(target, 'evidence.json'),
              JSON.stringify(
                { ...record, manifest: result.manifest, specimen: manifest.specimen },
                null,
                2,
              ),
              { mode: 0o600 },
            );
          }
        }
        await rm(directory, { recursive: true });
      }
    passed = true;
  } finally {
    sandbox.onModuleDestroy();
    await rm(root, { recursive: true });
    if (process.env.FONT_FORMAT_ARTIFACTS)
      await writeFile(
        join(resolve(process.env.FONT_FORMAT_ARTIFACTS), 'run.json'),
        JSON.stringify({ passed, records, cleaned: true, businessWrites: 0 }, null, 2),
        { mode: 0o600 },
      );
  }
  console.log(
    JSON.stringify({
      event: 'font-formats-complete',
      cases: records.length,
      cleaned: true,
      businessWrites: 0,
    }),
  );
}
main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: 'font-formats-failed',
      failureCode: error instanceof FontProcessingFailure ? error.code : 'regression-check-failed',
      diagnostic: error instanceof FontProcessingFailure ? error.diagnostic : undefined,
    }),
  );
  process.exitCode = 1;
});
