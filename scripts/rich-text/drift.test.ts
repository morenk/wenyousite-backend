import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = process.cwd();
const tsx = resolve('node_modules/tsx/dist/cli.mjs');
const source = readFileSync('scripts/check-doc-truth.ts', 'utf8');
const newline = 'markdown-editor-newline-v1-fixtures.json';
const before = source.replace(`  '${newline}',\n`, '');
function run(script: string, cwd: string) {
  const result = spawnSync(process.execPath, [tsx, script], { cwd, encoding: 'utf8' });
  return { status: result.status, output: result.stdout + result.stderr };
}
test('隔离真实文件：旧 newline 清单漏检，候选定位漂移；缺失副本规则与原清单均保留', () => {
  assert.notEqual(before, source, 'candidate must explicitly list newline');
  const temp = mkdtempSync(join(tmpdir(), 'wenyou-newline-drift-'));
  try {
    const backend = join(temp, 'wenyousite-backend');
    mkdirSync(backend);
    for (const path of ['AGENTS.md', 'docs', 'contracts', 'src/common/swagger']) {
      cpSync(resolve(repo, path), join(backend, path), { recursive: true });
    }
    const oldPath = join(temp, 'before.ts'); const candidatePath = join(temp, 'candidate.ts');
    writeFileSync(oldPath, before); writeFileSync(candidatePath, source);
    // 参考仓库/文件不存在时继续沿用原来的存在性判断，不偷偷扩大或放宽规则。
    assert.equal(run(candidatePath, backend).status, 0);
    for (const client of ['wenyousite-frontend', 'wenyousite-mobile']) {
      const clientDir = join(temp, client, 'contracts'); mkdirSync(clientDir, { recursive: true });
      assert.equal(run(candidatePath, backend).status, 0);
      const path = join(clientDir, newline);
      const original = readFileSync(join(backend, 'contracts', newline), 'utf8');
      writeFileSync(path, original);
      assert.equal(run(candidatePath, backend).status, 0);
      writeFileSync(path, original + ' ');
      assert.equal(run(oldPath, backend).status, 0, 'old gate must miss newline-only byte drift');
      const drifted = run(candidatePath, backend);
      assert.notEqual(drifted.status, 0);
      assert.ok(drifted.output.includes(`${client} 的 ${newline} 与后端不一致`));
      writeFileSync(path, original);
      for (const filename of ['markdown-v4-fixtures.json', 'markdown-v4-nodes-fixtures.json', 'markdown-editor-roundtrip-v7-fixtures.json']) {
        writeFileSync(join(clientDir, filename), 'synthetic-byte-drift');
        assert.notEqual(run(candidatePath, backend).status, 0, filename);
        rmSync(join(clientDir, filename));
      }
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
