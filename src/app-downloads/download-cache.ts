import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { Artifact, Catalog, assertDownload, catalogSchema } from './download-model';
import { hashFile, readJson, safeOpen } from './download-files';
import { inspectApk } from './download-apk';

export class DownloadCache {
  private readonly verified = new Map<string, string>();
  constructor(
    readonly directory: string,
    readonly catalogDirectory: string,
  ) {}
  async catalog(): Promise<Catalog> {
    return catalogSchema.parse(await readJson(join(this.catalogDirectory, 'catalog.json')));
  }
  path(a: Artifact) {
    return join(this.directory, `${a.buildNumber}-${a.sha256}.apk`);
  }
  async open(a: Artifact): Promise<FileHandle> {
    const file = await safeOpen(this.path(a));
    try {
      const before = await file.stat({ bigint: true });
      const fingerprint = `${before.dev}:${before.ino}:${before.size}:${before.mtimeNs}:${before.ctimeNs}`;
      assertDownload(before.size === BigInt(a.sizeBytes));
      if (this.verified.get(a.sha256) !== fingerprint) {
        assertDownload((await hashFile(file, a.sizeBytes)) === a.sha256);
        await inspectApk(file, a);
        const after = await file.stat({ bigint: true });
        assertDownload(
          after.size === before.size &&
            after.ctimeNs === before.ctimeNs &&
            after.mtimeNs === before.mtimeNs,
        );
        if (this.verified.size >= 4) this.verified.delete(this.verified.keys().next().value!);
        this.verified.set(a.sha256, fingerprint);
      }
      return file;
    } catch (error) {
      await file.close();
      throw error;
    }
  }
}
