import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FontConfigurationDto } from './dto/font-admin.dto';
import { fontSha } from './font-domain';

export const FONT_COMPILER_PATH = join(__dirname, '../../scripts/fonts/dynamic/compile.py');
export function canonicalFontJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalFontJson).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map(
          (key) =>
            JSON.stringify(key) + ':' + canonicalFontJson((value as Record<string, unknown>)[key]),
        )
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export async function fontBuildIdentity(sourceSha256: string, configuration: FontConfigurationDto) {
  const toolchain = {
    fontTools: '4.67.0',
    pillow: '13.0.0',
    brotli: '1.2.0',
    python: '3.12',
    pipelineSha256: fontSha(await readFile(FONT_COMPILER_PATH)),
  };
  const key = fontSha(
    canonicalFontJson({ sourceSha256, configuration, toolchain, manifestVersion: 2 }),
  );
  return { key, toolchain };
}
