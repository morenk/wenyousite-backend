import { z } from 'zod';
import { safeOpen } from './download-files';
import { assertDownload } from './download-model';

const proofSchema = z
  .object({
    schemaVersion: z.literal(1),
    platform: z.literal('android'),
    versionName: z.string(),
    buildNumber: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    sizeBytes: z.number().int().positive(),
    publishedAt: z.iso.datetime(),
    operationId: z.string().uuid(),
  })
  .strict();
export async function verifyPublicationProof(path: string, build: number, publishedAt: string) {
  const file = await safeOpen(path);
  try {
    const stat = await file.stat();
    assertDownload(stat.uid === 0 && (stat.mode & 0o027) === 0 && stat.size < 16384);
    const proof = proofSchema.parse(JSON.parse(await file.readFile('utf8')));
    assertDownload(proof.buildNumber === build && proof.publishedAt === publishedAt);
    return proof;
  } finally {
    await file.close();
  }
}
