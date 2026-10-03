import type { FileHandle } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { Artifact, assertDownload } from './download-model';

async function read(file: FileHandle, start: number, size: number) {
  assertDownload(Number.isSafeInteger(start) && start >= 0 && size >= 0 && size <= 8 * 1024 ** 2);
  const buffer = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await file.read(buffer, offset, size - offset, start + offset);
    assertDownload(bytesRead > 0);
    offset += bytesRead;
  }
  return buffer;
}
/** 只解压有界 AndroidManifest.xml；APK 主体始终流式读取，不装入内存。 */
export async function inspectApk(file: FileHandle, artifact: Artifact) {
  const size = (await file.stat()).size;
  const tailStart = Math.max(0, size - 65557),
    tail = await read(file, tailStart, size - tailStart);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--)
    if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) {
      eocd = i;
      break;
    }
  assertDownload(
    eocd >= 0 && tail.readUInt16LE(eocd + 4) === 0 && tail.readUInt16LE(eocd + 6) === 0,
  );
  const entries = tail.readUInt16LE(eocd + 10),
    centralSize = tail.readUInt32LE(eocd + 12),
    centralStart = tail.readUInt32LE(eocd + 16);
  assertDownload(entries > 0 && entries < 65535 && centralStart + centralSize === tailStart + eocd);
  const central = await read(file, centralStart, centralSize);
  let cursor = 0,
    manifest: Buffer | undefined;
  for (let i = 0; i < entries; i++) {
    assertDownload(cursor + 46 <= central.length && central.readUInt32LE(cursor) === 0x02014b50);
    const nameLength = central.readUInt16LE(cursor + 28),
      extraLength = central.readUInt16LE(cursor + 30),
      commentLength = central.readUInt16LE(cursor + 32);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    assertDownload(next <= central.length);
    if (central.toString('utf8', cursor + 46, cursor + 46 + nameLength) === 'AndroidManifest.xml') {
      assertDownload(!manifest && !(central.readUInt16LE(cursor + 8) & 1));
      const method = central.readUInt16LE(cursor + 10),
        compressed = central.readUInt32LE(cursor + 20),
        expanded = central.readUInt32LE(cursor + 24),
        offset = central.readUInt32LE(cursor + 42);
      assertDownload(
        [0, 8].includes(method) && expanded > 0 && expanded <= 1024 ** 2 && compressed <= 1024 ** 2,
      );
      const local = await read(file, offset, 30);
      assertDownload(
        local.readUInt32LE(0) === 0x04034b50 &&
          local.readUInt16LE(8) === method &&
          !(local.readUInt16LE(6) & 1),
      );
      const localNameLength = local.readUInt16LE(26),
        dataStart = offset + 30 + localNameLength + local.readUInt16LE(28);
      assertDownload(dataStart + compressed <= centralStart);
      assertDownload(
        (await read(file, offset + 30, localNameLength)).toString('utf8') === 'AndroidManifest.xml',
      );
      const data = await read(file, dataStart, compressed);
      manifest = method === 8 ? inflateRawSync(data, { maxOutputLength: 1024 ** 2 }) : data;
      assertDownload(manifest.length === expanded);
    }
    cursor = next;
  }
  assertDownload(cursor === central.length && manifest);
  const identity = parseAndroidManifest(manifest);
  assertDownload(
    identity.package === artifact.applicationId &&
      identity.versionCode === artifact.buildNumber &&
      identity.versionName === artifact.versionName,
  );
}

export function parseAndroidManifest(xml: Buffer) {
  assertDownload(
    xml.length >= 8 &&
      xml.readUInt16LE(0) === 3 &&
      xml.readUInt16LE(2) === 8 &&
      xml.readUInt32LE(4) === xml.length,
  );
  const strings: string[] = [];
  let cursor = 8;
  while (cursor < xml.length) {
    assertDownload(cursor + 8 <= xml.length);
    const type = xml.readUInt16LE(cursor),
      header = xml.readUInt16LE(cursor + 2),
      size = xml.readUInt32LE(cursor + 4);
    assertDownload(header >= 8 && size >= header && cursor + size <= xml.length);
    const chunk = xml.subarray(cursor, cursor + size);
    if (type === 1) {
      assertDownload(strings.length === 0 && header >= 28);
      const count = chunk.readUInt32LE(8),
        flags = chunk.readUInt32LE(16),
        start = chunk.readUInt32LE(20);
      assertDownload(count <= 10000 && header + count * 4 <= start && start <= size);
      for (let i = 0; i < count; i++) {
        let at = start + chunk.readUInt32LE(header + i * 4);
        assertDownload(at >= start && at < size);
        const length8 = () => {
          assertDownload(at < size);
          const first = chunk[at++];
          if (!(first & 0x80)) return first;
          assertDownload(at < size);
          return ((first & 0x7f) << 8) | chunk[at++];
        };
        const length16 = () => {
          assertDownload(at + 2 <= size);
          const first = chunk.readUInt16LE(at);
          at += 2;
          if (!(first & 0x8000)) return first;
          assertDownload(at + 2 <= size);
          const second = chunk.readUInt16LE(at);
          at += 2;
          return (first & 0x7fff) * 65536 + second;
        };
        if (flags & 0x100) {
          length8();
          const length = length8();
          assertDownload(at + length < size && chunk[at + length] === 0);
          strings.push(chunk.toString('utf8', at, at + length));
        } else {
          const length = length16() * 2;
          assertDownload(at + length + 2 <= size && chunk.readUInt16LE(at + length) === 0);
          strings.push(chunk.toString('utf16le', at, at + length));
        }
      }
    } else if (type === 0x102) {
      assertDownload(header >= 16 && header + 20 <= size);
      const nameIndex = chunk.readUInt32LE(header + 4);
      assertDownload(nameIndex < strings.length);
      if (strings[nameIndex] !== 'manifest') {
        cursor += size;
        continue;
      }
      const attributesStart = header + chunk.readUInt16LE(header + 8),
        attributeSize = chunk.readUInt16LE(header + 10),
        count = chunk.readUInt16LE(header + 12);
      assertDownload(
        attributeSize >= 20 &&
          attributesStart >= header + 20 &&
          attributesStart + count * attributeSize <= size,
      );
      const found: Record<string, string | number> = {};
      for (let i = 0; i < count; i++) {
        const at = attributesStart + i * attributeSize,
          ns = chunk.readUInt32LE(at),
          name = chunk.readUInt32LE(at + 4),
          raw = chunk.readUInt32LE(at + 8),
          kind = chunk[at + 15],
          data = chunk.readUInt32LE(at + 16);
        assertDownload(name < strings.length);
        const key = strings[name];
        if (!['package', 'versionCode', 'versionName'].includes(key)) continue;
        assertDownload(!Object.hasOwn(found, key));
        assertDownload(
          key === 'package'
            ? ns === 0xffffffff
            : strings[ns] === 'http://schemas.android.com/apk/res/android',
        );
        const value =
          raw !== 0xffffffff
            ? strings[raw]
            : kind === 3
              ? strings[data]
              : kind === 0x10 || kind === 0x11
                ? data
                : undefined;
        assertDownload(value !== undefined);
        found[key] = key === 'versionCode' ? Number(value) : value;
      }
      assertDownload(
        typeof found.package === 'string' &&
          typeof found.versionName === 'string' &&
          Number.isSafeInteger(found.versionCode),
      );
      return found;
    }
    cursor += size;
  }
  throw new Error('INVALID_APK_MANIFEST');
}
