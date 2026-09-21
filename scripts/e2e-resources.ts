/** 每次运行启动独立数据进程；从不连接、建库于或清空既有服务。 */
import { spawn, ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { ensure } from './webe2e-cleanup';
import { registry } from './e2e-registry';
import { processStart, stopOwnedGroup } from './e2e-processes';
import { cleanupDiagnostic } from './e2e-cleanup-diagnostics';
const childOwners = new WeakMap<ChildProcess, { runId: string; root: string; started?: string }>();

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
  if (!child.pid) return;
  const owner = childOwners.get(child);
  ensure(owner, '拒绝停止未登记进程');
  const closed = child.exitCode !== null || child.signalCode !== null ? Promise.resolve()
    : new Promise<void>((ok) => child.once('close', () => ok()));
  try { await stopOwnedGroup(child.pid, owner.runId, owner.root, owner.started); } catch (error) {
    console.error(JSON.stringify(cleanupDiagnostic(owner.runId, 'process-group', error, child.pid)));
    throw error;
  }
  // /proc 可先观察到 zombie；等待 Node 的 close 事件，确保退出码与末尾日志已收齐。
  await closed;
}

export interface Resources {
  runId: string; root: string; databaseUrl: string; redisPort: number; redisPassword: string;
  env: NodeJS.ProcessEnv; spawn: (command: string, args: string[], env: NodeJS.ProcessEnv, cwd?: string) => ChildProcess;
  verify: () => Promise<void>; logPath: (child: ChildProcess) => string;
}
export async function withResources<T>(use: (resources: Resources) => Promise<T>): Promise<T> {
  ensure(process.getuid?.() !== 0, '隔离 runner 必须由开发身份运行，禁止 root 数据进程');
  const pgBin = process.env.E2E_PG_BIN;
  const redisBin = process.env.E2E_REDIS_BIN;
  ensure(pgBin && redisBin, '需配置 E2E_PG_BIN 与 E2E_REDIS_BIN（仅只读二进制路径）；不接受 DATABASE_URL/REDIS_HOST 作为基础资源');
  const env = { ...cleanEnvironment(), ...(process.env.E2E_LIBRARY_PATH ? { LD_LIBRARY_PATH: process.env.E2E_LIBRARY_PATH } : {}) };
  const registration = await registry();
  const runId = `e2e_${randomBytes(12).toString('hex')}`;
  const root = mkdtempSync(join(tmpdir(), 'wenyousite-e2e-'));
  chmodSync(root, 0o700);
  const marker = join(root, 'ownership.json');
  const ownership = { version: 1, runId, uid: process.getuid?.(), root: realpathSync(root) };
  writeFileSync(marker, JSON.stringify(ownership), { mode: 0o600, flag: 'wx' });
  const children: ChildProcess[] = [];
  const logPaths = new WeakMap<ChildProcess, string>();
  let closing = false;
  let interrupted = false;
  const processRegistry: Array<{ group: number; started: string | undefined }> = [];
  writeFileSync(join(root, 'processes.json'), JSON.stringify({ runId, root, supervisorPid: process.pid, supervisorStart: processStart(process.pid), processes: processRegistry }), { mode: 0o600 });
  const unregister = registration.add(root, runId);
  let prisma: PrismaClient | undefined;
  let redis: Redis | undefined;
  const launch = (command: string, args: string[], childEnv: NodeJS.ProcessEnv, cwd = root) => {
    ensure(!closing && !interrupted, '隔离任务已经结束，拒绝启动进程');
    const child = spawn(command, args, { cwd, env: { ...childEnv, E2E_RUN_ID: runId, E2E_RESOURCE_ROOT: root }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    childOwners.set(child, { runId, root, started: child.pid ? processStart(child.pid) : undefined });
    if (child.pid) processRegistry.push({ group: child.pid, started: processStart(child.pid) });
    writeFileSync(join(root, 'processes.json'), JSON.stringify({ runId, root, supervisorPid: process.pid, supervisorStart: processStart(process.pid), processes: processRegistry }), { mode: 0o600 });
    child.on('error', () => undefined);
    // 进程日志可能包含凭据或测试正文；只保留私有文件，控制台仅输出安全状态。
    const log = join(root, `process-${children.length}.log`);
    logPaths.set(child, log);
    writeFileSync(log, '', { mode: 0o600 });
    const { appendFileSync } = require('node:fs') as typeof import('node:fs');
    child.stdout?.on('data', (data: Buffer) => appendFileSync(log, data));
    child.stderr?.on('data', (data: Buffer) => appendFileSync(log, data));
    return child;
  };
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
    const init = launch(join(pgBin, 'initdb'), ['-D', join(root, 'postgres'), '-U', 'e2e_owner', '--pwfile', pwfile, '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C'], env);
    const initialized = await new Promise<number | null>((ok, fail) => { init.once('exit', ok); init.once('error', fail); });
    ensure(initialized === 0, '隔离 PostgreSQL 初始化失败');
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
      ensure(!closing && !interrupted, '隔离任务已终止');
      ensure(JSON.stringify(JSON.parse(readFileSync(marker, 'utf8'))) === JSON.stringify(ownership), '资源登记发生漂移');
      ensure(realpathSync(root) === ownership.root && !lstatSync(root).isSymbolicLink(), '隔离目录身份漂移');
      const rows = await prisma!.$queryRaw<Array<{ cluster_name: string }>>`SHOW cluster_name`;
      ensure(rows[0]?.cluster_name === runId, 'PostgreSQL 进程身份不匹配');
      ensure((await redis!.info('server')).includes(`run_id:${redisInstance}\r\n`) && await redis!.get('e2e:ownership') === runId, 'Redis 进程身份不匹配');
    };
    await verify();
    writeFileSync(join(root, 'resources.json'), JSON.stringify({ ...ownership, postgresPid: postgres.pid, redisPid: redisChild.pid, pgPort, redisPort, redisInstance }), { flag: 'wx', mode: 0o600 });
    return await Promise.race([use({ runId, root, databaseUrl, redisPort, redisPassword, env, spawn: launch, verify, logPath: (child) => logPaths.get(child)! }), signalPromise]);
  } finally {
    closing = true;
    process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);
    // 仅终止本进程实际创建的进程组；从不按读取到的任意 PID 清理外部资源。
    redis?.disconnect();
    await prisma?.$disconnect();
    const cleanupErrors: unknown[] = [];
    for (const child of children.reverse()) {
      try { await stopChild(child); } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length) for (const child of children) {
      child.stdout?.destroy(); child.stderr?.destroy(); child.unref();
    }
    ensure(cleanupErrors.length === 0, '部分进程身份无法核验，已关闭其余自有进程；保留目录供残留清理');
    try {
      const valid = existsSync(marker) && JSON.stringify(JSON.parse(readFileSync(marker, 'utf8'))) === JSON.stringify(ownership)
        && realpathSync(root) === ownership.root && !lstatSync(root).isSymbolicLink();
      ensure(valid, '资源身份验证失败，保留目录供治理核对；未删除未知资源');
    } catch (error) {
      console.error(JSON.stringify(cleanupDiagnostic(runId, 'root-identity', error)));
      throw error;
    }
    try { rmSync(root, { recursive: true }); } catch (error) {
      console.error(JSON.stringify(cleanupDiagnostic(runId, 'root-removal', error)));
      throw error;
    }
    unregister();
  }
}
