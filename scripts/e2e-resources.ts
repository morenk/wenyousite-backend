/** 每次运行启动独立数据进程；从不连接、建库于或清空既有服务。 */
import { spawn, ChildProcess, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { ensure } from './webe2e-cleanup';

export function cleanEnvironment(): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, LANG: 'C.UTF-8', TZ: 'UTC' };
}
export async function unusedPort() {
  const server = createServer();
  await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((ok, fail) => server.close((error) => error ? fail(error) : ok()));
  return port;
}
export async function stopChild(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((ok) => child.once('exit', () => ok()));
  process.kill(-child.pid!, 'SIGTERM');
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) process.kill(-child.pid!, 'SIGKILL');
  }, 10_000);
  try { await exited; } finally { clearTimeout(timer); }
}
export interface Resources {
  runId: string; root: string; databaseUrl: string; redisPort: number; redisPassword: string;
  env: NodeJS.ProcessEnv; spawn: (command: string, args: string[], env: NodeJS.ProcessEnv, cwd?: string) => ChildProcess;
  verify: () => Promise<void>;
}
export async function withResources<T>(use: (resources: Resources) => Promise<T>): Promise<T> {
  ensure(process.getuid?.() !== 0, '隔离 runner 必须由开发身份运行，禁止 root 数据进程');
  const pgBin = process.env.E2E_PG_BIN;
  const redisBin = process.env.E2E_REDIS_BIN;
  ensure(pgBin && redisBin, '需配置 E2E_PG_BIN 与 E2E_REDIS_BIN（仅只读二进制路径）；不接受 DATABASE_URL/REDIS_HOST 作为基础资源');
  const env = { ...cleanEnvironment(), ...(process.env.E2E_LIBRARY_PATH ? { LD_LIBRARY_PATH: process.env.E2E_LIBRARY_PATH } : {}) };
  const runId = `e2e_${randomBytes(12).toString('hex')}`;
  const root = mkdtempSync(join(tmpdir(), 'wenyousite-e2e-'));
  chmodSync(root, 0o700);
  const marker = join(root, 'ownership.json');
  const ownership = { version: 1, runId, uid: process.getuid?.(), root: realpathSync(root) };
  writeFileSync(marker, JSON.stringify(ownership), { mode: 0o600, flag: 'wx' });
  const children: ChildProcess[] = [];
  let prisma: PrismaClient | undefined;
  let redis: Redis | undefined;
  const launch = (command: string, args: string[], childEnv: NodeJS.ProcessEnv, cwd = root) => {
    const child = spawn(command, args, { cwd, env: childEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    child.on('error', () => undefined);
    // 进程日志可能包含凭据或测试正文；只保留私有文件，控制台仅输出安全状态。
    const log = join(root, `process-${children.length}.log`);
    writeFileSync(log, '', { mode: 0o600 });
    const { appendFileSync } = require('node:fs') as typeof import('node:fs');
    child.stdout?.on('data', (data: Buffer) => appendFileSync(log, data));
    child.stderr?.on('data', (data: Buffer) => appendFileSync(log, data));
    return child;
  };
  let interrupted = false;
  let rejectSignal: (error: Error) => void = () => undefined;
  const signalPromise = new Promise<never>((_, reject) => { rejectSignal = reject; });
  // 初始化期间亦接收信号；在进入 race 前为拒绝安装处理器。
  void signalPromise.catch(() => undefined);
  const onSignal = () => { interrupted = true; rejectSignal(new Error('隔离运行收到终止信号')); };
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
  try {
    const pgPort = await unusedPort();
    let redisPort = await unusedPort();
    while (redisPort === pgPort) redisPort = await unusedPort();
    const password = randomBytes(32).toString('hex');
    const redisPassword = randomBytes(32).toString('hex');
    const pwfile = join(root, 'postgres.password');
    writeFileSync(pwfile, password, { mode: 0o600 });
    execFileSync(join(pgBin, 'initdb'), ['-D', join(root, 'postgres'), '-U', 'e2e_owner', '--pwfile', pwfile, '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C'], { env, cwd: root, stdio: 'pipe' });
    mkdirSync(join(root, 'socket')); mkdirSync(join(root, 'uploads'));
    const postgres = launch(join(pgBin, 'postgres'), ['-D', join(root, 'postgres'), '-h', '127.0.0.1', '-p', String(pgPort), '-k', join(root, 'socket'), '-c', `cluster_name=${runId}`, '-c', 'max_connections=50'], env);
    const redisConfig = join(root, 'redis.conf');
    writeFileSync(redisConfig, `bind 127.0.0.1\nport ${redisPort}\nrequirepass ${redisPassword}\ndir ${root}\nsave ""\nappendonly no\n`, { mode: 0o600 });
    const redisChild = launch(redisBin, [redisConfig], env);
    const databaseUrl = `postgresql://e2e_owner:${password}@127.0.0.1:${pgPort}/postgres?schema=public`;
    prisma = new PrismaClient({ datasourceUrl: databaseUrl, log: [] });
    redis = new Redis({ host: '127.0.0.1', port: redisPort, password: redisPassword, lazyConnect: true, retryStrategy: () => null, maxRetriesPerRequest: 1 });
    redis.on('error', () => undefined);
    for (let attempt = 0; ; attempt++) {
      ensure(!interrupted && postgres.exitCode === null && redisChild.exitCode === null, '隔离数据进程未启动');
      try {
        await prisma.$queryRaw`SELECT 1`;
        if (redis.status !== 'ready') await redis.connect();
        await redis.ping(); break;
      } catch {
        ensure(attempt < 59, '隔离数据进程启动超时');
        await new Promise((ok) => setTimeout(ok, 250));
      }
    }
    const serverInfo = await redis.info('server');
    const redisInstance = serverInfo.match(/^run_id:(\w+)/m)?.[1];
    ensure(redisInstance, '缺少 Redis 进程身份');
    await redis.set('e2e:ownership', runId, 'NX');
    const verify = async () => {
      ensure(JSON.stringify(JSON.parse(readFileSync(marker, 'utf8'))) === JSON.stringify(ownership), '资源登记发生漂移');
      ensure(realpathSync(root) === ownership.root && !lstatSync(root).isSymbolicLink(), '隔离目录身份漂移');
      const rows = await prisma!.$queryRaw<Array<{ cluster_name: string }>>`SHOW cluster_name`;
      ensure(rows[0]?.cluster_name === runId, 'PostgreSQL 进程身份不匹配');
      ensure((await redis!.info('server')).includes(`run_id:${redisInstance}\r\n`) && await redis!.get('e2e:ownership') === runId, 'Redis 进程身份不匹配');
    };
    await verify();
    writeFileSync(join(root, 'resources.json'), JSON.stringify({ ...ownership, postgresPid: postgres.pid, redisPid: redisChild.pid, pgPort, redisPort, redisInstance }), { flag: 'wx', mode: 0o600 });
    return await Promise.race([use({ runId, root, databaseUrl, redisPort, redisPassword, env, spawn: launch, verify }), signalPromise]);
  } finally {
    process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);
    // 仅终止本进程实际创建的进程组；从不按读取到的任意 PID 清理外部资源。
    redis?.disconnect();
    await prisma?.$disconnect();
    for (const child of children.reverse()) await stopChild(child);
    const valid = existsSync(marker) && JSON.stringify(JSON.parse(readFileSync(marker, 'utf8'))) === JSON.stringify(ownership)
      && realpathSync(root) === ownership.root && !lstatSync(root).isSymbolicLink();
    ensure(valid, '资源身份验证失败，保留目录供治理核对；未删除未知资源');
    rmSync(root, { recursive: true });
  }
}
