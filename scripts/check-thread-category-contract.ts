/** 校验 Web、Flutter 与后端共用的动态主题帖分类黄金用例和 OpenAPI 边界。 */

import * as fs from 'node:fs';
import * as path from 'node:path';

type JsonObject = Record<string, unknown>;

const fixturePath = 'contracts/thread-category-v3-fixtures.json';
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

if (fixture.contract !== 'wenyousite-thread-category' || fixture.version !== 3) {
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
  const { id, slug, name, sortOrder, isActive } = value;
  if (typeof id !== 'string' || definitionIds.has(id))
    failures.push('分类 definition id 必须存在且唯一');
  else definitionIds.add(id);
  if (typeof slug !== 'string' || !/^[A-Z][A-Z0-9_]{0,49}$/.test(slug)) {
    failures.push(`${String(id)}: slug 格式无效`);
  } else if (definitionsBySlug.has(slug)) {
    failures.push(`${slug}: slug 必须唯一`);
  } else {
    definitionsBySlug.set(slug, value);
  }
  if (typeof name !== 'string' || name.length === 0 || name.length > 50) {
    failures.push(`${String(id)}: name 必须为 1–50 字符`);
  }
  for (const deprecatedField of ['color', 'icon', 'mergedIntoId']) {
    if (deprecatedField in value)
      failures.push(`${String(id)}: 文本分类黄金 definition 不得包含 ${deprecatedField}`);
  }
  if (!Number.isInteger(sortOrder) || Number(sortOrder) < 0)
    failures.push(`${String(id)}: sortOrder 无效`);
  if (typeof isActive !== 'boolean') failures.push(`${String(id)}: isActive 必须是布尔值`);
}
if (definitions.length < 3) failures.push('分类黄金用例至少需要三个非历史分类');
if (!definitions.some((value) => isObject(value) && value.isActive === false)) {
  failures.push('分类黄金用例必须覆盖停用分类');
}

const slugPolicy = isObject(fixture.slugPolicy) ? fixture.slugPolicy : {};
if (
  slugPolicy.normalization !== 'trim-uppercase' ||
  slugPolicy.pattern !== '^[A-Z][A-Z0-9_]{0,49}$' ||
  slugPolicy.minLength !== 1 ||
  slugPolicy.maxLength !== 50
) {
  failures.push('slugPolicy 必须固定为 trim-uppercase 与 1–50 位大写字母开头格式');
}

const expectedOrder = Array.isArray(fixture.expectedDiscoveryOrder)
  ? fixture.expectedDiscoveryOrder
  : [];
const actualOrder = definitions
  .filter(isObject)
  .filter((definition) => definition.isActive === true)
  .sort(
    (left, right) =>
      Number(left.sortOrder) - Number(right.sortOrder) ||
      String(left.slug).localeCompare(String(right.slug), 'en-US'),
  )
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
  const actualCategoryInfo =
    typeof slug !== 'string'
      ? null
      : {
          slug,
          name: definition?.name ?? slug,
          isActive: definition?.isActive ?? false,
        };
  if (JSON.stringify(value.expectedCategoryInfo) !== JSON.stringify(actualCategoryInfo)) {
    failures.push(`${value.id}: categoryInfo 期望与后端兼容读模型不一致`);
  }
  const actual = {
    label: actualCategoryInfo?.name ?? '未分类',
    selectable: actualCategoryInfo?.isActive ?? false,
  };
  if (JSON.stringify(value.expected) !== JSON.stringify(actual)) {
    failures.push(`${value.id}: 展示期望与动态注册表不一致`);
  }
}
for (const id of [
  'renamed-category-uses-current-registry-name',
  'inactive-category-uses-current-registry-name',
  'unknown-historical-slug-remains-readable',
  'uncategorized-draft',
]) {
  if (!caseIds.has(id)) failures.push(`缺少移动端分类黄金用例 ${id}`);
}

const schemas = schemaMap();
const categoryDefinition = isObject(schemas.ThreadCategoryResponseDto)
  ? schemas.ThreadCategoryResponseDto
  : undefined;
