export const CATEGORY_SLUG_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,49}$/;

export function normalizeCategorySlug(value: string): string {
  return value.trim().toUpperCase();
}
