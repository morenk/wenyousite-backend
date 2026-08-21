import { PrismaClient } from '@prisma/client';
import { extractMarkdownImageUrls } from '../src/common/markdown-cover-images';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const PAGE_SIZE = 250;

type ContentRow = { id: string; content: string };

async function mediaIdsForContent(content: string) {
  const urls = extractMarkdownImageUrls(content);
  if (urls.length === 0) return { mediaIds: [] as string[], unmatched: 0 };
  const media = await prisma.media.findMany({
    where: { url: { in: urls }, status: 'COMPLETED' },
    select: { id: true, url: true },
    orderBy: { createdAt: 'desc' },
  });
  const byUrl = new Map<string, string>();
  for (const item of media) if (!byUrl.has(item.url)) byUrl.set(item.url, item.id);
  const mediaIds = urls.map((url) => byUrl.get(url)).filter((id): id is string => Boolean(id));
  const storagePrefix =
    process.env.COS_ENDPOINT && process.env.COS_BUCKET
      ? `${process.env.COS_ENDPOINT.replace(/\/$/, '')}/${process.env.COS_BUCKET}/`
      : null;
  const unmatched = storagePrefix
    ? urls.filter((url) => url.startsWith(storagePrefix) && !byUrl.has(url)).length
    : 0;
  return { mediaIds, unmatched };
}

async function scanContent(
  kind: 'post' | 'draft',
  page: (cursor?: string) => Promise<ContentRow[]>,
) {
  let cursor: string | undefined;
  let rowsSeen = 0;
  let references = 0;
  let unmatched = 0;
  for (;;) {
    const rows = await page(cursor);
    if (rows.length === 0) break;
    for (const row of rows) {
      const resolved = await mediaIdsForContent(row.content);
      references += resolved.mediaIds.length;
      unmatched += resolved.unmatched;
      if (apply) {
        await prisma.$transaction(async (tx) => {
          if (kind === 'post') {
            await tx.postMedia.deleteMany({ where: { postId: row.id } });
            if (resolved.mediaIds.length > 0) {
              await tx.postMedia.createMany({
                data: resolved.mediaIds.map((mediaId, sortOrder) => ({
                  postId: row.id,
                  mediaId,
                  sortOrder,
                })),
                skipDuplicates: true,
              });
            }
          } else {
            await tx.draftMedia.deleteMany({ where: { draftId: row.id } });
            if (resolved.mediaIds.length > 0) {
              await tx.draftMedia.createMany({
                data: resolved.mediaIds.map((mediaId, sortOrder) => ({
                  draftId: row.id,
                  mediaId,
                  sortOrder,
                })),
                skipDuplicates: true,
              });
            }
          }
        });
      }
    }
    rowsSeen += rows.length;
    cursor = rows.at(-1)?.id;
    if (rows.length < PAGE_SIZE) break;
  }
  return { rowsSeen, references, unmatched };
}

async function normalizeIrreversibleRemovals() {
  const [moments, comments] = await Promise.all([
    prisma.moment.findMany({
      where: {
        deletedAt: { not: null },
        OR: [{ removalSource: null }, { removalSource: { not: 'ADMIN' } }],
      },
      select: {
        id: true,
        coverMediaId: true,
        images: { select: { mediaId: true } },
      },
    }),
    prisma.momentComment.findMany({
      where: {
        deletedAt: { not: null },
        OR: [{ removalSource: null }, { removalSource: { not: 'ADMIN' } }],
        mediaId: { not: null },
      },
      select: { id: true, mediaId: true },
    }),
  ]);
  if (!apply) return { moments: moments.length, comments: comments.length };
  await prisma.$transaction(async (tx) => {
    for (const moment of moments) {
      await tx.moment.update({ where: { id: moment.id }, data: { coverMediaId: null } });
      await tx.momentImage.deleteMany({ where: { momentId: moment.id } });
    }
    for (const comment of comments) {
      await tx.momentComment.update({ where: { id: comment.id }, data: { mediaId: null } });
    }
  });
  return { moments: moments.length, comments: comments.length };
}

async function backfillAvatars() {
  const users = await prisma.user.findMany({
    where: { avatar: { not: null } },
    select: { id: true, avatar: true },
  });
  let matched = 0;
  for (const user of users) {
    if (!user.avatar) continue;
    const media = await prisma.media.findFirst({
      where: { url: user.avatar, status: 'COMPLETED' },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!media) continue;
    matched++;
    if (apply) {
      await prisma.user.update({ where: { id: user.id }, data: { avatarMediaId: media.id } });
    }
  }
  return { users: users.length, matched };
}

async function rebuildOrphanMarkers() {
  if (!apply) return;
  await prisma.$executeRawUnsafe(`
    UPDATE "media"
    SET "orphaned_at" = NOW()
    WHERE "status" = 'COMPLETED'
  `);
  await prisma.$executeRawUnsafe(`
    UPDATE "media" AS m
    SET "orphaned_at" = NULL
    WHERE m."status" = 'COMPLETED' AND (
      EXISTS (SELECT 1 FROM "users" u WHERE u."avatar_media_id" = m."id") OR
      EXISTS (SELECT 1 FROM "users" u WHERE u."profile_cover_media_id" = m."id") OR
      EXISTS (SELECT 1 FROM "users" u WHERE u."profile_cover_mobile_media_id" = m."id") OR
      EXISTS (SELECT 1 FROM "direct_messages" dm WHERE dm."media_id" = m."id") OR
      EXISTS (SELECT 1 FROM "moment_images" mi WHERE mi."media_id" = m."id") OR
      EXISTS (SELECT 1 FROM "moments" mo WHERE mo."cover_media_id" = m."id") OR
      EXISTS (SELECT 1 FROM "moment_comments" mc WHERE mc."media_id" = m."id") OR
      EXISTS (SELECT 1 FROM "post_media" pm WHERE pm."media_id" = m."id") OR
      EXISTS (SELECT 1 FROM "draft_media" dm WHERE dm."media_id" = m."id") OR
      EXISTS (
        SELECT 1 FROM "sticker_imports" si
        WHERE si."source_media_id" = m."id" AND si."status" = 'PROCESSING'
      )
    )
  `);
}

async function main() {
  const postResult = await scanContent('post', (cursor) =>
    prisma.post.findMany({
      where: {
        subthread: { deletedAt: null },
        OR: [
          { deletedAt: null, thread: { OR: [{ deletedAt: null }, { removalSource: 'ADMIN' }] } },
          { removalSource: 'ADMIN' },
        ],
      },
      select: { id: true, content: true },
      cursor: cursor ? { id: cursor } : undefined,
      take: PAGE_SIZE,
      orderBy: { id: 'asc' },
    }),
  );
  const draftResult = await scanContent('draft', (cursor) =>
    prisma.draft.findMany({
      select: { id: true, content: true },
      cursor: cursor ? { id: cursor } : undefined,
      take: PAGE_SIZE,
      orderBy: { id: 'asc' },
    }),
  );
  const avatarResult = await backfillAvatars();
  const normalized = await normalizeIrreversibleRemovals();
  await rebuildOrphanMarkers();

  process.stdout.write(
    `${JSON.stringify({
      mode: apply ? 'apply' : 'audit',
      posts: postResult,
      drafts: draftResult,
      avatars: avatarResult,
      irreversibleRemovals: normalized,
    })}\n`,
  );
}

main()
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
