import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { Artifact } from '../../src/app-downloads/download-model';
import { initializeDownloads } from '../../src/app-downloads/download-cli';
import type { DownloadConfig } from '../../src/app-downloads/download-config';

function manifest(version: string, build: number, application = 'site.wenyou.app') {
  const strings = ['manifest', 'package', application, 'http://schemas.android.com/apk/res/android', 'versionCode', 'versionName', version];
  const values = strings.map(s => { const text = Buffer.from(s); return Buffer.concat([Buffer.from([s.length, text.length]), text, Buffer.from([0])]); });
  const start = 28 + values.length * 4, pool = Buffer.alloc(start + values.reduce((n, b) => n + b.length, 0));
  pool.writeUInt16LE(1); pool.writeUInt16LE(28, 2); pool.writeUInt32LE(pool.length, 4); pool.writeUInt32LE(strings.length, 8); pool.writeUInt32LE(0x100, 16); pool.writeUInt32LE(start, 20);
  let offset = 0; values.forEach((v, i) => { pool.writeUInt32LE(offset, 28 + i * 4); v.copy(pool, start + offset); offset += v.length; });
  const element = Buffer.alloc(36 + 60); element.writeUInt16LE(0x102); element.writeUInt16LE(16, 2); element.writeUInt32LE(element.length, 4); element.writeUInt32LE(0xffffffff, 16); element.writeUInt32LE(0, 20); element.writeUInt16LE(20, 24); element.writeUInt16LE(20, 26); element.writeUInt16LE(3, 28);
  for (const [index, ns, key, kind, value] of [[0, 0xffffffff, 1, 3, 2], [1, 3, 4, 0x10, build], [2, 3, 5, 3, 6]]) {
    const at = 36 + index * 20; element.writeUInt32LE(ns, at); element.writeUInt32LE(key, at + 4); element.writeUInt32LE(0xffffffff, at + 8); element.writeUInt16LE(8, at + 12); element[at + 15] = kind; element.writeUInt32LE(value, at + 16);
  }
  const header = Buffer.alloc(8); header.writeUInt16LE(3); header.writeUInt16LE(8, 2); header.writeUInt32LE(8 + pool.length + element.length, 4);
  return Buffer.concat([header, pool, element]);
}
function crc32(data: Buffer) { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
export function apkFixture(build = 42, bytes = 16384, application?: string) {
  const version = `0.0.0-e2e.${build}`, xml = manifest(version, build, application);
  const files = [{ name: 'AndroidManifest.xml', data: xml }, { name: 'test-padding.bin', data: Buffer.alloc(Math.max(0, bytes - xml.length), 0x6f) }];
  const locals: Buffer[] = [], directory: Buffer[] = []; let at = 0;
  for (const { name, data } of files) {
    const filename = Buffer.from(name), crc = crc32(data), local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(at, 42);
    locals.push(local, filename, data); directory.push(central, filename); at += local.length + filename.length + data.length;
  }
  const cd = Buffer.concat(directory), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(2, 8); end.writeUInt16LE(2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(at, 16);
  const buffer = Buffer.concat([...locals, cd, end]), key = `mobile/android/wenyou-${version}-${build}.apk`;
  const artifact: Artifact = { schemaVersion: 1, applicationId: 'site.wenyou.app', versionName: version, buildNumber: build, sizeBytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex'), bucket: 'wenyou-apk', key, legacyUpdateUrl: `https://wenyou-apk.cn-nb1.rains3.com/${key}` };
  return { artifact, buffer };
}
export async function isolatedFiles(parent?: string) {
  const root = await mkdtemp(join(parent ?? tmpdir(), 'download-'));
  const config: DownloadConfig = { DOWNLOAD_SOCKET: join(root, 'gateway.sock'), DOWNLOAD_CACHE_DIR: join(root, 'cache'), DOWNLOAD_CATALOG_DIR: join(root, 'catalog'), DOWNLOAD_EGRESS_DIR: join(root, 'egress'), DOWNLOAD_ORIGIN_DIR: join(root, 'origin') };
  for (const directory of [config.DOWNLOAD_CACHE_DIR, config.DOWNLOAD_CATALOG_DIR, config.DOWNLOAD_EGRESS_DIR, config.DOWNLOAD_ORIGIN_DIR]) await mkdir(directory, { mode: 0o700 });
  await initializeDownloads(config, 'egress'); await initializeDownloads(config, 'origin');
  await writeFile(join(root, 'ownership.json'), JSON.stringify({ uid: process.getuid?.(), root, isolated: true }), { mode: 0o600, flag: 'wx' });
  return { root, config };
}
