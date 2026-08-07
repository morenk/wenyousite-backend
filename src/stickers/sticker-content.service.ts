import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { STICKER_MARKER_PREFIX, STICKER_POST_LIMIT } from './sticker.constants';

export interface MarkdownImageToken {
  url: string;
  title: string | null;
  stickerAssetId: string | null;
}

const MARKDOWN_IMAGE_PATTERN = /!\[[^\]\n]*\]\(\s*([^\s)]+)(?:\s+["']([^"'\n]*)["'])?\s*\)/g;
const CUID_PATTERN = /^c[a-z0-9]{20,}$/;

/** Markdown 图片协议与新增图片权限校验。 */
@Injectable()
export class StickerContentService {
  constructor(private readonly prisma: PrismaService) {}

  marker(assetId: string) {
    return `${STICKER_MARKER_PREFIX}${assetId}`;
  }

  markdown(asset: { id: string; url: string }) {
    return `![表情](${asset.url} "${this.marker(asset.id)}")`;
  }

  extract(content: string): MarkdownImageToken[] {
    const visible = this.maskCode(content);
    const tokens: MarkdownImageToken[] = [];
    for (const match of visible.matchAll(new RegExp(MARKDOWN_IMAGE_PATTERN.source, 'g'))) {
      if (this.isEscaped(visible, match.index ?? 0)) continue;
      const url = match[1].replace(/^<|>$/g, '');
      const title = match[2] ?? null;
      const stickerAssetId = title?.startsWith(STICKER_MARKER_PREFIX)
        ? title.slice(STICKER_MARKER_PREFIX.length)
        : null;
      if (title?.includes('wenyousite-sticker:') && !stickerAssetId) {
        throw this.invalid('表情标记不合法');
      }
      if (stickerAssetId && !CUID_PATTERN.test(stickerAssetId)) {
        throw this.invalid('表情标记不合法');
      }
      tokens.push({ url, title, stickerAssetId });
    }
    return tokens;
  }

  async assertContentAllowed(userId: string, content: string, previousContent = '') {
    const current = this.extract(content);
    const previous = this.extract(previousContent);
    const stickers = current.filter((token) => token.stickerAssetId);
    if (stickers.length > STICKER_POST_LIMIT) {
      throw this.invalid(`单篇内容最多可使用 ${STICKER_POST_LIMIT} 个表情`);
    }

    const previousCounts = this.count(previous.map((token) => this.signature(token)));
    const newTokens = current.filter((token) => {
      const signature = this.signature(token);
      const remaining = previousCounts.get(signature) ?? 0;
      if (remaining > 0) {
        previousCounts.set(signature, remaining - 1);
        return false;
      }
      return true;
    });
    if (newTokens.length === 0) return stickers.map((token) => token.stickerAssetId!);

    const regularUrls = [...new Set(
      newTokens.filter((token) => !token.stickerAssetId).map((token) => token.url),
    )];
    if (regularUrls.length > 0) {
      const media = await this.prisma.media.findMany({
        where: { userId, status: 'COMPLETED', url: { in: regularUrls } },
        select: { url: true },
      });
      const allowed = new Set(media.map((item) => item.url));
      if (regularUrls.some((url) => !allowed.has(url))) {
        throw this.invalid('新增正文图片必须先由当前账号上传，不能使用外链图片');
      }
    }

    const newStickers = newTokens.filter((token) => token.stickerAssetId);
    if (newStickers.length > 0) {
      const ids = [...new Set(newStickers.map((token) => token.stickerAssetId!))];
      const favorites = await this.prisma.userSticker.findMany({
        where: { userId, assetId: { in: ids } },
        select: { asset: { select: { id: true, url: true } } },
      });
      const allowed = new Map(favorites.map((favorite) => [favorite.asset.id, favorite.asset.url]));
      if (newStickers.some((token) => allowed.get(token.stickerAssetId!) !== token.url)) {
        throw this.invalid('只能使用当前收藏夹中的表情');
      }
    }
    return stickers.map((token) => token.stickerAssetId!);
  }

  async recordUsage(userId: string, assetIds: string[]) {
    const ids = [...new Set(assetIds)];
    if (ids.length === 0) return;
    await this.prisma.userSticker.updateMany({
      where: { userId, assetId: { in: ids } },
      data: { lastUsedAt: new Date() },
    });
  }

  private signature(token: MarkdownImageToken) {
    return token.stickerAssetId
      ? `sticker:${token.stickerAssetId}:${token.url}`
      : `image:${token.url}`;
  }

  private count(values: string[]) {
    const counts = new Map<string, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return counts;
  }

  private maskCode(content: string) {
    const chars = [...content];
    const mask = (start: number, end: number) => {
      for (let i = start; i < end; i++) if (chars[i] !== '\n') chars[i] = ' ';
    };
    for (const match of content.matchAll(/^(?: {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?^(?: {0,3})\1\s*$/gm)) {
      mask(match.index ?? 0, (match.index ?? 0) + match[0].length);
    }
    const fenced = chars.join('');
    for (const match of fenced.matchAll(/(`+)(?!`)([^\n]*?)\1(?!`)/g)) {
      mask(match.index ?? 0, (match.index ?? 0) + match[0].length);
    }
    return chars.join('');
  }

  private isEscaped(content: string, index: number) {
    let slashes = 0;
    for (let i = index - 1; i >= 0 && content[i] === '\\'; i--) slashes++;
    return slashes % 2 === 1;
  }

  private invalid(message: string) {
    return new BusinessException(ErrorCode.INVALID_STICKER, message, HttpStatus.BAD_REQUEST);
  }
}

