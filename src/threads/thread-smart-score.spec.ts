import { computeThreadEngagement, computeThreadSmartScore } from './thread-smart-score';

describe('thread smart score', () => {
  it('按回复、点赞、浏览和温油累计计算活跃度', () => {
    expect(computeThreadEngagement({ replies: 2, likes: 3, views: 10, tips: 0 })).toBeCloseTo(
      2 * 2 + 3 * 3 + 10 * 0.3,
    );
    expect(computeThreadEngagement({ replies: 0, likes: 0, views: 0, tips: 99 })).toBeCloseTo(
      5 * Math.log(100),
    );
  });

  it('使用 ageHours + 2 的 1.25 次方衰减', () => {
    const newScore = computeThreadSmartScore(100, 0);
    const dayOldScore = computeThreadSmartScore(100, 24);
    expect(newScore / dayOldScore).toBeCloseTo(((24 + 2) / 2) ** 1.25, 1);
  });
});
