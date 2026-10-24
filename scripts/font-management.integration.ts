import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { verifyIsolatedEnvironment } from './e2e-guard';
import { fontSha } from '../src/text-fonts/font-domain';

type Data = Record<string, any>;
type Request = (
  path: string,
  method?: string,
  body?: unknown,
  status?: number,
  headers?: Record<string, string>,
) => Promise<Data>;

export async function verifyFontManagement(
  db: PrismaClient,
  request: Request,
  root: string,
  actorId: string,
  userHeaders: Record<string, string>,
) {
  await verifyIsolatedEnvironment();
  const prefix = '管理隔离' + randomUUID().slice(0, 8);
  const submit = (name: string, language = 'other', extra: Data = {}) =>
    request(
      '/admin/text-fonts/submissions',
      'POST',
      { submissionId: randomUUID(), name, language, ...extra },
      201,
    );
  const upload = (submission: Data, bytes: Buffer) =>
    request(
      `/admin/text-fonts/${submission.familyId}/sources?format=ttf&expectedFamilyRevision=${submission.familyRevision}&submissionId=${submission.submissionId}`,
      'POST',
      bytes,
      201,
    );
  const requestProcessing = (submission: Data, requestId = randomUUID()) =>
    request(
      `/admin/text-fonts/submissions/${submission.submissionId}/process`,
      'POST',
      { requestId },
      201,
    );
  const wait = async (jobId: string) => {
    for (let n = 0; n < 180; n++) {
      const job = await request(`/admin/text-fonts/jobs/${jobId}`);
      if (['ready', 'failed'].includes(job.status)) return job;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error('简化处理未完成');
  };
  const publish = async (familyId: string, versionId: string) => {
    const family = await request(`/admin/text-fonts/${familyId}`);
    const catalog = await request('/meta/text-fonts/v2');
    return request(
      `/admin/text-fonts/${familyId}/publish`,
      'POST',
      {
        versionId,
        expectedFamilyRevision: family.revision,
        expectedCatalogRevision: catalog.revision,
      },
      201,
    );
  };
  const read = (name: string) => readFileSync(join(root, 'font-fixtures', name));
  const source = read('fixture-1.ttf');
  const input = { submissionId: randomUUID(), name: prefix + ' One' };
  await request('/admin/text-fonts/management', 'GET', undefined, 401, {});
  await request('/admin/text-fonts/submissions', 'POST', input, 403, userHeaders);
  const created = await Promise.all([
    request('/admin/text-fonts/submissions', 'POST', input, 201),
    request('/admin/text-fonts/submissions', 'POST', input, 201),
  ]);
  const first = created[0];
  assert.equal(first.language, 'other');
  assert.equal(created[1].familyId, first.familyId);
  assert.equal(
    (await request('/admin/text-fonts/submissions', 'POST', { ...input, name: 'changed' }, 409))
      .code,
    40930,
  );
  const uploaded = await Promise.all([upload(first, source), upload(first, source)]);
  assert.equal(uploaded[0].jobId, uploaded[1].jobId);
  assert.equal(uploaded[0].submissionId, first.submissionId);
  await request(`/admin/text-fonts/jobs/${uploaded[0].jobId}`, 'GET', undefined, 401, {});
  await request(
    `/admin/text-fonts/submissions/${first.submissionId}/process`,
    'POST',
    { requestId: randomUUID() },
    403,
    userHeaders,
  );
  assert.equal(
    (await request(`/admin/text-fonts/submissions/${first.submissionId}`)).job.jobId,
    uploaded[0].jobId,
  );
  assert.equal(await db.textFontBuildJob.count({ where: { familyId: first.familyId } }), 1);
  const wrongSource = await request(
    `/admin/text-fonts/${first.familyId}/sources?format=ttf&expectedFamilyRevision=${first.familyRevision}&submissionId=${first.submissionId}`,
    'POST',
    read('fixture-2.ttf'),
    409,
  );
  assert.equal(wrongSource.code, 40930);
  const intent = randomUUID();
  await Promise.all([
    requestProcessing(first, intent),
    requestProcessing(first, intent),
    requestProcessing(first),
  ]);
  const ready = await wait(uploaded[0].jobId);
  assert.equal(ready.status, 'ready');
  const original = await db.textFontVersion.findUniqueOrThrow({
    where: { id: ready.versionId },
    include: { artifact: true },
  });
  assert.equal(original.publishedAt, null, '简化成功不能自动发布');
  assert.equal((original.configuration as Data).author, '');
  assert.equal((original.configuration as Data).licenseText, '');
  assert.equal((original.uploadAuthorization as Data).actorId, actorId);
  assert.equal((original.uploadAuthorization as Data).sourceSha256, fontSha(source));
  const job = await db.textFontBuildJob.findUniqueOrThrow({ where: { id: ready.jobId } });
  assert.equal(job.attempt, 1);
  assert.equal(job.parametersVersion, 2);
  await request(`/admin/text-fonts/jobs/${ready.jobId}/process`, 'POST', undefined, 409);
  // 资产是二进制/JSON 原文，不通过 API 信封 helper 读取。
  const readNotice = async (versionId: string) => {
    const version = await db.textFontVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: { artifact: true },
    });
    const manifest = version.artifact.manifest as Data;
    const descriptor = manifest.notices[0];
    const registration = (await import('./e2e-guard')).assertIsolatedEnvironment();
    return JSON.parse(
      readFileSync(
        join(
          registration.fontObjectStore!.directory,
          registration.fontObjectStore!.bucket,
          'text-fonts/v2/assets',
          descriptor.sha256 + '.json',
        ),
        'utf8',
      ),
    );
  };
  const emptyNotice = await readNotice(ready.versionId);
  assert.deepEqual(emptyNotice.originalMetadata.records, []);
  for (const key of ['actorId', 'confirmedAt', 'requestId', 'ip', 'uploadAuthorization'])
    assert(!JSON.stringify(emptyNotice).includes(key));
  await publish(first.familyId, ready.versionId);
  const oldConfiguration = original.configuration;
  let family = await request(`/admin/text-fonts/${first.familyId}`);
  const renamed = await submit(prefix + ' Renamed', 'other', {
    familyId: first.familyId,
    expectedFamilyRevision: family.revision,
  });
  assert.equal(renamed.sortOrder, first.sortOrder);
  assert.equal(
    (await request('/admin/text-fonts/submissions', 'POST', input, 201)).familyId,
    first.familyId,
    '创建重放先于旧修订检查',
  );
  const detail = await request(`/admin/text-fonts/${first.familyId}`);
  assert.equal(
    detail.jobs.find((item: Data) => item.jobId === uploaded[0].jobId).submissionId,
    first.submissionId,
  );
  assert.equal(
    (await request(`/admin/text-fonts/jobs/${uploaded[0].jobId}`)).submissionId,
    first.submissionId,
  );
  const renamedJob = await upload(renamed, source);
  await requestProcessing(renamed);
  const renamedReady = await wait(renamedJob.jobId);
  assert.equal(renamedReady.status, 'ready');
  assert.notEqual(renamedReady.versionId, ready.versionId);
  const renamedVersion = await db.textFontVersion.findUniqueOrThrow({
    where: { id: renamedReady.versionId },
  });
  assert.equal(renamedVersion.artifactKey, original.artifactKey);
  assert.equal((renamedVersion.configuration as Data).name, renamed.name);
  assert.deepEqual(
    (await db.textFontVersion.findUniqueOrThrow({ where: { id: ready.versionId } })).configuration,
    oldConfiguration,
  );
  await publish(first.familyId, renamedReady.versionId);
  await publish(first.familyId, ready.versionId);
  const head = await request('/meta/text-fonts/v2');
  await request(
    `/admin/text-fonts/versions/${ready.versionId}/withdraw`,
    'POST',
    { expectedCatalogRevision: head.revision, reason: '隔离回滚后撤回' },
    201,
  );
  const withdrawn = (
    await request(`/admin/text-fonts/management?q=${encodeURIComponent(prefix)}`)
  ).items.find((item: Data) => item.familyId === first.familyId);
  assert.equal(withdrawn.status, 'withdrawn');
  assert.equal(withdrawn.lastPublishedVersionId, ready.versionId);
  assert.equal(withdrawn.currentVersionId, null);
  family = await request(`/admin/text-fonts/${first.familyId}`);
  const resubmitted = await submit(input.name, 'other', {
    familyId: first.familyId,
    expectedFamilyRevision: family.revision,
  });
  const rejob = await upload(resubmitted, source);
  await requestProcessing(resubmitted);
  const reReady = await wait(rejob.jobId);
  assert.equal(reReady.status, 'ready');
  assert.notEqual(reReady.versionId, ready.versionId);
  assert.equal(
    (await db.textFontVersion.findUniqueOrThrow({ where: { id: reReady.versionId } })).artifactKey,
    original.artifactKey,
  );
  assert(
    (await db.textFontVersion.findUniqueOrThrow({ where: { id: ready.versionId } })).withdrawnAt,
  );
  await publish(first.familyId, reReady.versionId);

  for (const [file, reason] of [
    ['fixture-restricted.ttf', 'embedding-restricted'],
    ['fixture-no-subsetting.ttf', 'subsetting-restricted'],
    ['fixture-bitmap-only.ttf', 'bitmap-only'],
    ['fixture-combined-restrictions.ttf', 'embedding-restricted'],
  ]) {
    const submission = await submit(prefix + ' ' + reason);
    const uploadJob = await upload(submission, read(file));
    const requestId = randomUUID();
    await requestProcessing(submission, requestId);
    const failed = await wait(uploadJob.jobId);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.failureCode, 'rights-required');
    assert.equal(failed.failureReason, reason);
    const attempts = (await db.textFontBuildJob.findUniqueOrThrow({ where: { id: failed.jobId } }))
      .attempt;
    await requestProcessing(submission, requestId);
    assert.equal(
      (await db.textFontBuildJob.findUniqueOrThrow({ where: { id: failed.jobId } })).attempt,
      attempts,
    );
    await requestProcessing(submission);
    await wait(failed.jobId);
    assert.equal(
      (await db.textFontBuildJob.findUniqueOrThrow({ where: { id: failed.jobId } })).attempt,
      attempts + 1,
    );
    assert.equal(await db.textFontBuildJob.count({ where: { familyId: submission.familyId } }), 1);
  }
  for (const [file, expectedRecords] of [
    ['fixture-multiline-license.ttf', 2],
    ['fixture-malformed-license.ttf', 0],
  ] as const) {
    const submission = await submit(prefix + ' ' + file);
    const uploadedJob = await upload(submission, read(file));
    await requestProcessing(submission);
    const result = await wait(uploadedJob.jobId);
    assert.equal(result.status, 'ready');
    const notice = await readNotice(result.versionId);
    assert.equal(notice.originalMetadata.records.length, expectedRecords);
    if (expectedRecords)
      assert.equal(
        notice.originalMetadata.records.find((record: Data) => record.nameId === 13).text,
        'Copyright Example\r\nPermission to redistribute.\n\tKeep this notice.',
      );
    else assert.equal(notice.originalMetadata.omittedRecords, 1);
  }
  for (const [label, kept, omitted] of [
    ['oversize-license', 0, 1],
    ['many-license', 64, 236],
    ['total-license', 8, 12],
    ['control-license', 0, 1],
  ] as const) {
    const bounded = await submit(prefix + label);
    const boundedJob = await upload(bounded, read('fixture-' + label + '.ttf'));
    await requestProcessing(bounded);
    const result = await wait(boundedJob.jobId);
    assert.equal(result.status, 'ready');
    const notice = await readNotice(result.versionId);
    assert.equal(notice.originalMetadata.records.length, kept);
    assert.equal(notice.originalMetadata.omittedRecords, omitted);
  }
  const corrupt = await submit(prefix + ' corrupt');
  const corruptJob = await upload(corrupt, Buffer.from([0, 1, 0, 0, 1]));
  await requestProcessing(corrupt);
  assert.equal((await wait(corruptJob.jobId)).failureCode, 'invalid-font');
  const pagePrefix = prefix + ' page';
  for (let i = 0; i < 26; i++)
    await submit(pagePrefix + String(i).padStart(2, '0'), i % 2 ? 'ja' : 'en');
  const firstPage = await request(
    `/admin/text-fonts/management?q=${encodeURIComponent(pagePrefix)}`,
  );
  assert.equal(firstPage.total, 26);
  assert.equal(firstPage.items.length, 20);
  assert(firstPage.nextCursor);
  const secondPage = await request(
    `/admin/text-fonts/management?q=${encodeURIComponent(pagePrefix)}&cursor=${firstPage.nextCursor}`,
  );
  assert.equal(secondPage.items.length, 6);
  assert.equal(secondPage.nextCursor, null);
  assert.equal(
    new Set([...firstPage.items, ...secondPage.items].map((item) => item.familyId)).size,
    26,
  );
  assert.equal(
    (await request(`/admin/text-fonts/management?q=${encodeURIComponent(pagePrefix)}&language=en`))
      .total,
    13,
  );
  assert.equal(
    (
      await request(
        `/admin/text-fonts/management?q=${encodeURIComponent(pagePrefix)}&language=en&cursor=${firstPage.nextCursor}`,
        'GET',
        undefined,
        409,
      )
    ).code,
    40931,
  );
  await submit(pagePrefix + '%_');
  assert.equal(
    (await request(`/admin/text-fonts/management?q=${encodeURIComponent('%_')}`)).total,
    1,
  );
  assert.equal(
    (
      await request(
        `/admin/text-fonts/management?q=${encodeURIComponent(pagePrefix)}&cursor=${firstPage.nextCursor}`,
        'GET',
        undefined,
        409,
      )
    ).code,
    40931,
  );

  const another = await submit(prefix + ' Second', 'other');
  const anotherJob = await upload(another, source);
  await requestProcessing(another);
  const anotherReady = await wait(anotherJob.jobId);
  await publish(another.familyId, anotherReady.versionId);
  for (const suffix of ['English A', 'English B']) {
    const en = await submit(prefix + suffix, 'en');
    const enJob = await upload(en, source);
    await requestProcessing(en);
    const enReady = await wait(enJob.jobId);
    await publish(en.familyId, enReady.versionId);
  }
  const savedDetails = await request(`/admin/text-fonts/${another.familyId}`);
  const custom = {
    name: savedDetails.name,
    designLanguage: savedDetails.designLanguage,
    sortOrder: savedDetails.sortOrder,
    author: 'Stored author',
    sourceUrl: 'https://example.invalid/font',
    licenseName: 'Stored license',
    licenseText: 'Stored permission',
    specimenText: 'Custom AB',
    rights: { redistribution: true, conversion: true, subsetting: true },
    expectedFamilyRevision: savedDetails.revision,
  };
  const customized = await request(`/admin/text-fonts/${another.familyId}`, 'PATCH', custom);
  const withDetails = await submit(prefix + ' Metadata preserved', 'ja', {
    familyId: another.familyId,
    expectedFamilyRevision: customized.revision,
  });
  const inherited = await db.textFontSubmission.findUniqueOrThrow({
    where: { id: withDetails.submissionId },
  });
  for (const key of ['author', 'sourceUrl', 'licenseName', 'licenseText', 'rights', 'specimenText'])
    assert.deepEqual((inherited.configuration as Data)[key], (custom as Data)[key]);
  const versionsBefore = await db.textFontVersion.findMany({ orderBy: { id: 'asc' } });
  const postsBefore = await db.post.findMany({
    select: { id: true, content: true },
    orderBy: { id: 'asc' },
  });
  const orderSnapshot = async () => {
    const catalog = await request('/meta/text-fonts/v2');
    const all: Data[] = [];
    let cursor: string | null = null;
    let revision = 0;
    do {
      const page: Data = await request(
        '/admin/text-fonts/management?status=enabled&sort=sortOrder&direction=asc' +
          (cursor ? '&cursor=' + cursor : ''),
      );
      all.push(...page.items);
      cursor = page.nextCursor;
      revision = page.listingRevision;
    } while (cursor);
    return {
      expectedCatalogRevision: catalog.revision,
      listingRevision: revision,
      groups: ['other', 'en'].map((language) => ({
        language,
        items: all
          .filter((item) => item.language === language)
          .map((item) => ({ familyId: item.familyId, expectedFamilyRevision: item.revision })),
      })),
    };
  };
  const snapshot = await orderSnapshot();
  const unchanged = await request('/admin/text-fonts/order', 'PUT', {
    expectedCatalogRevision: snapshot.expectedCatalogRevision,
    groups: snapshot.groups,
  });
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.listingRevision, snapshot.listingRevision);
  const groups = structuredClone(snapshot.groups);
  groups[0].items.reverse();
  groups[1].items.reverse();
  const malformed = structuredClone(groups);
  malformed[0].items.pop();
  await request(
    '/admin/text-fonts/order',
    'PUT',
    { expectedCatalogRevision: snapshot.expectedCatalogRevision, groups: malformed },
    409,
  );
  assert.equal((await request('/meta/text-fonts/v2')).revision, snapshot.expectedCatalogRevision);
  const duplicate = structuredClone(groups);
  duplicate[0].items[1] = duplicate[0].items[0];
  await request(
    '/admin/text-fonts/order',
    'PUT',
    { expectedCatalogRevision: snapshot.expectedCatalogRevision, groups: duplicate },
    409,
  );
  for (const kind of ['stale-family', 'duplicate-language', 'cross-language', 'nonselectable']) {
    const invalid = structuredClone(groups);
    if (kind === 'stale-family') invalid[0].items[0].expectedFamilyRevision--;
    if (kind === 'duplicate-language') invalid[1].language = invalid[0].language;
    if (kind === 'cross-language')
      [invalid[0].items[0], invalid[1].items[0]] = [invalid[1].items[0], invalid[0].items[0]];
    if (kind === 'nonselectable')
      invalid[0].items[0] = {
        familyId: firstPage.items[0].familyId,
        expectedFamilyRevision: firstPage.items[0].revision,
      };
    await request(
      '/admin/text-fonts/order',
      'PUT',
      { expectedCatalogRevision: snapshot.expectedCatalogRevision, groups: invalid },
      409,
    );
  }
  const saved = await request('/admin/text-fonts/order', 'PUT', {
    expectedCatalogRevision: snapshot.expectedCatalogRevision,
    groups,
  });
  assert.equal(saved.changed, true);
  assert.equal(saved.catalogRevision, snapshot.expectedCatalogRevision + 1);
  assert.equal(saved.listingRevision, snapshot.listingRevision + 1);
  await request(
    '/admin/text-fonts/order',
    'PUT',
    { expectedCatalogRevision: snapshot.expectedCatalogRevision, groups },
    409,
  );
  const currentOrder = await orderSnapshot();
  const competing = {
    expectedCatalogRevision: currentOrder.expectedCatalogRevision,
    groups: currentOrder.groups.map((group) => ({ ...group, items: [...group.items].reverse() })),
  };
  const raced = await Promise.allSettled([
    request('/admin/text-fonts/order', 'PUT', competing),
    request('/admin/text-fonts/order', 'PUT', competing),
  ]);
  assert.equal(raced.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = raced.find((result) => result.status === 'rejected') as PromiseRejectedResult;
  assert.equal(rejected.reason.actual, 409);
  assert.equal(
    (await request('/meta/text-fonts/v2')).revision,
    currentOrder.expectedCatalogRevision + 1,
  );
  assert.deepEqual(await db.textFontVersion.findMany({ orderBy: { id: 'asc' } }), versionsBefore);
  assert.deepEqual(
    await db.post.findMany({ select: { id: true, content: true }, orderBy: { id: 'asc' } }),
    postsBefore,
  );
  // 合法旧上限仍须允许追加并经原配置接口编辑，不能生成越界的隐藏排序字段。
  const boundaryDraft = await submit(prefix + ' Boundary draft', 'en');
  const enPublished = (await orderSnapshot()).groups.find(
    (group) => group.language === 'en',
  )!.items;
  const boundaryIds = [...enPublished.map((item) => item.familyId), boundaryDraft.familyId];
  const configurationBody = (detail: Data) =>
    Object.fromEntries(
      [
        'name',
        'designLanguage',
        'sortOrder',
        'author',
        'sourceUrl',
        'licenseName',
        'licenseText',
        'specimenText',
        'rights',
      ].map((key) => [key, detail[key]]),
    );
  for (const [index, id] of boundaryIds.entries()) {
    const detail = await request(`/admin/text-fonts/${id}`);
    await request(`/admin/text-fonts/${id}`, 'PATCH', {
      ...configurationBody(detail),
      sortOrder: index === 0 ? -50 : 1000000,
      expectedFamilyRevision: detail.revision,
    });
    if (detail.currentVersionId) await publish(id, detail.currentVersionId);
  }
  const familiesBeforeBoundary = await db.textFontFamily.findMany({
    orderBy: { id: 'asc' },
    include: { lastPublishedVersion: true },
  });
  const groupBeforeBoundary = familiesBeforeBoundary
    .filter(
      (family) =>
        ((family.lastPublishedVersion?.configuration ?? family.configuration) as Data)
          .designLanguage === 'en',
    )
    .sort(
      (a, b) =>
        (a.configuration as Data).sortOrder - (b.configuration as Data).sortOrder ||
        a.id.localeCompare(b.id),
    );
  const catalogBeforeBoundary = await request('/meta/text-fonts/v2');
  const headBeforeBoundary = await db.textFontCatalogHead.findUniqueOrThrow({ where: { id: 1 } });
  const boundaryInput = {
    submissionId: randomUUID(),
    name: prefix + ' Appended at boundary',
    language: 'en',
  };
  const [appended, replayed] = await Promise.all([
    request('/admin/text-fonts/submissions', 'POST', boundaryInput, 201),
    request('/admin/text-fonts/submissions', 'POST', boundaryInput, 201),
  ]);
  assert.equal(appended.familyId, replayed.familyId);
  assert.equal(appended.sortOrder, groupBeforeBoundary.length);
  assert(appended.sortOrder <= 1000000);
  const familiesAfterBoundary = await db.textFontFamily.findMany({
    orderBy: { id: 'asc' },
    include: { lastPublishedVersion: true },
  });
  for (const before of familiesBeforeBoundary) {
    const after = familiesAfterBoundary.find((family) => family.id === before.id)!;
    const position = groupBeforeBoundary.findIndex((family) => family.id === before.id);
    if (position < 0) {
      assert.deepEqual(after, before);
      continue;
    }
    assert.deepEqual(after.configuration, {
      ...(before.configuration as Data),
      sortOrder: position,
    });
    assert.equal(
      after.revision,
      before.revision + ((before.configuration as Data).sortOrder === position ? 0 : 1),
    );
  }
  const headAfterBoundary = await db.textFontCatalogHead.findUniqueOrThrow({ where: { id: 1 } });
  assert.equal(headAfterBoundary.revision, headBeforeBoundary.revision + 1);
  assert.equal(headAfterBoundary.listingRevision, headBeforeBoundary.listingRevision + 1);
  const catalogAfterBoundary = await request('/meta/text-fonts/v2');
  const entries = (catalog: Data): Data[] => {
    assert.equal(catalog.nextCursor, null, '边界样本必须读取完整公开目录');
    return catalog.items;
  };
  assert.deepEqual(
    entries(catalogAfterBoundary)
      .filter((font: Data) => font.designLanguage === 'en')
      .map((font: Data) => font.familyId),
    entries(catalogBeforeBoundary)
      .filter((font: Data) => font.designLanguage === 'en')
      .map((font: Data) => font.familyId),
  );
  assert.deepEqual(
    entries(catalogAfterBoundary).filter((font: Data) => font.designLanguage !== 'en'),
    entries(catalogBeforeBoundary).filter((font: Data) => font.designLanguage !== 'en'),
  );
  const normalizedAudits = await db.auditLog.findMany({
    where: {
      action: 'TEXT_FONT_DRAFT_UPDATED',
      targetId: 'font-catalog',
      metadata: { path: ['operation'], equals: 'normalize-sort-order' },
    },
  });
  assert.equal(normalizedAudits.length, 1);
  assert.equal((normalizedAudits[0].metadata as Data).revision, headAfterBoundary.revision);
  assert.equal(
    (normalizedAudits[0].metadata as Data).familyCount,
    groupBeforeBoundary.filter(
      (family, index) => (family.configuration as Data).sortOrder !== index,
    ).length,
  );
  for (const entry of entries(catalogAfterBoundary).filter(
    (font) => font.designLanguage === 'en',
  )) {
    const family = familiesAfterBoundary.find((candidate) => candidate.id === entry.familyId)!;
    assert.equal(entry.sortOrder, (family.configuration as Data).sortOrder);
  }
  const editable = await request(`/admin/text-fonts/${appended.familyId}`);
  await request(`/admin/text-fonts/${appended.familyId}`, 'PATCH', {
    ...configurationBody(editable),
    expectedFamilyRevision: editable.revision,
  });
  assert.deepEqual(await db.textFontVersion.findMany({ orderBy: { id: 'asc' } }), versionsBefore);
  assert.deepEqual(
    await db.post.findMany({ select: { id: true, content: true }, orderBy: { id: 'asc' } }),
    postsBefore,
  );
  console.log(
    JSON.stringify({
      event: 'font-management-passed',
      runId: process.env.E2E_RUN_ID,
      pagination: 26,
      idempotency: true,
      metadata: true,
      atomicOrder: true,
    }),
  );
}
