import { ExperienceEventType } from '@prisma/client';

export const LEVEL_THRESHOLDS = [0, 50, 200, 600, 1500, 3500, 7000, 14000, 30000] as const;

export const EXPERIENCE_RULES = {
  [ExperienceEventType.DAILY_CHECK_IN]: {
    delta: 2,
    dailyCap: 1,
    counter: 'checkInCount',
  },
  [ExperienceEventType.THREAD_PUBLISHED]: {
    delta: 30,
    dailyCap: 1,
    counter: 'threadPublishCount',
  },
  [ExperienceEventType.PRIVATE_THREAD_ACTIVATED]: {
    delta: 15,
    dailyCap: 1,
    counter: 'threadPublishCount',
  },
  [ExperienceEventType.POST_CREATED]: {
    delta: 3,
    dailyCap: 5,
    counter: 'postCreateCount',
  },
  [ExperienceEventType.THREAD_REPLY_RECEIVED]: {
    delta: 2,
    dailyCap: 5,
    counter: 'receivedReplyCount',
  },
  [ExperienceEventType.THREAD_LIKED]: {
    delta: 2,
    dailyCap: 10,
    counter: 'receivedLikeCount',
  },
  [ExperienceEventType.MOMENT_PUBLISHED]: {
    delta: 4,
    dailyCap: 3,
    counter: 'momentPublishCount',
  },
  [ExperienceEventType.MOMENT_COMMENT_CREATED]: {
    delta: 2,
    dailyCap: 5,
    counter: 'momentCommentCount',
  },
  [ExperienceEventType.MOMENT_REPLY_RECEIVED]: {
    delta: 1,
    dailyCap: 5,
    counter: 'momentReplyReceivedCount',
  },
  [ExperienceEventType.TIP_SENT]: {
    delta: 1,
    dailyCap: 3,
    counter: 'tipSentCount',
  },
  [ExperienceEventType.TIP_RECEIVED]: {
    delta: 2,
    dailyCap: 5,
    counter: 'tipReceivedCount',
  },
} as const;

export type GrantableExperienceType = keyof typeof EXPERIENCE_RULES;
export type ExperienceCounterField = (typeof EXPERIENCE_RULES)[GrantableExperienceType]['counter'];

export function levelForExperience(experience: number): number {
  for (let index = LEVEL_THRESHOLDS.length - 1; index >= 0; index -= 1) {
    if (experience >= LEVEL_THRESHOLDS[index]) return index + 1;
  }
  return 1;
}

export function progressionFor(experience: number) {
  const level = levelForExperience(experience);
  return {
    level,
    experience,
    currentLevelExperience: LEVEL_THRESHOLDS[level - 1],
    nextLevelExperience: level === LEVEL_THRESHOLDS.length ? null : LEVEL_THRESHOLDS[level],
  };
}

/** 将任意时刻映射为北京时间自然日键，避免服务器本地时区影响签到与日上限。 */
export function beijingDateKey(value: Date = new Date()): string {
  return new Date(value.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
