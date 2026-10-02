import { join } from 'node:path';
import { DownloadBudget, DownloadInstanceLock } from './download-budget';
import {
  DownloadConfig,
  ledgerPath,
  loadDownloadConfig,
  downloadBudgetLimits,
} from './download-config';
import { DownloadPublisher } from './download-publisher';
import { StreamingApkOrigin } from './download-origin';
import { assertDownload } from './download-model';
import { readJson, syncDirectory } from './download-files';

export function parseDownloadArgs(args: string[]) {
  const [command, ...rest] = args,
    options: Record<string, string> = {};
  assertDownload(rest.length % 2 === 0);
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    assertDownload(/^--[a-z-]+$/.test(key) && !Object.hasOwn(options, key));
    options[key] = rest[i + 1];
  }
  const allowed: Record<string, string[]> = {
    'init-ledger': ['--env', '--kind'],
    register: ['--env', '--manifest'],
    warm: ['--env', '--build', '--origin-env'],
    'verify-origin': ['--env', '--build', '--origin-env'],
    repair: ['--env', '--build', '--origin-env'],
    publish: ['--env', '--build', '--published-at', '--publication-proof'],
    status: ['--env'],
    prune: ['--env'],
    'verify-cache': ['--env', '--build'],
    withdraw: ['--env'],
    pause: ['--env'],
    resume: ['--env'],
  };
  assertDownload(
    allowed[command] &&
      Object.keys(options).length === allowed[command].length &&
      Object.keys(options).every((k) => allowed[command].includes(k)),
  );
  if (options['--build'])
    assertDownload(
      /^[1-9][0-9]*$/.test(options['--build']) && Number(options['--build']) <= 2100000000,
    );
  return { command, options };
}
export async function initializeDownloads(config: DownloadConfig, kind: 'egress' | 'origin') {
  DownloadBudget.initialize(ledgerPath(config, kind), kind);
  DownloadInstanceLock.initialize(
    join(
      kind === 'egress' ? config.DOWNLOAD_EGRESS_DIR : config.DOWNLOAD_ORIGIN_DIR,
      kind === 'egress' ? 'gateway-lock.sqlite' : 'publisher-lock.sqlite',
    ),
  );
  if (kind === 'origin') {
    const publisher = new DownloadPublisher(config);
    // 初始化不得覆盖已经存在的 catalog；文件通过独占创建后再由正常原子路径更新。
    const { open } = await import('node:fs/promises');
    const file = await open(join(config.DOWNLOAD_CATALOG_DIR, 'catalog.json'), 'wx', 0o640);
    try {
      await file.chmod(0o640);
      await file.writeFile(
        JSON.stringify({
          schemaVersion: 1,
          state: 'no_release',
          recommendedBuild: null,
          artifacts: [],
        }),
      );
      await file.sync();
    } finally {
      await file.close();
    }
    await syncDirectory(config.DOWNLOAD_CATALOG_DIR);
    await publisher.cache.catalog();
  }
}
async function main() {
  const { command, options } = parseDownloadArgs(process.argv.slice(2));
  const config = await loadDownloadConfig(options['--env']),
    publisher = new DownloadPublisher(config),
    build = Number(options['--build']);
  let result: unknown;
  if (command === 'init-ledger') {
    const kind = options['--kind'];
    assertDownload(kind === 'egress' || kind === 'origin');
    await initializeDownloads(config, kind);
    result = { status: 'initialized', kind };
  } else if (command === 'register')
    result = await publisher.register(await readJson(options['--manifest'], 16384));
  else if (command === 'warm' || command === 'repair' || command === 'verify-origin') {
    const origin = await StreamingApkOrigin.fromEnvironment(options['--origin-env']);
    try {
      if (command === 'verify-origin') {
        const entry = (await publisher.cache.catalog()).artifacts.find(
          (a) => a.artifact.buildNumber === build,
        );
        assertDownload(entry);
        const budget = new DownloadBudget(
          ledgerPath(config, 'origin'),
          'origin',
          downloadBudgetLimits(config, 'origin'),
        );
        try {
          budget.reserve(128 * 1024);
          await origin.head(entry.artifact, AbortSignal.timeout(30_000));
          result = { status: 'verified', buildNumber: build };
        } finally {
          budget.close();
        }
      } else result = await publisher.warm(build, origin, command === 'repair');
    } finally {
      origin.close();
    }
  } else if (command === 'publish') {
    // 证明由受限 PostgreSQL 发布 CLI 从已提交记录导出，非任意远程输入。
    const { verifyPublicationProof } = await import('./download-publication-proof');
    const proof = await verifyPublicationProof(
      options['--publication-proof'],
      build,
      options['--published-at'],
    );
    const entry = (await publisher.cache.catalog()).artifacts.find(
      (a) => a.artifact.buildNumber === build,
    );
    assertDownload(
      entry &&
        proof.sha256 === entry.artifact.sha256 &&
        proof.sizeBytes === entry.artifact.sizeBytes &&
        proof.versionName === entry.artifact.versionName,
    );
    result = await publisher.publish(build, options['--published-at']);
  } else if (command === 'verify-cache') {
    const entry = (await publisher.cache.catalog()).artifacts.find(
      (a) => a.artifact.buildNumber === build,
    );
    assertDownload(entry);
    const file = await publisher.cache.open(entry.artifact);
    await file.close();
    result = { status: 'ready', buildNumber: build };
  } else if (command === 'prune') {
    assertDownload(process.getuid?.() === 0);
    const lock = new DownloadInstanceLock(join(config.DOWNLOAD_EGRESS_DIR, 'gateway-lock.sqlite'));
    try {
      result = await publisher.prune();
    } finally {
      lock.close();
    }
  } else if (command === 'withdraw' || command === 'pause' || command === 'resume')
    result = await publisher.policy(command);
  else {
    const catalog = await publisher.cache.catalog();
    const budget = new DownloadBudget(
      ledgerPath(config, 'origin'),
      'origin',
      downloadBudgetLimits(config, 'origin'),
    );
    try {
      result = {
        status: catalog.state,
        recommendedBuild: catalog.recommendedBuild,
        ...budget.status(),
      };
    } finally {
      budget.close();
    }
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
if (require.main === module)
  void main().catch(() => {
    process.stderr.write('DOWNLOAD_COMMAND_FAILED\n');
    process.exitCode = 1;
  });
