import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

const check = process.argv.includes('--check');
const target = path.resolve('docs/api-endpoints.md');
const temp = path.join(os.tmpdir(), `wenyousite-endpoints-${process.pid}.json`);
const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;

try {
  execFileSync('pnpm', ['openapi:export', temp], { stdio: 'pipe' });
  const spec = JSON.parse(fs.readFileSync(temp, 'utf8')) as { paths: Record<string, any> };
  const groups = new Map<string, string[]>();
  for (const [apiPath, item] of Object.entries(spec.paths)) {
    for (const method of methods) {
      const operation = item[method];
      if (!operation) continue;
      const tag = operation.tags?.[0] ?? 'Other';
      const auth = operation['x-auth-mode'] ?? 'public';
      const displayPath = apiPath.replace(/^\/api\/v1/, '') || '/';
      const row = `| ${method.toUpperCase()} | \`${displayPath}\` | ${auth} | ${String(operation.summary ?? '').replace(/\|/g, '\\|')} |`;
      groups.set(tag, [...(groups.get(tag) ?? []), row]);
    }
  }
  const lines = [
    '# API 端点表',
    '',
    '> 本文件由 `pnpm docs:generate` 从 OpenAPI 生成，请勿手工编辑。路径均位于 `/api/v1` 下。',
    '',
  ];
  for (const [tag, rows] of groups) {
    lines.push(`## ${tag}`, '', '| 方法 | 路径 | 鉴权 | 说明 |', '|---|---|---|---|', ...rows, '');
  }
  const generated = `${lines.join('\n').trimEnd()}\n`;
  if (check) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== generated) {
      throw new Error('docs/api-endpoints.md 与当前 OpenAPI 不一致；请运行 pnpm docs:generate');
    }
  } else {
    fs.writeFileSync(target, generated);
  }
  console.log(`API endpoint documentation ${check ? 'is current' : 'generated'}`);
} finally {
  fs.rmSync(temp, { force: true });
}
