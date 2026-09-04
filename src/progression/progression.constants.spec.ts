import {
  beijingDateKey,
  EXPERIENCE_RULES,
  LEVEL_THRESHOLDS,
  levelForExperience,
  progressionFor,
} from './progression.constants';

describe('progression constants', () => {
  it('使用约定的九级经验门槛', () => {
    expect(LEVEL_THRESHOLDS).toEqual([0, 50, 200, 600, 1500, 3500, 7000, 14000, 30000]);
    expect(levelForExperience(49)).toBe(1);
    expect(levelForExperience(50)).toBe(2);
    expect(levelForExperience(29_999)).toBe(8);
    expect(levelForExperience(30_000)).toBe(9);
    expect(levelForExperience(99_999)).toBe(9);
  });

  it('九级仍保留精确经验且没有下一级门槛', () => {
    expect(progressionFor(31_234)).toEqual({
      level: 9,
      experience: 31_234,
      currentLevelExperience: 30_000,
      nextLevelExperience: null,
    });
  });

  it('按北京时间切换自然日', () => {
    expect(beijingDateKey(new Date('2026-08-07T15:59:59.999Z'))).toBe('2026-08-07');
    expect(beijingDateKey(new Date('2026-08-07T16:00:00.000Z'))).toBe('2026-08-08');
  });

  it('经验奖励按创作、互动与投喂分项限额', () => {
    expect(EXPERIENCE_RULES).toMatchObject({
      DAILY_CHECK_IN: { delta: 2, dailyCap: 1 },
      THREAD_PUBLISHED: { delta: 30, dailyCap: 1 },
      PRIVATE_THREAD_ACTIVATED: { delta: 15, dailyCap: 1 },
      POST_CREATED: { delta: 3, dailyCap: 5 },
      THREAD_REPLY_RECEIVED: { delta: 2, dailyCap: 5 },
      MOMENT_PUBLISHED: { delta: 4, dailyCap: 3 },
      MOMENT_COMMENT_CREATED: { delta: 2, dailyCap: 5 },
      MOMENT_REPLY_RECEIVED: { delta: 1, dailyCap: 5 },
      THREAD_LIKED: { delta: 2, dailyCap: 10 },
      TIP_SENT: { delta: 1, dailyCap: 3 },
      TIP_RECEIVED: { delta: 2, dailyCap: 5 },
    });
  });
});
