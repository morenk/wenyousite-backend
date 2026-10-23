import { requireFontAuthorization } from './font-authorization';
import { fontBuildIdentity, fontVersionReuseKey } from './font-build-identity';
import { FontConfigurationDto } from './dto/font-admin.dto';
import { fontManagementOffset } from './font-management.service';

const config: FontConfigurationDto = {
  name: '原名称',
  designLanguage: 'other',
  sortOrder: 0,
  author: '',
  sourceUrl: '',
  licenseName: '',
  licenseText: '',
  specimenText: 'Aa',
  rights: { redistribution: false, conversion: false, subsetting: false },
};
const sha = 'a'.repeat(64);
const evidence = {
  actorId: 'test-actor',
  confirmedAt: '2026-10-24T00:00:00.000Z',
  sourceSha256: sha,
  ruleVersion: 'admin-font-upload-v1',
};

it('只有源绑定的简化确认可替代旧手工材料，规则/源/操作者/时间缺失都拒绝', () => {
  expect(() => requireFontAuthorization(config, sha, 2, evidence)).not.toThrow();
  expect(() => requireFontAuthorization(config, sha, 1, evidence)).toThrow();
  for (const altered of [
    null,
    { ...evidence, actorId: '' },
    { ...evidence, confirmedAt: 'bad' },
    { ...evidence, sourceSha256: 'b'.repeat(64) },
    { ...evidence, ruleVersion: 'invented' },
  ]) {
    expect(() => requireFontAuthorization(config, sha, 2, altered)).toThrow();
  }
  expect(() => requireFontAuthorization(config, sha, 3, evidence)).toThrow();
});

it('改名称或排序复用字形产物，名称变化仍获得独立版本身份；样张和处理器版本隔离缓存', async () => {
  const before = await fontBuildIdentity(sha, config, 2);
  const renamed = { ...config, name: '新名称', sortOrder: 13 };
  expect((await fontBuildIdentity(sha, renamed, 2)).key).toBe(before.key);
  expect(fontVersionReuseKey(before.key, renamed, 2)).not.toBe(
    fontVersionReuseKey(before.key, config, 2),
  );
  expect(fontVersionReuseKey(before.key, { ...config, sortOrder: 9 }, 2)).toBe(
    fontVersionReuseKey(before.key, config, 2),
  );
  expect(fontVersionReuseKey(before.key, { ...config, author: '补充作者' }, 2)).not.toBe(
    fontVersionReuseKey(before.key, config, 2),
  );
  expect((await fontBuildIdentity(sha, { ...config, specimenText: 'Bb' }, 2)).key).not.toBe(
    before.key,
  );
  expect((await fontBuildIdentity(sha, config, 1)).key).not.toBe(before.key);
});

it('列表游标拒绝格式错误、筛选变化和过期修订', () => {
  const cursor = Buffer.from(
    JSON.stringify({ version: 1, revision: 7, filter: sha, offset: 20 }),
  ).toString('base64url');
  expect(fontManagementOffset(cursor, 7, sha)).toBe(20);
  for (const value of [
    '!',
    'bnVsbA',
    Buffer.from(JSON.stringify({ version: 1, revision: 7, filter: sha, offset: -1 })).toString(
      'base64url',
    ),
  ]) {
    expect(() => fontManagementOffset(value, 7, sha)).toThrow('字体列表游标无效');
  }
  for (const [revision, filter] of [
    [8, sha],
    [7, 'b'.repeat(64)],
  ] as const) {
    try {
      fontManagementOffset(cursor, revision, filter);
      throw new Error('应拒绝');
    } catch (error) {
      expect(error).toMatchObject({ errorCode: 40931 });
    }
  }
});
