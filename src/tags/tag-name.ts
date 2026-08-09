export const TAG_NAME_PATTERN = /^[a-zA-Z0-9_\u4e00-\u9fff#]+$/;
export const MAX_TAGS_PER_THREAD = 5;
export const MAX_TAG_NAME_LENGTH = 20;

export function normalizeTagName(name: string): string {
  return name.trim();
}

export function isValidTagName(name: string): boolean {
  return name.length > 0 && name.length <= MAX_TAG_NAME_LENGTH && TAG_NAME_PATTERN.test(name);
}
