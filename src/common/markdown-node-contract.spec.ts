import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BlockFilterService } from '../access/block-filter.service';
import { ThreadAccessService } from '../access/thread-access.service';
import { DiceService } from '../dice/dice.service';
import { MentionsService } from '../mentions/mentions.service';
import { PrismaService } from '../prisma/prisma.service';
import { STICKER_MARKER_PREFIX } from '../stickers/sticker.constants';
import { StickerContentService } from '../stickers/sticker-content.service';

type ContractNode =
  | { type: 'mention'; userId: string; label: string }
  | { type: 'mention_all_players'; label: string }
  | { type: 'dice'; nodeId: string; notation: string }
  | { type: 'sticker'; assetId: string; url: string; alt: string }
  | { type: 'image'; url: string; alt: string; title: string | null };

const fixtures = JSON.parse(
  readFileSync(resolve(__dirname, '../../contracts/markdown-v4-nodes-fixtures.json'), 'utf8'),
) as { cases: Array<{ id: string; markdown: string; nodes: ContractNode[] }> };

describe('Markdown v4 节点跨端契约', () => {
  const dice = new DiceService();
  const stickers = new StickerContentService({} as PrismaService);
  const mentions = new MentionsService(
    {} as PrismaService,
    {} as ThreadAccessService,
    {} as BlockFilterService,
  ) as unknown as {
    extractMentionTokens(content: string): {
      usernames: string[];
      userIds: string[];
      allPlayers: boolean;
    };
  };

  it.each(fixtures.cases)('$id 的服务端解析结果与黄金语料一致', (fixture) => {
    const expectedDice = fixture.nodes
      .filter((node): node is Extract<ContractNode, { type: 'dice' }> => node.type === 'dice')
      .map(({ nodeId, notation }) => ({ nodeId, notation }));
    expect(
      dice.parseContent(fixture.markdown).nodes.map(({ nodeId, notation }) => ({
        nodeId,
        notation,
      })),
    ).toEqual(expectedDice);

    const expectedImages = fixture.nodes
      .filter(
        (node): node is Extract<ContractNode, { type: 'image' | 'sticker' }> =>
          node.type === 'image' || node.type === 'sticker',
      )
      .map((node) =>
        node.type === 'sticker'
          ? {
              url: node.url,
              title: `${STICKER_MARKER_PREFIX}${node.assetId}`,
              stickerAssetId: node.assetId,
            }
          : { url: node.url, title: node.title, stickerAssetId: null },
      );
    expect(stickers.extract(fixture.markdown)).toEqual(expectedImages);

    const mentionTokens = mentions.extractMentionTokens(fixture.markdown);
    expect(mentionTokens.userIds).toEqual(
      fixture.nodes
        .filter(
          (node): node is Extract<ContractNode, { type: 'mention' }> => node.type === 'mention',
        )
        .map((node) => node.userId),
    );
    expect(mentionTokens.usernames).toEqual([]);
    expect(mentionTokens.allPlayers).toBe(
      fixture.nodes.some((node) => node.type === 'mention_all_players'),
    );
  });
});
