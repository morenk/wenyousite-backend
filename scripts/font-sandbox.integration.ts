import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { ObjectStorageService } from '../src/storage/object-storage.service';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { verifyIsolatedEnvironment } from './e2e-guard';
import { FontStorageService } from '../src/text-fonts/font-storage.service';
import { FontProcessingFailure, FontSandboxService } from '../src/text-fonts/font-sandbox.service';
import { FONT_SANDBOX_PROBE_PATH } from '../src/text-fonts/font-sandbox-preflight';
import { FontWorkDirectoryService } from '../src/text-fonts/font-work-directory.service';
import { newFontId } from '../src/text-fonts/font-domain';

/** 使用真实隔离边界；不是仅断言 bwrap 参数或用 mock 假装解析受限。 */
export async function verifyFontSandbox() {
  await verifyIsolatedEnvironment();
  const root = dirname(process.env.E2E_MANIFEST!);
  const config = new ConfigService({ textFonts: { storageRoot: process.env.TEXT_FONT_STORAGE_ROOT, bucket: process.env.TEXT_FONT_BUCKET, toolchainDir: process.env.TEXT_FONT_TOOLCHAIN_DIR } });
  config.set('cos', { endpoint: process.env.COS_ENDPOINT, region: 'auto', bucket: '', accessKeyId: process.env.COS_ACCESS_KEY_ID, secretAccessKey: process.env.COS_SECRET_ACCESS_KEY });
  const storage = new FontStorageService(config, new ObjectStorageService(config)), work = new FontWorkDirectoryService(storage);
  const sandbox = new FontSandboxService(config);
  const canary = join(root, 'outside-font-sandbox-canary');
  await writeFile(canary, randomBytes(32), { mode: 0o600, flag: 'wx' });
  const probe = async (name: 'boundaries' | 'wall-time' | 'oversize-output' | 'diagnostic', code: string, failure?: string, wallMs?: number, diagnostic?: unknown) => {
    const ticket = await work.create(newFontId('tfj'), 1, randomBytes(16).toString('hex'), 'import');
    try {
      const input = join(ticket.root, 'input'), output = join(ticket.root, 'output');
      await mkdir(input, { mode: 0o700 }); await mkdir(output, { mode: 0o700 });
      await writeFile(join(input, 'source'), 'synthetic-font-sandbox-input', { mode: 0o400 });
      await writeFile(join(input, 'probe.json'), JSON.stringify({ outsideCanary: canary }), { mode: 0o400 });
      const script = join(ticket.root, `${name}.py`);
      await writeFile(script, code, { mode: 0o400 });
      const run = sandbox.run(input, output, { script, wallMs });
      if (failure) await assert.rejects(run, error => {
        assert(error instanceof FontProcessingFailure);
        assert.equal(error.message, failure);
        assert.deepEqual(error.diagnostic, diagnostic);
        return true;
      });
      else {
        await run;
        assert.equal(JSON.parse(await readFile(join(output, 'evidence.json'), 'utf8')).passed, true);
      }
    } catch (error) {
      const category = error instanceof FontProcessingFailure ? error.code : error instanceof assert.AssertionError ? 'assertion' : 'unknown';
      throw new Error(`FONT_SANDBOX_PROBE_FAILURE:${name}:${category}`, { cause: error });
    } finally { await work.remove(ticket, true); }
  };
  try {
    await probe('boundaries', await readFile(FONT_SANDBOX_PROBE_PATH, 'utf8'));
    await probe('wall-time', 'while True: pass\n', 'resource-limit', 150);
    await probe('oversize-output', "open('/output/oversize.ttf', 'wb').write(b'x' * 6291457)\n", 'resource-limit');
    for (const valid of [true, false]) {
      const diagnostic = { stage: valid ? 'instantiate' : '/private/font', category: valid ? 'value-error' : 'private-message', message: 'private-message', path: '/private/font' };
      const code = `import json, sys\nsys.stderr.write('private-stderr')\nprint(json.dumps(${JSON.stringify({ failureCode: 'processing-failed', diagnostic })}))\nsys.exit(2)\n`;
      await probe('diagnostic', code, 'processing-failed', undefined, valid ? { stage: 'instantiate', category: 'value-error' } : undefined);
    }
    assert.deepEqual(await work.abandoned(), []);
  } finally { sandbox.onModuleDestroy(); }
}
