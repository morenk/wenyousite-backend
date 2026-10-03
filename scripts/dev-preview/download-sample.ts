/** 下载页面专用合成样本，绝不读取真实快照或真实对象存储。 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { initializeDownloads } from '../../src/app-downloads/download-cli';
import { DownloadPublisher } from '../../src/app-downloads/download-publisher';
import type { DownloadConfig } from '../../src/app-downloads/download-config';
import { apkFixture } from '../download-tests/fixture';
import { Session, hash, writePrivate } from './common';
import { clients, verifyResources } from './resources';

export function sampleDownloadConfig(s: Session): DownloadConfig {
  return { DOWNLOAD_SOCKET: join(s.root, 'socket/download.sock'), DOWNLOAD_CACHE_DIR: join(s.root, 'download-cache'), DOWNLOAD_CATALOG_DIR: join(s.root, 'download-catalog'), DOWNLOAD_EGRESS_DIR: join(s.root, 'download-egress'), DOWNLOAD_ORIGIN_DIR: join(s.root, 'download-origin'), DOWNLOAD_PREVIEW_RUN_ID: s.runId };
}
export async function prepareDownloadSample(s: Session) {
  const config = sampleDownloadConfig(s);
  if (!existsSync(join(config.DOWNLOAD_ORIGIN_DIR, 'budget.sqlite'))) {
    const { mkdir } = await import('node:fs/promises');
    for (const path of [config.DOWNLOAD_CACHE_DIR, config.DOWNLOAD_CATALOG_DIR, config.DOWNLOAD_EGRESS_DIR, config.DOWNLOAD_ORIGIN_DIR]) await mkdir(path, { mode: 0o700 });
    await initializeDownloads(config, 'egress'); await initializeDownloads(config, 'origin');
    const { artifact, buffer } = apkFixture(4242, 128 * 1024), publisher = new DownloadPublisher(config);
    const {db,redis} = clients(s);
    try {
      await verifyResources(s,db,redis);
      await db.mobileRelease.create({data:{platform:'android',versionName:artifact.versionName,buildNumber:artifact.buildNumber,summary:'下载页合成样本（不可安装）',items:['仅用于隔离下载联调'],confirmedItems:[],publishedRevision:1,publishedSummary:'下载页合成样本（不可安装）',publishedItems:['仅用于隔离下载联调'],publishedAt:new Date()}});
    } finally { redis.disconnect(); await db.$disconnect(); }
    await publisher.register(artifact); await publisher.warm(artifact.buildNumber, { async head() {}, async get() { return Readable.from([buffer]); }, close() {} });
    await publisher.publish(artifact.buildNumber, new Date().toISOString());
    writePrivate(join(s.root, 'download-fixture.json'), { version: 1, runId: s.runId, synthetic: true, installable: false, buildNumber: artifact.buildNumber, sizeBytes: artifact.sizeBytes, sha256: artifact.sha256 });
  }
  const text = Object.entries(config).map(([k,v]) => `${k}=${v}`).join('\n') + '\n';
  writeFileSync(join(s.root, 'download.env'), text, { mode: 0o600 });
}
export const DOWNLOAD_SAMPLE_HASH = hash('wenyou-download-synthetic-sample-v1');
