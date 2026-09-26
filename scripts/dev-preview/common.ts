import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { cleanEnvironment } from '../e2e-resources';

export const REPO = realpathSync(resolve(__dirname, '../..'));
export const HEADER = 'X-Wenyou-Preview-Run';
export const KIND = 'wenyou-dev-preview';
export interface Snapshot {
  version: 1; capturedAt: string; businessDate: string; sha256: string; sourceSha: string;
  migrationVersion: string; mediaSha256: string; mediaOrigin: string;
}
export interface Consumer {
  version: 1; kind: typeof KIND; sessionId: string; runId: string; state: 'ready';
  snapshot: Pick<Snapshot, 'capturedAt' | 'businessDate' | 'sha256' | 'sourceSha' | 'migrationVersion'>;
  source: { backendSha: string; worktree: string };
  backend: { port: number; origin: string; apiBase: string; identityUrl: string };
  media: { port: number; origin: string; identityUrl: string };
  web: { port: number; origin: string };
  identity: { header: typeof HEADER; value: string };
  ownership: { uid: number; resourceId: string };
}
export interface Session {
  version: 1; sessionId: string; runId: string; root: string; worktree: string; uid: number;
  state: 'initializing' | 'ready' | 'stopped' | 'failed'; initialized: boolean; backendSha: string; sourceDigest: string; sourceDirty: boolean;
  snapshot: Snapshot; ports: { postgres: number; redis: number; backend: number; media: number; api: number; web: number };
  secrets: { owner: string; app: string; redis: string; jwt: string; pepper: string };
  redisInstance?: string;
  processes: Array<{ name: string; group: number; started: string }>;
  tools: { pg: string; redis: string; library?: string };
}
export function hash(value: string | Buffer) { return createHash('sha256').update(value).digest('hex'); }
export function businessDate(date = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); }
export function safeName(name: string) { assert(/^[a-z][a-z0-9-]{2,47}$/.test(name), '批次名非法'); return name; }
export function safePort(port: number) { assert(Number.isInteger(port) && port >= 1024 && port <= 65535 && ![3000,3001,5432,6379].includes(port), '预览端口非法'); return port; }
export function privateDirectory(path: string, create = false) {
  if (create && !existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
  const s = lstatSync(path);
  assert(s.isDirectory() && !s.isSymbolicLink() && s.uid === process.getuid?.() && (s.mode & 0o777) === 0o700 && realpathSync(path) === resolve(path), '预览目录归属或权限不符');
  return path;
}
export function privateFile(path: string, owner = process.getuid?.()) {
  const s = lstatSync(path);
  assert(s.isFile() && !s.isSymbolicLink() && s.uid === owner && (s.mode & 0o077) === 0, '私有文件归属或权限不符');
  return path;
}
export function writePrivate(path: string, value: unknown) {
  const temp = path + '.tmp-' + process.pid;
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  renameSync(temp, path);
}
export function stateRoot() {
  return privateDirectory(resolve(process.env.PREVIEW_STATE_ROOT || join(homedir(), '.local/state/wenyousite-preview')), true);
}
export function sessionRoot(name: string) { return join(stateRoot(), safeName(name)); }
export function save(s: Session) { writePrivate(join(s.root, 'session.json'), s); }
export function load(name: string) {
  const root = privateDirectory(sessionRoot(name));
  const s = JSON.parse(readFileSync(privateFile(join(root, 'session.json')), 'utf8')) as Session;
  assert(s.version === 1 && s.sessionId === name && s.uid === process.getuid?.() && s.root === root && s.worktree === REPO && /^preview_[a-f0-9]{24}$/.test(s.runId), '会话归属不符');
  const own = JSON.parse(readFileSync(privateFile(join(root, 'ownership.json')), 'utf8'));
  assert(own.runId === s.runId && own.root === root && own.uid === s.uid && own.worktree === s.worktree, '归属登记漂移');
  assert(Object.values(s.secrets).every(v=>/^[a-f0-9]{64}$/.test(v)), '私有凭据格式漂移');
  Object.values(s.ports).forEach(safePort);
  assert(new Set(Object.values(s.ports)).size === Object.values(s.ports).length, '端口重复');
  return s;
}
export function environment(s?: Session) {
  return { ...cleanEnvironment(), ...(s?.tools.library ? { LD_LIBRARY_PATH: s.tools.library } : process.env.E2E_LIBRARY_PATH ? { LD_LIBRARY_PATH: process.env.E2E_LIBRARY_PATH } : {}) };
}
export function sha() { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(); }
export function sourceEvidence() {
  const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z', '--', 'src', 'prisma', 'scripts/dev-preview', 'package.json', 'pnpm-lock.yaml'], {cwd:REPO}).toString().split('\0').filter(Boolean).sort();
  const digest = createHash('sha256');
  for (const file of [...new Set(files)]) { digest.update(file + '\0'); if (existsSync(join(REPO,file))) digest.update(readFileSync(join(REPO,file))); }
  const dirty = execFileSync('git',['status','--porcelain','--','src','prisma','scripts/dev-preview','package.json','pnpm-lock.yaml'],{cwd:REPO,encoding:'utf8'}).length>0;
  return {sourceDigest:digest.digest('hex'),sourceDirty:dirty};
}
export function databaseUrl(s: Session, owner = false) {
  return 'postgresql://' + (owner ? 'preview_owner:' + s.secrets.owner : 'wenyousite_app:' + s.secrets.app) + '@127.0.0.1:' + s.ports.postgres + '/postgres?schema=public';
}
export function consumer(s: Session): Consumer {
  const { capturedAt, businessDate, sha256, sourceSha, migrationVersion } = s.snapshot;
  const origin = (port: number) => 'http://127.0.0.1:' + port;
  return { version: 1, kind: KIND, sessionId: s.sessionId, runId: s.runId, state: 'ready',
    snapshot: { capturedAt, businessDate, sha256, sourceSha, migrationVersion },
    source: { backendSha: s.backendSha, worktree: s.worktree },
    backend: { port: s.ports.backend, origin: origin(s.ports.backend), apiBase: origin(s.ports.backend) + '/api/v1', identityUrl: origin(s.ports.backend) + '/__preview/identity' },
    media: { port: s.ports.media, origin: origin(s.ports.media), identityUrl: origin(s.ports.media) + '/__preview/identity' },
    web: { port: s.ports.web, origin: origin(s.ports.web) },
    identity: { header: HEADER, value: s.runId }, ownership: { uid: s.uid, resourceId: s.runId } };
}
export function identity(s: Session, role: 'backend' | 'media') {
  return { version: 1, kind: KIND, sessionId: s.sessionId, runId: s.runId, role, resourceId: s.runId, snapshotSha256: s.snapshot.sha256 };
}
export async function verifyConsumer(s: Session) {
  for (const role of ['backend', 'media'] as const) {
    const response = await fetch(consumer(s)[role].identityUrl, { redirect: 'error', signal: AbortSignal.timeout(3000), cache: 'no-store' });
    assert(response.ok && response.headers.get(HEADER) === s.runId && response.headers.get('content-type')?.includes('application/json'), '预览响应身份不符');
    assert.deepEqual(await response.json(), identity(s, role), '预览实际资源不符');
  }
}
