import { TEXT_FONT_ASSET_INDEX } from './text-font-assets.generated';

/** 固定构建目录是身份与可用性的唯一源，拒绝 CSS 名称和任意 URL。 */
export const TEXT_FONT_IDS = TEXT_FONT_ASSET_INDEX.fonts.map((font) => font.id);
export const TEXT_FONT_PENDING_IDS: readonly string[] = TEXT_FONT_ASSET_INDEX.fonts
  .filter((font) => font.availability !== 'ready')
  .map((font) => font.id);
export const isTextFontId = (id: string): boolean =>
  (TEXT_FONT_IDS as readonly string[]).includes(id);
export const isTextFontSourceReady = (id: string): boolean =>
  isTextFontId(id) && !TEXT_FONT_PENDING_IDS.includes(id);
