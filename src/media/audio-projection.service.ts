import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { extractMarkdownAudioLinks } from './audio-links';
import { AUDIO_MAX_DURATION_MS } from './audio-policy';

type Body = { node: Record<string, unknown>; id: string; draft: boolean; urls: string[] };
@Injectable()
export class AudioProjectionService {
  constructor(private readonly prisma: PrismaService) {}
  async project(value: unknown) {
    const bodies: Body[] = [];
    let visited = 0;
    const visit = (node: unknown, field = '') => {
      if (++visited > 10000) return;
      if (Array.isArray(node)) {
        node.forEach((item) => visit(item, field));
        return;
      }
      if (!node || typeof node !== 'object' || node instanceof Date) return;
      const record = node as Record<string, unknown>;
      if (
        typeof record.content === 'string' &&
        record.content.length <= 10000 &&
        typeof record.id === 'string' &&
        !record.deletedAt &&
        (typeof record.threadId === 'string' ||
          ['BODY', 'FLOOR'].includes(String(record.kind)) ||
          field === 'bodyPost' ||
          typeof record.slot === 'number')
      ) {
        record.mediaAudios = [];
        bodies.push({
          node: record,
          id: record.id,
          draft: typeof record.slot === 'number',
          urls: extractMarkdownAudioLinks(record.content),
        });
      }
      for (const [key, child] of Object.entries(record))
        if (!['mediaAudios', 'mediaDisplays', 'rpIdentity', 'mentionIdentities'].includes(key))
          visit(child, key);
    };
    visit(value);
    const urls = [...new Set(bodies.flatMap((body) => body.urls))].slice(0, 2000);
    if (!urls.length) return;
    const postIds = bodies.filter((b) => !b.draft).map((b) => b.id);
    const draftIds = bodies.filter((b) => b.draft).map((b) => b.id);
    const byUrl = new Map<
      string,
      {
        sourceUrl: string;
        mediaId: string;
        contentType: 'audio/mpeg';
        size: number;
        durationMs: number;
        posts: Set<string>;
        drafts: Set<string>;
      }[]
    >();
    for (let offset = 0; offset < urls.length; offset += 200) {
      const rows = await this.prisma.media.findMany({
        where: {
          url: { in: urls.slice(offset, offset + 200) },
          purpose: 'RICH_CONTENT_AUDIO',
          status: 'COMPLETED',
          deletionClaimedAt: null,
        },
        select: {
          id: true,
          url: true,
          size: true,
          durationMs: true,
          contentType: true,
          postAttachments: {
            where: { postId: { in: postIds }, post: { deletedAt: null } },
            select: { postId: true },
          },
          draftAttachments: { where: { draftId: { in: draftIds } }, select: { draftId: true } },
        },
      });
      for (const row of rows) {
        if (
          !row.id || row.contentType !== 'audio/mpeg' ||
          !Number.isSafeInteger(row.size) ||
          row.size! <= 0 ||
          !Number.isSafeInteger(row.durationMs) ||
          row.durationMs! <= 0 ||
          row.durationMs! > AUDIO_MAX_DURATION_MS
        )
          continue;
        const item = {
          sourceUrl: row.url,
          mediaId: row.id,
          contentType: 'audio/mpeg' as const,
          size: row.size!,
          durationMs: row.durationMs!,
          posts: new Set(row.postAttachments.map((p) => p.postId)),
          drafts: new Set(row.draftAttachments.map((d) => d.draftId)),
        };
        byUrl.set(row.url, [...(byUrl.get(row.url) ?? []), item]);
      }
    }
    for (const body of bodies) {
      body.node.mediaAudios = body.urls.flatMap((url) => {
        const matches = byUrl.get(url);
        if (matches?.length !== 1) return [];
        const { posts, drafts, ...descriptor } = matches[0];
        return (body.draft ? drafts : posts).has(body.id) ? [descriptor] : [];
      });
    }
  }
}
