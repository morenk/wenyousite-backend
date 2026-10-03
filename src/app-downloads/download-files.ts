import { constants } from 'node:fs';
import { FileHandle, lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { assertDownload } from './download-model';

export async function safeDirectory(path: string) {
  assertDownload((await realpath(path)) === resolve(path));
  const st = await lstat(path);
  assertDownload(st.isDirectory() && (st.mode & 0o022) === 0);
}
export async function safeOpen(path: string): Promise<FileHandle> {
  await safeDirectory(dirname(path));
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const st = await file.stat();
    assertDownload(st.isFile() && st.nlink === 1 && (st.mode & 0o022) === 0);
    return file;
  } catch (error) {
    await file.close();
    throw error;
  }
}
export async function readJson(path: string, maxBytes = 8 * 1024 ** 2): Promise<unknown> {
  const file = await safeOpen(path);
  try {
    assertDownload((await file.stat()).size <= maxBytes);
    return JSON.parse(await file.readFile('utf8')) as unknown;
  } finally {
    await file.close();
  }
}
export async function syncDirectory(path: string) {
  const directory = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
export async function atomicJson(path: string, data: unknown) {
  await safeDirectory(dirname(path));
  const next = `${path}.${randomUUID()}.tmp`;
  const file = await open(next, 'wx', 0o640);
  try {
    await file.chmod(0o640);
    await file.writeFile(JSON.stringify(data));
    await file.sync();
    await file.close();
    await rename(next, path);
    await syncDirectory(dirname(path));
  } catch (error) {
    await file.close().catch(() => undefined);
    await unlink(next).catch(() => undefined);
    throw error;
  }
}
export async function hashFile(file: FileHandle, size: number) {
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(64 * 1024);
  let position = 0;
  while (position < size) {
    const { bytesRead } = await file.read(
      buffer,
      0,
      Math.min(buffer.length, size - position),
      position,
    );
    assertDownload(bytesRead > 0);
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  assertDownload((await file.stat()).size === size);
  return hash.digest('hex');
}
