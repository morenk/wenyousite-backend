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
    expect(result.fonts.map((font) => font.id).sort()).toEqual(TEXT_FONT_IDS.filter(isTextFontSourceReady).sort());
    expect(
      ['zh', 'ja', 'en'].map(
        (language) => result.fonts.filter((font) => font.designLanguage === language).length,
      ),
    ).toEqual([12, 10, 6]);
    for (const font of result.fonts) {
      expect(font.availability === 'ready').toBe(isTextFontSourceReady(font.id));
    }
    const catalog = JSON.parse(
      readFileSync(join(__dirname, '../../contracts/thread-font-catalog-v1.json'), 'utf8'),
    ) as {
      fonts: Array<{ id: string; name: string; designLanguage: string; availability: string }>;
    };
    expect(result.fonts).toEqual(catalog.fonts);
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

  it('怪盗原包核验后在日文分组提供可用身份', () => {
    const result = new TextFontsController(new ConfigService()).getCatalog();
    expect(result.fonts.find((font) => font.id === 'kaitou-yokoku-gothic')).toEqual({
      id: 'kaitou-yokoku-gothic',
      name: '怪盗予告黑体',
      designLanguage: 'ja',
      availability: 'ready',
    });
  });

  it('独立策略绑定原 manifest，旧目录形状不变且响应不共享可变引用', () => {
    const controller = new TextFontsController(new ConfigService());
    const catalog = controller.getCatalog();
    expect(Object.keys(catalog).sort()).toEqual(
      ['fontVersion', 'catalogVersion', 'assetBaseUrl', 'manifest', 'fonts'].sort(),
    );
    const policy = controller.getRuntimePolicy();
    expect(policy).toEqual(JSON.parse(readFileSync(
      join(__dirname, '../../contracts/thread-font-runtime-policy-v2.json'), 'utf8',
    )));
    expect(policy.policyVersion).toBe(2);
    expect(policy.manifestSha256).toBe(catalog.manifest!.sha256);
    for (const platform of [policy.web, policy.mobile]) {
      expect(platform.network).toMatchObject({
        timeoutMode: 'idle-with-total-cap', timeoutMs: 15000, maxTransferMs: 600000,
      });
    }
    expect(policy.mobile.registration.snapshot).toEqual({
      assetCount: 868, totalAssetBytes: 184645488,
      registrationCount: 868, totalRegistrationAssetBytes: 184645488,
    });
    policy.retry.delayCeilingsMs[0] = 999;
    policy.mobile.registration.snapshot.assetCount = 1;
    expect(controller.getRuntimePolicy().retry.delayCeilingsMs[0]).toBe(1000);
    expect(controller.getRuntimePolicy().mobile.registration.snapshot.assetCount).toBe(868);
    expect(catalog.assetBaseUrl).toBeNull();
  });
});
