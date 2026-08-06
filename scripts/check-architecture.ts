/** 模块化单体架构棘轮：阻止控制器越层、配置散落和关键事件绕过 Outbox。 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const sourceRoot = path.resolve('src');
const failures: string[] = [];

function collect(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? collect(target) : entry.name.endsWith('.ts') ? [target] : [];
  });
}

function relative(file: string): string {
  return path.relative(process.cwd(), file);
}

for (const file of collect(sourceRoot)) {
  const content = fs.readFileSync(file, 'utf8');
  const name = relative(file);

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
    /\.emit\(['"](?:post\.created|thread\.published|thread\.liked|thread\.unliked|user\.followed)['"]/.test(
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
}

if (failures.length > 0) {
  throw new Error(`架构检查失败：\n${failures.join('\n')}`);
}

console.log('Architecture boundaries are valid');
