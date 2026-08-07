import * as fs from 'node:fs';

const check = process.argv.includes('--check');
const source = fs.readFileSync('src/common/exceptions/error-codes.ts', 'utf8');
const target = 'docs/error-codes.md';
const pattern = /\/\*\*\s*([^*]+?)\s*\*\/\s*([A-Z][A-Z0-9_]+):\s*(\d+)/g;
const rows = [...source.matchAll(pattern)].map((match) => ({
  description: match[1].replace(/\s+/g, ' ').trim(),
  name: match[2],
  code: Number(match[3]),
}));
if (rows.length === 0) throw new Error('未能从 ErrorCode 提取错误码');
const generated = [
  '# 业务错误码',
  '',
  '> 本文件由 `pnpm docs:generate` 从 `ErrorCode` 生成，请勿手工维护数值。Flutter 必须按名称分支并保留 unknown fallback。',
  '',
  '| 名称 | code | 含义 |',
  '|---|---:|---|',
  ...rows.map((row) => `| \`${row.name}\` | ${row.code} | ${row.description} |`),
  '',
].join('\n');
if (check) {
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== generated) {
    throw new Error('docs/error-codes.md 与 ErrorCode 不一致；请运行 pnpm docs:generate');
  }
} else {
  fs.writeFileSync(target, generated);
}
console.log(`Error-code documentation ${check ? 'is current' : 'generated'}`);
