/** 校验 Web、Flutter 与后端共用的动态主题帖分类黄金用例和 OpenAPI 边界。 */

import * as fs from 'node:fs';
import * as path from 'node:path';

type JsonObject = Record<string, unknown>;

const fixturePath = 'contracts/thread-category-v1-fixtures.json';
const fixtureSource = fs.readFileSync(fixturePath, 'utf8');
const fixture = JSON.parse(fixtureSource) as JsonObject;
const openApi = JSON.parse(fs.readFileSync('contracts/openapi.json', 'utf8')) as JsonObject;
const failures: string[] = [];

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function schemaMap() {
  if (!isObject(openApi.components) || !isObject(openApi.components.schemas)) return {};
  return openApi.components.schemas;
}

if (fixture.contract !== 'wenyousite-thread-category' || fixture.version !== 1) {
  failures.push('分类黄金用例的契约标识或版本无效');
}
if (/\b(?:DEDUCTION|NATION|RPG)\b|演绎|国策|角色扮演/u.test(fixtureSource)) {
  failures.push('分类黄金用例不得依赖历史分类 slug、名称或数量');
}

const definitions = Array.isArray(fixture.definitions) ? fixture.definitions : [];
const definitionIds = new Set<string>();
const definitionsBySlug = new Map<string, JsonObject>();
for (const value of definitions) {
  if (!isObject(value)) {
    failures.push('definitions 每项必须是对象');
    continue;
  }
  const { id, slug, name, color, sortOrder, isActive, mergedIntoId, createdAt, updatedAt } = value;
  if (typeof id !== 'string' || definitionIds.has(id)) failures.push('分类 definition id 必须存在且唯一');
  else definitionIds.add(id);
  if (typeof slug !== 'string' || !/^[A-Z0-9][A-Z0-9_-]{0,49}$/.test(slug)) {
    failures.push(`${String(id)}: slug 格式无效`);
  } else if (definitionsBySlug.has(slug)) {
    failures.push(`${slug}: slug 必须唯一`);
  } else {
    definitionsBySlug.set(slug, value);
  }
  if (typeof name !== 'string' || name.length === 0 || name.length > 50) {
    failures.push(`${String(id)}: name 必须为 1–50 字符`);
  }
  if (!(color === null || (typeof color === 'string' && /^#[0-9A-F]{6}$/.test(color)))) {
    failures.push(`${String(id)}: color 必须为空或大写 #RRGGBB`);
  }
  if (!Number.isInteger(sortOrder) || Number(sortOrder) < 0) failures.push(`${String(id)}: sortOrder 无效`);
  if (isActive !== true) failures.push(`${String(id)}: 公开发现黄金数据只能包含启用分类`);
  if (mergedIntoId !== null) failures.push(`${String(id)}: 未合并的公开分类 mergedIntoId 必须为 null`);
  for (const [field, timestamp] of [['createdAt', createdAt], ['updatedAt', updatedAt]] as const) {
    if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) {
      failures.push(`${String(id)}: ${field} 必须是 ISO 时间`);
    }
  }
}
if (definitions.length < 2) failures.push('分类黄金用例至少需要两个非历史分类');

const expectedOrder = Array.isArray(fixture.expectedDiscoveryOrder)
  ? fixture.expectedDiscoveryOrder
  : [];
const actualOrder = definitions
  .filter(isObject)
  .sort((left, right) => Number(left.sortOrder) - Number(right.sortOrder)
    || String(left.name).localeCompare(String(right.name), 'zh-CN'))
  .map((definition) => definition.slug);
if (JSON.stringify(expectedOrder) !== JSON.stringify(actualOrder)) {
  failures.push('expectedDiscoveryOrder 与服务端 sortOrder/name 排序不一致');
}

const presentationCases = Array.isArray(fixture.presentationCases) ? fixture.presentationCases : [];
const caseIds = new Set<string>();
for (const value of presentationCases) {
  if (!isObject(value) || typeof value.id !== 'string' || !isObject(value.expected)) {
    failures.push('presentationCases 每项必须包含 id 和 expected');
    continue;
  }
  if (caseIds.has(value.id)) failures.push(`${value.id}: case id 重复`);
  caseIds.add(value.id);
  const slug = value.threadCategory;
  const definition = typeof slug === 'string' ? definitionsBySlug.get(slug) : undefined;
  const actual = {
    label: definition?.name ?? slug ?? '未分类',
    color: definition?.color ?? null,
    selectable: Boolean(definition),
  };
  if (JSON.stringify(value.expected) !== JSON.stringify(actual)) {
    failures.push(`${value.id}: 展示期望与动态注册表不一致`);
  }
}
for (const id of [
  'renamed-category-uses-current-registry-name',
  'unknown-historical-slug-remains-readable',
  'uncategorized-draft',
]) {
  if (!caseIds.has(id)) failures.push(`缺少移动端分类黄金用例 ${id}`);
}

const schemas = schemaMap();
const categoryDefinition = isObject(schemas.ThreadCategoryResponseDto)
  ? schemas.ThreadCategoryResponseDto
  : undefined;
const definitionProperties = categoryDefinition && isObject(categoryDefinition.properties)
  ? categoryDefinition.properties
  : undefined;
const slugSchema = definitionProperties && isObject(definitionProperties.slug)
  ? definitionProperties.slug
  : undefined;
if (slugSchema?.type !== 'string' || Array.isArray(slugSchema.enum)) {
  failures.push('ThreadCategoryResponseDto.slug 必须是开放字符串，不能是枚举');
}
for (const field of [
  'id',
  'slug',
  'name',
  'description',
  'color',
  'icon',
  'sortOrder',
  'isActive',
  'mergedIntoId',
]) {
  if (!definitionProperties || !(field in definitionProperties)) {
    failures.push(`ThreadCategoryResponseDto 缺少 ${field}`);
  }
}
const updateCategory = isObject(schemas.UpdateThreadCategoryDto)
  ? schemas.UpdateThreadCategoryDto
  : undefined;
if (updateCategory && isObject(updateCategory.properties) && 'slug' in updateCategory.properties) {
  failures.push('UpdateThreadCategoryDto 不得允许修改稳定 slug');
}

const inputCategorySchemas = new Set(['CreateThreadDto', 'UpdateThreadDto', 'SaveThreadAggregateDto']);
for (const [schemaName, schema] of Object.entries(schemas)) {
  if (!isObject(schema) || !isObject(schema.properties) || !isObject(schema.properties.category)) continue;
  const category = schema.properties.category;
  if (category.type !== 'string' || Array.isArray(category.enum)) {
    failures.push(`${schemaName}.category 必须是开放字符串，不能是枚举`);
  }
  if (!inputCategorySchemas.has(schemaName) && category.nullable !== true) {
    failures.push(`${schemaName}.category 必须允许历史草稿或无分类值为 null`);
  }
}

const paths = isObject(openApi.paths) ? openApi.paths : {};
const categoryPath = isObject(paths['/api/v1/thread-categories'])
  ? paths['/api/v1/thread-categories']
  : undefined;
const listOperation = categoryPath && isObject(categoryPath.get) ? categoryPath.get : undefined;
if (listOperation?.operationId !== 'threadCategoriesList'
  || !Array.isArray(listOperation.security)
  || listOperation.security.length !== 0) {
  failures.push('GET /thread-categories 必须保持公开且具有稳定 operationId');
}

const frontendFixture = path.resolve('../wenyousite-frontend', fixturePath);
if (fs.existsSync(frontendFixture) && fs.readFileSync(frontendFixture, 'utf8') !== fixtureSource) {
  failures.push('前后端动态分类黄金用例不一致');
}

if (failures.length > 0) {
  throw new Error(`Thread category contract checks failed:\n${failures.join('\n')}`);
}
console.log(
  `Thread category v1 contract is valid (${definitions.length} definitions, ${presentationCases.length} presentation cases)`,
);
