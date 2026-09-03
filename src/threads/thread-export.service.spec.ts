import {
  renderExportContent,
  formatExportTime,
  getExportMediaExtension,
  getExportFilenameStem,
  ThreadExportService,
  type PreparedAsset,
  type RenderContext,
  type ThreadExportDiceRoll,
  type ThreadExportOptions,
} from './thread-export.service';
import { ThreadExportFormat } from './dto/thread-export.dto';

const options: ThreadExportOptions = {
  format: ThreadExportFormat.BOTH,
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
            { path: 'media/001-image.png', buffer: Buffer.from('map') },
          ],
        ]),
        diceRolls: [diceRoll],
      }),
    );

    expect(result).toContain('**章节**');
    expect(result).toContain('骰子（1d20+2 = 17，结果：15）');
    expect(result).toContain('回到主题');
    expect(result).toContain('![地图](media/001-image.png)');
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
          [
            'image:https://cdn.example/1.png',
            { path: 'media/001-image.png', buffer: Buffer.from('1') },
          ],
          [
            'image:https://cdn.example/2.png',
            { path: 'media/002-image.png', buffer: Buffer.from('2') },
          ],
        ]),
        diceRolls: [
          { nodeId: firstId, notation: '1d6', total: 4, results: [4] },
          { nodeId: secondId, notation: '1d8', total: 7, results: [7] },
        ],
      }),
    );

    expect(result).toContain('骰子（1d6 = 4，结果：4）');
    expect(result).toContain('骰子（1d8 = 7，结果：7）');
    expect(result).toContain('![一](media/001-image.png)');
    expect(result).toContain('![二](media/002-image.png)');
  });

  it('表情只保留替代文字，不生成媒体链接', () => {
    const result = renderExportContent(
      '![笑脸](https://cdn.example/sticker.webp "wenyousite-sticker:v1:123e4567-e89b-42d3-a456-426614174000")',
      context({
        assets: new Map([
          [
            'sticker:123e4567-e89b-42d3-a456-426614174000',
            { path: 'media/001-sticker', buffer: Buffer.from('sticker') },
          ],
        ]),
      }),
    );

    expect(result).toBe('笑脸');
    expect(result).not.toContain('sticker.webp');
    expect(result).not.toContain('media/001-sticker');
  });

  it('时间固定格式化为北京时间', () => {
    expect(formatExportTime(new Date('2026-01-01T00:00:00.000Z'))).toBe(
      '2026-01-01 08:00:00（北京时间）',
    );
  });

  it('根据可信 MIME 类型生成媒体后缀，未知类型安全回退', () => {
    expect(getExportMediaExtension('image/jpeg')).toBe('.jpg');
    expect(getExportMediaExtension('image/webp; charset=binary')).toBe('.webp');
    expect(getExportMediaExtension('application/octet-stream')).toBe('.bin');
  });

  it('将帖子标题安全化为文件名 stem', () => {
    expect(getExportFilenameStem('星海 / 第一章: 归来?')).toBe('星海 第一章 归来');
    expect(getExportFilenameStem(null)).toBe('未命名主题帖');
    expect(getExportFilenameStem('   ...   ')).toBe('未命名主题帖');
    expect(getExportFilenameStem('CON')).toBe('主题帖-CON');
    expect(getExportFilenameStem('温油'.repeat(60))).toBe('温油'.repeat(40));
  });

  it('按导出格式选择 ZIP 中的正文文件', async () => {
    const service = new ThreadExportService(
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );
    const archive = (format: ThreadExportFormat) =>
      (
        service as unknown as {
          startArchive: (
            markdown: string,
            text: string,
            assets: ReadonlyMap<string, PreparedAsset>,
            warnings: ReadonlySet<string>,
            selectedFormat: ThreadExportFormat,
            filenameStem: string,
          ) => NodeJS.ReadableStream;
        }
      ).startArchive(
        'markdown',
        'text',
        new Map<string, PreparedAsset>(),
        new Set(),
        format,
        'topic-title',
      );
    const read = (stream: NodeJS.ReadableStream) =>
      new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
      });

    for (const [format, included, omitted] of [
      [ThreadExportFormat.TXT, ['topic-title.txt'], ['topic-title.md']],
      [ThreadExportFormat.MARKDOWN, ['topic-title.md'], ['topic-title.txt']],
      [ThreadExportFormat.BOTH, ['topic-title.md', 'topic-title.txt'], []],
    ] as const) {
      const bytes = await read(archive(format));
      const archiveText = bytes.toString('latin1');
      for (const filename of included) expect(archiveText).toContain(filename);
      for (const filename of omitted) expect(archiveText).not.toContain(filename);
    }
  });
});
