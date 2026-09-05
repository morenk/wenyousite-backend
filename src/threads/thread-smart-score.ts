import { createHash } from 'node:crypto';
import { markdownContributionText } from '../common/markdown-content';

export const SMART_SCORE_ZSET = 'threads:by:participation:v1';
export const SMART_SCORE_READY = `${SMART_SCORE_ZSET}:ready`;

export function newThreadSmartStats() {
  return {
    players: new Set<string>(), playerDays: new Set<string>(), ownerDays: new Map<string, number>(),
    seenText: new Set<string>(), words: 0, replies: 0,
  };
}
export type ThreadSmartStats = ReturnType<typeof newThreadSmartStats>;

export function addThreadContribution(
  stats: ThreadSmartStats,
  post: { authorId: string; content: string; kind: string; createdAt: Date },
  ownerId: string, playerIds: Set<string>, now: number,
) {
  if (post.kind === 'FLOOR') stats.replies++;
  const text = markdownContributionText(post.content);
  if (!text) return;
  if (stats.words < 100_000) {
    const fingerprint = `${post.authorId}:${createHash('sha256').update(text).digest('hex')}`;
    if (!stats.seenText.has(fingerprint)) {
      stats.seenText.add(fingerprint);
      stats.words = Math.min(100_000, stats.words + Array.from(text.replace(/\s/gu, '')).length);
    }
  }
  const timestamp = post.createdAt.getTime();
  if (timestamp < now - 7 * 86_400_000 || timestamp > now) return;
  const day = new Date(timestamp + 8 * 3_600_000).toISOString().slice(0, 10);
  if (post.authorId === ownerId) {
    if (post.kind === 'FLOOR') stats.ownerDays.set(day, Math.min(5, (stats.ownerDays.get(day) ?? 0) + 1));
  } else if (playerIds.has(post.authorId)) {
    stats.players.add(post.authorId);
    stats.playerDays.add(`${post.authorId}:${day}`);
  }
}

export function computeThreadSmartScore(stats: ThreadSmartStats): number {
  const replies = [...stats.ownerDays.values()].reduce((sum, value) => sum + value, 0);
  return 4 * Math.log1p(stats.players.size) + 2 * Math.log1p(stats.playerDays.size)
    + 2 * Math.log1p(replies) + Math.log1p(Math.min(stats.words, 100_000) / 1000);
}