const definitionProperties =
  categoryDefinition && isObject(categoryDefinition.properties)
    ? categoryDefinition.properties
    : undefined;
const slugSchema =
  definitionProperties && isObject(definitionProperties.slug)
    ? definitionProperties.slug
    : undefined;
if (slugSchema?.type !== 'string' || Array.isArray(slugSchema.enum)) {
  failures.push('ThreadCategoryResponseDto.slug 必须是开放字符串，不能是枚举');
}
if (
  slugSchema?.pattern !== slugPolicy.pattern ||
  slugSchema?.minLength !== slugPolicy.minLength ||
  slugSchema?.maxLength !== slugPolicy.maxLength
) {
  failures.push('ThreadCategoryResponseDto.slug 与黄金 slugPolicy 不一致');
}
for (const field of [
  'id',
  'slug',
  'name',
  'description',
  'icon',
  'sortOrder',
  'isActive',
  'mergedIntoId',
]) {
  if (!definitionProperties || !(field in definitionProperties)) {
    failures.push(`ThreadCategoryResponseDto 缺少 ${field}`);
  }
}
for (const schemaName of [
  'ThreadCategoryResponseDto',
  'CreateThreadCategoryDto',
  'UpdateThreadCategoryDto',
]) {
  const schema = isObject(schemas[schemaName]) ? schemas[schemaName] : undefined;
  if (schema && isObject(schema.properties) && 'color' in schema.properties) {
    failures.push(`${schemaName} 不得包含 color`);
  }
}
const updateCategory = isObject(schemas.UpdateThreadCategoryDto)
  ? schemas.UpdateThreadCategoryDto
  : undefined;
if (updateCategory && isObject(updateCategory.properties) && 'slug' in updateCategory.properties) {
  failures.push('UpdateThreadCategoryDto 不得允许修改稳定 slug');
}

const createCategory = isObject(schemas.CreateThreadCategoryDto)
  ? schemas.CreateThreadCategoryDto
  : undefined;
const createCategorySlug =
  createCategory && isObject(createCategory.properties) && isObject(createCategory.properties.slug)
    ? createCategory.properties.slug
    : undefined;
if (
  createCategorySlug?.pattern !== slugPolicy.pattern ||
  createCategorySlug?.minLength !== slugPolicy.minLength ||
  createCategorySlug?.maxLength !== slugPolicy.maxLength
) {
  failures.push('CreateThreadCategoryDto.slug 与黄金 slugPolicy 不一致');
}

for (const field of ['icon', 'mergedIntoId']) {
  const definition = definitionProperties?.[field];
  if (!isObject(definition) || definition.deprecated !== true) {
    failures.push(`ThreadCategoryResponseDto.${field} 必须标记为 deprecated`);
  }
}

const categoryInfo = isObject(schemas.ThreadCategoryInfoDto)
  ? schemas.ThreadCategoryInfoDto
  : undefined;
const categoryInfoProperties =
  categoryInfo && isObject(categoryInfo.properties) ? categoryInfo.properties : undefined;
if (
  !categoryInfoProperties ||
  JSON.stringify(Object.keys(categoryInfoProperties).sort()) !==
    JSON.stringify(['isActive', 'name', 'slug'])
) {
  failures.push('ThreadCategoryInfoDto 必须且只能包含 slug/name/isActive');
}
if (
  !Array.isArray(categoryInfo?.required) ||
  JSON.stringify([...categoryInfo.required].sort()) !==
    JSON.stringify(['isActive', 'name', 'slug'])
) {
  failures.push('ThreadCategoryInfoDto 的三个字段必须全部必填');
}
const infoSlug = categoryInfoProperties && isObject(categoryInfoProperties.slug)
  ? categoryInfoProperties.slug
  : undefined;
if (
  infoSlug?.pattern !== slugPolicy.pattern ||
  infoSlug?.minLength !== slugPolicy.minLength ||
  infoSlug?.maxLength !== slugPolicy.maxLength
) {
  failures.push('ThreadCategoryInfoDto.slug 与黄金 slugPolicy 不一致');
}

