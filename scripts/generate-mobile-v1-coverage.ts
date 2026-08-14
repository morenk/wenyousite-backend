import * as fs from 'node:fs';

type Operation = {
  operationId: string;
  method: string;
  path: string;
  tags: string[];
};

type Disposition = 'v1' | 'deferred' | 'not_applicable' | 'infrastructure';
type Status = 'implemented' | 'planned' | 'deferred' | 'not_applicable';

const outputPath = 'contracts/mobile-v1-operation-coverage.json';
const checkOnly = process.argv.includes('--check');
const document = JSON.parse(fs.readFileSync('contracts/openapi.json', 'utf8')) as Record<
  string,
  any
>;

const implementedEvidence: Record<string, { module: string; tests: string[] }> = {
  metaGetMeta: {
    module: 'app-shell',
    tests: ['test/mobile_update_test.dart', 'test/app_shell_test.dart'],
  },
  authRequestCode: {
    module: 'auth',
    tests: ['test/features/auth/auth_repository_test.dart'],
  },
  authVerifyAndComplete: {
    module: 'auth',
    tests: ['test/features/auth/auth_repository_test.dart'],
  },
  authLogin: {
    module: 'auth',
    tests: ['test/features/auth/auth_repository_test.dart'],
  },
  authRefresh: {
    module: 'auth',
    tests: [
      'test/core/network/session_controller_test.dart',
      'test/core/network/session_remote_test.dart',
    ],
  },
  authLogout: {
    module: 'auth',
    tests: [
      'test/features/auth/logout_controller_test.dart',
      'test/core/network/session_remote_test.dart',
    ],
  },
  threadsFindAll: {
    module: 'home',
    tests: [
      'test/features/home/home_repository_test.dart',
      'test/features/home/home_feed_controller_test.dart',
    ],
  },
  threadCategoriesList: {
    module: 'home',
    tests: [
      'test/features/home/home_repository_test.dart',
      'test/features/home/home_feed_controller_test.dart',
    ],
  },
};

const adminTags = new Set([
  'Admin Reports',
  'Admin Auth',
  'Admin Accounts',
  'Admin Cases',
  'Admin Appeals',
  'Admin Operations',
  'Admin Campaigns',
  'Admin',
  'Admin Moderation',
  'Admin Dashboard',
  'Admin Taxonomy',
]);

const deferredTags = new Set([
  'Mobile Devices',
  'Stickers',
  'Moments',
  'Direct Messages',
  'Wallet',
  'Reports',
  'Moderation Appeals',
]);

const deferredOperations = new Set([
  'bookmarksFindFolders',
  'bookmarksCreateFolder',
  'bookmarksMove',
  'searchSearchMoments',
  'tagsSearch',
  'tagsCreate',
  'tagsGetById',
  'threadTagsAdd',
  'threadTagsRemove',
]);

function moduleFor(operation: Operation, disposition: Disposition): string {
  if (disposition === 'infrastructure') return 'infrastructure';
  if (disposition === 'not_applicable') return 'admin';
  const id = operation.operationId;
  if (id.startsWith('auth')) return 'auth';
  if (id.startsWith('notifications')) return 'notifications';
  if (id.startsWith('users')) return 'users';
  if (id.startsWith('bookmarks')) return 'social';
  if (id.startsWith('subscriptions')) return 'social';
  if (id.startsWith('threads') || id.startsWith('threadMembers') || id.startsWith('threadTags')) {
    return 'threads';
  }
  if (id.startsWith('subthreads')) return 'threads';
  if (id.startsWith('posts')) return 'posts';
  if (id.startsWith('drafts')) return 'drafts';
  if (id.startsWith('media')) return 'media';
  if (id.startsWith('search') || id.startsWith('threadSearch')) return 'search';
  if (id === 'threadCategoriesList') return 'home';
  if (id === 'metaGetMeta') return 'app-shell';
  if (id.startsWith('tags')) return 'editor';
  if (id.startsWith('mobileDevice')) return 'notifications';
  if (id.startsWith('stickers')) return 'editor';
  if (id.startsWith('moments')) return 'moments';
  if (id.startsWith('userMoments')) return 'moments';
  if (id.startsWith('direct')) return 'direct-messages';
  if (id.startsWith('economy')) return 'economy';
  if (id.startsWith('reports') || id.startsWith('userModeration')) return 'moderation';
  if (id.startsWith('clientContentModeration')) return 'moderation';
  throw new Error(`无法为 ${id} 选择移动端模块`);
}

function dispositionFor(operation: Operation): Disposition {
  const primaryTag = operation.tags[0] ?? '';
  if (operation.operationId === 'healthCheck') return 'infrastructure';
  if (adminTags.has(primaryTag)) return 'not_applicable';
  if (deferredTags.has(primaryTag) || deferredOperations.has(operation.operationId)) {
    return 'deferred';
  }
  return 'v1';
}

const methods = new Set(['get', 'put', 'post', 'delete', 'patch', 'options', 'head']);
const operations: Operation[] = [];
for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
  for (const [method, value] of Object.entries(pathItem as Record<string, any>)) {
    if (!methods.has(method) || typeof value?.operationId !== 'string') continue;
    operations.push({
      operationId: value.operationId,
      method: method.toUpperCase(),
      path,
      tags: Array.isArray(value.tags) ? value.tags : [],
    });
  }
}

const rows = operations.map((operation) => {
  const disposition = dispositionFor(operation);
  const evidence = implementedEvidence[operation.operationId];
  const status: Status = evidence
    ? 'implemented'
    : disposition === 'v1'
      ? 'planned'
      : disposition === 'deferred'
        ? 'deferred'
        : 'not_applicable';
  return {
    operationId: operation.operationId,
    method: operation.method,
    path: operation.path,
    module: evidence?.module ?? moduleFor(operation, disposition),
    disposition,
    status,
    ...(evidence ? { evidence: evidence.tests } : {}),
  };
});

const count = (disposition: Disposition) =>
  rows.filter((row) => row.disposition === disposition).length;
const payload = {
  schemaVersion: 1,
  contractVersion: document.info?.version,
  counts: {
    total: rows.length,
    v1: count('v1'),
    deferred: count('deferred'),
    notApplicable: count('not_applicable'),
    infrastructure: count('infrastructure'),
  },
  operations: rows,
};
const serialized = `${JSON.stringify(payload, null, 2)}\n`;

if (checkOnly) {
  if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, 'utf8') !== serialized) {
    throw new Error(`${outputPath} 已漂移；请运行 pnpm mobile:coverage:generate`);
  }
  console.log(
    `Mobile V1 coverage is current (${payload.counts.v1}/${payload.counts.deferred}/${payload.counts.notApplicable}/${payload.counts.infrastructure})`,
  );
} else {
  fs.writeFileSync(outputPath, serialized);
  console.log(`Generated ${outputPath} with ${rows.length} operations`);
}
