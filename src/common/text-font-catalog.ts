import { TEXT_FONT_ASSET_INDEX } from './text-font-assets.generated';

/** 退役身份仍用于解析和保护历史正文，不进入当前可选目录。 */
export const TEXT_FONT_RETIRED_IDS = ['xiaocheng-lafeng'] as const;
export const TEXT_FONT_IDS = [
  ...TEXT_FONT_ASSET_INDEX.fonts.map((font) => font.id), ...TEXT_FONT_RETIRED_IDS,
];
export const TEXT_FONT_PENDING_IDS: readonly string[] = TEXT_FONT_ASSET_INDEX.fonts
  .filter((font) => font.availability !== 'ready')
  .map((font) => font.id);
export const isTextFontId = (id: string): boolean =>
  (TEXT_FONT_IDS as readonly string[]).includes(id);
export const isTextFontSourceReady = (id: string): boolean =>
  TEXT_FONT_ASSET_INDEX.fonts.some((font) => font.id === id && font.availability === 'ready');
