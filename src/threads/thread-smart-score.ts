import { RedisService } from '../redis/redis.service';

export const SMART_SCORE_ZSET = 'threads:by:smart';

export interface ThreadSmartStats {
  views: number;
  replies: number;
  likes: number;
  tips: number;
  createdAt: number;
}

export function computeThreadEngagement(
  stats: Pick<ThreadSmartStats, 'views' | 'replies' | 'likes' | 'tips'>,
) {
  return (
    stats.replies * 2 +
    stats.likes * 3 +
    stats.views * 0.3 +
    5 * Math.log1p(Math.max(0, stats.tips))
  );
}

export function computeThreadSmartScore(engagement: number, ageHours: number): number {
  return engagement / Math.pow(Math.max(0, ageHours) + 2, 1.25);
}

export function initialThreadSmartScore(replies: number, views: number, tips: number): number {
  return computeThreadSmartScore(computeThreadEngagement({ replies, views, tips, likes: 0 }), 0);
}

export async function updateThreadSmartScore(
  redis: RedisService,
  threadId: string,
): Promise<number> {
  const stats = await redis.hgetall(`thread:${threadId}:stats`);
  const createdAt = Number.parseInt(stats?.createdAt ?? '0', 10);
  if (!createdAt) return 0;

  const engagement = computeThreadEngagement({
    views: Number.parseInt(stats?.views ?? '0', 10),
    replies: Number.parseInt(stats?.replies ?? '0', 10),
    likes: Number.parseInt(stats?.likes ?? '0', 10),
    tips: Number(stats?.tips ?? '0'),
  });
  const ageHours = (Date.now() - createdAt) / 3_600_000;
  const score = computeThreadSmartScore(engagement, ageHours);
  await redis.zadd(SMART_SCORE_ZSET, score, threadId);
  return score;
}
