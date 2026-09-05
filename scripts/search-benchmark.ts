import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { Prisma, PrismaClient } from '@prisma/client';
import { SearchService } from '../src/search/search.service';
import { ThreadAccessService } from '../src/access/thread-access.service';

async function main() {
  assert.equal(process.env.SEARCH_BENCHMARK_ENV, 'test');
  const base = new URL(process.env.DATABASE_URL!);
  assert(['127.0.0.1', 'localhost', '::1'].includes(base.hostname));
  const database = `wenyousite_search_test_${randomUUID().replaceAll('-', '')}`;
  const adminUrl = new URL(base); adminUrl.pathname = '/postgres';
  const testUrl = new URL(base); testUrl.pathname = `/${database}`;
  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  const db = new PrismaClient({ datasourceUrl: testUrl.toString() });
  let created = false;
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`); created = true;
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: testUrl.toString(), DIRECT_DATABASE_URL: testUrl.toString() }, stdio: 'pipe',
    });
    await db.user.createMany({ data: ['owner', 'player', 'viewer', 'blocked'].map((id) => ({ id, username: id, email: `${id}@example.invalid`, password: 'unused' })) });
    await db.$executeRaw`INSERT INTO threads(id, owner_id, title, published, published_at, updated_at, visibility)
      SELECT 'thread-' || g, CASE WHEN g % 20 = 0 THEN 'blocked' ELSE 'owner' END, '测试文游 ' || g, true, now(), now(),
        CASE WHEN g % 10 = 0 THEN 'PRIVATE'::"ThreadVisibility" ELSE 'PUBLIC'::"ThreadVisibility" END FROM generate_series(1, 1000) g`;
    await db.$executeRaw`INSERT INTO subthreads(id, thread_id, title)
      SELECT 'sub-' || g, 'thread-' || g, '子贴' FROM generate_series(1,1000) g`;
    await db.$executeRaw`INSERT INTO posts(id, thread_id, subthread_id, author_id, kind, floor_number, content, updated_at, deleted_at)
      SELECT 'post-' || g, 'thread-' || ((g - 1) / 100 + 1), 'sub-' || ((g - 1) / 100 + 1),
        CASE WHEN g % 17 = 0 THEN 'blocked' ELSE 'player' END,
        CASE WHEN g % 100 = 1 THEN 'BODY'::"PostKind" ELSE 'FLOOR'::"PostKind" END,
        CASE WHEN g % 100 = 1 THEN NULL ELSE g END,
        repeat('城门外的旅人沿着长街缓缓走来，风吹过树梢，故事中的人物继续交谈。', g % 12 + 1)
        || CASE WHEN g % 5 = 0 THEN '月光下的旅程' ELSE '静夜中的旅程' END
        || CASE WHEN g % 9973 = 0 THEN '琉璃鹭' ELSE '' END || md5(g::text), now(),
        CASE WHEN g % 31 = 0 THEN now() ELSE NULL END
      FROM generate_series(1, 100000) g`;
    await db.userBlock.create({ data: { blockerId: 'viewer', blockedId: 'blocked' } });
    await db.$executeRaw`ANALYZE posts`; await db.$executeRaw`ANALYZE threads`; await db.$executeRaw`ANALYZE subthreads`;
    let captured: Prisma.Sql | undefined;
    const instrumented = new Proxy(db, { get(target, property) {
      if (property === '$transaction') return (callback: any, options: any) => target.$transaction((tx) => callback(new Proxy(tx, {
        get(client, field) {
          if (field === '$queryRaw') return (query: Prisma.Sql) => { captured = query; return client.$queryRaw(query); };
          const value = Reflect.get(client, field); return typeof value === 'function' ? value.bind(client) : value;
        },
      })), options);
      const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    } });
    const search = new SearchService(instrumented as any, new ThreadAccessService(db as any));
    const cases = [
      { label: '常见二字/全站', q: '月光' }, { label: '常见三字/全站', q: '月光下' },
      { label: '稀有二字/全站', q: '琉璃' }, { label: '稀有三字/全站', q: '琉璃鹭' },
      { label: '常见二字/帖内', q: '月光', thread: 'thread-1' },
    ];
    const measurements = [];
    for (const item of cases) {
      const elapsed: number[] = [];
      let results = 0;
      for (let round = 0; round < 5; round++) {
        const started = performance.now();
        const page = item.thread
          ? await search.searchThreadPosts(item.thread, item.q, undefined, 20, 'viewer', true)
          : await search.searchPosts(item.q, undefined, 20, 'viewer', true);
        elapsed.push(performance.now() - started); results = page.items.length;
      }
      assert(captured);
      const explain = await db.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${captured}`);
      elapsed.sort((a, b) => a - b);
      measurements.push({ ...item, results, medianMs: Math.round(elapsed[2]), maxMs: Math.round(elapsed[4]), explain });
    }
    const stats = await db.$queryRaw`SELECT count(*)::int AS rows, round(avg(octet_length(content)))::int AS average_bytes,
      min(octet_length(content))::int AS minimum_bytes, max(octet_length(content))::int AS maximum_bytes FROM posts`;
    const report = { recordedAt: new Date().toISOString(), stats, measurements };
    writeFileSync('/tmp/wenyousite-search-benchmark.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ stats, measurements: measurements.map(({ explain, ...result }) => result) }, null, 2));
  } finally {
    await db.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP DATABASE "${database}"`);
    await admin.$disconnect();
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
