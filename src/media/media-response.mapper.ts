import { mediaVariantsFor } from './media-policy';

type MediaVariantSource = {
  url: string;
  status?: string;
  purpose?: string | null;
  animated?: boolean;
};

function derivativeUrl(url: string, suffix: '_thumb.webp' | '_feed.webp' | '_md.webp'): string | null {
  const match = url.match(/^(.*)\.[^./?#]+([?#].*)?$/);
  return match ? `${match[1]}${suffix}${match[2] ?? ''}` : null;
}

/** 只在服务端已完成衍生图生成后公开可用地址。 */
export function mediaVariantUrls(media: MediaVariantSource) {
  if (media.status !== 'COMPLETED') {
    return { thumbnailUrl: null, feedUrl: null, mediumUrl: null };
  }
  const variants = new Set(mediaVariantsFor(media.purpose, media.animated));
  return {
    thumbnailUrl: variants.has('thumbnail') ? derivativeUrl(media.url, '_thumb.webp') : null,
    feedUrl: variants.has('feed') ? derivativeUrl(media.url, '_feed.webp') : null,
    mediumUrl: variants.has('medium') ? derivativeUrl(media.url, '_md.webp') : null,
  };
}

export function withMediaVariants<T extends MediaVariantSource>(media: T) {
  return { ...media, ...mediaVariantUrls(media) };
}
