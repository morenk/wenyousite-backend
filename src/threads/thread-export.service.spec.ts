import {
  renderExportContent,
  type RenderContext,
  type ThreadExportDiceRoll,
  type ThreadExportOptions,
} from './thread-export.service';

const options: ThreadExportOptions = {
  includeAuthors: true,
  includeTimestamps: true,
  includeFloorNumbers: true,
  includeReplyTargets: true,
  includeSourceLinks: false,
  includeMedia: true,
};

function context(overrides: Partial<RenderContext> = {}): RenderContext {
  return {
    options,
    assets: new Map(),
    warnings: new Set(),
    webUrl: 'https://wenyou.site',
    diceRolls: [],
    ...overrides,
  };
}

describe('renderExportContent', () => {
  it('降级骰子、站内引用和本地媒体，同时保留普通 Markdown', () => {
    const nodeId = '123e4567-e89b-42d3-a456-426614174000';
    const diceRoll: ThreadExportDiceRoll = {
      nodeId,
      notation: '1d20+2',
      total: 17,
      results: [15],
    };
    const result = renderExportContent(
      `**章节** [[dice:v1:${nodeId}:1d20+2]] [回到主题](/threads/cjldummythreadid000000000000) ![地图](https://cdn.example/map.png)`,
      context({
        assets: new Map([
          [
            'image:https://cdn.example/map.png',
            { path: 'media/001-image', buffer: Buffer.from('map') },
          ],
        ]),
        diceRolls: [diceRoll],
      }),
    );

    expect(result).toContain('**章节**');
    expect(result).toContain('骰子（1d20+2 = 17，结果：15）');
    expect(result).toContain('回到主题');
    expect(result).toContain('![地图](media/001-image)');
    expect(result).not.toContain('cjldummythreadid000000000000');
  });

  it('不改写代码块中的协议文本，并脱敏邀请链接', () => {
    const result = renderExportContent(
      '```md\n![代码](https://cdn.example/code.png) [[dice:v1:123e4567-e89b-42d3-a456-426614174000:1d6]]\n```\n/join/abcdefghijklmnop',
      context(),
    );

    expect(result).toContain('![代码](https://cdn.example/code.png)');
    expect(result).toContain('[[dice:v1:123e4567-e89b-42d3-a456-426614174000:1d6]]');
    expect(result).toContain('邀请传送门');
    expect(result).not.toContain('/join/abcdefghijklmnop');
  });

  it('连续转换多个骰子和图片标记', () => {
    const firstId = '123e4567-e89b-42d3-a456-426614174000';
    const secondId = '123e4567-e89b-42d3-a456-426614174001';
    const result = renderExportContent(
      `[[dice:v1:${firstId}:1d6]] [[dice:v1:${secondId}:1d8]] ![一](https://cdn.example/1.png) ![二](https://cdn.example/2.png)`,
      context({
        assets: new Map([
          ['image:https://cdn.example/1.png', { path: 'media/001-image', buffer: Buffer.from('1') }],
          ['image:https://cdn.example/2.png', { path: 'media/002-image', buffer: Buffer.from('2') }],
        ]),
        diceRolls: [
          { nodeId: firstId, notation: '1d6', total: 4, results: [4] },
          { nodeId: secondId, notation: '1d8', total: 7, results: [7] },
        ],
      }),
    );

    expect(result).toContain('骰子（1d6 = 4，结果：4）');
    expect(result).toContain('骰子（1d8 = 7，结果：7）');
    expect(result).toContain('![一](media/001-image)');
    expect(result).toContain('![二](media/002-image)');
  });
});
