import { momentViewerVisibility, visibleMomentAuthorWhere } from './moment-visibility.where';

describe('动态可见性查询条件', () => {
  it('统一排除查看者与作者之间任一方向的拉黑关系', () => {
    expect(visibleMomentAuthorWhere('viewer-1')).toEqual({
      userBlocks: { none: { blockedId: 'viewer-1' } },
      blockedBy: { none: { blockerId: 'viewer-1' } },
    });
  });

  it('匿名查看不添加作者条件，登录查看复用作者条件', () => {
    expect(momentViewerVisibility()).toEqual({});
    expect(momentViewerVisibility('viewer-1')).toEqual({
      author: visibleMomentAuthorWhere('viewer-1'),
    });
  });
});
