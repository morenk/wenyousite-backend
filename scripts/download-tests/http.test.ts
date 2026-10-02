import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request, type IncomingHttpHeaders } from 'node:http';
import { join } from 'node:path';
import { rm, rename, readFile, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { performance } from 'node:perf_hooks';
import { startDownloadGateway } from '../../src/app-downloads/download-main';
import { DownloadPublisher } from '../../src/app-downloads/download-publisher';
import { DownloadBudget } from '../../src/app-downloads/download-budget';
import { DOWNLOAD_LIMITS } from '../../src/app-downloads/app-download.contract';
import { isolatedFiles, apkFixture } from './fixture';

function http(socketPath: string, path: string, method = 'GET', headers: IncomingHttpHeaders = {}) {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer; elapsed: number }>((resolve, reject) => {
    const start = performance.now();
    const req = request({ socketPath, path, method, headers: { 'x-real-ip': '127.0.0.1', ...headers } }, res => {
      const chunks: Buffer[] = []; res.on('data', b => chunks.push(b)); res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks), elapsed: performance.now() - start }));
    }); req.on('error', reject); req.end();
  });
}
test('真实 UDS：匿名 JSON、旧 APP HEAD/GET、Range、撤回与 miss 绝不回源', async () => {
  const { root, config } = await isolatedFiles(), { artifact, buffer } = apkFixture(42, 96 * 1024), publisher = new DownloadPublisher(config);
  let sourceReads = 0, server: Awaited<ReturnType<typeof startDownloadGateway>> | undefined;
  const budgetPath = join(config.DOWNLOAD_EGRESS_DIR, 'budget.sqlite');
  const budget = () => new DownloadBudget(budgetPath, 'egress', { day: DOWNLOAD_LIMITS.outboundDayBytes, month: DOWNLOAD_LIMITS.outboundMonthBytes });
  try {
    await publisher.register(artifact); await publisher.warm(42, { async head() { sourceReads++; }, async get() { sourceReads++; return Readable.from([buffer]); }, close() {} }); await publisher.publish(42, '2026-10-02T00:00:00.000Z');
    server = await startDownloadGateway(config);
    await assert.rejects(startDownloadGateway({ ...config, DOWNLOAD_SOCKET: join(root, 'other.sock') }));
    const originReads = sourceReads, filePath = '/api/v1/app-downloads/android/42/file';
    const info = await http(config.DOWNLOAD_SOCKET, '/api/v1/app-downloads/android'); assert.equal(info.status, 200); assert.equal(JSON.parse(info.body.toString()).data.status, 'available');
    const b = budget(), before = b.status().dayReservedBytes;
    const head = await http(config.DOWNLOAD_SOCKET, filePath, 'HEAD'); assert.equal(head.status, 200); assert.equal(head.body.length, 0); assert.equal(head.headers['content-length'], String(buffer.length)); assert.equal(head.headers['x-amz-meta-apk-sha256'], artifact.sha256); assert.equal(head.headers['x-amz-meta-application-id'], 'site.wenyou.app'); assert.equal(b.status().dayReservedBytes, before);
    for (let n = 0; n < 35; n++) { const health = await http(config.DOWNLOAD_SOCKET, '/__health'); assert.deepEqual(JSON.parse(health.body.toString()), { status: 'ok' }); }
    assert.equal(b.status().dayReservedBytes, before);
    const get = await http(config.DOWNLOAD_SOCKET, filePath); assert.equal(get.status, 200); assert.deepEqual(get.body, buffer); assert.ok(get.elapsed >= buffer.length / 250000 * 1000 - 50); assert.equal(b.status().dayReservedBytes - before, buffer.length);
    const range = await http(config.DOWNLOAD_SOCKET, filePath, 'GET', { range: 'bytes=9-99' }); assert.equal(range.status, 206); assert.deepEqual(range.body, buffer.subarray(9, 100)); assert.equal(range.headers['content-range'], `bytes 9-99/${buffer.length}`);
    assert.equal((await http(config.DOWNLOAD_SOCKET, filePath, 'HEAD', { range: 'bytes=0-1,3-4' })).status, 416);
    await publisher.policy('pause'); assert.equal((await http(config.DOWNLOAD_SOCKET, filePath, 'HEAD')).status, 503); assert.equal(JSON.parse((await http(config.DOWNLOAD_SOCKET, '/api/v1/app-downloads/android')).body.toString()).data.status, 'paused'); await publisher.policy('resume');
    const cachePath = publisher.cache.path(artifact); await rename(cachePath, cachePath + '.missing');
    assert.equal((await http(config.DOWNLOAD_SOCKET, filePath)).status, 503); assert.equal(JSON.parse((await http(config.DOWNLOAD_SOCKET, '/api/v1/app-downloads/android')).body.toString()).data.status, 'unavailable'); assert.equal(sourceReads, originReads);
    await rename(cachePath + '.missing', cachePath); await publisher.policy('withdraw'); assert.equal((await http(config.DOWNLOAD_SOCKET, filePath)).status, 503); assert.equal(JSON.parse((await http(config.DOWNLOAD_SOCKET, '/api/v1/app-downloads/android')).body.toString()).data.status, 'withdrawn');
    b.close(); await server.close(); server = undefined;
    server = await startDownloadGateway(config); const restored = budget(); assert.ok(restored.status().dayReservedBytes > buffer.length); restored.close();
  } finally { await server?.close(); await rm(root, { recursive: true, force: true }); }
});
test('失败与 HEAD 共用 30/min，用户伪造转发头无效，预算满时 info 不再 available', async () => {
  const { root, config } = await isolatedFiles(), { artifact, buffer } = apkFixture(), p = new DownloadPublisher(config);
  let server: Awaited<ReturnType<typeof startDownloadGateway>> | undefined;
  try {
    await p.register(artifact); await p.warm(42, { async head() {}, async get() { return Readable.from([buffer]); }, close() {} }); await p.publish(42, '2026-10-02T00:00:00.000Z'); server = await startDownloadGateway(config);
    for (let i = 0; i < 30; i++) assert.equal((await http(config.DOWNLOAD_SOCKET, '/api/v1/app-downloads/android/123/file', 'HEAD', { 'x-forwarded-for': `10.1.1.${i}` })).status, 404);
    const denied = await http(config.DOWNLOAD_SOCKET, '/api/v1/app-downloads/android/42/file', 'HEAD'); assert.equal(denied.status, 429); assert.ok(Number(denied.headers['retry-after']) > 0);
    const b = new DownloadBudget(join(config.DOWNLOAD_EGRESS_DIR, 'budget.sqlite'), 'egress', { day: DOWNLOAD_LIMITS.outboundDayBytes, month: DOWNLOAD_LIMITS.outboundMonthBytes });
    b.reserve(DOWNLOAD_LIMITS.outboundDayBytes - b.status().dayReservedBytes - 1000);
    const info = await http(config.DOWNLOAD_SOCKET, '/api/v1/app-downloads/android', 'GET', { 'x-real-ip': '127.0.0.2' }); assert.equal(info.status, 200); assert.equal(JSON.parse(info.body.toString()).data.status, 'paused');
    b.reserve(1000 - Buffer.byteLength(info.body)); const response = await http(config.DOWNLOAD_SOCKET, '/api/v1/app-downloads/android/42/file', 'GET', { 'x-real-ip': '127.0.0.2' }); assert.equal(response.status, 429); assert.equal(response.body.length, 0); b.close();
    const text = (await readFile(join(config.DOWNLOAD_CATALOG_DIR, 'catalog.json'))).toString(); await writeFile(join(config.DOWNLOAD_CATALOG_DIR, 'catalog.json'), '{}');
    assert.equal((await http(config.DOWNLOAD_SOCKET, '/api/v1/app-downloads/android', 'HEAD', { 'x-real-ip': '127.0.0.3' })).status, 503); await writeFile(join(config.DOWNLOAD_CATALOG_DIR, 'catalog.json'), text);
  } finally { await server?.close(); await rm(root, { recursive: true, force: true }); }
});
test('真实慢连接：全局/IP 并发拒绝、健康旁路、中断不退款并释放槽位', async () => {
  const { root, config } = await isolatedFiles(), { artifact, buffer } = apkFixture(42, 2 * 1024 ** 2), p = new DownloadPublisher(config);
  let server: Awaited<ReturnType<typeof startDownloadGateway>> | undefined;
  const held: Array<ReturnType<typeof request>> = [];
  try {
    await p.register(artifact); await p.warm(42, { async head() {}, async get() { return Readable.from([buffer]); }, close() {} }); await p.publish(42, '2026-10-02T00:00:00.000Z'); server = await startDownloadGateway(config);
    const path = '/api/v1/app-downloads/android/42/file';
    for (const ip of ['127.0.0.1', '127.0.0.1', '127.0.0.2', '127.0.0.2']) await new Promise<void>((ok, fail) => {
      const r = request({ socketPath: config.DOWNLOAD_SOCKET, path, headers: { 'x-real-ip': ip } }, response => { assert.equal(response.statusCode, 200); response.pause(); ok(); }); held.push(r); r.on('error', error => { if (!r.destroyed) fail(error); }); r.end();
    });
    assert.equal((await http(config.DOWNLOAD_SOCKET, path, 'HEAD', { 'x-real-ip': '127.0.0.3' })).status, 429);
    assert.equal((await http(config.DOWNLOAD_SOCKET, path, 'HEAD')).status, 429);
    assert.equal((await http(config.DOWNLOAD_SOCKET, '/__health')).status, 200);
    const b = new DownloadBudget(join(config.DOWNLOAD_EGRESS_DIR, 'budget.sqlite'), 'egress', { day: DOWNLOAD_LIMITS.outboundDayBytes, month: DOWNLOAD_LIMITS.outboundMonthBytes });
    const reserved = b.status().dayReservedBytes; assert.equal(reserved, 4 * buffer.length);
    held.forEach(r => r.destroy());
    for (let i = 0; i < 100 && server.gateway.admission.count(); i++) await new Promise(ok => setTimeout(ok, 10));
    assert.equal(server.gateway.admission.count(), 0); assert.equal(b.status().dayReservedBytes, reserved);
    assert.equal((await http(config.DOWNLOAD_SOCKET, path, 'HEAD', { 'x-real-ip': '127.0.0.3' })).status, 200); b.close();
  } finally { held.forEach(r => r.destroy()); await server?.close(); await rm(root, { recursive: true, force: true }); }
});
