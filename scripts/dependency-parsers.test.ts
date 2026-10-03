import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import fastify from 'fastify';
import fastifyStatic from '@fastify/static';

function resolveDependency(chain: string[]): string {
  let from = join(process.cwd(), 'package.json');
  for (const name of chain) from = createRequire(from).resolve(name);
  return from;
}

it('邮件、glob 与 URI 的实际间接依赖在限时子进程处理恶意解析形状', () => {
  const paths = {
    mail: resolveDependency(['nodemailer/lib/addressparser']),
    braces: [
      resolveDependency(['archiver', 'readdir-glob', 'minimatch', 'brace-expansion']),
      resolveDependency(['@fastify/static', 'glob', 'minimatch', 'brace-expansion']),
    ],
    uris: [
      resolveDependency(['fastify', '@fastify/ajv-compiler', 'fast-uri']),
      resolveDependency(['fastify', 'fast-json-stringify', 'fast-uri']),
    ],
  };
  const script = `
    const assert = require('node:assert/strict');
    const paths = ${JSON.stringify(paths)};
    const parser = require(paths.mail);
    assert.equal(parser('"user"@example.invalid(x)evil.invalid')[0].address, 'user@example.invalid');
    assert.equal(parser('Synthetic <fixture@example.invalid>')[0].address, 'fixture@example.invalid');
    parser('x'.repeat(300000));
    parser('a(comment)'.repeat(10000) + '@example.invalid');
    for (const path of paths.braces) {
      const module = require(path);
      const expand = typeof module === 'function' ? module : module.expand;
      assert.deepEqual(expand('fixture-{a,b}.txt'), ['fixture-a.txt', 'fixture-b.txt']);
      for (const input of ['{'.repeat(5000) + 'a,b' + '}'.repeat(5000), '{a},b}'.repeat(5000)]) {
        assert.ok(Array.isArray(expand(input)));
      }
    }
    for (const path of paths.uris) {
      const uri = require(path);
      assert.equal(uri.parse('//%41.example.invalid').host, 'a.example.invalid');
      assert.equal(uri.equal('//%41.example.invalid', '//a.example.invalid'), true);
    }
    process.stdout.write('passed');
  `;
  // 恶意样本不进入主测试进程；不继承业务凭据或 NODE_OPTIONS，超时强制回收子进程。
  const output = execFileSync(process.execPath, ['--max-old-space-size=128', '-e', script], {
    env: { PATH: process.env.PATH },
    timeout: 5000,
    killSignal: 'SIGKILL',
    maxBuffer: 4096,
    encoding: 'utf8',
  });
  assert.equal(output, 'passed');
});

it('真实静态资源插件正常读取自身目录并拒绝目录穿越', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wenyou-static-security-'));
  const server = fastify();
  try {
    await writeFile(join(directory, 'fixture.txt'), 'synthetic public fixture');
    await server.register(fastifyStatic, { root: directory, prefix: '/fixtures/' });
    const allowed = await server.inject({ url: '/fixtures/fixture.txt' });
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.body, 'synthetic public fixture');
    assert.equal((await server.inject({ url: '/fixtures/%2e%2e/package.json' })).statusCode, 404);
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('Firebase 实际 multipart 依赖在限时子进程处理超长边界与原型名头', () => {
  const busboyPath = resolveDependency(['firebase-admin', '@fastify/busboy']);
  const script = String.raw`
    const assert = require('node:assert/strict');
    const { once } = require('node:events');
    const Busboy = require(${JSON.stringify(busboyPath)});
    async function parse(boundary, extraHeaders = '') {
      const parser = new Busboy({
        headers: { 'content-type': 'multipart/form-data; boundary=' + boundary },
      });
      const fields = [];
      parser.on('field', (name, value) => fields.push([name, value]));
      const finished = once(parser, 'finish');
      const prefix = 'prefix\r\n--a';
      const value = prefix + 'x'.repeat(1024);
      const part = (name) => '--' + boundary + '\r\n'
        + 'Content-Disposition: form-data; name="' + name + '"\r\n'
        + extraHeaders + '\r\n' + value + '\r\n';
      const body = part('first') + part('second') + '--' + boundary + '--\r\n';
      const split = body.indexOf(prefix) + prefix.length;
      parser.write(body.slice(0, split));
      parser.end(body.slice(split));
      await finished;
      assert.deepEqual(fields, [['first', value], ['second', value]]);
    }
    (async () => {
      await parse('normal-fixture');
      // GHSA-xjh9-v7x6-24jw: 252-byte boundary plus CRLF-- wraps an 8-bit skip table.
      await parse('a'.repeat(252));
      // GHSA-x8mw-p69m-v3mx: these names must not resolve to inherited header values.
      await parse('prototype-fixture', '__proto__: fixture\r\nconstructor: fixture\r\n');
      process.stdout.write('passed');
    })().catch(() => { process.exitCode = 1; });
  `;
  const output = execFileSync(process.execPath, ['--max-old-space-size=128', '-e', script], {
    env: { PATH: process.env.PATH },
    timeout: 5000,
    killSignal: 'SIGKILL',
    maxBuffer: 4096,
    encoding: 'utf8',
  });
  assert.equal(output, 'passed');
});
