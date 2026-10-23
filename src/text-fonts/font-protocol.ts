/** 身份语法不包含客户端构建时目录；历史 v1 身份由独立协议维护。 */
export const FONT_VERSION_PATTERN = '^tfv_[a-f0-9]{32}$';
export const FONT_FAMILY_PATTERN = '^tff_[a-f0-9]{32}$';
export const FONT_JOB_PATTERN = '^tfj_[a-f0-9]{32}$';
export const FONT_RELEASE_PATTERN = '^tfc_[a-f0-9]{32}$';
export const FONT_SHA_PATTERN = '^[a-f0-9]{64}$';
export const FONT_SORT_ORDER_LIMIT = 1000000;
export const FONT_SOURCE_MAX_BYTES = 64 * 1024 * 1024;
export const FONT_FORMATS = ['woff2', 'ttf', 'otf', 'json', 'png'] as const;
export type FontAssetFormat = (typeof FONT_FORMATS)[number];
