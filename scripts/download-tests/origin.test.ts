import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm, readdir, writeFile, open } from 'node:fs/promises';
import { join } from 'node:path';
import { DownloadPublisher } from '../../src/app-downloads/download-publisher';
import { DownloadBudget } from '../../src/app-downloads/download-budget';
import { DOWNLOAD_LIMITS } from '../../src/app-downloads/app-download.contract';
import { isolatedFiles, apkFixture } from './fixture';
import { privateObjectStore } from './object-store';

test('独立私有对象存储：签名 HEAD/GET、流式验证、预算与缓存命中', async () => {
  const { root, config } = await isolatedFiles(); const objectStore = await privateObjectStore(root);
  try {
    const { artifact, buffer } = apkFixture(48, 256 * 1024); await objectStore.upload(artifact, buffer);
    // 上传与读取共用本地模拟凭据：证明应用限制，不把凭据误称为云端只读。
    for(const bad of [{...artifact,bucket:'images' as typeof artifact.bucket},{...artifact,key:'mobile/images/other.apk'}]) {
      await assert.rejects(objectStore.origin.head(bad,AbortSignal.timeout(1000)));
      await assert.rejects(objectStore.origin.get(bad,AbortSignal.timeout(1000)));
    }
    assert.equal(objectStore.counts.head+objectStore.counts.get,0);
    assert.equal((await fetch(objectStore.endpoint + '/wenyou-apk/' + artifact.key)).status, 403);
    const p = new DownloadPublisher(config); await p.register(artifact);
    await Promise.all([p.warm(48, objectStore.origin), p.warm(48, objectStore.origin)]);
    assert.equal(objectStore.counts.head, 1); assert.equal(objectStore.counts.get, 1);
    assert.equal(objectStore.counts.writes,1);
    const b = new DownloadBudget(join(config.DOWNLOAD_ORIGIN_DIR, 'budget.sqlite'), 'origin', { day: DOWNLOAD_LIMITS.originDayBytes, month: DOWNLOAD_LIMITS.originMonthBytes });
    assert.equal(b.status().dayReservedBytes, buffer.length + 131072);
    const corrupt = Buffer.from(buffer); corrupt[1000] ^= 1; await objectStore.upload(artifact, corrupt); await assert.rejects(p.warm(48, objectStore.origin, true));
    assert.equal(b.status().dayReservedBytes, 2 * (buffer.length + 131072)); b.close();
    assert.equal((await readdir(config.DOWNLOAD_CACHE_DIR)).filter(p => p.endsWith('.part')).length, 0);
    const file = await p.cache.open(artifact); await file.close();
    const part = await open(join(config.DOWNLOAD_CACHE_DIR, '48-stale.part'), 'wx', 0o640); await part.truncate(DOWNLOAD_LIMITS.cacheBytes); await part.close();
    await assert.rejects(p.warm(48, objectStore.origin, true)); assert.equal(objectStore.counts.get, 2);
  } finally { await objectStore.close(); await rm(root, { recursive: true, force: true }); }
});
