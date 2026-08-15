import {
  planMarkdownV3Migration,
  staleMentionRelationIds,
} from './markdown-v3-migration';
import { findUnsupportedMarkdownFormats } from './markdown-content';

describe('Markdown v3 数据迁移', () => {
  it('dry-run 计划不修改输入，只为命中记录递增版本', () => {
    const records = [
      { id: 'safe', content: '## 合法标题', version: 4 },
      { id: 'legacy', content: '# 历史标题', version: 7 },
    ];
    const snapshot = structuredClone(records);

    expect(planMarkdownV3Migration(records)).toEqual([
      expect.objectContaining({
        id: 'legacy',
        content: '# 历史标题',
        nextContent: '\\# 历史标题',
        nextVersion: 8,
        unsupportedTypes: ['heading-1'],
      }),
    ]);
    expect(records).toEqual(snapshot);
  });

  it('迁移结果合法且重复规划幂等', () => {
    const [change] = planMarkdownV3Migration([
      { id: 'legacy', content: '| A | B |\n| - | - |\n| 1 | 2 |', version: 2 },
    ]);
    expect(change).toBeDefined();
    expect(findUnsupportedMarkdownFormats(change!.nextContent)).toEqual([]);
    expect(planMarkdownV3Migration([{
      id: change!.id,
      content: change!.nextContent,
      version: change!.nextVersion,
    }])).toEqual([]);
  });

  it('只删除字面化后失活的提及派生关系', () => {
    const relations = [
      { id: 'm1', mentionedUserId: 'u1', username: '甲', source: 'DIRECT' as const },
      { id: 'm2', mentionedUserId: 'u2', username: '乙', source: 'DIRECT' as const },
      { id: 'm3', mentionedUserId: 'u3', username: '丙', source: 'ALL_PLAYERS' as const },
    ];
    const content = '保留 [@甲](/users/u1)；字面 \\@乙；保留 @全体玩家';
    expect(staleMentionRelationIds(content, relations)).toEqual(['m2']);
  });
});
