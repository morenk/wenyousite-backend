import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { verifyIsolatedEnvironment } from './e2e-guard';

// 只解析本仓库这两份固定迁移；DO 块整体发送，外层事务由测试控制。
function statements(sql: string): string[] {
  const blocks: string[] = [];
  const source = sql.replace(/DO \$\$[\s\S]*?\$\$;/g, (value) => {
    blocks.push(value.slice(0, -1));
    return `DO_BLOCK_${blocks.length - 1};`;
  });
  return source
    .split(';')
    .map((value) => value.replace(/^\s*--.*$/gm, '').trim())
    .filter((value) => value && !['BEGIN', 'COMMIT'].includes(value))
    .map((value) => (/^DO_BLOCK_\d+$/u.test(value) ? blocks[Number(value.slice(9))] : value));
}
const familyId = 'tff_' + 'a'.repeat(32),
  v1 = 'tfv_' + '1'.repeat(32),
  v2 = 'tfv_' + '2'.repeat(32),
  v3 = 'tfv_' + '3'.repeat(32);
const artifact = 'a'.repeat(64),
  secondArtifact = 'b'.repeat(64);

export async function verifyFontManagementMigration(db: PrismaClient) {
  await verifyIsolatedEnvironment();
  const before = readFileSync(
    join(__dirname, '../prisma/migrations/20261022100000_dynamic_text_fonts/migration.sql'),
    'utf8',
  ).replace(/^ALTER TYPE "Audit(?:Action|TargetType)".*;$/gm, '');
  const after = readFileSync(
    join(__dirname, '../prisma/migrations/20261024000000_admin_font_management/migration.sql'),
    'utf8',
  );
  for (const proven of [true, false]) {
    const schema = 'font_migration_' + randomBytes(8).toString('hex');
    await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    const inSchema = <T>(body: (tx: Prisma.TransactionClient) => Promise<T>) =>
      db.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}", pg_catalog`);
          return body(tx);
        },
        { timeout: 30000 },
      );
    try {
      await inSchema(async (tx) => {
        for (const statement of statements(before)) await tx.$executeRawUnsafe(statement);
        await tx.$executeRawUnsafe(
          'CREATE TABLE audit_logs (id TEXT, action TEXT, target_type TEXT, target_id TEXT, metadata JSONB)',
        );
        for (const key of [artifact, secondArtifact])
          await tx.$executeRaw`
          INSERT INTO text_font_artifacts (build_key,source_sha256,toolchain,manifest,assets,manifest_sha,manifest_size,specimen_sha,specimen_size)
          VALUES (${key},${key},'{}','{}','[]',${key},1,${key},1)`;
        await tx.$executeRaw`INSERT INTO text_font_families (id,configuration,updated_at) VALUES (${familyId},'{}',now())`;
        await tx.$executeRaw`INSERT INTO text_font_versions (id,family_id,version_number,artifact_key,configuration,published_at,withdrawn_at)
          VALUES (${v1},${familyId},1,${artifact},'{"name":"旧版本一"}','2026-10-01','2026-10-04'),
                 (${v2},${familyId},2,${secondArtifact},'{"name":"旧版本二"}','2026-10-02',NULL)`;
        if (proven)
          await tx.$executeRaw`INSERT INTO audit_logs VALUES
          ('first','TEXT_FONT_PUBLISHED','TEXT_FONT',${v2},'{"revision":2}'),
          ('rollback','TEXT_FONT_PUBLISHED','TEXT_FONT',${v1},'{"revision":3}')`;
      });
      const migrate = () =>
        inSchema(async (tx) => {
          for (const statement of statements(after)) await tx.$executeRawUnsafe(statement);
        });
      if (!proven) {
        await assert.rejects(migrate, /FONT_LAST_PUBLISHED_UNPROVEN/);
        await inSchema(async (tx) => {
          const columns = await tx.$queryRaw<
            { count: bigint }[]
          >`SELECT count(*) FROM information_schema.columns WHERE table_schema=${schema} AND column_name='last_published_version_id'`;
          assert.equal(columns[0].count, 0n, '失败迁移整体回滚，不能留下半迁移状态');
          assert.equal(
            (await tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM text_font_versions`)[0]
              .count,
            2n,
          );
        });
      } else {
        await migrate();
        await inSchema(async (tx) => {
          const [family] = await tx.$queryRaw<
            { last_published_version_id: string; current_version_id: string | null }[]
          >`SELECT last_published_version_id,current_version_id FROM text_font_families`;
          assert.equal(family.last_published_version_id, v1);
          assert.equal(family.current_version_id, null);
          const versions = await tx.$queryRaw<
            { id: string; reuse_key: string | null; configuration: unknown; published_at: Date }[]
          >`SELECT id,reuse_key,configuration,published_at FROM text_font_versions ORDER BY version_number`;
          assert.equal(versions[0].reuse_key, null);
          assert.equal(versions[1].reuse_key, secondArtifact);
          assert.equal(versions[0].published_at.toISOString(), '2026-10-01T00:00:00.000Z');
          await tx.$executeRaw`INSERT INTO text_font_versions (id,family_id,version_number,artifact_key,reuse_key,configuration)
            VALUES (${v3},${familyId},3,${artifact},${artifact},'{"name":"新版本"}')`;
          const old = await tx.$queryRaw<
            { configuration: unknown; withdrawn_at: Date }[]
          >`SELECT configuration,withdrawn_at FROM text_font_versions WHERE id=${v1}`;
          assert.deepEqual(old[0].configuration, versions[0].configuration);
          assert(old[0].withdrawn_at);
          assert.equal(
            (
              await tx.$queryRaw<
                { count: bigint }[]
              >`SELECT count(*) FROM text_font_versions WHERE artifact_key=${artifact}`
            )[0].count,
            2n,
          );
        });
      }
    } finally {
      await verifyIsolatedEnvironment();
      await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    }
  }
  console.log(
    JSON.stringify({
      event: 'font-management-migration-passed',
      runId: process.env.E2E_RUN_ID,
      rollbackHistory: true,
      ambiguousHistoryRejected: true,
      artifactReuse: true,
    }),
  );
}
