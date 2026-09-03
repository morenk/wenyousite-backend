import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import archiver, { type Archiver } from 'archiver';
import { PassThrough } from 'node:stream';
import { PrismaService } from '../prisma/prisma.service';
import { ThreadAccessService } from '../access/thread-access.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import {
  StickerContentService,
  type MarkdownImageToken,
} from '../stickers/sticker-content.service';
import {
  decodeInternalReferenceLabel,
  formatInternalReferencePreview,
  parseInternalReference,
  INTERNAL_REFERENCE_DEFAULT_LABEL,
  INTERNAL_REFERENCE_INVITE_PREVIEW_LABEL,
} from '../common/internal-reference';
import { DEACTIVATED_USER_NAME } from '../common/user-summary';
import { ErrorCode } from '../common/exceptions/error-codes';
import { notFound } from '../common/exceptions/business.exception';
import type { ThreadExportDto } from './dto/thread-export.dto';
import { authorSelect, notDeleted } from '../common/prisma-helpers';

const exportThreadInclude = {
  owner: { select: authorSelect },
  topicTags: { include: { tag: { select: { name: true } } } },
  subthreads: {
    where: notDeleted,
    orderBy: { sortOrder: 'asc' as const },
    include: {
      posts: {
        where: notDeleted,
        orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
        include: {
          author: { select: authorSelect },
          diceRolls: { orderBy: { createdAt: 'asc' as const } },
          replyToPost: { select: { id: true, author: { select: authorSelect } } },
          mediaAttachments: {
            orderBy: { sortOrder: 'asc' as const },
            include: {
              media: {
                select: { url: true, key: true, contentType: true, status: true },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.ThreadInclude;

type ExportThread = Prisma.ThreadGetPayload<{ include: typeof exportThreadInclude }>;
type ExportPost = ExportThread['subthreads'][number]['posts'][number];

export interface ThreadExportOptions {
  includeAuthors: boolean;
  includeTimestamps: boolean;
  includeFloorNumbers: boolean;
  includeReplyTargets: boolean;
  includeSourceLinks: boolean;
  includeMedia: boolean;
}

export interface PreparedAsset {
  path: string;
  buffer: Buffer;
}

export interface ThreadExportDiceRoll {
  nodeId: string;
  notation: string;
  total: number;
  results: number[];
}

export interface RenderContext {
  options: ThreadExportOptions;
  assets: ReadonlyMap<string, PreparedAsset>;
  warnings: Set<string>;
  webUrl: string;
  diceRolls: ReadonlyArray<ThreadExportDiceRoll>;
}

interface RenderedPost {
  post: ExportPost;
  markdown: string;
}

const IMAGE_PATTERN = /!\[([^\]\n]*)\]\(\s*([^\s)]+)(?:\s+["']([^"'\n]*)["'])?\s*\)/gu;
const DICE_PATTERN = /\[\[dice:v1:([0-9a-f-]{36}):([^\]\r\n]{1,32})\]\]/giu;
const ALIGNMENT_PATTERN = /^\[wenyousite-align-v\d+-[a-z][a-z-]*\]: #[\t ]*(?:\n|$)/gmu;
const MARKDOWN_INTERNAL_LINK_PATTERN = /\[((?:\\.|[^\]\\\r\n])+)\]\(([^)\r\n]+)\)/gu;
const INVITE_LINK_PATTERN =
  /(?:https:\/\/(?:www\.)?wenyou\.site)?\/join\/[A-Za-z0-9_-]{16}(?:[?#][^\s<>()\]}"']*)?/giu;

/**
 * 公开的纯转换函数，便于在不连接数据库时验证协议降级。
 * ponytail: 先将单次导出的媒体缓存在内存；若档案大小成为实际瓶颈，再改成逐项流式写入。
 */
export function renderExportContent(content: string, context: RenderContext): string {
  let rendered = formatReferences(content, context.options.includeSourceLinks, context.webUrl);
  rendered = replaceVisible(rendered, DICE_PATTERN, (match) => {
    const [, nodeId, notation] = execPattern(DICE_PATTERN, match) ?? [];
    const roll = context.diceRolls.find(
      (item) => item.nodeId.toLowerCase() === nodeId?.toLowerCase(),
    );
    if (!roll) return `骰子（${notation}，未结算）`;
    return `骰子（${roll.notation} = ${roll.total}，结果：${roll.results.join('、')}）`;
  });
  rendered = replaceVisible(rendered, IMAGE_PATTERN, (match) => {
    const image = execPattern(IMAGE_PATTERN, match);
    if (!image) return match;
    const [, alt, url, title] = image;
    const stickerAssetId = title?.startsWith('wenyousite-sticker:v1:')
      ? title.slice('wenyousite-sticker:v1:'.length)
      : null;
    const reference = stickerAssetId ? `sticker:${stickerAssetId}` : `image:${url}`;
    const asset = context.assets.get(reference);
    if (asset) return `![${alt || (stickerAssetId ? '表情' : '图片')}](${asset.path})`;
    if (context.options.includeSourceLinks) return `![${alt}](${url})`;
    const placeholder = stickerAssetId ? '表情' : alt ? `图片：${alt}` : '图片';
    return `[${placeholder}]`;
  });
  rendered = replaceVisible(rendered, ALIGNMENT_PATTERN, () => {
    context.warnings.add('已移除正文中的段落对齐协议标记。');
    return '';
  });
  return rendered;
}

function formatReferences(content: string, includeSourceLinks: boolean, webUrl: string): string {
  if (!includeSourceLinks) return formatInternalReferencePreview(content, { redactInvites: true });
  const rendered = content.replace(
    MARKDOWN_INTERNAL_LINK_PATTERN,
    (match, rawLabel: string, href: string) => {
      const reference = parseInternalReference(href);
      if (!reference) return match;
      const label =
        decodeInternalReferenceLabel(rawLabel).trim() || INTERNAL_REFERENCE_DEFAULT_LABEL;
      if (reference.kind === 'INVITE') return INTERNAL_REFERENCE_INVITE_PREVIEW_LABEL;
      const escapedLabel = label
        .replace(/\\/gu, '\\\\')
        .replace(/\[/gu, '\\[')
        .replace(/\]/gu, '\\]');
      return `[${escapedLabel}](${new URL(reference.href, webUrl).toString()})`;
    },
  );
  return rendered.replace(INVITE_LINK_PATTERN, INTERNAL_REFERENCE_INVITE_PREVIEW_LABEL);
}

function replaceVisible(
  content: string,
  pattern: RegExp,
  replace: (match: string) => string,
): string {
  pattern.lastIndex = 0;
  const visible = maskMarkdownCode(content);
  let result = '';
  let cursor = 0;
  for (const match of visible.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (isEscaped(content, index)) continue;
    result += content.slice(cursor, index) + replace(content.slice(index, index + match[0].length));
    cursor = index + match[0].length;
  }
  pattern.lastIndex = 0;
  return result + content.slice(cursor);
}

function execPattern(pattern: RegExp, value: string) {
  pattern.lastIndex = 0;
  const result = pattern.exec(value);
  pattern.lastIndex = 0;
  return result;
}

function maskMarkdownCode(content: string): string {
  const chars = content.split('');
  const mask = (start: number, end: number) => {
    for (let index = start; index < end; index++) if (chars[index] !== '\n') chars[index] = ' ';
  };
  for (const match of content.matchAll(
    /^(?: {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?^(?: {0,3})\1\s*$/gmu,
  )) {
    mask(match.index ?? 0, (match.index ?? 0) + match[0].length);
  }
  const fenced = chars.join('');
  for (const match of fenced.matchAll(/(`+)(?!`)([^\n]*?)\1(?!`)/gu)) {
    mask(match.index ?? 0, (match.index ?? 0) + match[0].length);
  }
  return chars.join('');
}

function isEscaped(content: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && content[cursor] === '\\'; cursor--) slashes++;
  return slashes % 2 === 1;
}

function plainText(markdown: string): string {
  return markdown
    .replace(/^\s*\[wenyousite-align-v\d+-[a-z][a-z-]*\]: #[\t ]*$/gmu, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, '[图片]')
    .replace(/<br\s*\/?>(?=\s*$)/gimu, '\n')
    .replace(/(^|\n)```[\s\S]*?```(?=\n|$)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/[*_~`>#]/gu, '')
    .replace(/^\s*[-+]\s+/gmu, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function displayName(user: { username: string; deletedAt: Date | null }): string {
  return user.deletedAt ? DEACTIVATED_USER_NAME : user.username;
}

function postHeading(
  threadId: string,
  post: ExportPost,
  options: ThreadExportOptions,
  webUrl: string,
  headingLevel = 3,
): string {
  const parts: string[] = [];
  if (post.kind === 'FLOOR' && options.includeFloorNumbers) {
    parts.push(`第${post.floorNumber ?? '?'}楼`);
  } else if (post.kind === 'FLOOR') {
    parts.push('楼层');
  } else {
    parts.push('正文');
  }
  if (options.includeAuthors) parts.push(displayName(post.author));
  if (options.includeTimestamps) parts.push(post.createdAt.toISOString());
  if (options.includeReplyTargets && post.replyToPost) {
    parts.push(`回复 @${displayName(post.replyToPost.author)}`);
  }
  if (options.includeSourceLinks) {
    parts.push(`[来源](${new URL(`/threads/${threadId}?post=${post.id}`, webUrl).toString()})`);
  }
  return `${'#'.repeat(headingLevel)} ${parts.join(' · ')}`;
}

function buildMarkdown(
  thread: ExportThread,
  rendered: ReadonlyMap<string, RenderedPost>,
  options: ThreadExportOptions,
  webUrl: string,
): string {
  const lines = [`# ${thread.title?.trim() || '未命名主题帖'}`, ''];
  lines.push(`- 导出范围：已发布主题帖的可见正文、楼层和回复`);
  if (options.includeAuthors) lines.push(`- 楼主：${displayName(thread.owner)}`);
  if (thread.category) lines.push(`- 分类：${thread.category}`);
  const tags = thread.topicTags.map(({ tag }) => tag.name);
  if (tags.length > 0) lines.push(`- 标签：${tags.join('、')}`);
  if (options.includeTimestamps) {
    lines.push(`- 创建时间：${thread.createdAt.toISOString()}`);
    if (thread.publishedAt) lines.push(`- 发布时间：${thread.publishedAt.toISOString()}`);
  }
  if (options.includeSourceLinks) {
    lines.push(`- 主题来源：[打开主题帖](${new URL(`/threads/${thread.id}`, webUrl).toString()})`);
  }
  lines.push('');

  for (const subthread of thread.subthreads) {
    lines.push(`## ${subthread.title}`, '');
    const posts = subthread.posts;
    const body = posts.find((post) => post.kind === 'BODY');
    if (body) {
      const item = rendered.get(body.id);
      if (item) lines.push(postHeading(thread.id, body, options, webUrl), '', item.markdown, '');
    }
    const floors = posts
      .filter((post) => post.kind === 'FLOOR' && !post.parentPostId)
      .sort(
        (left, right) =>
          (left.floorNumber ?? Number.MAX_SAFE_INTEGER) -
          (right.floorNumber ?? Number.MAX_SAFE_INTEGER),
      );
    for (const floor of floors) {
      const item = rendered.get(floor.id);
      if (!item) continue;
      lines.push(postHeading(thread.id, floor, options, webUrl), '', item.markdown, '');
      const replies = new Map<string | null, ExportPost[]>();
      for (const post of posts) {
        if (post.kind !== 'FLOOR' || !post.parentPostId) continue;
        const children = replies.get(post.parentPostId) ?? [];
        children.push(post);
        replies.set(post.parentPostId, children);
      }
      const appendReplies = (parentId: string, headingLevel: number) => {
        const children = (replies.get(parentId) ?? []).sort(
          (left, right) =>
            left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
        );
        for (const reply of children) {
          const replyItem = rendered.get(reply.id);
          if (!replyItem) continue;
          lines.push(
            postHeading(thread.id, reply, options, webUrl, headingLevel),
            '',
            replyItem.markdown,
            '',
          );
          appendReplies(reply.id, Math.min(6, headingLevel + 1));
        }
      };
      appendReplies(floor.id, 4);
    }
  }
  return `${lines.join('\n').trim()}\n`;
}

function buildText(
  thread: ExportThread,
  rendered: ReadonlyMap<string, RenderedPost>,
  options: ThreadExportOptions,
  webUrl: string,
): string {
  return plainText(buildMarkdown(thread, rendered, options, webUrl));
}

@Injectable()
export class ThreadExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly threadAccess: ThreadAccessService,
    private readonly storage: ObjectStorageService,
    private readonly stickers: StickerContentService,
    private readonly config: ConfigService,
  ) {}

  async createArchive(threadId: string, userId: string, input: ThreadExportDto) {
    await this.threadAccess.assertCanManage(threadId, userId);
    const thread = await this.prisma.thread.findUnique({
      where: { id: threadId, published: true, deletedAt: null },
      include: exportThreadInclude,
    });
    if (!thread) throw notFound(ErrorCode.THREAD_NOT_FOUND, '仅可导出已发布主题帖');

    const options = normalizeOptions(input);
    const warnings = new Set<string>();
    const assets = await this.prepareAssets(thread, options, warnings);
    const webUrl = this.config.get<string>('app.webUrl') || 'https://wenyou.site';
    const rendered = new Map<string, RenderedPost>();
    for (const subthread of thread.subthreads) {
      for (const post of subthread.posts) {
        if (post.kind !== 'BODY' && post.kind !== 'FLOOR') continue;
        rendered.set(post.id, {
          post,
          markdown: renderExportContent(post.content, {
            options,
            assets,
            warnings,
            webUrl,
            diceRolls: post.diceRolls,
          }),
        });
      }
    }
    const markdown = buildMarkdown(thread, rendered, options, webUrl);
    const text = buildText(thread, rendered, options, webUrl);
    const stream = this.startArchive(markdown, text, assets, warnings);
    return {
      stream,
      filename: `wenyou-thread-${thread.id.replace(/[^a-zA-Z0-9_-]/gu, '') || 'export'}.zip`,
    };
  }

  private async prepareAssets(
    thread: ExportThread,
    options: ThreadExportOptions,
    warnings: Set<string>,
  ) {
    const assets = new Map<string, PreparedAsset>();
    if (!options.includeMedia) return assets;

    const tokens = new Map<string, MarkdownImageToken>();
    const mediaByUrl = new Map<
      string,
      { url: string; key: string; contentType: string | null; status: string }
    >();
    for (const subthread of thread.subthreads) {
      for (const post of subthread.posts) {
        for (const attachment of post.mediaAttachments)
          mediaByUrl.set(attachment.media.url, attachment.media);
        try {
          for (const token of this.stickers.extract(post.content)) {
            const reference = token.stickerAssetId
              ? `sticker:${token.stickerAssetId}`
              : `image:${token.url}`;
            tokens.set(reference, token);
          }
        } catch {
          warnings.add('部分表情标记无法解析，已按普通图片占位处理。');
        }
      }
    }

    const stickerIds = [...tokens.values()]
      .map((token) => token.stickerAssetId)
      .filter((id): id is string => Boolean(id));
    const stickerAssets =
      stickerIds.length > 0
        ? await this.prisma.stickerAsset.findMany({
            where: { id: { in: [...new Set(stickerIds)] } },
            select: { id: true, key: true },
          })
        : [];
    const stickerById = new Map(stickerAssets.map((asset) => [asset.id, asset]));
    let assetIndex = 0;
    for (const [reference, token] of tokens) {
      const record = token.stickerAssetId
        ? stickerById.get(token.stickerAssetId)
        : mediaByUrl.get(token.url);
      if (
        !record ||
        (!token.stickerAssetId && 'status' in record && record.status !== 'COMPLETED')
      ) {
        warnings.add(
          `${token.stickerAssetId ? '表情' : '图片'}未找到可打包的站内文件：${token.url}`,
        );
        continue;
      }
      let buffer: Buffer;
      try {
        buffer = await this.storage.download(record.key);
      } catch {
        warnings.add(
          `${token.stickerAssetId ? '表情' : '图片'}下载失败，已保留文字占位：${token.url}`,
        );
        continue;
      }
      assetIndex++;
      assets.set(reference, {
        path: `media/${String(assetIndex).padStart(3, '0')}-${token.stickerAssetId ? 'sticker' : 'image'}`,
        buffer,
      });
    }
    return assets;
  }

  private startArchive(
    markdown: string,
    text: string,
    assets: ReadonlyMap<string, PreparedAsset>,
    warnings: ReadonlySet<string>,
  ) {
    const archive = (archiver as unknown as (format: string) => Archiver)('zip');
    const stream = new PassThrough();
    archive.on('error', (error) => stream.destroy(error));
    archive.pipe(stream);
    void (async () => {
      archive.append(Buffer.from(markdown, 'utf8'), { name: 'thread.md' });
      archive.append(Buffer.from(text, 'utf8'), { name: 'thread.txt' });
      for (const asset of assets.values()) archive.append(asset.buffer, { name: asset.path });
      if (warnings.size > 0)
        archive.append(
          Buffer.from([...warnings].map((warning) => `- ${warning}`).join('\n') + '\n', 'utf8'),
          { name: 'export-notes.txt' },
        );
      await archive.finalize();
    })().catch((error: unknown) =>
      stream.destroy(error instanceof Error ? error : new Error('主题档案压缩失败')),
    );
    return stream;
  }
}

function normalizeOptions(input: ThreadExportDto): ThreadExportOptions {
  return {
    includeAuthors: input.includeAuthors !== false,
    includeTimestamps: input.includeTimestamps !== false,
    includeFloorNumbers: input.includeFloorNumbers !== false,
    includeReplyTargets: input.includeReplyTargets !== false,
    includeSourceLinks: input.includeSourceLinks === true,
    includeMedia: input.includeMedia !== false,
  };
}
