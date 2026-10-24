import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FontSandboxService } from './font-sandbox.service';

export const FONT_SANDBOX_PROBE_PATH = join(
  __dirname,
  '../../scripts/fonts/dynamic/sandbox-probe.py',
);

async function assertHostKernelAccessDenied(): Promise<void> {
  assert(process.getuid?.());
  const status = await readFile('/proc/self/status', 'utf8');
  assert.match(status, /^NoNewPrivs:\s+1$/m);
  for (const key of ['CapEff', 'CapPrm', 'CapInh', 'CapAmb', 'CapBnd']) {
    assert.match(status, new RegExp(`^${key}:\\s+0+$`, 'm'));
  }
  // 只尝试打开，不读取日志也不写入 sysctl；确认移除外层 /proc 屏蔽后仍无宿主权限。
  for (const [path, mode] of [
    ['/proc/kmsg', 'r'],
    ['/dev/kmsg', 'r'],
    ['/proc/sys/kernel/hostname', 'w'],
  ] as const) {
    await assert.rejects(
      async () => {
        const file = await open(path, mode === 'w' ? 'r+' : mode);
        await file.close();
      },
      (error: NodeJS.ErrnoException) =>
        ['EACCES', 'EPERM', 'ENOENT', 'EROFS'].includes(error.code ?? ''),
    );
  }
}

export async function runFontSandboxPreflight(root: string, toolchainDir: string): Promise<void> {
  await assertHostKernelAccessDenied();
  const work = await mkdtemp(join(root, 'sandbox-preflight-'));
  const sandbox = new FontSandboxService(new ConfigService({ textFonts: { toolchainDir } }));
  try {
    const input = join(work, 'input');
    const output = join(work, 'output');
    const outsideCanary = join(work, 'outside-canary');
    await mkdir(input, { mode: 0o700 });
    await mkdir(output, { mode: 0o700 });
    await writeFile(outsideCanary, 'synthetic-private-canary', { mode: 0o600, flag: 'wx' });
    await writeFile(join(input, 'source'), 'synthetic-font-sandbox-input', { mode: 0o600 });
    await writeFile(join(input, 'probe.json'), JSON.stringify({ outsideCanary }), { mode: 0o600 });
    await sandbox.run(input, output, { script: FONT_SANDBOX_PROBE_PATH, wallMs: 15000 });
    assert.deepEqual(JSON.parse(await readFile(join(output, 'evidence.json'), 'utf8')), {
      passed: true,
    });
  } finally {
    sandbox.onModuleDestroy();
    await rm(work, { recursive: true });
  }
}

if (require.main === module) {
  const [root, toolchainDir, ...extra] = process.argv.slice(2);
  if (!root || !toolchainDir || extra.length) {
    process.stderr.write('FONT_SANDBOX_PREFLIGHT_FAILED:arguments\n');
    process.exitCode = 1;
  } else {
    void runFontSandboxPreflight(root, toolchainDir).then(
      () => process.stdout.write('FONT_SANDBOX_PREFLIGHT_PASSED\n'),
      () => {
        // 不输出异常对象、环境或路径，避免启动日志携带运行凭据。
        process.stderr.write('FONT_SANDBOX_PREFLIGHT_FAILED:boundaries\n');
        process.exitCode = 1;
      },
    );
  }
}
