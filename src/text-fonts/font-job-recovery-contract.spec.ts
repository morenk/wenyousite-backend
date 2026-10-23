import { readFileSync } from 'node:fs';
import { join } from 'node:path';

it('共享 job 恢复契约允许旧任务为空，并使用历史任务准确绑定而非最新提交', () => {
  const document = JSON.parse(
    readFileSync(join(__dirname, '../../contracts/openapi.json'), 'utf8'),
  );
  const job = document.components.schemas.FontJobDto;
  expect(job.properties.submissionId).toMatchObject({
    type: 'string',
    format: 'uuid',
    nullable: true,
  });
  expect(job.required).not.toContain('submissionId');
  const fixtures = JSON.parse(
    readFileSync(join(__dirname, '../../contracts/admin-font-management-v1-fixtures.json'), 'utf8'),
  );
  expect(
    fixtures.jobRecoveryCases.find((row: { id: string }) => row.id === 'legacy-job').submissionId,
  ).toBeNull();
  const historical = fixtures.jobRecoveryCases.find(
    (row: { id: string }) => row.id === 'older-job-after-newer-submission',
  );
  expect(historical.expectedProcessSubmissionId).toBe(historical.submissionId);
  expect(historical.expectedProcessSubmissionId).not.toBe(historical.latestSubmissionId);
  expect(historical.expectedScanManagementList).toBe(false);
});
