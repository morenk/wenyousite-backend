/** OpenAPI 契约棘轮：校验成功响应 envelope、引用完整性及匿名响应 DTO 债务不回升。 */
import * as fs from 'node:fs';

const inputPath = process.argv[2] ?? '/tmp/wenyousite-openapi-check.json';
const document = JSON.parse(fs.readFileSync(inputPath, 'utf8')) as Record<string, any>;
const failures: string[] = [];
const operationIds = new Set<string>();
const methods = new Set(['get', 'put', 'post', 'delete', 'patch', 'options', 'head']);
let anonymousSuccessSchemas = 0;

function resolveReference(reference: string): unknown {
  if (!reference.startsWith('#/')) return undefined;
  return reference
    .slice(2)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce<unknown>((current, part) =>
      current && typeof current === 'object' ? (current as Record<string, unknown>)[part] : undefined,
    document);
}

function visit(value: unknown, location: string): void {
  if (!value || typeof value !== 'object') return;
  if ('$ref' in value) {
    const reference = (value as { $ref?: unknown }).$ref;
    if (typeof reference === 'string' && reference.startsWith('#/') && !resolveReference(reference)) {
      failures.push(`${location}: 无法解析引用 ${reference}`);
    }
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, `${location}[${index}]`));
    return;
  }
  Object.entries(value).forEach(([key, child]) => visit(child, `${location}.${key}`));
}

for (const [route, pathItem] of Object.entries(document.paths ?? {})) {
  for (const [method, operation] of Object.entries(pathItem as Record<string, any>)) {
    if (!methods.has(method) || !operation) continue;
    const label = `${method.toUpperCase()} ${route}`;
    const operationId = operation.operationId;
    if (!operationId) failures.push(`${label}: 缺少 operationId`);
    else if (operationIds.has(operationId)) failures.push(`${label}: operationId 重复 (${operationId})`);
    else operationIds.add(operationId);

    for (const [status, response] of Object.entries(operation.responses ?? {}) as [string, any][]) {
      if (!/^2\d\d$/.test(status) || status === '204' || status === '205') continue;
      const schema = response?.content?.['application/json']?.schema;
      const allOf = schema?.allOf;
      const wrapped =
        Array.isArray(allOf) &&
        allOf.some((part: any) => part?.$ref === '#/components/schemas/ApiSuccessEnvelope');
      const dataSchema = allOf?.find((part: any) => part?.properties?.data)?.properties?.data;
      if (!wrapped || dataSchema === undefined) {
        failures.push(`${label} ${status}: 成功 JSON 响应未声明统一 envelope/data`);
      } else if (
        dataSchema &&
        typeof dataSchema === 'object' &&
        !Array.isArray(dataSchema) &&
        Object.keys(dataSchema).length === 0
      ) {
        anonymousSuccessSchemas += 1;
      }
    }
  }
}

visit(document, 'openapi');

// 历史匿名成功响应基线。新增/修改端点必须声明 DTO，存量清理后同步下调。
const anonymousSchemaBudget = 19;
if (anonymousSuccessSchemas > anonymousSchemaBudget) {
  failures.push(
    `匿名成功响应为 ${anonymousSuccessSchemas}，超过基线 ${anonymousSchemaBudget}；请为端点补充 Swagger DTO`,
  );
}

if (failures.length > 0) {
  throw new Error(`OpenAPI 契约检查失败：\n${failures.join('\n')}`);
}

console.log(
  `OpenAPI contract is valid (${operationIds.size} operations, ${anonymousSuccessSchemas}/${anonymousSchemaBudget} anonymous schemas)`,
);
