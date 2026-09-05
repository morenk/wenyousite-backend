import { markdownContributionText } from '../common/markdown-content';
import { addThreadContribution, computeThreadSmartScore, newThreadSmartStats } from './thread-smart-score';

const now = Date.parse('2026-09-05T16:30:00Z');
const players = new Set(['player']);
const post = { authorId: 'player', kind: 'FLOOR', content: '一起创作', createdAt: new Date(now) };

describe('参与创作推荐分', () => {
  it('过滤图片、地址、协议和不可见字符，保留可见标签与 Unicode 字符', () => {
    expect(markdownContributionText('![长图片描述](https://example.invalid/image "wenyousite-sticker:v1:a")')).toBe('');
    expect(markdownContributionText('https://example.invalid/a [[dice:v1:node:1d6]]\u200b')).toBe('');
    expect(markdownContributionText('**一起**创作😀 [规则](https://example.invalid/a)')).toBe('一起创作😀 规则');
    const stats = newThreadSmartStats();
    addThreadContribution(stats, { ...post, content: '😀😀' }, 'owner', players, now);
    expect(stats.words).toBe(2);
  });

  it('玩家按实际发言计数，跨北京时间日期累计参与天数，七天外只累计字数', () => {
    const stats = newThreadSmartStats();
    for (const createdAt of ['2026-09-05T15:59:00Z', '2026-09-05T16:00:00Z']) {
      addThreadContribution(stats, { ...post, createdAt: new Date(createdAt) }, 'owner', players, now);
    }
    addThreadContribution(stats, { ...post, authorId: 'spectator' }, 'owner', players, now);
    addThreadContribution(stats, { ...post, authorId: 'old-player', createdAt: new Date(now - 7 * 86400000 - 1) }, 'owner', new Set(['old-player']), now);
    expect(stats.players.size).toBe(1);
    expect(stats.playerDays.size).toBe(2);
    expect(stats.words).toBe(12);
    expect(computeThreadSmartScore(stats)).toBeCloseTo(4 * Math.log(2) + 2 * Math.log(3) + Math.log1p(12 / 1000));
  });

  it('楼主正文不算回复，每日最多五次，重复文本只按同作者计一次', () => {
    const stats = newThreadSmartStats();
    for (let index = 0; index < 20; index++) {
      addThreadContribution(stats, { ...post, authorId: 'owner', content: '**一起**创作' }, 'owner', players, now);
    }
    addThreadContribution(stats, { ...post, authorId: 'owner', content: '一起创作', kind: 'BODY' }, 'owner', players, now);
    expect([...stats.ownerDays.values()]).toEqual([5]);
    expect(stats.words).toBe(4);
    expect(stats.players.size).toBe(0);
    expect(computeThreadSmartScore(stats)).toBeCloseTo(2 * Math.log(6) + Math.log1p(4 / 1000));
  });

  it('字数最多十万，纯图片发言不算参与', () => {
    const stats = newThreadSmartStats();
    addThreadContribution(stats, { ...post, content: '![图](https://example.invalid/a)' }, 'owner', players, now);
    expect(stats.players.size).toBe(0);
    addThreadContribution(stats, { ...post, content: '字'.repeat(100_010), createdAt: new Date(0) }, 'owner', players, now);
    expect(stats.words).toBe(100_000);
    expect(computeThreadSmartScore(stats)).toBeCloseTo(Math.log(101));
  });
});
