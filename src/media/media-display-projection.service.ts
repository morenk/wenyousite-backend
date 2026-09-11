import { extractStickerTokens } from '../stickers/sticker-content.service';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { extractMarkdownImageUrls } from '../common/markdown-cover-images';
import { readMediaDisplay } from './media-display';

type RecordValue = Record<string, unknown>;
type Target = { node: RecordValue; field: 'display' | 'avatarDisplay'; url: string; mediaId?: string; userId?: string; threadId?: string };
type Body = { node: RecordValue; id: string; draft: boolean; urls: string[]; stickerIds: Map<string, string> };
const MAX_NODES = 10_000;
const MAX_URLS = 2_000;
const BATCH_SIZE = 200;

function record(value: unknown): value is RecordValue {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date));
}

/** 只增强已经通过领域权限过滤的返回对象；正文必须另有对应引用账本，不接受请求中的任意 URL。 */
@Injectable()
export class MediaDisplayProjectionService {
  constructor(private readonly prisma: PrismaService) {}

  async project<T>(value: T): Promise<T> {
    const targets: Target[] = [];
    const bodies: Body[] = [];
    let count = 0;
    const visit = (node: unknown, field = '', parent?: RecordValue, owner?: string) => {
      if (++count > MAX_NODES) return;
      if (Array.isArray(node)) { for (const item of node) visit(item, field, parent, owner); return; }
      if (!record(node)) return;
      const userId = typeof node.id === 'string' && typeof node.username === 'string' ? node.id : owner;
      if (typeof node.avatar === 'string' && userId && !node.deletedAt && !node.isDeactivated) {
        node.avatarDisplay = null;
        targets.push({ node, field: 'avatarDisplay', url: node.avatar, userId });
      }
      if (typeof node.url === 'string') {
        if (typeof node.id === 'string' && ('contentType' in node || field === 'asset' || field === 'sticker')) {
          node.display = null;
          targets.push({ node, field: 'display', url: node.url, mediaId: node.id });
        } else if (field === 'coverMedia' && typeof parent?.id === 'string') {
          node.display = null;
          targets.push({ node, field: 'display', url: node.url, threadId: parent.id });
        } else if ((field === 'profileCover' || field === 'mobile') && userId) {
          node.display = null;
          targets.push({ node, field: 'display', url: node.url, userId });
        }
      }
      if (typeof node.content === 'string' && typeof node.id === 'string' && !node.deletedAt &&
        (typeof node.threadId === 'string' || node.kind === 'BODY' || node.kind === 'FLOOR' || field === 'bodyPost' || typeof node.slot === 'number')) {
        node.mediaDisplays = [];
        // 巨大正文只影响增强，不放大数据库 IN 查询；原正文和权限语义保持。
        if (node.content.length <= 1_000_000) {
          const stickerIds = new Map<string, string>();
          try { for (const token of extractStickerTokens(node.content)) if (token.stickerAssetId) stickerIds.set(token.url, token.stickerAssetId); }
          catch { /* 历史无效表情标记不能触发资产查询扩权。 */ }
          bodies.push({ node, id: node.id, draft: typeof node.slot === 'number', stickerIds,
            urls: [...new Set(extractMarkdownImageUrls(node.content))].slice(0, MAX_URLS) });
        }
      }
      for (const [key, child] of Object.entries(node)) {
        if (['display', 'avatarDisplay', 'mediaDisplays', 'displayAsset'].includes(key)) continue;
        visit(child, key, node, userId);
      }
    };
    visit(value);
    const urls = [...new Set([...targets.map((item) => item.url), ...bodies.flatMap((item) => item.urls)])].slice(0, MAX_URLS);
    if (!urls.length) return value;
    const threadIds = [...new Set(targets.flatMap((item) => item.threadId ? [item.threadId] : []))];
    const postIds = bodies.filter((body) => !body.draft).map((body) => body.id);
    const draftIds = bodies.filter((body) => body.draft).map((body) => body.id);
    const select = {
      id: true, url: true, purpose: true, displayAsset: true,
      avatarUser: { select: { id: true } }, profileCoverUser: { select: { id: true } }, profileCoverMobileUser: { select: { id: true } },
      postAttachments: { where: { post: { deletedAt: null, OR: [{ id: { in: postIds } }, { threadId: { in: threadIds } }] } },
        select: { postId: true, post: { select: { threadId: true } } } },
      draftAttachments: { where: { draftId: { in: draftIds } }, select: { draftId: true } },
    } satisfies Prisma.MediaSelect;
    type Row = Prisma.MediaGetPayload<{ select: typeof select }>;
    const byUrl = new Map<string, Row[]>();
    const stickers = new Map<string, { id: string; displayAsset: unknown }[]>();
    for (let offset = 0; offset < urls.length; offset += BATCH_SIZE) {
      const batch = urls.slice(offset, offset + BATCH_SIZE);
      const rows = await this.prisma.media.findMany({
        // 精确URL批次同时检查全体存活重复项；下方再按该响应的绑定关系授权，不能任选一条。
        where: { url: { in: batch }, status: 'COMPLETED', deletionClaimedAt: null }, select,
      });
      for (const row of rows) byUrl.set(row.url, [...(byUrl.get(row.url) ?? []), row]);
      // 表情已是公开规范化 WebP；仅具名返回资产或正文实际表情节点可使用其已验证描述。
      const assets = await this.prisma.stickerAsset.findMany({ where: { url: { in: batch } }, select: { id: true, url: true, displayAsset: true } });
      for (const item of assets) stickers.set(item.url, [...(stickers.get(item.url) ?? []), item]);
    }
    for (const target of targets) {
      const matches = byUrl.get(target.url) ?? [];
      if (matches.length === 1) {
        const row = matches[0];
        const allowed = target.mediaId === row.id ||
          (target.field === 'avatarDisplay' && target.userId === row.avatarUser?.id) ||
          (target.field === 'display' && Boolean(target.userId) &&
            [row.profileCoverUser?.id, row.profileCoverMobileUser?.id].includes(target.userId)) ||
          (Boolean(target.threadId) && ['RICH_CONTENT', 'LEGACY'].includes(row.purpose) &&
            row.postAttachments.some((item) => item.post.threadId === target.threadId));
        if (allowed) {
          const display = readMediaDisplay(row.displayAsset);
          target.node[target.field] = display;
          if (target.threadId && display) target.node.animated = display.animated;
        }
      }
      const asset = stickers.get(target.url);
      if (!matches.length && asset?.length === 1 && asset[0].id === target.mediaId) target.node[target.field] = readMediaDisplay(asset[0].displayAsset);
    }
    for (const body of bodies) {
      body.node.mediaDisplays = body.urls.flatMap((sourceUrl) => {
        const matches = byUrl.get(sourceUrl) ?? [];
        if (matches.length !== 1) {
          const asset = stickers.get(sourceUrl);
          return !matches.length && asset?.length === 1 && body.stickerIds.get(sourceUrl) === asset[0].id
            ? [{ sourceUrl, display: readMediaDisplay(asset[0].displayAsset) }] : [];
        }
        const row = matches[0];
        if (!['RICH_CONTENT', 'LEGACY'].includes(row.purpose)) return [];
        const referenced = body.draft ? row.draftAttachments.some((item) => item.draftId === body.id)
          : row.postAttachments.some((item) => item.postId === body.id);
        return referenced ? [{ sourceUrl, display: readMediaDisplay(row.displayAsset) }] : [];
      });
    }
    return value;
  }
}
