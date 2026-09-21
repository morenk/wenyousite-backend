import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import fs from 'node:fs';
import { ownedGroup } from './e2e-processes';

// 精确推进到 stat 已读而 environ 被退出过程清空的窗口，无需概率重试。
function procFixture(nextState: string, nextStart = '123', environment = '', failure?: string) {
  let reads = 0;
  const stat = (state: string, start: string) => `42 (fixture) ${[state, '1', '41', ...Array(16).fill('0'), start].join(' ')}`;
  mock.method(fs, 'readdirSync', () => ['42']);
  mock.method(fs, 'readFileSync', (path: string) => {
    if (path.endsWith('/stat')) {
      reads++;
      if (reads > 1 && nextState === 'gone') throw Object.assign(new Error('gone'), { code: 'ENOENT' });
      return stat(reads === 1 ? 'R' : nextState, reads === 1 ? '123' : nextStart);
    }
    if (path.endsWith('/environ')) {
      if (failure) throw Object.assign(new Error('proc read failed'), { code: failure });
      return environment;
    }
    throw new Error('unexpected read');
  });
  mock.method(fs, 'statSync', () => ({ uid: process.getuid?.() }));
}
for (const state of ['Z', 'X', 'gone']) test(`身份读取时变为 ${state} 的原进程已退出`, () => {
  try { procFixture(state); assert.deepEqual(ownedGroup(41, 'run', '/private'), []); }
  finally { mock.restoreAll(); }
});
test('退出期间 environ 变为不可读，仅确认原进程已退出才忽略', () => {
  try { procFixture('Z', '123', '', 'EACCES'); assert.deepEqual(ownedGroup(41, 'run', '/private'), []); }
  finally { mock.restoreAll(); }
});
for (const [label, state, start, failure] of [
  ['仍存活但身份为空', 'R', '123', undefined],
  ['PID 已复用', 'Z', '456', undefined],
  ['仍存活且 environ 不可读', 'R', '123', 'EACCES'],
  ['environ 消失但进程仍存活', 'R', '123', 'ENOENT'],
] as const) test(`${label} 保持拒绝`, () => {
  try { procFixture(state, start, '', failure); assert.throws(() => ownedGroup(41, 'run', '/private')); }
  finally { mock.restoreAll(); }
});
test('活跃且身份匹配的后代仍被发现', () => {
  try { procFixture('R', '123', 'E2E_RUN_ID=run\0E2E_RESOURCE_ROOT=/private\0'); assert.deepEqual(ownedGroup(41, 'run', '/private'), [42]); }
  finally { mock.restoreAll(); }
});
