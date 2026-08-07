type MediaVariantSource = {
  url: string;
  status?: string;
};

function derivativeUrl(url: string, suffix: '_thumb.webp' | '_md.webp'): string | null {
  const match = url.match(/^(.*)\.[^./?#]+([?#].*)?$/);
  return match ? `${match[1]}${suffix}${match[2] ?? ''}` : null;
}

/** 只在服务端已完成衍生图生成后公开可用地址。 */
export function mediaVariantUrls(media: MediaVariantSource) {
  if (media.status !== 'COMPLETED') {
    return { thumbnailUrl: null, mediumUrl: null };
  }
  return {
    thumbnailUrl: derivativeUrl(media.url, '_thumb.webp'),
    mediumUrl: derivativeUrl(media.url, '_md.webp'),
  };
}

export function withMediaVariants<T extends MediaVariantSource>(media: T) {
  return { ...media, ...mediaVariantUrls(media) };
}
