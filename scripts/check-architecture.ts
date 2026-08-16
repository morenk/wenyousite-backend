/** 模块化单体架构棘轮：阻止控制器越层、配置散落和关键事件绕过 Outbox。 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';

const sourceRoot = path.resolve('src');
const failures: string[] = [];
const providerOwners = new Map<string, string[]>();
const authDecorators = new Set([
  'Public',
  'OptionalAuth',
  'AuthRead',
  'Auth',
  'AdminAuth',
  'SuperAdminAuth',
  'AdminStepUpAuth',
  'SuperAdminStepUpAuth',
  'AdminBearerAuth',
  'AppealAuth',
]);
const writeMethods = new Set(['Post', 'Put', 'Patch', 'Delete']);

function collect(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? collect(target) : entry.name.endsWith('.ts') ? [target] : [];
  });
}

function relative(file: string): string {
  return path.relative(process.cwd(), file);
}

function decorators(node: ts.Node): readonly ts.Decorator[] {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
}

function decoratorName(decorator: ts.Decorator): string | undefined {
  const expression = decorator.expression;
  const target = ts.isCallExpression(expression) ? expression.expression : expression;
  return ts.isIdentifier(target) ? target.text : undefined;
}

function authDecorator(node: ts.Node): string | undefined {
  return decorators(node)
    .map(decoratorName)
    .find((name): name is string => Boolean(name && authDecorators.has(name)));
}

function checkControllerAuth(source: ts.SourceFile, name: string) {
  for (const statement of source.statements) {
    if (!ts.isClassDeclaration(statement)) continue;
    if (!decorators(statement).some((item) => decoratorName(item) === 'Controller')) continue;
    const classAuth = authDecorator(statement);

    for (const member of statement.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      const httpMethod = decorators(member)
        .map(decoratorName)
        .find((item): item is string => Boolean(item && ['Get', ...writeMethods].includes(item)));
      if (!httpMethod) continue;
      const resolvedAuth = authDecorator(member) ?? classAuth;
      const methodName = member.name.getText(source);
      if (!resolvedAuth) {
        failures.push(`${name}:${source.getLineAndCharacterOfPosition(member.getStart()).line + 1}: ${methodName} 缺少显式认证装饰器`);
      } else if (writeMethods.has(httpMethod) && resolvedAuth === 'AuthRead') {
        failures.push(`${name}:${source.getLineAndCharacterOfPosition(member.getStart()).line + 1}: ${httpMethod} ${methodName} 不得使用 AuthRead`);
      }
    }
  }
}

function collectModuleProviders(source: ts.SourceFile, name: string) {
  for (const statement of source.statements) {
    if (!ts.isClassDeclaration(statement)) continue;
    const moduleDecorator = decorators(statement).find(
      (item) => decoratorName(item) === 'Module' && ts.isCallExpression(item.expression),
    );
    if (!moduleDecorator || !ts.isCallExpression(moduleDecorator.expression)) continue;
    const metadata = moduleDecorator.expression.arguments[0];
    if (!metadata || !ts.isObjectLiteralExpression(metadata)) continue;
    const providers = metadata.properties.find(
      (property): property is ts.PropertyAssignment =>
        ts.isPropertyAssignment(property) && property.name.getText(source) === 'providers',
    );
    if (!providers || !ts.isArrayLiteralExpression(providers.initializer)) continue;
    for (const provider of providers.initializer.elements) {
      if (!ts.isIdentifier(provider)) continue;
      const owners = providerOwners.get(provider.text) ?? [];
      owners.push(name);
      providerOwners.set(provider.text, owners);
    }
  }
}

for (const file of collect(sourceRoot)) {
  const content = fs.readFileSync(file, 'utf8');
  const name = relative(file);
  const source = ts.createSourceFile(name, content, ts.ScriptTarget.Latest, true);

  if (file.endsWith('.controller.ts')) checkControllerAuth(source, name);
  if (file.endsWith('.module.ts')) collectModuleProviders(source, name);

  if (
    file.endsWith('.controller.ts') &&
    !file.endsWith(path.join('health', 'health.controller.ts')) &&
    /\bPrismaService\b|\bthis\.prisma\b/.test(content)
  ) {
    failures.push(`${name}: 业务控制器不得直接访问 Prisma，请下沉到应用服务`);
  }

  if (name !== 'src/config/configuration.ts' && /\bprocess\.env\b/.test(content)) {
    failures.push(`${name}: 环境变量只能由 config/configuration.ts 读取`);
  }

  if (
    /common\/(?:services\/(?:thread-access|block-filter)|guards\/block\.guard)|jobs\/(?:notification|post-events|image\.processor)/.test(
      content,
    )
  ) {
    failures.push(`${name}: 引用了已废弃的跨层路径`);
  }

  if (
    /\.emit\(['"](?:post\.created|post\.mentions\.updated|thread\.published|thread\.liked|thread\.unliked|user\.followed)['"]/.test(
      content,
    )
  ) {
    failures.push(`${name}: 可靠领域事件必须在业务事务中写入 Outbox`);
  }

  if (file.endsWith('.service.ts') && !file.endsWith('.spec.ts')) {
    const lineCount = content.split(/\r?\n/).length;
    if (lineCount > 650) {
      failures.push(`${name}: ${lineCount} 行，超过服务层 650 行上限，请按命令/查询/策略拆分`);
    }
  }

  if (
    name.startsWith('src/common/') &&
    !name.endsWith('.spec.ts') &&
    /from\s+['"][^'"]*(?:admin|auth)\//.test(content)
  ) {
    failures.push(`${name}: common 不得反向依赖 admin/auth 领域模块`);
  }

  if (name !== 'src/app.module.ts' && /from\s+['"][^'"]*admin\/admin\.module['"]/.test(content)) {
    failures.push(`${name}: 特性模块不得整体导入 AdminModule`);
  }
}

for (const [provider, owners] of providerOwners) {
  if (owners.length > 1) {
    failures.push(`${provider}: Provider 在多个模块重复注册：${owners.join(', ')}`);
  }
}

if (failures.length > 0) {
  throw new Error(`架构检查失败：\n${failures.join('\n')}`);
}

console.log('Architecture boundaries are valid');
