import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { FONT_COMPILER_PATH } from './font-build-identity';
import { FontCompilerDiagnostic, fontCompilerDiagnostic } from './font-processing-diagnostics';
import {
  FONT_DOCUMENT_MAX_BYTES,
  FONT_OUTPUT_MAX_BYTES,
  FONT_SHARD_MAX_BYTES,
} from './font-manifest';

export const FONT_FAILURE_CODES = [
  'invalid-font',
  'unsupported-font',
  'rights-required',
  'resource-limit',
  'sandbox-unavailable',
  'processing-failed',
] as const;
export const FONT_FAILURE_REASONS = [
  'embedding-restricted',
  'subsetting-restricted',
  'bitmap-only',
] as const;
export class FontProcessingFailure extends Error {
  constructor(
    readonly code: (typeof FONT_FAILURE_CODES)[number],
    readonly reason?: (typeof FONT_FAILURE_REASONS)[number],
    readonly diagnostic?: FontCompilerDiagnostic,
  ) {
    super(code);
  }
}
export function fontSandboxArgs(
  input: string,
  output: string,
  toolchain: string,
  script = FONT_COMPILER_PATH,
): string[] {
  return [
    '--as=2147483648',
    '--cpu=600',
    '--nofile=128',
    '--core=0',
    '--fsize=67108864',
    '--',
    '/usr/bin/bwrap',
    '--unshare-net',
    '--unshare-pid',
    '--unshare-ipc',
    '--unshare-uts',
    '--die-with-parent',
    '--new-session',
    '--cap-drop',
    'ALL',
    '--clearenv',
    '--setenv',
    'LANG',
    'C.UTF-8',
    '--setenv',
    'TMPDIR',
    '/output',
    '--ro-bind',
    '/usr/bin/python3.12',
    '/usr/bin/python3.12',
    '--ro-bind',
    '/usr/lib/python3.12',
    '/usr/lib/python3.12',
    '--ro-bind',
    '/usr/lib/x86_64-linux-gnu',
    '/usr/lib/x86_64-linux-gnu',
    '--ro-bind',
    '/usr/lib64',
    '/usr/lib64',
    '--symlink',
    'usr/lib',
    '/lib',
    '--symlink',
    'usr/lib64',
    '/lib64',
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--ro-bind',
    toolchain,
    '/toolchain',
    '--ro-bind',
    input,
    '/input',
    '--bind',
    output,
    '/output',
    '--ro-bind',
    script,
    '/compiler.py',
    '--remount-ro',
    '/proc',
    '--remount-ro',
    '/dev',
    '--remount-ro',
    '/',
    '--chdir',
    '/output',
    '/usr/bin/python3.12',
    '-I',
    '-B',
    '/compiler.py',
  ];
}
async function inspectOutput(output: string): Promise<void> {
  const names = await readdir(output);
  if (names.length > 8203) throw new FontProcessingFailure('resource-limit');
  let bytes = 0;
  for (const name of names) {
    const stat = await lstat(join(output, name));
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      stat.uid !== process.getuid?.()
    )
      throw new FontProcessingFailure('processing-failed');
    const limit =
      name === 'result.json'
        ? 4096
        : /\.(?:json|png)$/u.test(name)
          ? FONT_DOCUMENT_MAX_BYTES
          : FONT_SHARD_MAX_BYTES;
    bytes += stat.size;
    if (stat.size > limit || bytes > FONT_OUTPUT_MAX_BYTES)
      throw new FontProcessingFailure('resource-limit');
  }
}

@Injectable()
export class FontSandboxService implements OnModuleDestroy {
  private readonly active = new Set<() => void>();
  constructor(private readonly config: ConfigService) {}

  onModuleDestroy(): void {
    for (const stop of this.active) stop();
  }

  async run(
    input: string,
    output: string,
    options: { script?: string; wallMs?: number } = {},
  ): Promise<void> {
    const toolchain = this.config.get<string>('textFonts.toolchainDir');
    if (
      process.platform !== 'linux' ||
      process.arch !== 'x64' ||
      !process.getuid?.() ||
      !toolchain ||
      resolve(toolchain) !== (await realpath(toolchain))
    )
      throw new FontProcessingFailure('sandbox-unavailable');
    const args = fontSandboxArgs(input, output, toolchain, options.script);
    await new Promise<void>((accept, reject) => {
      const child = spawn('/usr/bin/prlimit', args, {
        detached: true,
        env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let failure: FontProcessingFailure | undefined;
      let stdout = '',
        received = 0,
        checking = false;
      const stop = (cause: FontProcessingFailure) => {
        failure ??= cause;
        if (child.pid && child.exitCode === null && child.signalCode === null) {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH')
              failure = new FontProcessingFailure('processing-failed');
          }
        }
      };
      const shutdown = () => stop(new FontProcessingFailure('processing-failed'));
      this.active.add(shutdown);
      const deadline = setTimeout(
        () => stop(new FontProcessingFailure('resource-limit')),
        Math.min(options.wallMs ?? 600000, 600000),
      );
      const monitor = setInterval(() => {
        if (checking) return;
        checking = true;
        void inspectOutput(output)
          .catch((error: unknown) =>
            stop(
              error instanceof FontProcessingFailure
                ? error
                : new FontProcessingFailure('processing-failed'),
            ),
          )
          .finally(() => {
            checking = false;
          });
      }, 500);
      const count = (chunk: Buffer) => {
        received += chunk.length;
        if (received > 65536) stop(new FontProcessingFailure('resource-limit'));
      };
      child.stdout.on('data', (chunk: Buffer) => {
        count(chunk);
        if (received <= 65536) stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', count);
      child.once('error', () => {
        failure = new FontProcessingFailure('sandbox-unavailable');
      });
      child.once('close', (code, signal) => {
        this.active.delete(shutdown);
        clearTimeout(deadline);
        clearInterval(monitor);
        if (failure) return reject(failure);
        if (code === 0) return accept();
        if (signal === 'SIGXCPU' || signal === 'SIGXFSZ' || signal === 'SIGKILL')
          return reject(new FontProcessingFailure('resource-limit'));
        try {
          const parsed: unknown = JSON.parse(stdout);
          if (
            parsed &&
            typeof parsed === 'object' &&
            'failureCode' in parsed &&
            FONT_FAILURE_CODES.includes(parsed.failureCode as (typeof FONT_FAILURE_CODES)[number])
          )
            return reject(
              new FontProcessingFailure(
                parsed.failureCode as (typeof FONT_FAILURE_CODES)[number],
                parsed.failureCode === 'rights-required' &&
                  'failureReason' in parsed &&
                  FONT_FAILURE_REASONS.includes(
                    parsed.failureReason as (typeof FONT_FAILURE_REASONS)[number],
                  )
                  ? (parsed.failureReason as (typeof FONT_FAILURE_REASONS)[number])
                  : undefined,
                fontCompilerDiagnostic('diagnostic' in parsed ? parsed.diagnostic : undefined),
              ),
            );
        } catch {
          /* 只返回固定类别；不暴露字体正文、路径或解析器输出。 */
        }
        reject(new FontProcessingFailure(code === 1 ? 'sandbox-unavailable' : 'processing-failed'));
      });
    });
    await inspectOutput(output);
  }
}
