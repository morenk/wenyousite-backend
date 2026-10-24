import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FontConfigurationDto } from './dto/font-admin.dto';
import { fontSha } from './font-domain';
import { FONT_UPLOAD_RULE_VERSION } from './font-management-contract';

export const FONT_COMPILER_PATH = join(__dirname, '../../scripts/fonts/dynamic/compile.py');
export const FONT_COMPILER_V2_PATH = join(__dirname, '../../scripts/fonts/dynamic/compile-v2.py');
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
export function fontVersionReuseKey(
  artifactKey: string,
  configuration: FontConfigurationDto,
  parametersVersion = 1,
): string {
  return parametersVersion === 1
    ? artifactKey
    : fontSha(
        canonicalFontJson({
          artifactKey,
          name: configuration.name,
          designLanguage: configuration.designLanguage,
          author: configuration.author,
          sourceUrl: configuration.sourceUrl,
          licenseName: configuration.licenseName,
          licenseText: configuration.licenseText,
          rights: configuration.rights,
          specimenText: configuration.specimenText,
        }),
      );
}

export async function fontBuildIdentity(
  sourceSha256: string,
  configuration: FontConfigurationDto,
  parametersVersion = 1,
) {
  const script = parametersVersion === 2 ? FONT_COMPILER_V2_PATH : FONT_COMPILER_PATH;
  const toolchain = {
    fontTools: '4.67.0',
    pillow: '13.0.0',
    brotli: '1.2.0',
    python: '3.12',
    pipelineSha256: fontSha(await readFile(script)),
  };
  const key = fontSha(
    canonicalFontJson(
      parametersVersion === 2
        ? {
            sourceSha256,
            parametersVersion: 2,
            authorizationRuleVersion: FONT_UPLOAD_RULE_VERSION,
            configuration: { specimenText: configuration.specimenText },
            toolchain,
            manifestVersion: 2,
          }
        : { sourceSha256, configuration, toolchain, manifestVersion: 2 },
    ),
  );
  return { key, toolchain, script };
}
