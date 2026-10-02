import assert from 'node:assert/strict';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** 模拟 Web 的最小权限消费者，只使用本轮 manifest、样本编号和 HTTP。 */
async function main() {
  for (const key of ['DATABASE_URL', 'DIRECT_DATABASE_URL', 'REDIS_PASSWORD', 'JWT_ACCESS_SECRET']) assert(!process.env[key], '消费者不得获得数据服务或签名凭据');
  const manifestPath = process.env.E2E_MANIFEST!;
  const root = dirname(realpathSync(manifestPath));
  const readPrivate = (path: string) => {
    const stat = lstatSync(path);
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid?.() && (stat.mode & 0o777) === 0o600);
    assert.equal(dirname(realpathSync(path)), root);
    return JSON.parse(readFileSync(path, 'utf8'));
  };
  assert.equal(lstatSync(root).mode & 0o777, 0o700);
  const manifest = readPrivate(manifestPath);
  assert.equal(manifest.runId, process.env.E2E_RUN_ID);
  assert(/^e2e_[a-f0-9]{24}$/.test(manifest.runId) && manifest.state === 'ready');
  assert.equal(manifest.apiBase, process.env.API_BASE);
  const api = new URL(manifest.apiBase);
  assert(api.hostname === '127.0.0.1' && api.protocol === 'http:' && api.port && api.port !== '3000');
  assert.equal(process.env.E2E_DISCUSSION_FIXTURES, join(root, 'discussion-fixtures.json'));
  const fixture = readPrivate(process.env.E2E_DISCUSSION_FIXTURES!);
  assert.equal(fixture.version, 1); assert.equal(fixture.runId, manifest.runId);
  assert.equal(fixture.ownerUserId, process.env.E2E_USER_ID);
  const privateEnv = readPrivate(manifest.privateEnvPath);
  assert.equal(privateEnv.E2E_DISCUSSION_FIXTURES, process.env.E2E_DISCUSSION_FIXTURES);
  assert.deepEqual(fixture.scenarios.map((s: { size: number }) => s.size), [1000, 5000, 10000]);
  const get = async (path: string, status = 200) => {
    const response = await fetch(manifest.apiBase + path, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, status); return response.json();
  };
  for (const s of fixture.scenarios) {
    const floorPath = '/subthreads/' + s.subthreadId + '/posts/window';
    const replyPath = '/posts/' + s.rootPostId + '/replies/window';
    for (const path of [floorPath, replyPath]) {
      const first = (await get(path)).data;
      assert.equal(first.total, s.size); assert.equal(first.maxNumber, s.size); assert.equal(first.items.length, 20);
      for (const number of [1, s.size / 2, s.size]) {
        const window = (await get(path + '?number=' + number)).data;
        assert.equal(window.target.number, number); assert(window.items.length <= 20); assert.equal(window.pinnedItems.length, 0);
      }
      assert.equal((await get(path + '?number=2&authorId=' + fixture.ownerUserId, 409)).code, 40010);
    }
    assert.equal((await get(floorPath)).data.pinnedItems[0].id, s.pinnedPostId);
    assert.deepEqual((await get(replyPath)).data.pinnedItems, []);
    assert.equal((await get(floorPath + '?postId=' + s.editableFloorId)).data.target.number, 3);
    assert.equal((await get(replyPath + '?postId=' + s.editableReplyId)).data.target.number, 3);
    assert.equal((await get(floorPath + '?postId=' + s.otherAuthorFloorId)).data.target.number, 2);
    assert.equal((await get(replyPath + '?postId=' + s.otherAuthorReplyId)).data.target.number, 2);
  }
  console.log('讨论消费者样本通过：受限环境、0600 身份绑定、1k/5k/10k 主楼和回复真实 HTTP、置顶、作者筛选及定位 ID');
}
void main().catch(() => { console.error('讨论消费者样本验证失败'); process.exitCode = 1; });
