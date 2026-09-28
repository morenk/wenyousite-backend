import { assertIsolatedEnvironment, verifyIsolatedEnvironment } from './e2e-guard';
const manifest = assertIsolatedEnvironment();
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import Redis from 'ioredis';

type Counts = { following: number; followers: number };
type Profile = { _count?: Counts; isDeactivated?: boolean };
const db = new PrismaClient({ log: [] });
const redis = new Redis({ host: manifest.redis.host, port: manifest.redis.port,
  password: process.env.REDIS_PASSWORD, lazyConnect: true, retryStrategy: () => null });

async function main() {
  await verifyIsolatedEnvironment();
  assert.equal(process.env.PROFILE_FOLLOW_COUNTS_TEST_ENV, 'test');
  await redis.connect();
  const createUser = () => db.user.create({ data: {
    username: 'counts_' + randomUUID().slice(0, 12), email: randomUUID() + '@counts.invalid', password: 'unused',
  } });
  const owner = await createUser();
  const viewer = await createUser();
  const departed = await createUser();
  const peers = await Promise.all(Array.from({ length: 12 }, createUser));
  const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
  const token = (id: string) => jwt.sign({ sub: id }, { expiresIn: '5m' });
  const request = async <T>(path: string, userId?: string, method = 'GET', status = 200): Promise<T> => {
    await new Promise(resolve => setTimeout(resolve, 150));
    const response = await fetch(process.env.API_BASE + path, {
      method, headers: userId ? { authorization: 'Bearer ' + token(userId) } : {}, signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, status, `${method} ${path.replaceAll(/c[a-z0-9]{20,}/g, ':id')} 状态码`);
    const body = await response.json() as { data: T };
    return body.data;
  };
  const lists = async (userId?: string): Promise<Counts> => {
    const path = userId === owner.id ? '/users' : `/users/${owner.id}`;
    return {
      following: (await request<unknown[]>(`${path}/following`, userId)).length,
      followers: (await request<unknown[]>(`${path}/followers`, userId)).length,
    };
  };
  await db.userFollow.createMany({ data: [
    ...[...peers, departed].map(peer => ({ followerId: peer.id, followingId: owner.id })),
    ...[...peers.slice(0, 2), departed].map(peer => ({ followerId: owner.id, followingId: peer.id })),
  ] });
  assert.deepEqual((await request<Profile>('/users/me', owner.id))._count, { following: 3, followers: 13 });
  await request('/users/me', departed.id, 'DELETE');
  assert.equal(await db.userFollow.count({ where: { followerId: owner.id } }), 3);
  assert.equal(await db.userFollow.count({ where: { followingId: owner.id } }), 13);
  const expected = { following: 2, followers: 12 };
  assert.deepEqual(await lists(owner.id), expected);
  assert.deepEqual(await lists(), expected);
  const profiles = [
    (await request<Profile>('/users/me', owner.id))._count,
    (await request<Profile>(`/users/${owner.id}`, viewer.id))._count,
    (await request<Profile>(`/users/${owner.id}`))._count,
  ];
  assert.deepEqual(profiles, [expected, expected, expected], '软注销后本人、登录公开、游客计数必须从 3/13 变为 2/12，与列表一致');
  const tombstone = await request<Profile>(`/users/${departed.id}`);
  assert.equal(tombstone.isDeactivated, true);
  assert.equal(tombstone._count, undefined, '注销账号仍只返回墓碑资料');

  await request(`/users/me/followers/${peers[0].id}`, undefined, 'DELETE', 401);
  for (let n = 0; n < 2; n++) await request(`/users/me/followers/${peers[0].id}`, owner.id, 'DELETE');
  const afterRemoval = { following: 2, followers: 11 };
  assert.deepEqual((await request<Profile>('/users/me', owner.id))._count, afterRemoval);
  assert.deepEqual((await request<Profile>(`/users/${owner.id}`, owner.id))._count, afterRemoval);
  assert.deepEqual(await lists(owner.id), afterRemoval);
  assert.equal(await db.userFollow.count({ where: { followerId: owner.id, followingId: peers[0].id } }), 1,
    '移除粉丝必须保留本人对对方的关注');
  assert.equal(await db.userFollow.count({ where: { followerId: peers[0].id, followingId: owner.id } }), 0);

  // 既有游客缓存独立于登录查询；此纠错不扩展为关系写入缓存失效改造。
  assert.deepEqual((await request<Profile>(`/users/${owner.id}`))._count, expected);
  const cacheKeys = await redis.keys(`*cache:user:${owner.id}`);
  assert.equal(cacheKeys.length, 1, '只定位本轮随机用户的游客缓存');
  const ttl = await redis.pttl(cacheKeys[0]);
  assert(ttl > 0 && ttl <= 300_000, '游客资料保留最多五分钟缓存');
  await redis.pexpire(cacheKeys[0], 1);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual((await request<Profile>(`/users/${owner.id}`))._count, afterRemoval,
    '缓存过期重查仍排除已注销关系');

  await db.userBlock.createMany({ data: [
    { blockerId: viewer.id, blockedId: peers[0].id },
    { blockerId: peers[1].id, blockedId: viewer.id },
  ] });
  const visibleToViewer = { following: 0, followers: 10 };
  assert.deepEqual((await request<Profile>(`/users/${owner.id}`, viewer.id))._count, visibleToViewer);
  assert.deepEqual(await lists(viewer.id), visibleToViewer, '继续按当前查看者双向拉黑过滤');
  assert.deepEqual((await request<Profile>('/users/me', owner.id))._count, afterRemoval);
  assert.deepEqual((await request<Profile>(`/users/${owner.id}`))._count, afterRemoval,
    '游客缓存不能混入其他查看者的拉黑投影');
  assert.deepEqual((await request<Profile>('/users/me', viewer.id))._count, { following: 0, followers: 0 });
  await request(`/users/follow/${owner.id}`, peers[0].id, 'POST', 201);
  assert.deepEqual((await request<Profile>('/users/me', owner.id))._count, expected, '移除完成后允许重新关注');
  await db.userBlock.createMany({ data: [
    { blockerId: owner.id, blockedId: peers[0].id },
    { blockerId: peers[1].id, blockedId: owner.id },
  ] });
  const visibleToOwner = { following: 0, followers: 10 };
  assert.deepEqual((await request<Profile>('/users/me', owner.id))._count, visibleToOwner);
  assert.deepEqual(await lists(owner.id), visibleToOwner, '本人计数也保留双向拉黑过滤');
  assert.equal(await db.userFollow.count({ where: { OR: [
    { followerId: owner.id, followingId: departed.id }, { followerId: departed.id, followingId: owner.id },
  ] } }), 2, '计数纠错不能删除注销账号的既有关系');
  console.log('通过：3/13→2/12、三类资料与列表、双向拉黑、单向幂等移除及重新关注、游客缓存命中/过期、注销墓碑、匿名写入拒绝');
}

void main().catch((error: unknown) => {
  console.error(error instanceof assert.AssertionError ? error.message : '关注计数隔离回归失败（内部上下文已隐藏）');
  process.exitCode = 1;
}).finally(async () => { redis.disconnect(); await db.$disconnect(); });
