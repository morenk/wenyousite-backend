import { MediaPurpose } from '@prisma/client';

export const MEDIA_PURPOSES = [
  MediaPurpose.AVATAR,
  MediaPurpose.PROFILE_COVER,
  MediaPurpose.DIRECT_MESSAGE,
  MediaPurpose.MOMENT,
  MediaPurpose.MOMENT_COMMENT,
  MediaPurpose.RICH_CONTENT,
  MediaPurpose.STICKER_SOURCE,
  MediaPurpose.LEGACY,
] as const;

export type MediaVariantName = 'thumbnail' | 'feed' | 'medium';

const PURPOSE_VARIANTS: Record<MediaPurpose, readonly MediaVariantName[]> = {
  [MediaPurpose.AVATAR]: [],
  [MediaPurpose.PROFILE_COVER]: [],
  [MediaPurpose.DIRECT_MESSAGE]: ['thumbnail', 'medium'],
  [MediaPurpose.MOMENT]: ['thumbnail', 'feed', 'medium'],
  [MediaPurpose.MOMENT_COMMENT]: ['thumbnail', 'medium'],
  [MediaPurpose.RICH_CONTENT]: ['thumbnail', 'feed', 'medium'],
  [MediaPurpose.STICKER_SOURCE]: [],
  [MediaPurpose.LEGACY]: ['thumbnail', 'feed', 'medium'],
};

export function mediaVariantsFor(
  purpose: MediaPurpose | string | null | undefined,
  animated = false,
): readonly MediaVariantName[] {
  const normalized = MEDIA_PURPOSES.includes(purpose as MediaPurpose)
    ? (purpose as MediaPurpose)
    : MediaPurpose.LEGACY;
  const variants = PURPOSE_VARIANTS[normalized];
  return animated && variants.includes('thumbnail') ? ['thumbnail'] : animated ? [] : variants;
}

export function mediaPurposeAllowed(
  purpose: MediaPurpose | string | null | undefined,
  expected: MediaPurpose,
): boolean {
  return purpose === expected || purpose === MediaPurpose.LEGACY || purpose == null;
}

export function derivativeKey(key: string, variant: MediaVariantName): string {
  const suffix = variant === 'thumbnail' ? '_thumb.webp' : variant === 'feed' ? '_feed.webp' : '_md.webp';
  return key.replace(/(\.[^.]+)$/, `${suffix}`);
}
