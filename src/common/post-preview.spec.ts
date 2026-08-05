import { buildPostPreview } from './post-preview';

describe('buildPostPreview', () => {
  it('骰子帖摘要同时包含正文与正式总点数', () => {
    expect(buildPostPreview('**行动检定**', [{ notation: '1d20+2', total: 17 }])).toBe(
      '行动检定 · 🎲 1d20+2=17',
    );
  });

  it('纯骰子帖仍产生可用于通知与动态的摘要', () => {
    expect(buildPostPreview('', [{ notation: '2d6', total: 8 }])).toBe('🎲 2d6=8');
  });

  it('超过三次时截断逐项展示但保留总次数', () => {
    const rolls = [1, 2, 3, 4].map((total) => ({ notation: '1d6', total }));
    expect(buildPostPreview('', rolls)).toBe('🎲 1d6=1、1d6=2、1d6=3，等4次');
  });
});
