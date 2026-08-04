/** Markdown 本地链接检查：防止 AGENTS 与 docs 引用不存在的仓库内文件 */

import * as fs from 'fs';
import * as path from 'path';

const roots = ['AGENTS.md', 'README.md', 'docs'];
const markdownFiles: string[] = [];

function collect(target: string) {
  if (!fs.existsSync(target)) return;
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    for (const child of fs.readdirSync(target)) collect(path.join(target, child));
  } else if (target.endsWith('.md')) {
    markdownFiles.push(target);
  }
}

for (const root of roots) collect(root);

const failures: string[] = [];
const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;

for (const file of markdownFiles) {
  const content = fs.readFileSync(file, 'utf-8');
  for (const match of content.matchAll(linkPattern)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, '');
    if (/^(?:https?:|mailto:|#)/.test(rawTarget)) continue;
    if (/[{}]/.test(rawTarget) || (!rawTarget.includes('/') && !rawTarget.includes('.'))) continue;
    const cleanTarget = decodeURIComponent(rawTarget.split('#')[0].split('?')[0]);
    if (!cleanTarget) continue;
    const resolved = path.resolve(path.dirname(file), cleanTarget);
    if (!fs.existsSync(resolved)) failures.push(`${file}: ${rawTarget}`);
  }
}

if (failures.length > 0) {
  throw new Error(`发现失效 Markdown 链接：\n${failures.join('\n')}`);
}

console.log(`Markdown links are valid (${markdownFiles.length} files)`);
