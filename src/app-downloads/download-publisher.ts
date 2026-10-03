import { open, readdir, lstat, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { DOWNLOAD_LIMITS } from './app-download.contract';
import { DownloadBudget, DownloadInstanceLock } from './download-budget';
import { DownloadCache } from './download-cache';
import { DownloadConfig, ledgerPath, downloadBudgetLimits } from './download-config';
import { atomicJson, safeDirectory, syncDirectory } from './download-files';
import { Artifact, Catalog, artifactSchema, assertDownload } from './download-model';
import { OriginReader } from './download-origin';
import { inspectApk } from './download-apk';

export class DownloadPublisher {
  readonly cache: DownloadCache;
  constructor(readonly config: DownloadConfig) {
    this.cache = new DownloadCache(config.DOWNLOAD_CACHE_DIR, config.DOWNLOAD_CATALOG_DIR);
  }
  async locked<T>(use: () => Promise<T>, waitMs = 120_000): Promise<T> {
    const until = Date.now() + waitMs;
    let lock: DownloadInstanceLock | undefined;
    while (!lock) {
      try {
        lock = new DownloadInstanceLock(
          join(this.config.DOWNLOAD_ORIGIN_DIR, 'publisher-lock.sqlite'),
        );
      } catch (error) {
        if ((error as { errcode?: number }).errcode !== 5 || Date.now() >= until) throw error;
        await delay(100);
      }
    }
    try {
      return await use();
    } finally {
      lock.close();
    }
  }
  async register(input: unknown) {
    const artifact = artifactSchema.parse(input);
    return this.locked(async () => {
      const catalog = await this.cache.catalog();
      const prior = catalog.artifacts.find((a) => a.artifact.buildNumber === artifact.buildNumber);
      if (prior) assertDownload(JSON.stringify(prior.artifact) === JSON.stringify(artifact));
      else {
        catalog.artifacts.push({ artifact, publishedAt: null });
        await this.save(catalog);
      }
      return { status: 'registered', buildNumber: artifact.buildNumber };
    });
  }
  async warm(build: number, origin: OriginReader, repair = false) {
    const requestedAt = Date.now();
    return this.locked(async () => {
      const catalog = await this.cache.catalog();
      const artifact = catalog.artifacts.find((a) => a.artifact.buildNumber === build)?.artifact;
      assertDownload(artifact);
      try {
        const file = await this.cache.open(artifact);
        const stat = await file.stat();
        await file.close();
        if (!repair || stat.ctimeMs >= requestedAt)
          return { status: 'ready', buildNumber: build, fetched: false };
      } catch {
        /* 仅显式预热可修复缺失或损坏，不向公众暴露此能力。 */
      }
      await this.ensureSpace(artifact.sizeBytes);
      const budget = new DownloadBudget(
        ledgerPath(this.config, 'origin'),
        'origin',
        downloadBudgetLimits(this.config, 'origin'),
      );
      try {
        // 每次尝试包含完整对象及有界错误/元数据余量；SDK 不进行隐藏重试。
        for (let attempt = 0; attempt < 2; attempt++) {
          budget.reserve(artifact.sizeBytes + 128 * 1024);
          try {
            await this.fetch(artifact, origin);
            return { status: 'ready', buildNumber: build, fetched: true };
          } catch (error) {
            const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
              ?.httpStatusCode;
            if (attempt !== 0 || !status || ![500, 502, 503, 504].includes(status)) throw error;
            await delay(500);
          }
        }
        throw new Error('PREWARM_FAILED');
      } finally {
        budget.close();
      }
    });
  }
  private async fetch(a: Artifact, origin: OriginReader) {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 600_000);
    const temporary = join(this.config.DOWNLOAD_CACHE_DIR, `${a.buildNumber}-${randomUUID()}.part`);
    let file: Awaited<ReturnType<typeof open>> | undefined;
    let stream: Awaited<ReturnType<OriginReader['get']>> | undefined;
    try {
      await origin.head(a, controller.signal);
      file = await open(temporary, 'wx+', 0o640);
      await file.chmod(0o640);
      stream = await origin.get(a, controller.signal);
      const hash = createHash('sha256');
      let size = 0;
      for await (const chunk of stream) {
        assertDownload(Buffer.isBuffer(chunk));
        size += chunk.length;
        assertDownload(size <= a.sizeBytes);
        hash.update(chunk);
        let offset = 0;
        while (offset < chunk.length) {
          const { bytesWritten } = await file.write(chunk, offset, chunk.length - offset);
          assertDownload(bytesWritten > 0);
          offset += bytesWritten;
        }
      }
      assertDownload(size === a.sizeBytes && hash.digest('hex') === a.sha256);
      await inspectApk(file, a);
      await file.sync();
      await file.close();
      file = undefined;
      const destination = this.cache.path(a);
      try {
        // 修复替换也不能 unlink 在途 inode：旧文件保留为计入容量的 .part，离线再清理。
        await rename(
          destination,
          join(this.config.DOWNLOAD_CACHE_DIR, `${a.buildNumber}-${randomUUID()}.part`),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await rename(temporary, destination);
      await syncDirectory(this.config.DOWNLOAD_CACHE_DIR);
    } finally {
      clearTimeout(timer);
      controller.abort();
      stream?.destroy();
      await file?.close();
      await unlink(temporary).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
    }
  }
  private async ensureSpace(required: number) {
    await safeDirectory(this.config.DOWNLOAD_CACHE_DIR);
    let total = required;
    for (const name of await readdir(this.config.DOWNLOAD_CACHE_DIR)) {
      const stat = await lstat(join(this.config.DOWNLOAD_CACHE_DIR, name));
      assertDownload(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
      total += stat.size;
    }
    // 保守计入旧 inode、未完成 .part 与本次空间；运行时不 unlink 可能仍在发送的文件。
    assertDownload(total <= DOWNLOAD_LIMITS.cacheBytes);
  }
  async publish(build: number, publishedAt: string) {
    return this.locked(async () => {
      const catalog = await this.cache.catalog(),
        entry = catalog.artifacts.find((a) => a.artifact.buildNumber === build);
      assertDownload(entry && new Date(publishedAt).toISOString() === publishedAt);
      assertDownload(catalog.recommendedBuild === null || build >= catalog.recommendedBuild);
      const file = await this.cache.open(entry.artifact);
      await file.close();
      if (entry.publishedAt) assertDownload(entry.publishedAt === publishedAt);
      entry.publishedAt = publishedAt;
      catalog.recommendedBuild = build;
      catalog.state = 'available';
      await this.save(catalog);
      return { status: 'published', buildNumber: build };
    });
  }
  async policy(action: 'withdraw' | 'pause' | 'resume') {
    return this.locked(async () => {
      const catalog = await this.cache.catalog();
      if (action === 'resume') {
        assertDownload(catalog.state === 'paused' && catalog.recommendedBuild !== null);
        const entry = catalog.artifacts.find(
          (a) => a.artifact.buildNumber === catalog.recommendedBuild && a.publishedAt,
        );
        assertDownload(entry);
        const file = await this.cache.open(entry.artifact);
        await file.close();
        catalog.state = 'available';
      } else {
        if (action === 'pause')
          assertDownload(catalog.state === 'available' || catalog.state === 'paused');
        catalog.state = action === 'withdraw' ? 'withdrawn' : 'paused';
      }
      await this.save(catalog);
      return { status: catalog.state };
    });
  }
  async prune() {
    return this.locked(async () => {
      const catalog = await this.cache.catalog();
      const recent = catalog.artifacts
        .filter((a) => a.publishedAt && a.artifact.buildNumber !== catalog.recommendedBuild)
        .sort((a, b) => b.artifact.buildNumber - a.artifact.buildNumber)
        .slice(0, 2);
      const keep = new Set([
        ...recent.map((a) => a.artifact.buildNumber),
        catalog.recommendedBuild,
      ]);
      const known = new Set(
        catalog.artifacts
          .filter((a) => !keep.has(a.artifact.buildNumber))
          .map((a) => `${a.artifact.buildNumber}-${a.artifact.sha256}.apk`),
      );
      let removed = 0;
      await safeDirectory(this.config.DOWNLOAD_CACHE_DIR);
      for (const name of await readdir(this.config.DOWNLOAD_CACHE_DIR)) {
        if (!known.has(name) && !/^[1-9][0-9]*-[0-9a-f-]{36}\.part$/.test(name)) continue;
        const path = join(this.config.DOWNLOAD_CACHE_DIR, name),
          stat = await lstat(path);
        assertDownload(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
        await unlink(path);
        removed++;
      }
      await syncDirectory(this.config.DOWNLOAD_CACHE_DIR);
      return { status: 'pruned', removed };
    });
  }

  async save(catalog: Catalog) {
    await atomicJson(join(this.config.DOWNLOAD_CATALOG_DIR, 'catalog.json'), catalog);
  }
}