for (const schemaName of [
  'ThreadListItemResponseDto',
  'DraftThreadResponseDto',
  'ThreadDetailResponseDto',
  'InviteThreadPreviewResponseDto',
  'SubscriptionThreadResponseDto',
]) {
  const schema = isObject(schemas[schemaName]) ? schemas[schemaName] : undefined;
  const properties = schema && isObject(schema.properties) ? schema.properties : undefined;
  const info = properties && isObject(properties.categoryInfo) ? properties.categoryInfo : undefined;
  const reference =
    typeof info?.$ref === 'string'
      ? info.$ref
      : Array.isArray(info?.allOf) && isObject(info.allOf[0])
        ? info.allOf[0].$ref
        : undefined;
  if (
    info?.nullable !== true ||
    reference !== '#/components/schemas/ThreadCategoryInfoDto' ||
    !Array.isArray(schema?.required) ||
    !schema.required.includes('categoryInfo')
  ) {
    failures.push(`${schemaName}.categoryInfo 必须是必填且可空的 ThreadCategoryInfoDto`);
  }
}

const inputCategorySchemas = new Set([
  'CreateThreadDto',
  'UpdateThreadDto',
  'SaveThreadAggregateDto',
]);
for (const [schemaName, schema] of Object.entries(schemas)) {
  if (!isObject(schema) || !isObject(schema.properties) || !isObject(schema.properties.category))
    continue;
  const category = schema.properties.category;
  if (category.type !== 'string' || Array.isArray(category.enum)) {
    failures.push(`${schemaName}.category 必须是开放字符串，不能是枚举`);
  }
  if (!inputCategorySchemas.has(schemaName) && category.nullable !== true) {
    failures.push(`${schemaName}.category 必须允许历史草稿或无分类值为 null`);
  }
  if (
    inputCategorySchemas.has(schemaName) &&
    (category.pattern !== slugPolicy.pattern ||
      category.minLength !== slugPolicy.minLength ||
      category.maxLength !== slugPolicy.maxLength)
  ) {
    failures.push(`${schemaName}.category 与黄金 slugPolicy 不一致`);
  }
}

const paths = isObject(openApi.paths) ? openApi.paths : {};
const categoryPath = isObject(paths['/api/v1/thread-categories'])
  ? paths['/api/v1/thread-categories']
  : undefined;
const listOperation = categoryPath && isObject(categoryPath.get) ? categoryPath.get : undefined;
if (
  listOperation?.operationId !== 'threadCategoriesList' ||
  !Array.isArray(listOperation.security) ||
  listOperation.security.length !== 0
) {
  failures.push('GET /thread-categories 必须保持公开且具有稳定 operationId');
}

const threadPath = isObject(paths['/api/v1/threads']) ? paths['/api/v1/threads'] : undefined;
const threadListOperation = threadPath && isObject(threadPath.get) ? threadPath.get : undefined;
const threadListParameters = Array.isArray(threadListOperation?.parameters)
  ? threadListOperation.parameters
  : [];
const categoryParameter = threadListParameters.find(
  (parameter) => isObject(parameter) && parameter.name === 'category',
);
const categoryParameterSchema =
  isObject(categoryParameter) && isObject(categoryParameter.schema)
    ? categoryParameter.schema
    : undefined;
if (
  categoryParameterSchema?.pattern !== slugPolicy.pattern ||
  categoryParameterSchema?.minLength !== slugPolicy.minLength ||
  categoryParameterSchema?.maxLength !== slugPolicy.maxLength
) {
  failures.push('GET /threads category 查询参数与黄金 slugPolicy 不一致');
}

const frontendFixture = path.resolve('../wenyousite-frontend', fixturePath);
if (fs.existsSync(frontendFixture) && fs.readFileSync(frontendFixture, 'utf8') !== fixtureSource) {
  failures.push('前后端动态分类黄金用例不一致');
}

if (failures.length > 0) {
  throw new Error(`Thread category contract checks failed:\n${failures.join('\n')}`);
}
console.log(
  `Thread category v3 contract is valid (${definitions.length} definitions, ${presentationCases.length} presentation cases)`,
);
