import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { lockInteractionUsers } from '../src/access/block-visibility.where';

const base = process.env.API_BASE!;
assert.equal(process.env.API_E2E_ENV, 'test');
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
assert(/^wenyousite_e2e_[a-z0-9_]+$/.test(new URL(process.env.DATABASE_URL!).pathname.slice(1)));
const db = new PrismaClient();
const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
const prefix = `block${randomUUID().slice(0, 8)}`;
const key = (value: string) => `c${createHash('sha256').update(prefix + value).digest('hex').slice(0, 24)}`;
const ids = ['a', 'b', 'c'].map(key);
const [a, b, c] = ids;
const tokens = new Map(ids.map((id) => [id, jwt.sign({ sub: id }, { expiresIn: '10m' })]));
let requests = 0;
async function request(user: string | undefined, path: string, method = 'GET', body?: unknown, status = 200) {
  const response = await fetch(`${base}${path}`, {
    method, headers: {
      ...(user ? { Authorization: `Bearer ${tokens.get(user)}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      'X-Forwarded-For': `198.22.${Math.floor(++requests / 250)}.${requests % 250 + 1}`,
    }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json() as any;
  assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(result)}`);
  return result;
}
async function archive(user: string, thread: string) {
  const response = await fetch(`${base}/threads/${thread}/export`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokens.get(user)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ format: 'MARKDOWN', includeMedia: false }),
  });
  assert.equal(response.status, 200);
  const zip = Buffer.from(await response.arrayBuffer());
  // Read central-directory sizes because streaming ZIP headers use data descriptors.
  const files: string[] = [];
  for (let offset = 0; offset + 46 < zip.length; offset++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) continue;
    const size = zip.readUInt32LE(offset + 20);
    const local = zip.readUInt32LE(offset + 42);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const content = zip.subarray(start, start + size);
    files.push((zip.readUInt16LE(offset + 10) === 8 ? inflateRawSync(content) : content).toString());
  }
  assert(files.length > 0);
  return files.join('\n');
}
const thread = (user: string) => key(`${user}-thread`);
const sub = (user: string) => key(`${user}-sub`);
const floor = (user: string) => key(`${user}-floor`);
const moment = (user: string) => key(`${user}-moment`);
const inviteToken = `${prefix}invite`.padEnd(16, 'x');
async function seed() {
  for (const user of ids) {
    await db.user.create({ data: { id: user, email: `${user}@example.invalid`, username: user, password: 'unused',
      wallet: { create: { kind: 'USER', balance: 100_000n } } } });
  }
  for (const user of ids) {
    await db.thread.create({ data: { id: thread(user), title: `${prefix}主题${user}`, ownerId: user, published: true, publishedAt: new Date(),
      subthreads: { create: { id: sub(user), title: '正文', postingPolicy: 'PARTICIPANTS' } },
      members: { create: ids.map((id) => ({ userId: id, role: id === user ? 'OWNER' : id === a ? 'COLLABORATOR' : 'PARTICIPANT', playerMarked: true })) },
    } });
    await db.thread.update({ where: { id: thread(user) }, data: { defaultSubthreadId: sub(user) } });
  }
  for (const user of ids) {
    await db.post.create({ data: { id: `${user}-body`, threadId: thread(user), subthreadId: sub(user), authorId: user === c ? b : user,
      kind: 'BODY', content: `${prefix}正文独有 BODY_${user}` } });
    await db.post.create({ data: { id: floor(user), threadId: thread(c), subthreadId: sub(c), authorId: user,
      floorNumber: ids.indexOf(user) + 1, content: `${prefix}楼层 FLOOR_${user}` } });
    await db.moment.create({ data: { id: moment(user), authorId: user, clientRequestId: randomUUID(), createRequestHash: 'fixture', title: `${prefix}动态`, content: `${prefix}动态正文` } });
  }
  await db.post.createMany({ data: [
    { id: `${prefix}hidden-parent-reply`, authorId: c, parentPostId: floor(b), replyToPostId: floor(b), content: `${prefix}隐藏父级回复` },
    { id: `${prefix}hidden-author-reply`, authorId: b, parentPostId: floor(c), replyToPostId: floor(c), content: `${prefix}隐藏作者回复` },
    { id: `${prefix}visible-reference`, authorId: c, parentPostId: floor(c), replyToPostId: `${prefix}hidden-author-reply`, content: `${prefix}第三方保留文字` },
  ].map((post) => ({ ...post, threadId: thread(c), subthreadId: sub(c) })) });
  await db.momentComment.create({ data: { id: `${prefix}comment-b`, momentId: moment(c), authorId: b, clientRequestId: randomUUID(), createRequestHash: 'fixture', content: 'B 评论' } });
  await db.userFollow.createMany({ data: [{ followerId: a, followingId: b }, { followerId: c, followingId: b }] });
  await db.threadInvite.create({ data: { threadId: thread(b), token: inviteToken } });
  await db.notification.createMany({ data: [
    { id: `${prefix}notification-b`, userId: a, type: 'reply', fromUserId: b, threadId: thread(c), postId: floor(b), content: 'B 的回复' },
    { id: `${prefix}notification-c`, userId: a, type: 'reply', fromUserId: c, threadId: thread(c), postId: floor(c), content: 'C 的回复' },
    { id: `${prefix}notification-like`, userId: a, type: 'like', fromUserId: c, content: 'B、C 点赞', payload: { likers: [{ userId: b, username: b }, { userId: c, username: c }] } },
  ] });
  const [firstUserId, secondUserId] = [a, b].sort();
  await db.directConversation.create({ data: { id: `${prefix}dm`, firstUserId, secondUserId, requesterId: a, recipientId: b, status: 'PENDING',
    participants: { create: [{ userId: a }, { userId: b }] },
    messages: { create: { id: `${prefix}message`, senderId: a, recipientId: b, content: '历史私聊', clientRequestId: randomUUID() } },
  } });
}
async function hiddenMatrix(viewer: string, hidden: string) {
  for (const path of [`/users/${hidden}`, `/threads/${thread(hidden)}`, `/subthreads/${sub(hidden)}`, `/direct-conversations/${prefix}dm`, `/direct-conversations/${prefix}dm/messages`, `/direct-conversations/by-user/${hidden}`]) {
    await request(viewer, path, 'GET', undefined, 404);
  }
  for (const sort of ['newest', 'active', 'recommended']) {
    const page = await request(viewer, `/threads?sort=${sort}&limit=1`);
    assert(!page.data.some((item: any) => item.owner.id === hidden));
    assert(page.data.length === 1, '过滤必须发生在分页前');
  }
  const users = await request(viewer, `/search/users?q=${hidden}`);
  assert.equal(users.data.length, 0);
  const body = await request(viewer, `/search/posts?q=${prefix}&includeBody=true`);
  assert(!body.data.some((item: any) => item.author.id === hidden || item.thread.id === thread(hidden)));
  const dm = await request(viewer, '/direct-conversations?view=INBOX');
  assert(!dm.data.some((item: any) => item.id === `${prefix}dm`));
}
async function run() {
  await seed();
  // Warm anonymous cache, including C's default BODY written by B.
  await request(undefined, `/threads/${thread(b)}`);
  await request(undefined, `/threads/${thread(c)}`);
  await request(undefined, `/users/${b}`);
  const oldSearch = await request(a, `/search/posts?q=${prefix}`);
  assert(oldSearch.data.every((item: any) => item.kind === 'FLOOR'));
  const fullSearch = await request(a, `/threads/${thread(c)}/search/posts?q=${prefix}&includeBody=true`);
  assert(fullSearch.data.some((item: any) => item.kind === 'BODY'));
  await request(a, `/search/posts?q=${prefix}&includeBody=invalid`, 'GET', undefined, 400);
  await request(a, `/threads/${thread(b)}/like`, 'POST', undefined, 201);
  await request(a, `/users/me/block/${b}`, 'POST', undefined, 201);
  await hiddenMatrix(a, b);
  await hiddenMatrix(b, a);
  await request(c, `/users/${b}`);
  await request(c, `/threads/${thread(b)}`);
  await request(undefined, `/threads/${thread(b)}`);
  const detail = await request(a, `/threads/${thread(c)}`);
  assert.equal(detail.data.subthreads[0].bodyPost, null);
  const floors = await request(a, `/subthreads/${sub(c)}/posts`);
  assert(!floors.data.some((item: any) => item.id === floor(b)));
  const root = floors.data.find((item: any) => item.id === floor(c));
  assert.equal(root.replies.length, 1);
  assert.equal(root.replies[0].replyToPost, null);
  await request(a, `/posts/${floor(b)}`, 'GET', undefined, 404);
  await request(a, `/posts/${prefix}hidden-parent-reply`, 'GET', undefined, 404);
  const notifications = await request(a, '/notifications?limit=1');
  assert.deepEqual(notifications.data.map((item: any) => item.id), [`${prefix}notification-c`]);
  const members = await request(a, `/threads/${thread(c)}/members`);
  assert(!members.data.some((item: any) => item.userId === b));
  await request(a, `/moments/${moment(b)}`, 'GET', undefined, 404);
  await request(a, `/moments/${moment(c)}/comments/${prefix}comment-b/replies`, 'GET', undefined, 404);
  await request(a, `/threads/${thread(b)}/export`, 'POST', { includeMedia: false }, 404);
  const text = await archive(a, thread(c));
  assert(!text.includes(`FLOOR_${b}`) && !text.includes(`BODY_${c}`) && text.includes(`FLOOR_${c}`));
  const following = await request(a, `/users/${c}/following`);
  assert(!following.data.some((item: any) => item.id === b));
  await request(a, `/threads/${thread(b)}/like`, 'DELETE');
  assert.equal(await db.threadLike.count({ where: { threadId: thread(b), userId: a } }), 0);
  await db.thread.update({ where: { id: thread(b) }, data: { visibility: 'PRIVATE' } });
  await request(a, `/threads/join-by-link/${inviteToken}`, 'GET', undefined, 404);
  await request(a, `/threads/join-by-link/${inviteToken}`, 'POST', undefined, 403);
  await request(c, `/threads/join-by-link/${inviteToken}`);
  await db.thread.update({ where: { id: thread(b) }, data: { visibility: 'PUBLIC' } });
  await request(a, `/threads/${thread(b)}`, 'PATCH', { version: 1, title: '拒绝协作修改' }, 403);
  await request(a, `/subthreads/${sub(b)}`, 'PATCH', { version: 1, title: '拒绝协作修改' }, 403);
  await db.threadMember.update({ where: { threadId_userId: { threadId: thread(c), userId: a } }, data: { role: 'PARTICIPANT' } });
  for (const [path, body] of [
    [`/users/follow/${b}`, undefined],
    [`/threads/${thread(b)}/like`, undefined],
    ['/bookmarks', { threadId: thread(b) }],
    ['/subscriptions', { threadId: thread(c), type: 'USER', targetUserId: b }],
    [`/subthreads/${sub(b)}/posts`, { content: '不应写入', clientRequestId: randomUUID() }],
    [`/subthreads/${sub(c)}/posts`, { content: `[@${b}](/users/${b}) 新提及`, clientRequestId: randomUUID() }],
    [`/subthreads/${sub(c)}/posts`, { content: '拒绝跨拉黑回复', parentPostId: floor(b), clientRequestId: randomUUID() }],
    [`/users/${b}/tips`, { amount: '2', clientRequestId: randomUUID() }],
    [`/direct-conversations`, { recipientId: b, content: '拒绝私聊', clientRequestId: randomUUID() }],
    [`/moments/${moment(b)}/like`, undefined],
    [`/moments/${moment(b)}/comments`, { content: '拒绝评论', clientRequestId: randomUUID() }],
  ] as const) await request(a, path, 'POST', body, 403);
  assert.equal(await db.directMessage.count({ where: { conversationId: `${prefix}dm` } }), 1);
  assert.equal((await db.directConversation.findUniqueOrThrow({ where: { id: `${prefix}dm` } })).status, 'PENDING');
  await request(b, `/users/me/block/${a}`, 'POST', undefined, 201);
  await request(a, `/users/me/block/${b}`, 'DELETE');
  await request(a, `/users/${b}`, 'GET', undefined, 404);
  await request(b, `/users/me/block/${a}`, 'DELETE');
  await request(a, `/users/${b}`);
  await request(a, `/direct-conversations/${prefix}dm/messages`);
  // Hold the same user locks while inserting an uncommitted block; an in-flight follow must recheck after it commits.
  await db.userFollow.deleteMany({ where: { followerId: a, followingId: b } });
  let release!: () => void; let acquired!: () => void;
  const locked = new Promise<void>((resolve) => { acquired = resolve; });
  const resume = new Promise<void>((resolve) => { release = resolve; });
  const blocking = db.$transaction(async (tx) => {
    await lockInteractionUsers(tx, [a, b]);
    await tx.userBlock.create({ data: { blockerId: a, blockedId: b } });
    acquired(); await resume;
  }, { timeout: 10_000 });
  await locked;
  const interaction = request(a, `/users/follow/${b}`, 'POST', undefined, 403);
  try {
    const deadline = Date.now() + 5000;
    for (;;) {
      const rows = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      if (rows[0].count > 0n) break;
      assert(Date.now() < deadline, '关注请求未进入用户锁等待');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  } finally { release(); }
  await blocking; await interaction;
  assert.equal(await db.userFollow.count({ where: { followerId: a, followingId: b } }), 0);
  // 删除发生在消费之前：保留 Outbox 历史，但失效源内容必须正常结束而非永久重试。
  await db.thread.update({ where: { id: thread(c) }, data: { deletedAt: new Date() } });
  const staleEvent = await db.domainOutbox.create({ data: {
    eventType: 'post.created', aggregateType: 'post', aggregateId: floor(c),
    eventKey: `${prefix}:deleted-source`,
    payload: { postId: floor(c), content: '已删除主题的延迟事件', userId: c,
      threadId: thread(c), subthreadId: sub(c), subthreadTitle: '已删除子贴',
      parentPostId: null, replyToPostId: null, authorRole: 'OWNER', authorPlayerMarked: true },
  } });
  const deliveryDeadline = Date.now() + 15_000;
  for (;;) {
    const row = await db.domainOutbox.findUniqueOrThrow({ where: { id: staleEvent.id } });
    assert.equal(row.lastError, null, '已删除源内容不应导致 Outbox 重试');
    if (row.processedAt) { assert.equal(row.attempts, 1); break; }
    assert(Date.now() < deliveryDeadline, '延迟事件未完成投递');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.log(`Block/search matrix passed (${requests} HTTP requests), including cached previews, export and concurrent follow`);
}
void run().finally(() => db.$disconnect()).catch((error) => { console.error(error); process.exitCode = 1; });
