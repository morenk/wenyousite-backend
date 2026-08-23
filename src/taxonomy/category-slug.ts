export const CATEGORY_SLUG_PATTERN = /^[A-Z][A-Z0-9_]{0,49}$/;
export const CATEGORY_SLUG_PATTERN_SOURCE = CATEGORY_SLUG_PATTERN.source;
export const CATEGORY_SLUG_MIN_LENGTH = 1;
export const CATEGORY_SLUG_MAX_LENGTH = 50;

export function normalizeCategorySlug(value: string): string {
  return value.trim().toUpperCase();
}

export function normalizeCategorySlugValue(value: unknown): unknown {
  return typeof value === 'string' ? normalizeCategorySlug(value) : value;
}

export function trimStringValue(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}
