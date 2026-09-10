import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { PrismaClient, PostingPolicy } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';

const base = process.env.API_BASE!;
assert.equal(process.env.API_E2E_ENV, 'test');
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname));
assert(/^wenyousite_e2e_[a-z0-9_]+$/.test(new URL(process.env.DATABASE_URL!).pathname.slice(1)));
const db = new PrismaClient();
const prefix = randomUUID();
const key = (name: string) => `c${createHash('sha256').update(prefix + name).digest('hex').slice(0, 24)}`;
const [owner, collaborator, player, participant, outsider] = ['owner', 'collaborator', 'player', 'participant', 'outsider'].map(key);
const users = [owner, collaborator, player, participant, outsider];
const threadId = key('thread');
const defaultId = key('default');
const otherId = key('other');
const bodyId = key('body');
const parentId = key('floor');
const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
const tokens = new Map(users.map((id) => [id, jwt.sign({ sub: id }, { expiresIn: '10m' })]));
let requests = 0;
async function request(user: string | undefined, path: string, method = 'GET', body?: unknown, status = 200) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(user ? { Authorization: `Bearer ${tokens.get(user)}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      'X-Forwarded-For': `198.24.${Math.floor(++requests / 250)}.${requests % 250 + 1}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json() as any;
  assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(result)}`);
  return result;
}
async function snapshot() {
  return db.thread.findUniqueOrThrow({
    where: { id: threadId },
    select: {
      title: true, version: true, status: true, visibility: true,
      subthreads: { orderBy: { id: 'asc' }, select: { id: true, title: true, version: true, postingPolicy: true } },
      posts: { where: { kind: 'BODY' }, select: { id: true, content: true, version: true } },
      topicTags: { orderBy: { tagId: 'asc' }, select: { tagId: true } },
    },
  });
}
async function payload(extra: Record<string, unknown> = {}) {
  const current = await snapshot();
  const sub = current.subthreads.find((item) => item.id === defaultId)!;
  return {
    version: current.version,
    defaultSubthreadVersion: sub.version,
    bodyVersion: current.posts[0].version,
    content: current.posts[0].content,
    tagNames: [],
    ...extra,
  };
}
async function run() {
  for (const id of users) await db.user.create({ data: {
    id, email: `${id}@example.invalid`, username: id, password: 'unused',
    wallet: { create: { kind: 'USER' } },
  } });
  await db.thread.create({ data: {
    id: threadId, title: '主贴权限回归', ownerId: owner, published: true, publishedAt: new Date(),
    members: { create: users.filter((userId) => userId !== outsider).map((userId) => ({
      userId, role: userId === owner ? 'OWNER' : userId === collaborator ? 'COLLABORATOR' : 'PARTICIPANT',
      playerMarked: userId === player,
    })) },
    subthreads: { create: [
      { id: defaultId, title: '主贴权限回归', sortOrder: 0 },
      { id: otherId, title: '保持独立策略', sortOrder: 1, postingPolicy: 'PLAYERS' },
    ] },
  } });
  await db.thread.update({ where: { id: threadId }, data: { defaultSubthreadId: defaultId } });
  await db.post.createMany({ data: [
    { id: bodyId, kind: 'BODY', content: '原正文', threadId, subthreadId: defaultId, authorId: owner },
    { id: parentId, kind: 'FLOOR', floorNumber: 1, content: '父楼层', threadId, subthreadId: defaultId, authorId: owner },
  ] });
  const path = `/threads/${threadId}/aggregate`;
  for (const user of [undefined, player, participant, outsider]) {
    await request(user, path, 'PATCH', await payload({ defaultSubthreadPostingPolicy: 'PLAYERS' }), user ? 403 : 401);
  }
  for (const value of [null, 'PUBLIC', 1]) {
    await request(owner, path, 'PATCH', await payload({ defaultSubthreadPostingPolicy: value }), 400);
  }
  const otherBefore = await db.subthread.findUniqueOrThrow({ where: { id: otherId } });
  for (const policy of ['COLLABORATORS', 'PLAYERS', 'PARTICIPANTS'] as PostingPolicy[]) {
    const before = await snapshot();
    const currentDefault = before.subthreads.find((item) => item.id === defaultId)!;
    const updated = await request(policy === 'PLAYERS' ? collaborator : owner, path, 'PATCH', await payload({
      title: `主贴权限 ${policy}`, content: `正文 ${policy}`, defaultSubthreadPostingPolicy: policy,
    }));
    const defaultSub = updated.data.subthreads.find((item: { id: string }) => item.id === defaultId);
    assert.equal(defaultSub.postingPolicy, policy);
    assert.equal(defaultSub.version, currentDefault.version + 1, '标题和权限只递增一次版本');
    assert.equal(defaultSub.postingCapability.canPost, true);
    assert.deepEqual(await db.subthread.findUniqueOrThrow({ where: { id: otherId } }), otherBefore);
    assert.equal(await db.threadMember.count({ where: { threadId, userId: outsider } }), 0,
      '登录非成员在开放策略首次发言前不能被隐式加入');
    for (const user of [undefined, ...users]) {
      const allowed = !!user && (user === owner || user === collaborator || policy === 'PARTICIPANTS' || (policy === 'PLAYERS' && user === player));
      const detail = await request(user, `/threads/${threadId}`);
      assert.equal(detail.data.subthreads.find((item: { id: string }) => item.id === defaultId).postingCapability.canPost, allowed);
      for (const reply of [false, true]) {
        await request(user, `/subthreads/${defaultId}/posts`, 'POST', {
          content: '主贴权限楼层与回复回归', clientRequestId: randomUUID(),
          ...(reply ? { parentPostId: parentId, replyToPostId: parentId } : {}),
        }, allowed ? 201 : user ? 403 : 401);
      }
    }
  }
  const joined = await db.threadMember.findUniqueOrThrow({ where: { threadId_userId: { threadId, userId: outsider } } });
  assert.equal(joined.role, 'PARTICIPANT', '公开帖开放发言后自动进入候选池');
  assert.equal(joined.playerMarked, false);
  await request(owner, path, 'PATCH', await payload({ defaultSubthreadPostingPolicy: 'COLLABORATORS' }));
  const oldClientBefore = await db.subthread.findUniqueOrThrow({ where: { id: defaultId } });
  await request(owner, path, 'PATCH', await payload({ title: '旧客户端标题' }));
  const oldClientAfter = await db.subthread.findUniqueOrThrow({ where: { id: defaultId } });
  assert.equal(oldClientAfter.postingPolicy, 'COLLABORATORS', '省略保留原值');
  assert.equal(oldClientAfter.version, oldClientBefore.version + 1);
  // BODY 冲突发生在子贴更新之后，读取数据库验证事务确实回滚。
  const beforeConflict = await snapshot();
  await request(owner, path, 'PATCH', await payload({
    title: '不得写入', content: '不得写入正文', bodyVersion: 99999, defaultSubthreadPostingPolicy: 'PLAYERS',
  }), 409);
  assert.deepEqual(await snapshot(), beforeConflict, '正文冲突应回滚已执行的子贴修改');
  await request(owner, path, 'PATCH', await payload({ defaultSubthreadVersion: 99999, defaultSubthreadPostingPolicy: 'PLAYERS' }), 409);
  assert.deepEqual(await snapshot(), beforeConflict);
  // 停用标签在默认子贴和正文更新后校验，确保后续校验失败没有部分落库。
  const inactiveName = `policy_${prefix.slice(0, 8)}`;
  await db.topicTag.create({ data: { name: inactiveName, isActive: false } });
  await request(owner, path, 'PATCH', await payload({
    title: '标签冲突标题', content: '标签冲突正文', tagNames: [inactiveName], defaultSubthreadPostingPolicy: 'PLAYERS',
  }), 409);
  assert.deepEqual(await snapshot(), beforeConflict);
  const concurrent = await payload({ title: '并发保存', defaultSubthreadPostingPolicy: 'PLAYERS' });
  const statuses = await Promise.all([owner, collaborator].map(async (user) => {
    const response = await fetch(`${base}${path}`, {
      method: 'PATCH', headers: {
        Authorization: `Bearer ${tokens.get(user)}`, 'Content-Type': 'application/json',
        'X-Forwarded-For': `198.25.0.${user === owner ? 1 : 2}`,
      }, body: JSON.stringify(concurrent),
    });
    return response.status;
  }));
  assert.deepEqual(statuses.sort(), [200, 409]);
  console.log('Main-post policy HTTP, role matrix, atomic rollback and compatibility passed');
}
void run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
