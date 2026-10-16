import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { auditAudioResources } from './audio-resource-audit';

test('审计先设只读且兼容未迁移schema；只输出聚合', async () => {
  const statements: string[] = [];
  const tx = {
    async $executeRaw(query: TemplateStringsArray) { statements.push(query.join('')); },
    async $queryRaw(query: TemplateStringsArray | { sql: string }) {
      const sql = 'sql' in query ? query.sql : query.join(''); statements.push(sql);
      if (sql.includes('SHOW')) return [{ transaction_read_only: 'on' }];
      if (sql.includes('information_schema')) return [{ count: 0n }];
      assert(!sql.includes('audio_upload_lease_until')); return [{ total: 0n }];
    },
  };
  const db = { $transaction: async (run: (arg: typeof tx) => Promise<unknown>) => run(tx) };
  const value = await auditAudioResources(db as unknown as PrismaClient, false);
  assert.equal(statements[0], 'SET TRANSACTION READ ONLY'); assert.equal(value.readOnly, true);
  assert.equal(value.budgetSchema, false); assert.deepEqual(value.summary, { total: '0' });
  assert.equal(value.recovery.lastSuccessfulRun, 'not-exposed');
});
