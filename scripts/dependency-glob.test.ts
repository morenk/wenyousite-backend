import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import archiver from 'archiver';

function dependency(chain: string[]) {
  let entry = join(process.cwd(), 'package.json');
  for (const name of chain) entry = createRequire(entry).resolve(name);
  return { entry, module: createRequire(entry)(entry) };
}

it('静态资源插件通过真实 glob 预枚举嵌套文件、忽略模式和 dotfile', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wenyou-static-glob-'));
  const server = fastify();
  try {
    await mkdir(join(directory, 'nested'));
    for (const file of ['root.txt', 'nested/中文 文件.txt', '.private.txt', 'skip.txt']) {
      await writeFile(join(directory, file), file);
    }
    await server.register(fastifyStatic, { root: directory, prefix: '/fixtures/', wildcard: false, globIgnore: ['**/skip.txt'] });
    for (const file of ['root.txt', 'nested/中文 文件.txt']) {
      const response = await server.inject({ url: `/fixtures/${encodeURI(file)}` });
      assert.equal(response.statusCode, 200);
      assert.equal(response.body, file);
    }
    for (const file of ['.private.txt', 'skip.txt', '../package.json']) {
      assert.equal((await server.inject({ url: `/fixtures/${file}` })).statusCode, 404);
    }
  } finally { await server.close(); await rm(directory, { recursive: true, force: true }); }
});

it('归档 glob 与 archiver-utils 同步筛选保留否定、花括号、dotfile 和 ZIP 内容', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wenyou-archive-glob-'));
  try {
    await mkdir(join(directory, 'nested'));
    for (const file of ['a.txt', 'b.md', 'skip.txt', '.hidden.txt', 'nested/中文 文件.txt']) {
      await writeFile(join(directory, file), `content:${file}`);
    }
    const utils = dependency(['archiver', 'archiver-utils']).module;
    assert.deepEqual(utils.file.expand({ cwd: directory, nodir: true }, ['**/*.{txt,md}', '!**/skip.txt']).sort(), ['a.txt', 'b.md', 'nested/中文 文件.txt']);
    assert.deepEqual(utils.file.expand({ cwd: directory, nodir: true, dot: true }, ['.*.txt']), ['.hidden.txt']);
    const archive = archiver('zip', { zlib: { level: 1 } });
    const chunks: Buffer[] = [];
    const output = new Promise<Buffer>((resolve, reject) => {
      archive.on('data', (chunk: Buffer) => chunks.push(chunk));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject); archive.on('warning', reject);
    });
    archive.glob('**/*.{txt,md}', { cwd: directory, ignore: ['**/skip.txt'], dot: false });
    await archive.finalize();
    const zip = await output;
    const contents = execFileSync('python3', ['-c', 'import io,json,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); print(json.dumps({n:z.read(n).decode() for n in z.namelist()}))'],
      { input: zip, encoding: 'utf8', timeout: 5000, env: { PATH: process.env.PATH }, maxBuffer: 4096 });
    assert.deepEqual(JSON.parse(contents), { 'a.txt': 'content:a.txt', 'b.md': 'content:b.md', 'nested/中文 文件.txt': 'content:nested/中文 文件.txt' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('实际 rimraf glob 仅清理隔离匹配路径，不跟随外部目录链接', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wenyou-rimraf-glob-'));
  try {
    await mkdir(join(directory, 'retained'));
    await writeFile(join(directory, 'retained/value'), 'retained');
    await mkdir(join(directory, 'remove-dir'));
    await symlink(join(directory, 'retained'), join(directory, 'remove-dir/link'));
    await writeFile(join(directory, 'remove-file'), 'synthetic');
    const { rimraf, rimrafSync } = dependency(['firebase-admin', '@google-cloud/firestore', 'google-gax', 'rimraf']).module;
    assert.equal(await rimraf(join(directory, 'remove-*'), { glob: true }), true);
    assert.equal(fs.existsSync(join(directory, 'remove-dir')), false);
    assert.equal(fs.existsSync(join(directory, 'remove-file')), false);
    assert.equal(await readFile(join(directory, 'retained/value'), 'utf8'), 'retained');
    await writeFile(join(directory, 'sync-fixture'), 'synthetic');
    assert.equal(rimrafSync(join(directory, 'sync-*'), { glob: true }), true);
    assert.equal(fs.existsSync(join(directory, 'sync-fixture')), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('受影响 glob 在取消后不再递归发起目录读取', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wenyou-glob-abort-'));
  try {
    await mkdir(join(directory, 'a/b/c'), { recursive: true });
    await writeFile(join(directory, 'a/b/c/value.txt'), 'synthetic');
    for (const chain of [['@fastify/static', 'glob'], ['archiver', 'archiver-utils', 'glob']]) {
      const { glob } = dependency(chain).module;
      const controller = new AbortController();
      let readsAfterAbort = 0;
      let pending = 0;
      const fixtureFs = { ...fs, readdir: (...args: unknown[]) => {
        if (controller.signal.aborted) readsAfterAbort++;
        pending++;
        const callback = args.pop() as (...values: unknown[]) => void;
        (fs.readdir as (...values: unknown[]) => void)(...args, (...values: unknown[]) => {
          controller.abort(new Error('fixture-stop'));
          callback(...values); pending--;
        });
      } };
      await assert.rejects(glob('**/*', { cwd: directory, fs: fixtureFs, signal: controller.signal }), /fixture-stop/);
      for (let attempt = 0; pending && attempt < 100; attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(pending, 0);
      assert.equal(readsAfterAbort, 0);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('受影响 minimatch 对 globparts 放大输入有界处理并保留正常匹配', () => {
  const paths = [['archiver', 'readdir-glob', 'minimatch'], ['@fastify/static', 'glob', 'minimatch']].map((chain) => dependency(chain).entry);
  const output = execFileSync(process.execPath, ['--max-old-space-size=128', '-e', `
const assert=require('node:assert/strict');
for(const path of ${JSON.stringify(paths)}) {
 const {Minimatch}=require(path);
 assert(new Minimatch('**/*.{txt,md}').match('nested/a.txt'));
 assert(!new Minimatch('**/*.txt').match('.private.txt'));
 try { const matcher=new Minimatch(('**/../').repeat(48)+'fixture.txt',{optimizationLevel:2}); assert.equal(typeof matcher.match('fixture.txt'),'boolean'); }
 catch(error) { assert(error instanceof RangeError); }
}
process.stdout.write('passed');`], { env: { PATH: process.env.PATH }, timeout: 5000, killSignal: 'SIGKILL', encoding: 'utf8', maxBuffer: 4096 });
  assert.equal(output, 'passed');
});
