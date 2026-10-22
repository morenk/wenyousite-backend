import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv/dist/2020';
import { DYNAMIC_FONT_RUNTIME_POLICY } from './font-runtime-policy';
import { fontEnvelopeBytes } from './font-catalog-page';
import { fontVersionState } from './font-version-state';
import { FontStorageService } from './font-storage.service';
import { ConfigService } from '@nestjs/config';
import { FontQueryService } from './font-query.service';
import { TextFontsV2Controller } from './text-fonts-v2.controller';
import { BusinessException } from '../common/exceptions/business.exception';
const read = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, '../../contracts/', name), 'utf8'));
it('运行策略独立且不允许扩大累计注册输入或添加固定家族数', () => {
  const validate = new Ajv().compile(read('thread-font-runtime-policy-v3.schema.json'));
  expect(DYNAMIC_FONT_RUNTIME_POLICY).toEqual(read('thread-font-runtime-policy-v3.json'));
  expect(validate(DYNAMIC_FONT_RUNTIME_POLICY)).toBe(true);
  expect(fontEnvelopeBytes(DYNAMIC_FONT_RUNTIME_POLICY)).toBeLessThanOrEqual(65536);
  const modified = structuredClone(DYNAMIC_FONT_RUNTIME_POLICY);
  modified.mobile.registration.maxInputBytes++;
  expect(validate(modified)).toBe(false);
  modified.mobile.registration.maxInputBytes = 67108864;
  expect(validate({ ...modified, manifestSha256: 'a'.repeat(64) })).toBe(false);
  expect(
    validate({
      ...modified,
      web: { ...modified.web, residency: { ...modified.web.residency, maxFamilies: 28 } },
    }),
  ).toBe(false);
});
it('状态表保留历史、停用可呈现而撤回不可呈现', () => {
  for (const row of read('thread-font-dynamic-v2-fixtures.json').statusCases) {
    expect(fontVersionState(row.published, row.enabled, row.current, row.withdrawn)).toEqual({
      selectable: row.selectable,
      pasteAllowed: row.pasteAllowed,
      renderAllowed: row.renderAllowed,
    });
  }
});
it('未配置私有存储时拒绝运行，策略响应不能修改服务端默认值', () => {
  const service = new FontStorageService(new ConfigService());
  try {
    service.requireConfigured();
    throw new Error('应拒绝');
  } catch (error) {
    expect((error as BusinessException).errorCode).toBe(50301);
  }
  const controller = new TextFontsV2Controller({} as FontQueryService);
  const policy = controller.getRuntimePolicy();
  policy.web.residency.maxFaces = 1;
  expect(controller.getRuntimePolicy().web.residency.maxFaces).toBe(64);
});
it('28 款导入映射稳定唯一且不包含 retired 小城', () => {
  const mapping = read('thread-font-v1-import-map.json');
  const old = read('thread-font-catalog-v1.json');
  expect(mapping.fonts.map((row: { legacyId: string }) => row.legacyId)).toEqual(
    old.fonts.map((row: { id: string }) => row.id),
  );
  expect(new Set(mapping.fonts.map((row: { versionId: string }) => row.versionId)).size).toBe(28);
  expect(mapping.retired).toEqual(['xiaocheng-lafeng']);
});

it('v2 清单接受保留的 v1 family；先读旧资源再读导入版本不重复登记', () => {
  const schema = read('thread-font-manifest-v2.schema.json');
  const validateFamily = new Ajv().compile(schema.properties.shards.items.properties.family);
  expect(validateFamily('WYF2-' + 'a'.repeat(32) + '-core')).toBe(true);
  expect(validateFamily('WYF1-' + 'a'.repeat(16) + '-core')).toBe(true);
  expect(validateFamily('WYF1-' + 'a'.repeat(32) + '-core')).toBe(false);
  const old = read('thread-font-manifest-v1.json');
  for (const row of read('thread-font-dynamic-v2-fixtures.json').legacyImportRegistrationCases) {
    const legacy = old.fonts.find((font: { id: string }) => font.id === row.legacyId);
    const shard = legacy.shards.find(
      (item: { family: string }) => item.family === row.events[0].family,
    );
    expect(shard.mobile.sha256).toBe(row.events[0].sha256);
    const ledger = new Set<string>();
    let attempts = 0,
      bytes = 0,
      afterLegacy = 0;
    for (const event of row.events) {
      expect(validateFamily(event.family)).toBe(true);
      const key = JSON.stringify([event.sha256, event.family]);
      if (!ledger.has(key)) {
        ledger.add(key);
        attempts++;
        bytes += event.bytes;
      }
      if (event.protocol === 1) afterLegacy = attempts;
    }
    expect(attempts).toBe(row.expectedNativeAttempts);
    expect(attempts - afterLegacy).toBe(row.expectedAdditionalAttemptsAfterImport);
    expect(bytes).toBe(row.expectedChargedBytes);
  }
});
