import { ValidationPipe } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CreateFontSubmissionDto,
  FontManagementQueryDto,
  ReorderFontsDto,
} from './dto/font-management.dto';
import {
  FONT_LANGUAGE_SPECIMENS,
  FONT_SIMPLIFIED_PARAMETERS_VERSION,
  FONT_UPLOAD_RULE_VERSION,
} from './font-management-contract';
import { API_CONTRACT_VERSION } from '../common/swagger/openapi-document';
import { selectFontManagementPage } from './font-management.service';

const fixture = JSON.parse(
  readFileSync(join(__dirname, '../../contracts/admin-font-management-v1-fixtures.json'), 'utf8'),
);
const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });

it.each(
  fixture.listCases as {
    id: string;
    query: Record<string, string>;
    afterCase?: string;
    expectedFamilyIds: string[];
    expectedTotal: number;
    expectedHasNext: boolean;
  }[],
)('$id：全量筛选后稳定分页符合跨端样例', (row) => {
  const candidates = fixture.listDataset.map((item: Record<string, unknown>) => ({
    ...item,
    createdAt: new Date(item.createdAt as string),
    updatedAt: new Date(item.updatedAt as string),
  }));
  const query = Object.assign(new FontManagementQueryDto(), row.query);
  const result = selectFontManagementPage(candidates, query, row.afterCase ? 20 : 0);
  expect(result.total).toBe(row.expectedTotal);
  expect(result.items.map((item) => item.familyId)).toEqual(row.expectedFamilyIds);
  expect((row.afterCase ? 20 : 0) + result.items.length < result.total).toBe(row.expectedHasNext);
});

it('Unicode 大小写、组合音符匹配和主排序并列不依赖 PostgreSQL locale', () => {
  const candidates = fixture.listDataset
    .slice(0, 3)
    .map((item: Record<string, unknown>) => ({
      ...item,
      name: 'CAFÉ',
      createdAt: new Date(0),
      updatedAt: new Date(0),
    }));
  const result = selectFontManagementPage(
    candidates.reverse(),
    Object.assign(new FontManagementQueryDto(), { q: ' cafe\u0301 ', sort: 'name' }),
    0,
  );
  expect(result.total).toBe(3);
  expect(result.items.map((item) => item.familyId)).toEqual(
    fixture.listDataset.slice(0, 3).map((item: Record<string, unknown>) => item.familyId),
  );
});

it.each(
  fixture.createCases as { id: string; input: unknown; accepted: boolean; expected?: unknown }[],
)('$id：简化提交输入与共享消费者样例一致', async (row) => {
  const result = pipe.transform(row.input, { type: 'body', metatype: CreateFontSubmissionDto });
  if (row.accepted) await expect(result).resolves.toEqual(row.expected);
  else await expect(result).rejects.toMatchObject({ status: 400 });
});

it('固定规则与语言样例不会在消费者和服务端漂移', () => {
  expect(fixture.apiContractVersion).toBe(API_CONTRACT_VERSION);
  expect(fixture.authorizationRuleVersion).toBe(FONT_UPLOAD_RULE_VERSION);
  expect(fixture.parametersVersion).toBe(FONT_SIMPLIFIED_PARAMETERS_VERSION);
  expect(fixture.specimens).toEqual(FONT_LANGUAGE_SPECIMENS);
  expect(fixture.listDataset.length).toBeGreaterThan(20);
});

it('列表默认创建时间倒序，拒绝客户端页长、旧游标和空枚举', async () => {
  await expect(
    pipe.transform({}, { type: 'query', metatype: FontManagementQueryDto }),
  ).resolves.toEqual({ sort: 'createdAt', direction: 'desc' });
  for (const input of [
    { limit: 100 },
    { after: 'legacy-id' },
    { sort: null },
    { direction: 'up' },
    { language: null },
  ]) {
    await expect(
      pipe.transform(input, { type: 'query', metatype: FontManagementQueryDto }),
    ).rejects.toMatchObject({ status: 400 });
  }
});

it('批量顺序必须提供目录及每个成员修订，不接受单条移动命令', async () => {
  const input = fixture.orderCases[0].input;
  await expect(pipe.transform(input, { type: 'body', metatype: ReorderFontsDto })).resolves.toEqual(
    input,
  );
  for (const malformed of [
    { ...input, expectedCatalogRevision: undefined },
    { ...input, groups: [] },
    { ...input, direction: 'up' },
    {
      ...input,
      groups: [{ language: 'zh', items: [{ familyId: input.groups[0].items[0].familyId }] }],
    },
  ]) {
    await expect(
      pipe.transform(malformed, { type: 'body', metatype: ReorderFontsDto }),
    ).rejects.toMatchObject({ status: 400 });
  }
});
