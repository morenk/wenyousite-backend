import { assertIsolatedEnvironment, verifyIsolatedEnvironment } from './e2e-guard';
assertIsolatedEnvironment();
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { verifyRpProfileMigration } from './rp-profile-migration';

const db = new PrismaClient();
async function main() {
  await verifyIsolatedEnvironment();
  assert.equal(process.env.RP_PROFILE_TEST_ENV, 'test');
  await verifyRpProfileMigration(db);
  const user = () => db.user.create({ data: { username: 'profile_' + randomUUID().slice(0, 10), email: randomUUID() + '@profile.invalid', password: 'unused' } });
  const [owner, author, reader] = await Promise.all([user(), user(), user()]);
  const category = await db.threadCategoryDefinition.findFirstOrThrow({ where: { isActive: true } });
  const thread = await db.thread.create({ data: { ownerId: owner.id, title: '资料引用隔离样本', category: category.slug, published: true, publishedAt: new Date(), rpIdentityEnabled: true,
    members: { create: [{ userId: owner.id, role: 'OWNER' }, { userId: author.id, playerMarked: true }, { userId: reader.id }] } } });
  const writeSub = await db.subthread.create({ data: { threadId: thread.id, title: '发言子贴' } });
  const profileSub = await db.subthread.create({ data: { threadId: thread.id, title: '他人代贴资料', sortOrder: 1 } });
  await db.thread.update({ where: { id: thread.id }, data: { defaultSubthreadId: writeSub.id } });
  const media = await db.media.create({ data: { userId: author.id, purpose: 'RICH_CONTENT', status: 'COMPLETED', url: 'https://profile.invalid/' + randomUUID() + '.png', key: randomUUID() } });
  const source = `当前角色资料 [@${reader.username}](/users/${reader.id})\n\n![资料图片](${media.url})`;
  const floor = await db.post.create({ data: { threadId: thread.id, subthreadId: profileSub.id, authorId: author.id, content: source, floorNumber: 1,
    mentionIdentitySnapshots: [{ userId: reader.id, label: reader.username, identityId: null }],
    mediaAttachments: { create: { mediaId: media.id, sortOrder: 0 } },
    diceRolls: { create: { nodeId: randomUUID(), notation: '1d6', quantity: 1, sides: 6, modifier: 0, results: [3], total: 3 } } } });
  const reply = await db.post.create({ data: { threadId: thread.id, subthreadId: profileSub.id, authorId: author.id, content: '楼中楼角色资料', parentPostId: floor.id, replyNumber: 1 } });
  const body = await db.post.create({ data: { threadId: thread.id, subthreadId: profileSub.id, authorId: owner.id, content: '子贴正文资料', kind: 'BODY' } });
  const foreignThread = await db.thread.create({ data: { ownerId: owner.id, title: '其他主题', published: true, publishedAt: new Date() } });
  const foreignSub = await db.subthread.create({ data: { threadId: foreignThread.id, title: '其他子贴' } });
  const foreignPost = await db.post.create({ data: { threadId: foreignThread.id, subthreadId: foreignSub.id, authorId: owner.id, content: '不可跨帖引用', floorNumber: 1 } });
  const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
  type Data = Record<string, any>;
  const request = async (path: string, userId?: string, method = 'GET', payload?: unknown, status: number | number[] = 200): Promise<Data> => {
    await new Promise(resolve => setTimeout(resolve, 135));
    const response = await fetch(process.env.API_BASE + path, { method, headers: {
      'X-Markdown-Contract-Version': '6',
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      ...(userId ? { authorization: 'Bearer ' + jwt.sign({ sub: userId, jti: randomUUID() }, { expiresIn: '10m' }) } : {}),
    }, body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
    const result = await response.json() as Data;
    assert.equal(Array.isArray(status) ? status.includes(response.status) : response.status === status, true, method + ' API status=' + response.status + ' code=' + result.code);
    if (method === 'GET' && response.status === 200 && (path.includes('/rp-identities') || path.startsWith('/posts/')))
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
    return response.status >= 400 ? result : result.data;
  };
  const base = '/threads/' + thread.id;
  const collection = base + '/rp-identities';
  let role = await request(collection, owner.id, 'POST', { nickname: '白鸦' }, 201);
  const rolePath = collection + '/' + role.identityId;
  const token = role.identityToken;
  const save = async (payload: unknown) => role = await request(rolePath, owner.id, 'PUT', { version: role.identity.version, ...payload as object });
  const displayState = (value: Data, status: string, id: string | null) => {
    assert.equal(value.profilePostStatus, status); assert.equal(value.profilePostId, id);
  };
  assert.equal((await request('/meta')).capabilities.rpIdentityProfileSupported, true);
  displayState(role, 'NONE', null);
  await save({ profilePostId: floor.id });
  displayState(role, 'AVAILABLE', floor.id); assert.equal(role.identityToken, token);
  const post = await request('/subthreads/' + writeSub.id + '/posts', owner.id, 'POST', { content: '资料绑定前的token仍可发表', identityMode: 'RP', identityId: role.identityId, identityToken: token, clientRequestId: randomUUID() }, 201);
  assert.equal(post.author.rpIdentity.id, role.identityId); assert(!('profilePostId' in post.author.rpIdentity));
  const originalSnapshot = (await db.post.findUniqueOrThrow({ where: { id: post.id } })).authorIdentitySnapshot;
  const otherRole = await request(collection, owner.id, 'POST', { nickname: '另一个角色', profilePostId: floor.id }, 201);
  displayState(otherRole, 'AVAILABLE', floor.id);
  const viewed = await request(rolePath, reader.id);
  displayState(viewed, 'AVAILABLE', floor.id); assert.equal(viewed.identity, null);
  const detail = await request('/posts/' + floor.id, reader.id);
  assert.equal(detail.content, source); assert.equal(detail.subthread.title, profileSub.title); assert.equal(detail.threadId, thread.id);
  assert.equal(detail.floorNumber, 1); assert.equal(detail.diceRolls[0].total, 3);
  assert.equal(detail.mediaDisplays[0].sourceUrl, media.url); assert.equal(detail.mentionIdentities[0].userId, reader.id);
  await save({ profilePostId: reply.id });
  const replyDetail = await request('/posts/' + reply.id, reader.id);
  assert.equal(replyDetail.parentPost.floorNumber, 1); assert.equal(replyDetail.replyNumber, 1);
  await save({ profilePostId: body.id }); displayState(role, 'AVAILABLE', body.id);
  await save({ profilePostId: reply.id });
  assert.equal((await request(rolePath, owner.id, 'PUT', { profilePostId: foreignPost.id, version: role.identity.version }, 404)).code, 40403);
  assert.equal((await request(rolePath, owner.id, 'PUT', { profilePostId: 'https://profile.invalid', version: role.identity.version }, 400)).code, 40000);
  assert.equal((await request(rolePath, owner.id, 'PUT', { profilePostId: floor.id, clearProfilePost: true, version: role.identity.version }, 400)).code, 40001);
  assert.equal((await request(collection, owner.id, 'POST', { profilePostId: floor.id }, 400)).code, 40001);
  const version = role.identity.version;
  const concurrent = await Promise.all([
    request(rolePath, owner.id, 'PUT', { profilePostId: floor.id, version }, [200, 409]),
    request(rolePath, owner.id, 'PUT', { profilePostId: body.id, version }, [200, 409]),
  ]);
  assert.equal(concurrent.filter(value => value.code === 40002).length, 1);
  role = concurrent.find(value => value.identityId)!; assert(role);
  await save({ profilePostId: reply.id });
  const edited = await request('/posts/' + reply.id, author.id, 'PATCH', { content: '更新后的资料原文', version: reply.version });
  assert.equal((await request('/posts/' + reply.id, reader.id)).content, edited.content);
  assert.equal((await request(rolePath, owner.id)).identityToken, token);
  await request('/posts/' + reply.id, author.id, 'DELETE');
  displayState(await request(rolePath, reader.id), 'UNAVAILABLE', null);
  await request('/posts/' + reply.id, reader.id, 'GET', undefined, 404);
  await db.post.update({ where: { id: reply.id }, data: { deletedAt: null, removalSource: null, removedById: null } });
  await db.post.update({ where: { id: floor.id }, data: { deletedAt: new Date(), removalSource: 'ADMIN' } });
  displayState(await request(rolePath, reader.id), 'UNAVAILABLE', null);
  await request('/posts/' + reply.id, reader.id, 'GET', undefined, 404);
  assert.equal((await request(rolePath, owner.id)).identity.profilePostId, reply.id);
  assert.equal((await request(rolePath, owner.id, 'PUT', { profilePostId: reply.id, version: role.identity.version }, 404)).code, 40403);
  await db.post.update({ where: { id: floor.id }, data: { deletedAt: null, removalSource: null } });
  await db.subthread.update({ where: { id: profileSub.id }, data: { deletedAt: new Date() } });
  displayState(await request(rolePath, reader.id), 'UNAVAILABLE', null);
  await db.subthread.update({ where: { id: profileSub.id }, data: { deletedAt: null } });
  await db.userBlock.create({ data: { blockerId: reader.id, blockedId: author.id } });
  displayState(await request(rolePath, reader.id), 'UNAVAILABLE', null);
  displayState(await request(rolePath, owner.id), 'AVAILABLE', reply.id);
  await request('/posts/' + reply.id, reader.id, 'GET', undefined, 404);
  await db.userBlock.deleteMany({ where: { blockerId: reader.id, blockedId: author.id } });
  await db.userBlock.create({ data: { blockerId: owner.id, blockedId: author.id } });
  assert.equal((await request(rolePath, owner.id, 'PUT', { profilePostId: reply.id, version: role.identity.version }, 404)).code, 40403);
  await db.userBlock.deleteMany({ where: { blockerId: owner.id, blockedId: author.id } });
  await request(base + '/identity-settings', owner.id, 'PATCH', { enabled: false });
  displayState(await request(rolePath, reader.id), 'NONE', null);
  assert.equal((await request(rolePath, owner.id)).identity.profilePostId, reply.id);
  await request(base + '/identity-settings', owner.id, 'PATCH', { enabled: true });
  displayState(await request(rolePath, reader.id), 'AVAILABLE', reply.id);
  await db.thread.update({ where: { id: thread.id }, data: { visibility: 'PRIVATE' } });
  await request(rolePath, undefined, 'GET', undefined, 404);
  await db.threadMember.delete({ where: { threadId_userId: { threadId: thread.id, userId: reader.id } } });
  await request(rolePath, reader.id, 'GET', undefined, 404);
  await request('/posts/' + reply.id, reader.id, 'GET', undefined, 404);
  await db.thread.update({ where: { id: thread.id }, data: { visibility: 'PUBLIC' } });
  role = await request(rolePath, owner.id);
  await save({ clearProfilePost: true }); displayState(role, 'NONE', null);
  await save({ profilePostId: floor.id });
  await save({ profilePostId: null }); displayState(role, 'NONE', null);
  await save({ profilePostId: reply.id });
  await request(base + '/identity', owner.id, 'DELETE');
  role = await request(rolePath, owner.id); displayState(role, 'NONE', null);
  assert.equal(role.identity.profilePostId, reply.id);
  await save({ nickname: '新昵称' }); displayState(role, 'AVAILABLE', reply.id);
  assert.notEqual(role.identityToken, token);
  assert.deepEqual((await db.post.findUniqueOrThrow({ where: { id: post.id } })).authorIdentitySnapshot, originalSnapshot);
  const playerRole = await request(collection, author.id, 'POST', { nickname: '玩家角色', profilePostId: body.id }, 201);
  await db.threadMember.update({ where: { threadId_userId: { threadId: thread.id, userId: author.id } }, data: { playerMarked: false } });
  displayState(await request(collection + '/' + playerRole.identityId, reader.id), 'NONE', null);
  await request(rolePath, owner.id, 'DELETE', { version: role.identity.version });
  displayState(await request(rolePath, reader.id), 'NONE', null);
  console.log('RP profile migration/current-content/access/token/legacy boundaries passed');
}
main().finally(() => db.$disconnect()).catch((error: unknown) => { console.error(error instanceof Error ? error.stack : 'profile test failed'); process.exitCode = 1; });
