import {
  beijingDateKey,
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
});
