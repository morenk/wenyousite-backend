import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { TextFontsController } from './text-fonts.controller';
import { TEXT_FONT_IDS, isTextFontSourceReady } from '../common/text-font-catalog';

describe('字体目录发布契约', () => {
  it('未配置分发来源时仍提供身份与待核验状态，不返回第三方下载兜底', () => {
    const controller = new TextFontsController(new ConfigService());
    const result = controller.getCatalog();
    expect(result.assetBaseUrl).toBeNull();
    expect(result.fontVersion).toBe(1);
    expect(result.fonts.map((font) => font.id).sort()).toEqual([...TEXT_FONT_IDS].sort());
    for (const font of result.fonts) {
      expect(font.availability === 'ready').toBe(isTextFontSourceReady(font.id));
    }
    const catalog = JSON.parse(
      readFileSync(join(__dirname, '../../contracts/thread-font-catalog-v1.json'), 'utf8'),
    ) as { fonts: Array<{ id: string; availability: string }> };
    expect(result.fonts.map(({ id, availability }) => ({ id, availability }))).toEqual(
      catalog.fonts.map(({ id, availability }) => ({ id, availability })),
    );
    result.fonts[0].name = '调用者副本';
    expect(controller.getCatalog().fonts[0].name).not.toBe('调用者副本');
  });

  it('公开 manifest 描述与已提交构建产物逐字节一致', () => {
    const controller = new TextFontsController(
      new ConfigService({ app: { textFontAssetBaseUrl: 'https://assets.example.com/fonts/' } }),
    );
    const result = controller.getCatalog();
    expect(result.assetBaseUrl).toBe('https://assets.example.com/fonts/');
    expect(result.manifest).not.toBeNull();
    const bytes = readFileSync(join(__dirname, '../../contracts/thread-font-manifest-v1.json'));
    expect(result.manifest!.bytes).toBe(bytes.length);
    expect(result.manifest!.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(result.manifest!.path).not.toMatch(/(?:^\/|\.\.|:|\?|#)/u);
  });
});
