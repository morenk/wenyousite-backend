import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const FONT_LEGACY_IMPORT = JSON.parse(
  readFileSync(join(__dirname, '../../contracts/thread-font-v1-import-map.json'), 'utf8'),
) as {
  sourceManifestSha256: string;
  fonts: Array<{ legacyId: string; familyId: string; versionId: string }>;
};
export const FONT_LEGACY_VERSIONS = new Map(
  FONT_LEGACY_IMPORT.fonts.map((row) => [row.legacyId, row.versionId]),
);
