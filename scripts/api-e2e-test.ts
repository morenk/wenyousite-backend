/**
 * API 端到端测试脚本 — 前端视角
 *
 * 用法: npx tsx scripts/api-e2e-test.ts
 *
 * 覆盖模块:
 *   Auth, Threads, Subthreads, Posts, Drafts,
 *   Notifications, Subscriptions, Bookmarks, Moments,
 *   Users, Tags, Search, 错误码
 */

import pc from 'picocolors';
import { z } from 'zod';
import { faker } from '@faker-js/faker';
import { PrismaClient } from '@prisma/client';
import { API_CONTRACT_VERSION } from '../src/common/swagger/openapi-document';
import { DraftsService } from '../src/drafts/drafts.service';
import { DiceService } from '../src/dice/dice.service';
import { StickerContentService } from '../src/stickers/sticker-content.service';
import { MediaReferenceService } from '../src/media/media-reference.service';
import { PrismaService } from '../src/prisma/prisma.service';

// ═══════════════════════════════════════════════════════════════
// 配置
// ═══════════════════════════════════════════════════════════════

const BASE = process.env.API_BASE || 'http://localhost:3000/api/v1';
const baseUrl = new URL(BASE);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

if (process.env.API_E2E_ENV !== 'test') {
  throw new Error('API_E2E_ENV 必须显式设为 test');
}
if (!LOOPBACK_HOSTS.has(baseUrl.hostname)) {
  throw new Error('API E2E 会写入并清理测试数据，只允许连接本机测试环境');
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('API E2E 缺少 DATABASE_URL');
const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
if (!/^wenyousite_e2e_[a-z0-9_]+$/.test(databaseName)) {
  throw new Error(`API E2E 只允许使用隔离数据库，当前数据库名为 ${databaseName}`);
}
const e2ePrisma = new PrismaClient({ datasourceUrl: databaseUrl });

const RUN_ID = Date.now().toString();
const TEST_EMAIL = `e2e-${RUN_ID}@wenyou.site`;
const SECOND_TEST_EMAIL = `e2e-drafts-peer-${RUN_ID}@wenyou.site`;
const TEST_PASSWORD = 'E2eTest123!';
const TEST_TAG_PREFIX = `e2e_${RUN_ID}_`;
const TEST_SOURCE_IP = `198.18.${Number(RUN_ID.slice(-5)) % 255}.${(Number(RUN_ID.slice(-3)) % 254) + 1}`;
const SECOND_TEST_SOURCE_IP = `198.19.${Number(RUN_ID.slice(-4)) % 255}.${(Number(RUN_ID.slice(-2)) % 254) + 1}`;
const TEST_USERNAME = faker.internet
  .username()
  .slice(0, 16)
  .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '');

// ═══════════════════════════════════════════════════════════════
// Zod Schemas（success-only，code 固定为 0）
// ═══════════════════════════════════════════════════════════════

const apiResponse = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ code: z.literal(0), message: z.string(), data });
const apiPaginated = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    code: z.literal(0),
    message: z.string(),
    data: z.array(data),
    meta: z.object({ cursor: z.string().nullable(), hasMore: z.boolean() }).optional(),
  });

const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  username: z.string(),
  avatar: z.string().nullable(),
  role: z.enum(['USER', 'ADMIN', 'SUPER_ADMIN']),
});

const authResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  user: userSchema,
});

const threadSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  ownerId: z.string(),
  category: z.string().nullable(),
  status: z.string(),
  visibility: z.string(),
  published: z.boolean(),
  pinned: z.boolean(),
  version: z.number(),
  deletedAt: z.string().nullable(),
});

// 首页列表使用精简卡片 DTO，不暴露详情/编辑所需的 ownerId 与 version。
const threadListSchema = threadSchema.omit({ ownerId: true, version: true });

const subthreadSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  title: z.string(),
  sortOrder: z.number(),
  postingPolicy: z.string(),
  version: z.number(),
});

const postSchema = z.object({
  id: z.string(),
  subthreadId: z.string().optional(),
  authorId: z.string().optional(),
  content: z.string(),
  floorNumber: z.number().nullable().optional(),
  parentPostId: z.string().nullable().optional(),
  replyToPostId: z.string().nullable().optional(),
  version: z.number().optional(),
  deletedAt: z.string().nullable().optional(),
  createdAt: z.string().optional(),
});

const draftSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    slot: z.number().int().min(1).max(5),
    content: z.string(),
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

const draftStateSchema = z
  .object({
    drafts: z.array(draftSchema),
    usedSlots: z.number().int().min(0).max(5),
    maxSlots: z.literal(5),
    slots: z.array(z.number().int().min(1).max(5)),
  })
  .strict();

const apiErrorSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.null(),
});

// ═══════════════════════════════════════════════════════════════
// Reporter
// ═══════════════════════════════════════════════════════════════

interface TestCase {
  name: string;
  fn: () => Promise<void>;
  tag: string;
  abortOnFailure?: boolean;
}

const tests: TestCase[] = [];
let passed = 0,
  failed = 0;

function suite(name: string) {
  console.log(`\n${pc.bold(pc.cyan('── ' + name + ' ──'))}`);
  return name;
}

function test(
  tag: string,
  name: string,
  fn: () => Promise<void>,
  options: { abortOnFailure?: boolean } = {},
) {
  tests.push({ name, fn, tag, ...options });
}

async function run(): Promise<boolean> {
  console.log(pc.bold(pc.magenta('\n╔══════════════════════════════════════════╗')));
  console.log(pc.bold(pc.magenta('║   温油站 API E2E 测试 (前端视角)        ║')));
  console.log(pc.bold(pc.magenta('╚══════════════════════════════════════════╝')));
  console.log(pc.dim(`   目标: ${BASE}`));
  console.log(pc.dim(`   时间: ${new Date().toISOString()}`));

  for (const t of tests) {
    const label = `[${t.tag}] ${t.name}`;
    try {
      await t.fn();
      console.log(`  ${pc.green('✓')} ${label}`);
      passed++;
    } catch (e: unknown) {
      console.log(`  ${pc.red('✗')} ${label}`);
      console.log(pc.red(`      ${e instanceof Error ? e.message : String(e)}`));
      failed++;
      if (t.abortOnFailure) {
        console.log(pc.yellow('      前置用例失败，停止后续级联测试'));
        break;
      }
    }
  }

  console.log(pc.bold('\n──────────────────────────────────────────'));
  console.log(
    `  ${pc.green(`通过: ${passed}`)}  ${pc.red(`失败: ${failed}`)}  总计: ${passed + failed}`,
  );
  console.log(pc.bold('──────────────────────────────────────────\n'));
  return failed === 0;
}

// ═══════════════════════════════════════════════════════════════
// API Client（Fastify 兼容：无 body 时不设 Content-Type）
// ═══════════════════════════════════════════════════════════════

class Client {
  token = '';
  cookies = new Map<string, string>();

  constructor(private readonly sourceIp = TEST_SOURCE_IP) {}

  private async req<T>(
    method: string,
    path: string,
    body?: unknown,
    schema?: z.ZodType<T>,
  ): Promise<T> {
    const headers: Record<string, string> = {};
    headers['X-Forwarded-For'] = this.sourceIp;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const cookieHeader = Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    if (cookieHeader) headers['Cookie'] = cookieHeader;

    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });

    for (const [key, val] of res.headers.entries()) {
      if (key.toLowerCase() === 'set-cookie') {
        const [nameVal] = val.split(';');
        const [name, ...valueParts] = nameVal.split('=');
        this.cookies.set(name.trim(), valueParts.join('='));
      }
    }

    const json = await res.json();
    if (schema) {
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        throw new Error(
          `Schema 不匹配 ${method} ${path}: ${issues} — keys: ${Object.keys(json.data || json).join(
            ', ',
          )}`,
        );
      }
      return parsed.data;
    }
    return json as T;
  }

  get<T>(path: string, schema?: z.ZodType<T>) {
    return this.req<T>('GET', path, undefined, schema);
  }
  post<T>(path: string, body?: unknown, schema?: z.ZodType<T>) {
    return this.req<T>('POST', path, body, schema);
  }
  patch<T>(path: string, body?: unknown, schema?: z.ZodType<T>) {
    return this.req<T>('PATCH', path, body, schema);
  }
  put<T>(path: string, body?: unknown, schema?: z.ZodType<T>) {
    return this.req<T>('PUT', path, body, schema);
  }
  del<T>(path: string, body?: unknown, schema?: z.ZodType<T>) {
    return this.req<T>('DELETE', path, body, schema);
  }

  async expectStatus(
    path: string,
    method: string,
    body?: unknown,
  ): Promise<{ status: number; json: unknown }> {
    const headers: Record<string, string> = {};
    headers['X-Forwarded-For'] = this.sourceIp;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const cookieHeader = Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    if (cookieHeader) headers['Cookie'] = cookieHeader;
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    return { status: res.status, json };
  }
}

const api = new Client();
const peerApi = new Client(SECOND_TEST_SOURCE_IP);
const guestApi = new Client(`198.20.${Number(RUN_ID.slice(-4)) % 255}.1`);

// ═══════════════════════════════════════════════════════════════
// 辅助
// ═══════════════════════════════════════════════════════════════

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`断言失败: ${message}`);
}

let threadId = '';
let subthreadId = '';
let activeCategorySlug = '';
let postId = '';
let draftId = '';
let draftVersion = 0;
let bookmarkId = '';
let currentUserId = '';
let momentId = '';
let momentCommentId = '';
const momentClientRequestId = crypto.randomUUID();
const momentCommentClientRequestId = crypto.randomUUID();
let momentFolderId = '';
let defaultBookmarkFolderId = '';
let subscriptionId = '';
let subscribableThreadId = '';
let tagId = '';
let peerUserId = '';
let privateCollaboratedThreadId = '';
let collaboratorOnlySubthreadId = '';
let playersOnlySubthreadId = '';
let collaboratorParentPostId = '';
let playersParentPostId = '';
let postingMatrixClientSequence = 0;
const useTestuserId = 'cms5zycb900017q0azar1nag2';

/** 从 email_verifications 表中读取最新验证码 */
async function fetchCodeFromDB(email: string): Promise<string | null> {
  const result = await e2ePrisma.emailVerification.findFirst({
    where: { email },
    orderBy: { createdAt: 'desc' },
    select: { token: true },
  });
  return result?.token ?? null;
}

async function registerTestClient(client: Client, email: string, username: string) {
  const requested = await client.post('/auth/register/request-code', { email });
  assert(requested.code === 0, `第二测试用户验证码请求失败: ${requested.code}`);
  const code = await fetchCodeFromDB(email);
  assert(!!code, '第二测试用户验证码不存在');
  const registered = await client.post(
    '/auth/register/verify-and-complete',
    { email, code, username, password: TEST_PASSWORD },
    apiResponse(authResponseSchema),
  );
  client.token = registered.data.accessToken;
  return registered.data.user.id;
}

async function waitForCondition<T>(
  read: () => Promise<T | null | undefined | false>,
  message: string,
  timeoutMs = 12_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`等待超时: ${message}`);
}

async function assertPostingMatrix(
  client: Client,
  label: string,
  expected: Record<'PARTICIPANTS' | 'COLLABORATORS' | 'PLAYERS', { status: number; code?: number }>,
) {
  postingMatrixClientSequence += 1;
  const requestClient = new Client(
    `198.21.${Math.floor(postingMatrixClientSequence / 250) + 1}.${(postingMatrixClientSequence % 250) + 1}`,
  );
  requestClient.token = client.token;
  requestClient.cookies = new Map(client.cookies);
  const targets = [
    { policy: 'PARTICIPANTS' as const, subthreadId, parentPostId: postId },
    {
      policy: 'COLLABORATORS' as const,
      subthreadId: collaboratorOnlySubthreadId,
      parentPostId: collaboratorParentPostId,
    },
    {
      policy: 'PLAYERS' as const,
      subthreadId: playersOnlySubthreadId,
      parentPostId: playersParentPostId,
    },
  ];
  for (const target of targets) {
    const expectation = expected[target.policy];
    for (const body of [
      { content: `${label}-${target.policy}-楼层`, clientRequestId: crypto.randomUUID() },
      {
        content: `${label}-${target.policy}-回复`,
        parentPostId: target.parentPostId,
        replyToPostId: target.parentPostId,
        clientRequestId: crypto.randomUUID(),
      },
    ]) {
      const result = await requestClient.expectStatus(
        `/subthreads/${target.subthreadId}/posts`,
        'POST',
        body,
      );
      assert(
        result.status === expectation.status,
        `${label}/${target.policy} 发言期望 ${expectation.status}，实际 ${result.status}`,
      );
      if (expectation.code !== undefined) {
        const error = apiErrorSchema.parse(result.json);
        assert(
          error.code === expectation.code,
          `${label}/${target.policy} 错误码应为 ${expectation.code}`,
        );
      }
    }
  }
}

async function cleanupUserByEmail(email: string) {
  const safeEmail = email.replaceAll("'", "''");
  await e2ePrisma.$executeRawUnsafe(
    `DO $cleanup$
       DECLARE test_user_id text;
       DECLARE test_wallet_id text;
       BEGIN
         SELECT id INTO test_user_id FROM users WHERE email='${safeEmail}';
         IF test_user_id IS NOT NULL THEN
           SELECT id INTO test_wallet_id FROM wallets WHERE user_id=test_user_id;
           DELETE FROM moments WHERE author_id=test_user_id;
           DELETE FROM threads WHERE owner_id=test_user_id;
           IF test_wallet_id IS NOT NULL THEN
             DELETE FROM daily_check_ins
               WHERE user_id=test_user_id OR wallet_id=test_wallet_id;
             DELETE FROM wallet_transactions
               WHERE sender_wallet_id=test_wallet_id
                  OR recipient_wallet_id=test_wallet_id
                  OR target_user_id=test_user_id;
             DELETE FROM wallets WHERE id=test_wallet_id;
           END IF;
           DELETE FROM users WHERE id=test_user_id;
         END IF;
         DELETE FROM email_verifications WHERE email='${safeEmail}';
       END
       $cleanup$;`,
  );
}

/** 无论用例成功或失败，都从本机数据库移除本次运行产生的数据。 */
async function cleanupTestData() {
  const safeTagPrefix = TEST_TAG_PREFIX.replaceAll("'", "''");
  await cleanupUserByEmail(TEST_EMAIL);
  await cleanupUserByEmail(SECOND_TEST_EMAIL);
  await e2ePrisma.$executeRawUnsafe(`DELETE FROM topic_tags WHERE name LIKE '${safeTagPrefix}%'`);
}

// ═══════════════════════════════════════════════════════════════
// 1. 健康检查 & 公开端点
// ═══════════════════════════════════════════════════════════════

const s1 = suite('健康检查 & 公开端点');

test(s1, 'GET /health 返回 ok', async () => {
  const r = await api.get('/health', apiResponse(z.any()));
  assert(r.data.status === 'ok', 'status 应为 ok');
  assert(r.data.info.database.status === 'up', '数据库应为 up');
});

test(s1, 'GET /meta 客户端协议元数据', async () => {
  const r = await api.get('/meta');
  assert(r.code === 0, 'meta 应成功');
  assert(r.data.contractVersion === API_CONTRACT_VERSION, `契约应为 ${API_CONTRACT_VERSION}`);
  assert(r.data.markdownContractVersion === 3, 'Markdown 协议应为 v3');
  for (const platform of ['android', 'ios']) {
    const policy = r.data.mobileCompatibility?.[platform];
    assert(!!policy, `${platform} 应返回移动兼容策略`);
    assert(
      policy.minimumSupportedBuild === null || Number.isInteger(policy.minimumSupportedBuild),
      `${platform} 最低构建号应为整数或 null`,
    );
    assert(
      policy.recommendedBuild === null || Number.isInteger(policy.recommendedBuild),
      `${platform} 推荐构建号应为整数或 null`,
    );
    assert(
      policy.updateUrl === null || typeof policy.updateUrl === 'string',
      `${platform} 更新地址应为字符串或 null`,
    );
  }
});

test(s1, 'GET /thread-categories 返回动态分类配置', async () => {
  const r = await api.get('/thread-categories');
  assert(r.code === 0 && Array.isArray(r.data), '分类列表应成功');
  activeCategorySlug = r.data[0]?.slug ?? '';
  assert(!!activeCategorySlug, '测试环境应至少有一个启用分类');
  assert(
    r.data.every((item: { isActive?: boolean }) => item.isActive === true),
    '只返回启用分类',
  );
});

test(s1, 'GET /threads 公开列表（分页）', async () => {
  const r = await api.get('/threads?sort=newest&limit=3', apiPaginated(threadListSchema));
  assert(Array.isArray(r.data), 'data 应为数组');
  assert(typeof r.meta.hasMore === 'boolean', 'meta 应含 hasMore');
  subscribableThreadId = r.data[0]?.id ?? '';
  assert(!!subscribableThreadId, '测试环境应至少有一个可订阅的公开帖');
});

test(s1, 'GET /search 全文搜索', async () => {
  const r = await api.get('/search?q=test');
  assert(r.code === 0, '搜索应成功');
  assert(Array.isArray(r.data.threads) || Array.isArray(r.data.posts), '应返回搜索结果');
});

test(s1, 'GET /users/:id 公开资料', async () => {
  const r = await api.get(`/users/${useTestuserId}`, apiResponse(z.any()));
  assert(r.data.username === 'testuser', '用户名应为 testuser');
});

test(s1, 'GET /users/:id (不存在) → 404', async () => {
  const { status } = await api.expectStatus('/users/nonexistent-12345', 'GET');
  assert(status === 404, `期望 404, 实际 ${status}`);
});

// ═══════════════════════════════════════════════════════════════
// 2. 认证流程
// ═══════════════════════════════════════════════════════════════

const s2 = suite('认证流程');

test(
  s2,
  'POST /auth/register/request-code 请求验证码',
  async () => {
    const r = await api.post('/auth/register/request-code', {
      email: TEST_EMAIL,
    });
    assert(r.code === 0, `请求验证码应成功 (got: ${r.code})`);
  },
  { abortOnFailure: true },
);

test(
  s2,
  'POST /auth/register/verify-and-complete 注册',
  async () => {
    await new Promise((r) => setTimeout(r, 300));
    const code = await fetchCodeFromDB(TEST_EMAIL);
    assert(!!code && code.length >= 6, `未找到验证码 (got: "${code}")`);
    const r = await api.post('/auth/register/verify-and-complete', {
      email: TEST_EMAIL,
      code,
      username: TEST_USERNAME,
      password: TEST_PASSWORD,
    });
    assert(r.code === 0, `注册应成功 (got: ${r.code} ${r.message})`);
    api.token = r.data.accessToken;
  },
  { abortOnFailure: true },
);

test(
  s2,
  'POST /auth/login 登录',
  async () => {
    // 用新用户登出再登入以测试纯登录
    await api.post('/auth/logout');
    const r = await api.post(
      '/auth/login',
      { account: TEST_EMAIL, password: TEST_PASSWORD },
      apiResponse(authResponseSchema),
    );
    assert(r.data.accessToken.length > 10, 'accessToken 应有效');
    assert(r.data.refreshToken === undefined, 'Web 登录响应体不应包含 refreshToken');
    api.token = r.data.accessToken;
  },
  { abortOnFailure: true },
);

test(s2, 'GET /users/me 当前用户信息', async () => {
  const r = await api.get('/users/me', apiResponse(userSchema));
  assert(r.data.email === TEST_EMAIL, '邮箱应匹配');
  currentUserId = r.data.id;
});

test(s2, 'POST /auth/refresh 刷新 token', async () => {
  const refreshToken = api.cookies.get('refreshToken');
  assert(!!refreshToken, 'cookie 中应有 refreshToken');
  const r = await api.post('/auth/refresh', { refreshToken }, apiResponse(authResponseSchema));
  assert(r.data.accessToken.length > 10, '新 accessToken 应有效');
  assert(r.data.refreshToken === undefined, 'Web 刷新响应体不应包含 refreshToken');
  api.token = r.data.accessToken;
});

test(s2, 'POST /auth/login 错误密码 → 401', async () => {
  const { status } = await api.expectStatus('/auth/login', 'POST', {
    account: TEST_EMAIL,
    password: 'WrongPass1!',
  });
  assert(status === 401, `期望 401, 实际 ${status}`);
});

test(s2, 'GET /users/me 未登录 → 401', async () => {
  const prev = api.token;
  api.token = '';
  const { status } = await api.expectStatus('/users/me', 'GET');
  api.token = prev;
  assert(status === 401, `期望 401, 实际 ${status}`);
});

// ═══════════════════════════════════════════════════════════════
// 3. 主题帖
// ═══════════════════════════════════════════════════════════════

const s3 = suite('主题帖');

test(s3, 'POST /threads 创建草稿帖', async () => {
  const clientRequestId = crypto.randomUUID();
  const title = `E2E 测试帖 ${Date.now()}`;
  const r = await api.post('/threads', {
    title,
    category: activeCategorySlug,
    visibility: 'PUBLIC',
    content: '帖子正文内容',
    clientRequestId,
  });
  assert(r.code === 0, `创建草稿应成功 (got: ${r.code} ${r.message})`);
  assert(
    r.data.subthreads.every(
      (item: { postingCapability?: { canPost: boolean; denialReason: string | null } }) =>
        item.postingCapability?.canPost === true && item.postingCapability.denialReason === null,
    ),
    '创建响应的全部子贴应包含楼主发言能力',
  );
  threadId = r.data.id;
  const replay = await api.post('/threads', {
    title,
    category: activeCategorySlug,
    visibility: 'PUBLIC',
    content: '帖子正文内容',
    clientRequestId,
  });
  assert(replay.data.id === threadId, '相同创建幂等键应返回原主题帖');
  assert(
    replay.data.subthreads.every(
      (item: { postingCapability?: { canPost: boolean } }) =>
        item.postingCapability?.canPost === true,
    ),
    '创建幂等重放响应也应包含发言能力',
  );
});

test(s3, 'GET /threads/draft 草稿箱（含新帖）', async () => {
  const r = await api.get('/threads/draft', apiResponse(z.any()));
  assert(r.code === 0, `草稿箱查询应成功 (got: ${r.code})`);
  assert(Array.isArray(r.data), 'data 应为数组');
});

test(s3, 'PATCH /threads/:id 发布默认子贴完整的草稿', async () => {
  const r = await api.patch(`/threads/${threadId}`, {
    published: true,
    version: 1,
  });
  assert(r.code === 0, `发布应成功 (got: ${r.code} ${r.message})`);
  assert(
    r.data.subthreads.every(
      (item: { postingCapability?: { canPost: boolean } }) =>
        item.postingCapability?.canPost === true,
    ),
    '更新响应的全部子贴应包含发言能力',
  );
});

test(s3, 'GET /threads/:id 获取已发布详情', async () => {
  const r = await api.get(`/threads/${threadId}`);
  assert(r.data.id === threadId, 'ID 应匹配');
  assert(r.data.published === true, '应为已发布');
  assert(
    r.data.subthreads.every(
      (item: { postingCapability?: { canPost: boolean } }) =>
        item.postingCapability?.canPost === true,
    ),
    '详情响应的全部子贴应包含发言能力',
  );
});

test(s3, 'PATCH /threads/:id 乐观锁冲突', async () => {
  const { status } = await api.expectStatus(`/threads/${threadId}`, 'PATCH', {
    version: 9999,
  });
  assert(status !== 200 && status !== 201, `应拒绝过期版本 (status: ${status})`);
});

test(s3, 'GET /threads 列表含新帖', async () => {
  const r = await api.get('/threads?sort=newest&limit=20', apiPaginated(threadListSchema));
  assert(
    r.data.some((t) => t.id === threadId),
    '列表应包含新创建的帖',
  );
});

test(s3, 'GET /threads filter=playing', async () => {
  const r = await api.get('/threads?filter=playing&limit=5');
  assert(r.code === 0, `filter=playing 应成功 (got: ${r.code})`);
});

test(s3, 'GET /threads 非法推荐游标 → 400', async () => {
  const { status } = await api.expectStatus('/threads?sort=recommended&cursor=oops', 'GET');
  assert(status === 400, `非法游标期望 400, 实际 ${status}`);
});

// ═══════════════════════════════════════════════════════════════
// 4. 子贴
// ═══════════════════════════════════════════════════════════════

const s4 = suite('子贴');

test(s4, 'GET /threads/:id/subthreads 子贴列表', async () => {
  const r = await api.get(`/threads/${threadId}/subthreads`, apiResponse(z.any()));
  assert(Array.isArray(r.data), 'data 应为数组');
  assert(r.data.length >= 1, '应至少有默认子贴');
  subthreadId = r.data[0].id;
});

test(s4, 'POST /threads/:id/subthreads 创建子贴', async () => {
  const r = await api.post(`/threads/${threadId}/subthreads`, {
    title: 'E2E 测试子贴',
    content: '子贴正文',
    sortOrder: 1,
    postingPolicy: 'PARTICIPANTS',
    clientRequestId: crypto.randomUUID(),
  });
  assert(r.code === 0, `创建子贴应成功 (got: ${r.code} ${r.message})`);
  subthreadId = r.data.id;
});

test(s4, 'GET /subthreads/:id 子贴详情', async () => {
  const r = await api.get(`/subthreads/${subthreadId}`, apiResponse(subthreadSchema));
  assert(r.data.id === subthreadId, 'ID 应匹配');
});

test(s4, 'PUT /threads/:id/subthreads/reorder 重排', async () => {
  const list = await api.get(
    `/threads/${threadId}/subthreads`,
    apiResponse(z.array(z.object({ id: z.string() }).passthrough())),
  );
  const ids = list.data.map((subthread) => subthread.id);
  if (ids.length >= 2) {
    const r = await api.put(`/threads/${threadId}/subthreads/reorder`, { ids });
    assert(r.code === 0, `重排应成功 (got: ${r.code} ${r.message})`);
  }
});

// ═══════════════════════════════════════════════════════════════
// 5. 帖子 & 楼层
// ═══════════════════════════════════════════════════════════════

const s5 = suite('帖子 & 楼层');

test(s5, 'GET /subthreads/:id/posts 楼层列表', async () => {
  const r = await api.get(`/subthreads/${subthreadId}/posts?limit=10`, apiPaginated(postSchema));
  assert(Array.isArray(r.data), 'data 应为数组');
});

test(s5, 'POST /subthreads/:id/posts 发帖', async () => {
  const r = await api.post(`/subthreads/${subthreadId}/posts`, {
    content: faker.lorem.sentence(),
    clientRequestId: crypto.randomUUID(),
  });
  assert(r.code === 0, `发帖应成功 (got: ${r.code} ${r.message})`);
  postId = r.data.id;
});

test(s5, 'GET /posts/:id 帖子详情', async () => {
  const r = await api.get(`/posts/${postId}`, apiResponse(postSchema));
  assert(r.data.id === postId, 'ID 应匹配');
});

test(s5, 'POST /subthreads/:id/posts 楼中楼回复', async () => {
  const r = await api.post(`/subthreads/${subthreadId}/posts`, {
    content: '楼中楼回复内容',
    parentPostId: postId,
    replyToPostId: postId,
    clientRequestId: crypto.randomUUID(),
  });
  assert(r.code === 0, `楼中楼应成功: ${r.code} ${r.message}`);
});

test(s5, 'GET /posts/:id/replies 楼中楼列表', async () => {
  const r = await api.get(`/posts/${postId}/replies?limit=10`, apiPaginated(postSchema));
  assert(Array.isArray(r.data), 'data 应为数组');
});

test(s5, 'PATCH /posts/:id 编辑帖子', async () => {
  const r = await api.patch(`/posts/${postId}`, {
    content: '编辑后的内容',
    version: 1,
  });
  assert(r.code === 0, `编辑应成功 (got: ${r.code} ${r.message})`);
});

test(s5, 'PATCH /posts/:id 乐观锁冲突', async () => {
  const { status } = await api.expectStatus(`/posts/${postId}`, 'PATCH', {
    content: '冲突',
    version: 9999,
  });
  assert(status !== 200, `应拒绝过期版本 (status: ${status})`);
});

test(s5, 'POST /threads/:id/like 点赞', async () => {
  const r = await api.post(`/threads/${threadId}/like`);
  assert(r.code === 0, `点赞应成功 (got: ${r.code} ${r.message})`);
});

test(s5, 'POST /threads/:id/like 重复点赞', async () => {
  const { status } = await api.expectStatus(`/threads/${threadId}/like`, 'POST');
  // API 可能返回 201（视为幂等成功）或 409（冲突）
  assert([201, 409].includes(status), `重复点赞期望 201/409, 实际 ${status}`);
});

test(s5, 'DELETE /threads/:id/like 取消点赞', async () => {
  const r = await api.del(`/threads/${threadId}/like`);
  assert(r.code === 0, `取消点赞应成功 (got: ${r.code} ${r.message})`);
});

// ═══════════════════════════════════════════════════════════════
// 6. 协作管理、发言能力与任免通知
// ═══════════════════════════════════════════════════════════════

const sCollaboration = suite('协作管理、发言能力与任免通知');

test(sCollaboration, '准备协作者、三种发言策略与私密协作主题', async () => {
  peerUserId = await registerTestClient(peerApi, SECOND_TEST_EMAIL, `e2epeer${RUN_ID.slice(-6)}`);
  const collaboratorSubthread = await api.post(`/threads/${threadId}/subthreads`, {
    title: '仅协作者',
    postingPolicy: 'COLLABORATORS',
    clientRequestId: crypto.randomUUID(),
  });
  collaboratorOnlySubthreadId = collaboratorSubthread.data.id;
  const playerSubthread = await api.post(`/threads/${threadId}/subthreads`, {
    title: '仅玩家',
    postingPolicy: 'PLAYERS',
    clientRequestId: crypto.randomUUID(),
  });
  playersOnlySubthreadId = playerSubthread.data.id;

  for (const targetId of [collaboratorOnlySubthreadId, playersOnlySubthreadId]) {
    const parent = await api.post(`/subthreads/${targetId}/posts`, {
      content: '发言矩阵父楼层',
      clientRequestId: crypto.randomUUID(),
    });
    if (targetId === collaboratorOnlySubthreadId) {
      collaboratorParentPostId = parent.data.id;
    } else {
      playersParentPostId = parent.data.id;
    }
  }

  const privateDraft = await api.post('/threads', {
    title: `私密协作主题 ${RUN_ID}`,
    category: activeCategorySlug,
    visibility: 'PRIVATE',
    content: '私密协作正文',
    clientRequestId: crypto.randomUUID(),
  });
  privateCollaboratedThreadId = privateDraft.data.id;
  await api.patch(`/threads/${privateCollaboratedThreadId}`, { published: true, version: 1 });
  await e2ePrisma.threadMember.create({
    data: {
      threadId: privateCollaboratedThreadId,
      userId: peerUserId,
      role: 'COLLABORATOR',
    },
  });
});

test(sCollaboration, '协作列表未登录 401，非法游标返回 40007', async () => {
  const unauthorized = await guestApi.expectStatus('/users/me/collaborated-threads', 'GET');
  assert(unauthorized.status === 401, `未登录协作列表期望 401，实际 ${unauthorized.status}`);
  const invalid = await peerApi.expectStatus(
    '/users/me/collaborated-threads?cursor=not-json',
    'GET',
  );
  const error = apiErrorSchema.parse(invalid.json);
  assert(invalid.status === 400 && error.code === 40007, '非法协作游标应返回 400/40007');
});

test(sCollaboration, '游客、楼主的详情能力与楼层/回复写入矩阵一致', async () => {
  const guestDetail = await guestApi.get(`/threads/${threadId}`);
  for (const item of guestDetail.data.subthreads) {
    assert(
      item.postingCapability?.denialReason === 'AUTHENTICATION_REQUIRED',
      '游客全部子贴应要求登录',
    );
  }
  await assertPostingMatrix(guestApi, '游客', {
    PARTICIPANTS: { status: 401 },
    COLLABORATORS: { status: 401 },
    PLAYERS: { status: 401 },
  });

  const ownerDetail = await api.get(`/threads/${threadId}`);
  for (const id of [subthreadId, collaboratorOnlySubthreadId, playersOnlySubthreadId]) {
    const item = ownerDetail.data.subthreads.find(
      (candidate: { id: string }) => candidate.id === id,
    );
    assert(item?.postingCapability?.canPost === true, '楼主三种策略均应允许');
    assert(item?.postingCapability?.denialReason === null, '允许发言时拒绝原因为 null');
  }
  await assertPostingMatrix(api, '楼主', {
    PARTICIPANTS: { status: 201 },
    COLLABORATORS: { status: 201 },
    PLAYERS: { status: 201 },
  });
});

test(sCollaboration, '普通参与者与玩家的详情能力和实际写入矩阵一致', async () => {
  const ordinaryDetail = await peerApi.get(`/threads/${threadId}`);
  const ordinaryReasons = new Map(
    ordinaryDetail.data.subthreads.map((item: { id: string; postingCapability: unknown }) => [
      item.id,
      item.postingCapability,
    ]),
  );
  assert(
    (ordinaryReasons.get(subthreadId) as { canPost: boolean }).canPost === true,
    '普通用户可在 PARTICIPANTS 发言',
  );
  assert(
    (ordinaryReasons.get(collaboratorOnlySubthreadId) as { denialReason: string }).denialReason ===
      'COLLABORATOR_REQUIRED',
    '普通用户应提示需要协作者',
  );
  assert(
    (ordinaryReasons.get(playersOnlySubthreadId) as { denialReason: string }).denialReason ===
      'PLAYER_REQUIRED',
    '普通用户应提示需要玩家',
  );
  await assertPostingMatrix(peerApi, '普通参与者', {
    PARTICIPANTS: { status: 201 },
    COLLABORATORS: { status: 403, code: 40302 },
    PLAYERS: { status: 403, code: 40303 },
  });

  await api.patch(`/threads/${threadId}/members/${peerUserId}`, { playerMarked: true });
  const playerDetail = await peerApi.get(`/threads/${threadId}`);
  const playerOnly = playerDetail.data.subthreads.find(
    (item: { id: string }) => item.id === playersOnlySubthreadId,
  );
  assert(playerOnly.postingCapability.canPost === true, '玩家可在 PLAYERS 发言');
  await assertPostingMatrix(peerApi, '玩家', {
    PARTICIPANTS: { status: 201 },
    COLLABORATORS: { status: 403, code: 40302 },
    PLAYERS: { status: 201 },
  });
});

test(
  sCollaboration,
  '并发相同任命只写一条事件，列表立即出现并稳定分页 PUBLIC/PRIVATE',
  async () => {
    const before = await peerApi.get('/users/me/collaborated-threads?limit=20');
    assert(
      before.data.some((item: { id: string }) => item.id === privateCollaboratedThreadId),
      '私密协作主题应返回',
    );
    assert(
      !before.data.some((item: { id: string }) => item.id === threadId),
      '普通参与主题不应进入协作列表',
    );

    const [left, right] = await Promise.all([
      api.expectStatus(`/threads/${threadId}/members/${peerUserId}`, 'PATCH', {
        role: 'COLLABORATOR',
      }),
      api.expectStatus(`/threads/${threadId}/members/${peerUserId}`, 'PATCH', {
        role: 'COLLABORATOR',
      }),
    ]);
    assert(left.status === 200 && right.status === 200, '并发相同任命应幂等成功');

    const roleEvents = await e2ePrisma.domainOutbox.findMany({
      where: { eventType: 'thread.collaborator-role.changed' },
    });
    const appointments = roleEvents.filter((row) => {
      const payload = row.payload as Record<string, unknown>;
      return (
        payload.threadId === threadId &&
        payload.targetUserId === peerUserId &&
        payload.newRole === 'COLLABORATOR'
      );
    });
    assert(appointments.length === 1, `并发任命应只有一条事件，实际 ${appointments.length}`);

    const sameTime = new Date('2026-08-23T23:00:00.000Z');
    await e2ePrisma.thread.updateMany({
      where: { id: { in: [threadId, privateCollaboratedThreadId] } },
      data: { updatedAt: sameTime },
    });
    const expectedIds = [threadId, privateCollaboratedThreadId].sort().reverse();
    const first = await peerApi.get('/users/me/collaborated-threads?limit=1');
    const second = await peerApi.get(
      `/users/me/collaborated-threads?limit=1&cursor=${encodeURIComponent(first.meta.cursor)}`,
    );
    assert(first.meta.hasMore === true, '协作列表首页应有下一页');
    assert(
      [first.data[0].id, second.data[0].id].join(',') === expectedIds.join(','),
      '相同更新时间应按 ID 倒序稳定分页且无重复遗漏',
    );
  },
);

test(sCollaboration, '协作者三种策略均可发言，任命通知 Outbox 重放不重复', async () => {
  const detail = await peerApi.get(`/threads/${threadId}`);
  for (const id of [subthreadId, collaboratorOnlySubthreadId, playersOnlySubthreadId]) {
    const item = detail.data.subthreads.find((candidate: { id: string }) => candidate.id === id);
    assert(item.postingCapability.canPost === true, '协作者三种策略均应允许');
  }
  await assertPostingMatrix(peerApi, '协作者', {
    PARTICIPANTS: { status: 201 },
    COLLABORATORS: { status: 201 },
    PLAYERS: { status: 201 },
  });

  const appointment = await waitForCondition(async () => {
    const rows = await e2ePrisma.domainOutbox.findMany({
      where: { eventType: 'thread.collaborator-role.changed' },
      orderBy: { createdAt: 'desc' },
    });
    return rows.find((row) => {
      const payload = row.payload as Record<string, unknown>;
      return (
        payload.threadId === threadId &&
        payload.targetUserId === peerUserId &&
        payload.newRole === 'COLLABORATOR'
      );
    });
  }, '协作者任命 Outbox');
  const notificationKey = `${appointment.eventKey}:${peerUserId}`;
  const notification = await waitForCondition(
    () =>
      e2ePrisma.notification.findFirst({
        where: { userId: peerUserId, eventKey: notificationKey },
      }),
    '协作者任命通知',
  );
  const payload = notification.payload as Record<string, unknown>;
  assert(notification.type === 'system', '任命通知类型应为 system');
  assert(
    notification.threadId === threadId && notification.fromUserId === currentUserId,
    '任命通知目标与操作者应正确',
  );
  assert(payload.action === 'thread_collaborator_added', '任命通知 action 应正确');
  assert(
    ['threadId', 'threadTitle', 'actorId', 'actorName', 'oldRole', 'newRole'].every(
      (key) => key in payload,
    ),
    '任命通知 payload 字段应完整',
  );

  const attempts = appointment.attempts;
  await e2ePrisma.domainOutbox.update({
    where: { id: appointment.id },
    data: { processedAt: null, availableAt: new Date(), lastError: null },
  });
  await waitForCondition(async () => {
    const replayed = await e2ePrisma.domainOutbox.findUnique({ where: { id: appointment.id } });
    return replayed && replayed.processedAt && replayed.attempts > attempts ? replayed : null;
  }, '任命 Outbox 重放完成');
  const count = await e2ePrisma.notification.count({
    where: { userId: peerUserId, eventKey: notificationKey },
  });
  assert(count === 1, `任命 Outbox 重放后通知应仍为一条，实际 ${count}`);
});

test(sCollaboration, '任一方向拉黑均保持主题可读，但三种策略楼层/回复全部拒绝', async () => {
  const assertBlockedRelation = async (label: string) => {
    const list = await peerApi.get('/users/me/collaborated-threads?limit=20');
    assert(
      list.data.some((item: { id: string }) => item.id === threadId),
      `${label}不应隐藏协作主题`,
    );
    const detail = await peerApi.get(`/threads/${threadId}`);
    for (const id of [subthreadId, collaboratorOnlySubthreadId, playersOnlySubthreadId]) {
      const item = detail.data.subthreads.find((candidate: { id: string }) => candidate.id === id);
      assert(
        item.postingCapability.denialReason === 'BLOCKED_RELATION',
        `${label}应优先投影 BLOCKED_RELATION`,
      );
    }
    await assertPostingMatrix(peerApi, label, {
      PARTICIPANTS: { status: 403 },
      COLLABORATORS: { status: 403 },
      PLAYERS: { status: 403 },
    });
  };

  await api.post(`/users/me/block/${peerUserId}`);
  await assertBlockedRelation('楼主拉黑协作者');
  await api.del(`/users/me/block/${peerUserId}`);

  await peerApi.post(`/users/me/block/${currentUserId}`);
  await assertBlockedRelation('协作者拉黑楼主');
  await peerApi.del(`/users/me/block/${currentUserId}`);
});

test(
  sCollaboration,
  '同角色和玩家标记重放不写事件，角色与标记同时撤销只写一次并立即移出列表',
  async () => {
    const countRoleEvents = () =>
      e2ePrisma.domainOutbox.count({ where: { eventType: 'thread.collaborator-role.changed' } });
    const before = await countRoleEvents();
    await api.patch(`/threads/${threadId}/members/${peerUserId}`, { role: 'COLLABORATOR' });
    await api.patch(`/threads/${threadId}/members/${peerUserId}`, { playerMarked: false });
    await api.patch(`/threads/${threadId}/members/${peerUserId}`, { playerMarked: true });
    assert((await countRoleEvents()) === before, '同角色和仅玩家标记变化不得写任免事件');

    await api.patch(`/threads/${threadId}/members/${peerUserId}`, {
      role: 'PARTICIPANT',
      playerMarked: false,
    });
    assert((await countRoleEvents()) === before + 1, '角色与玩家标记同时撤销只应写一条事件');
    const list = await peerApi.get('/users/me/collaborated-threads?limit=20');
    assert(
      !list.data.some((item: { id: string }) => item.id === threadId),
      '撤销后下一次协作列表应立即移除主题',
    );
    assert(
      list.data.some((item: { id: string }) => item.id === privateCollaboratedThreadId),
      '其他私密协作主题不受影响',
    );
    const removed = await waitForCondition(async () => {
      const rows = await e2ePrisma.notification.findMany({
        where: { userId: peerUserId, threadId, type: 'system' },
        orderBy: { createdAt: 'desc' },
      });
      return rows.find(
        (row) => (row.payload as Record<string, unknown>).action === 'thread_collaborator_removed',
      );
    }, '协作者撤销通知');
    assert(
      (removed.payload as Record<string, unknown>).action === 'thread_collaborator_removed',
      '撤销通知 action 应正确',
    );
    await waitForCondition(async () => {
      const pending = await e2ePrisma.domainOutbox.findMany({
        where: { eventType: 'post.created', processedAt: null },
        select: { payload: true },
      });
      const hasPendingCollaborationPost = pending.some(
        (row) => (row.payload as Record<string, unknown>).threadId === threadId,
      );
      return hasPendingCollaborationPost ? null : { settled: true };
    }, '协作发言 Outbox 全部确认');
  },
);

test(sCollaboration, '主题楼主互动、楼中楼订阅更新与直接回复按原因去重', async () => {
  const subscription = await peerApi.post('/subscriptions', {
    threadId,
    type: 'THREAD',
  });
  assert(subscription.code === 0, '普通用户应可订阅楼主更新');

  const ownerSelfReply = await api.post(`/subthreads/${subthreadId}/posts`, {
    content: `E2E 楼主楼中楼更新 ${RUN_ID}`,
    parentPostId: postId,
    replyToPostId: postId,
    clientRequestId: crypto.randomUUID(),
  });
  const subscribedNotification = await waitForCondition(
    () =>
      e2ePrisma.notification.findFirst({
        where: {
          userId: peerUserId,
          postId: ownerSelfReply.data.id,
          eventKey: `new-reply:${ownerSelfReply.data.id}:${peerUserId}`,
        },
      }),
    '楼主楼中楼订阅通知',
  );
  assert(subscribedNotification.type === 'new_post', '订阅更新类型应为 new_post');
  assert(
    (subscribedNotification.payload as Record<string, unknown>).action === 'new_reply',
    '订阅更新 action 应为 new_reply',
  );
  assert(
    (await e2ePrisma.notification.count({
      where: { userId: peerUserId, postId: ownerSelfReply.data.id },
    })) === 1,
    '楼主楼中楼更新应只产生一条订阅通知',
  );
  const subscriptionList = await peerApi.get('/notifications?type=new_post&limit=50');
  const subscriptionItem = subscriptionList.data.find(
    (item: { id: string }) => item.id === subscribedNotification.id,
  );
  assert(!!subscriptionItem, '订阅分类应包含楼中楼更新');
  assert(
    subscriptionItem.target?.postId === ownerSelfReply.data.id &&
      subscriptionItem.post?.parentPostId === postId,
    '订阅通知应精确指向新回复及其父楼层',
  );

  const peerFloor = await peerApi.post(`/subthreads/${subthreadId}/posts`, {
    content: `E2E 直接回复目标 ${RUN_ID}`,
    clientRequestId: crypto.randomUUID(),
  });
  const ownerThreadReply = await waitForCondition(
    () =>
      e2ePrisma.notification.findFirst({
        where: {
          userId: currentUserId,
          postId: peerFloor.data.id,
          eventKey: `reply:${peerFloor.data.id}:${currentUserId}`,
        },
      }),
    '新主楼层对主题楼主的互动通知',
  );
  const ownerThreadReplyPayload = ownerThreadReply.payload as Record<string, unknown>;
  assert(ownerThreadReply.type === 'reply', '他人主楼层对主题楼主应进入互动通知');
  assert(ownerThreadReplyPayload.action === 'reply', '主题楼主互动 action 应为 reply');
  assert(
    ownerThreadReplyPayload.replyTargetUserId === currentUserId,
    '主题楼主互动的回复目标应为楼主本人',
  );
  assert(
    (await e2ePrisma.notification.count({
      where: { userId: currentUserId, postId: peerFloor.data.id },
    })) === 1,
    '主题楼主对同一新主楼层应只收到一条互动通知',
  );
  const ownerInteractionList = await api.get('/notifications?type=reply&limit=50');
  const ownerInteractionItem = ownerInteractionList.data.find(
    (item: { id: string }) => item.id === ownerThreadReply.id,
  );
  assert(!!ownerInteractionItem, '互动分类应包含他人向本人主题发表的主楼层');
  assert(
    ownerInteractionItem.target?.postId === peerFloor.data.id &&
      ownerInteractionItem.post?.parentPostId === null,
    '主题楼主互动通知应精确指向新主楼层',
  );

  const directReply = await api.post(`/subthreads/${subthreadId}/posts`, {
    content: `E2E 直接回复且已订阅 ${RUN_ID}`,
    parentPostId: peerFloor.data.id,
    replyToPostId: peerFloor.data.id,
    clientRequestId: crypto.randomUUID(),
  });
  const directNotification = await waitForCondition(
    () =>
      e2ePrisma.notification.findFirst({
        where: {
          userId: peerUserId,
          postId: directReply.data.id,
          eventKey: `reply:${directReply.data.id}:${peerUserId}`,
        },
      }),
    '直接回复互动通知',
  );
  assert(directNotification.type === 'reply', '直接被回复时应进入互动通知');
  assert(
    (await e2ePrisma.notification.count({
      where: { userId: peerUserId, postId: directReply.data.id },
    })) === 1,
    '直接回复者与订阅者重叠时应按 reply 优先且仅一条',
  );

  await peerApi.del(`/subscriptions/${subscription.data.id}`);
});

// ═══════════════════════════════════════════════════════════════
// 7. 草稿池
// ═══════════════════════════════════════════════════════════════

const s6 = suite('草稿池');

test(s6, 'GET /drafts/state 未登录拒绝访问', async () => {
  const previous = api.token;
  api.token = '';
  const { status } = await api.expectStatus('/drafts/state', 'GET');
  api.token = previous;
  assert(status === 401, `期望 401, 实际 ${status}`);
});

test(s6, 'POST /drafts 并发重放同一幂等创建只产生一条草稿', async () => {
  const clientRequestId = crypto.randomUUID();
  const payload = { content: 'E2E 草稿内容', clientRequestId };
  const [first, replay] = await Promise.all([
    api.post('/drafts', payload, apiResponse(draftSchema)),
    api.post('/drafts', payload, apiResponse(draftSchema)),
  ]);
  assert(first.data.id === replay.data.id, '并发幂等重放应返回同一草稿 ID');
  const count = await e2ePrisma.draft.count({
    where: { userId: currentUserId, clientRequestId },
  });
  assert(count === 1, `幂等创建应只落一行，实际 ${count}`);
  draftId = first.data.id;
  draftVersion = first.data.version;
});

test(s6, 'POST /drafts 同一幂等键复用于不同载荷返回 40912', async () => {
  const stored = await e2ePrisma.draft.findUniqueOrThrow({ where: { id: draftId } });
  const { status, json } = await api.expectStatus('/drafts', 'POST', {
    content: '不同正文',
    clientRequestId: stored.clientRequestId,
  });
  const error = apiErrorSchema.parse(json);
  assert(status === 409, `期望 409, 实际 ${status}`);
  assert(error.code === 40912, `期望 40912, 实际 ${error.code}`);
});

test(s6, 'GET /drafts/state 返回严格且自洽的原子快照', async () => {
  const r = await api.get('/drafts/state', apiResponse(draftStateSchema));
  assert(r.data.drafts.length === 1, '应返回一条草稿');
  assert(r.data.usedSlots === r.data.drafts.length, '使用数应与列表一致');
  assert(
    r.data.slots.join(',') === r.data.drafts.map((draft) => draft.slot).join(','),
    '槽位应与列表一致',
  );
});

test(s6, 'POST /drafts 指定空槽位的并发幂等重放也只产生一条草稿', async () => {
  const clientRequestId = crypto.randomUUID();
  const payload = { content: '指定槽位幂等正文', slot: 2, clientRequestId };
  const [first, replay] = await Promise.all([
    api.post('/drafts', payload, apiResponse(draftSchema)),
    api.post('/drafts', payload, apiResponse(draftSchema)),
  ]);
  assert(first.data.id === replay.data.id, '指定槽位的并发重放应返回同一草稿 ID');
  const count = await e2ePrisma.draft.count({
    where: { userId: currentUserId, clientRequestId },
  });
  assert(count === 1, `指定槽位的幂等创建应只落一行，实际 ${count}`);
  await api.del(`/drafts/${first.data.id}?version=${first.data.version}`);
});

test(s6, 'PATCH /drafts/:id 相同旧版本并发写入只有一个成功', async () => {
  const [left, right] = await Promise.all([
    api.expectStatus(`/drafts/${draftId}`, 'PATCH', {
      content: '并发正文 A',
      version: draftVersion,
    }),
    api.expectStatus(`/drafts/${draftId}`, 'PATCH', {
      content: '并发正文 B',
      version: draftVersion,
    }),
  ]);
  const statuses = [left.status, right.status].sort((a, b) => a - b);
  assert(statuses[0] === 200 && statuses[1] === 409, `期望 200/409, 实际 ${statuses}`);
  const conflict = apiErrorSchema.parse(left.status === 409 ? left.json : right.json);
  assert(conflict.code === 40002, `期望 40002, 实际 ${conflict.code}`);
  const latest = await api.get(`/drafts/${draftId}`, apiResponse(draftSchema));
  assert(latest.data.version === draftVersion + 1, '并发更新后 version 应只递增一次');
  assert(['并发正文 A', '并发正文 B'].includes(latest.data.content), '最终正文应来自唯一赢家');
  draftVersion = latest.data.version;
});

test(s6, '草稿正文和媒体引用写入任一步失败时整笔事务回滚', async () => {
  const before = await e2ePrisma.draft.findUniqueOrThrow({ where: { id: draftId } });
  const expectedFailure = 'E2E_DRAFT_MEDIA_SYNC_FAILURE';
  const failingMediaReferences = {
    syncDraftContent: async () => {
      throw new Error(expectedFailure);
    },
    releaseDraftContent: async () => undefined,
  } as unknown as MediaReferenceService;
  const service = new DraftsService(
    e2ePrisma as unknown as PrismaService,
    new DiceService(),
    new StickerContentService(e2ePrisma as unknown as PrismaService),
    failingMediaReferences,
  );

  let rejected = false;
  try {
    await service.update(draftId, '不应提交的正文', before.version, currentUserId);
  } catch (error) {
    rejected = error instanceof Error && error.message === expectedFailure;
  }
  assert(rejected, '媒体引用同步失败应向调用方返回失败');

  const after = await e2ePrisma.draft.findUniqueOrThrow({ where: { id: draftId } });
  assert(after.content === before.content, '事务失败后正文不得变化');
  assert(after.version === before.version, '事务失败后 version 不得递增');
});

test(s6, '跨账号读取和更新返回 40405，幂等删除不泄露也不删除他人草稿', async () => {
  if (!peerApi.token) {
    peerUserId = await registerTestClient(peerApi, SECOND_TEST_EMAIL, `e2epeer${RUN_ID.slice(-6)}`);
  }
  for (const [method, body] of [
    ['GET', undefined],
    ['PATCH', { content: '越权正文', version: draftVersion }],
  ] as const) {
    const { status, json } = await peerApi.expectStatus(`/drafts/${draftId}`, method, body);
    const error = apiErrorSchema.parse(json);
    assert(status === 404 && error.code === 40405, `${method} 应返回 40405`);
  }
  const hiddenDelete = await peerApi.expectStatus(
    `/drafts/${draftId}?version=${draftVersion}`,
    'DELETE',
  );
  assert(hiddenDelete.status === 200, `越权删除应按不存在幂等处理，实际 ${hiddenDelete.status}`);
  const ownerRead = await api.get(`/drafts/${draftId}`, apiResponse(draftSchema));
  assert(ownerRead.data.id === draftId, '越权删除不得影响本人草稿');
});

test(s6, 'DELETE /drafts/:id 拒绝旧版本并允许相同删除重放', async () => {
  const stale = await api.expectStatus(`/drafts/${draftId}?version=${draftVersion - 1}`, 'DELETE');
  const conflict = apiErrorSchema.parse(stale.json);
  assert(stale.status === 409 && conflict.code === 40002, '旧版本删除应返回 409/40002');
  const [removed, concurrentReplay] = await Promise.all([
    api.del(`/drafts/${draftId}?version=${draftVersion}`),
    api.del(`/drafts/${draftId}?version=${draftVersion}`),
  ]);
  assert(removed.code === 0, `删除应成功: ${removed.code}`);
  assert(concurrentReplay.code === 0, '并发重复删除应幂等成功');
  const laterReplay = await api.del(`/drafts/${draftId}?version=${draftVersion}`);
  assert(laterReplay.code === 0, '稍后重复删除也应幂等成功');
});

test(s6, '旧 version 不得复活已删除槽位，旧 ID 也不得覆盖新草稿', async () => {
  const resurrect = await api.expectStatus('/drafts', 'POST', {
    content: '离线旧正文',
    slot: 1,
    version: draftVersion,
  });
  const conflict = apiErrorSchema.parse(resurrect.json);
  assert(resurrect.status === 409 && conflict.code === 40002, '旧 version 创建应冲突');

  const replacement = await api.post(
    '/drafts',
    { content: '新槽位正文', slot: 1, clientRequestId: crypto.randomUUID() },
    apiResponse(draftSchema),
  );
  const stalePatch = await api.expectStatus(`/drafts/${draftId}`, 'PATCH', {
    content: '旧设备覆盖',
    version: draftVersion,
  });
  const missing = apiErrorSchema.parse(stalePatch.json);
  assert(stalePatch.status === 404 && missing.code === 40405, '旧 ID 更新应返回 40405');
  const preserved = await api.get(`/drafts/${replacement.data.id}`, apiResponse(draftSchema));
  assert(preserved.data.content === '新槽位正文', '新草稿正文不得被旧 ID 覆盖');
  await api.del(`/drafts/${replacement.data.id}?version=${replacement.data.version}`);
});

test(s6, '五个并发自动创建获得唯一槽位，第六个稳定返回已满', async () => {
  const deviceClients = Array.from({ length: 6 }, (_, index) => {
    const client = new Client(
      `198.19.${100 + index}.${((Number(RUN_ID.slice(-2)) + index) % 254) + 1}`,
    );
    client.token = api.token;
    return client;
  });
  const created = await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      deviceClients[index].post(
        '/drafts',
        { content: `并发自动草稿 ${index + 1}`, clientRequestId: crypto.randomUUID() },
        apiResponse(draftSchema),
      ),
    ),
  );
  const slots = created.map((response) => response.data.slot).sort((a, b) => a - b);
  assert(slots.join(',') === '1,2,3,4,5', `并发槽位应为 1..5，实际 ${slots}`);

  const full = await deviceClients[5].expectStatus('/drafts', 'POST', {
    content: '第六个草稿',
    clientRequestId: crypto.randomUUID(),
  });
  const error = apiErrorSchema.parse(full.json);
  assert(full.status === 400 && error.code === 40001, '第六个草稿应返回 400/40001');

  for (const [index, response] of created.entries()) {
    await deviceClients[index].del(`/drafts/${response.data.id}?version=${response.data.version}`);
  }
});

test(s6, 'PostgreSQL 拒绝槽位和 version 不变量违规', async () => {
  for (const data of [
    { slot: 0, version: 1 },
    { slot: 6, version: 1 },
    { slot: 1, version: 0 },
  ]) {
    let rejected = false;
    try {
      const invalid = await e2ePrisma.draft.create({
        data: { userId: currentUserId, content: '非法草稿', ...data },
      });
      await e2ePrisma.draft.delete({ where: { id: invalid.id } });
    } catch {
      rejected = true;
    }
    assert(rejected, `数据库应拒绝 slot=${data.slot}, version=${data.version}`);
  }
});

// ═══════════════════════════════════════════════════════════════
// 7. 收藏
// ═══════════════════════════════════════════════════════════════

const s7 = suite('收藏');

test(s7, 'POST /bookmarks 收藏', async () => {
  const r = await api.post('/bookmarks', { threadId });
  assert(r.code === 0, `收藏应成功: ${r.code} ${r.message}`);
  bookmarkId = r.data.id;
});

test(s7, 'GET /bookmarks 收藏列表', async () => {
  const r = await api.get('/bookmarks?limit=10', apiPaginated(z.any()));
  assert(Array.isArray(r.data), 'data 应为数组');
});

test(s7, 'DELETE /bookmarks/:id 取消收藏', async () => {
  if (bookmarkId) {
    const r = await api.del(`/bookmarks/${bookmarkId}`);
    assert(r.code === 0, `取消收藏应成功 (got: ${r.code} ${r.message})`);
  }
});

// ═══════════════════════════════════════════════════════════════
// 8. 订阅
// ═══════════════════════════════════════════════════════════════

const s8 = suite('订阅');

test(s8, 'POST /subscriptions 创建订阅 THREAD', async () => {
  const r = await api.post('/subscriptions', {
    threadId: subscribableThreadId,
    type: 'THREAD',
  });
  assert(r.code === 0, `订阅应成功: ${r.code} ${r.message}`);
  subscriptionId = r.data.id;
});

test(s8, 'GET /subscriptions 订阅列表', async () => {
  const r = await api.get('/subscriptions?limit=10', apiPaginated(z.any()));
  assert(Array.isArray(r.data), 'data 应为数组');
});

test(s8, 'DELETE /subscriptions/:id 取消订阅', async () => {
  if (subscriptionId) {
    const r = await api.del(`/subscriptions/${subscriptionId}`);
    assert(r.code === 0, `取消订阅应成功 (got: ${r.code} ${r.message})`);
  }
});

// ═══════════════════════════════════════════════════════════════
// 9. 通知
// ═══════════════════════════════════════════════════════════════

const s9 = suite('通知');

test(s9, 'GET /notifications 通知列表', async () => {
  const r = await api.get('/notifications?limit=10');
  assert(r.code === 0, `通知列表应成功 (got: ${r.code} ${r.message})`);
});

test(s9, 'GET /notifications/unread 未读数', async () => {
  const r = await api.get('/notifications/unread');
  assert(r.code === 0, `未读数应成功 (got: ${r.code})`);
});

test(s9, 'POST /notifications/read-all 全部已读', async () => {
  const r = await api.post('/notifications/read-all');
  assert(r.code === 0, `全部已读应成功 (got: ${r.code} ${r.message})`);
});

// ═══════════════════════════════════════════════════════════════
// 10. 用户交互
// ═══════════════════════════════════════════════════════════════

const s10 = suite('用户交互');

test(s10, 'GET /users/search 搜索用户', async () => {
  const r = await api.get('/users/search?q=test&limit=10');
  assert(r.code === 0, `搜索应成功 (got: ${r.code})`);
  assert(Array.isArray(r.data), 'data 应为数组');
});

test(s10, 'GET /users/:id/played-threads 参与帖', async () => {
  const r = await api.get(`/users/${useTestuserId}/played-threads`, apiResponse(z.any()));
  assert(r.code === 0, `参与帖应成功 (got: ${r.code})`);
});

test(s10, 'GET /users/:id/recent-replies 最近回复', async () => {
  const r = await api.get(`/users/${useTestuserId}/recent-replies`, apiResponse(z.any()));
  assert(r.code === 0, `最近回复应成功 (got: ${r.code})`);
});

test(s10, 'GET /users/:id/bookmarks 公开收藏', async () => {
  const r = await api.get(`/users/${useTestuserId}/bookmarks`, apiResponse(z.any()));
  assert(r.code === 0, `公开收藏应成功 (got: ${r.code})`);
});

// ═══════════════════════════════════════════════════════════════
// 11. 动态收藏夹
// ═══════════════════════════════════════════════════════════════

const s11 = suite('动态收藏夹');

test(s11, 'GET /moments/bookmark-folders 获取动态收藏夹', async () => {
  const r = await api.get('/moments/bookmark-folders');
  assert(r.code === 0 && Array.isArray(r.data), '收藏夹列表应成功');
  const defaultFolder = r.data.find((folder: { isDefault?: boolean }) => folder.isDefault);
  assert(!!defaultFolder, '应存在默认收藏夹');
  defaultBookmarkFolderId = defaultFolder.id;
  assert(typeof defaultFolder.momentBookmarkCount === 'number', '收藏夹应返回动态收藏计数');
});

test(s11, 'POST /moments/bookmark-folders 新建动态收藏夹', async () => {
  const r = await api.post('/moments/bookmark-folders', {
    name: `E2E动态${RUN_ID.slice(-6)}`,
  });
  assert(r.code === 0, `新建收藏夹应成功 (got: ${r.code} ${r.message})`);
  momentFolderId = r.data.id;
});

test(s11, 'POST /moments 发布纯文本动态', async () => {
  const r = await api.post('/moments', {
    title: `E2E 动态 ${RUN_ID.slice(-6)}`,
    content: '动态收藏夹端到端验证',
    mediaIds: [],
    clientRequestId: momentClientRequestId,
  });
  assert(r.code === 0, `发布动态应成功 (got: ${r.code} ${r.message})`);
  momentId = r.data.id;
  assert(r.data.canInteract === true, '活跃作者的动态应允许互动');
});

test(s11, 'POST /moments 相同幂等请求稳定重放', async () => {
  const r = await api.post('/moments', {
    title: `E2E 动态 ${RUN_ID.slice(-6)}`,
    content: '动态收藏夹端到端验证',
    mediaIds: [],
    clientRequestId: momentClientRequestId,
  });
  assert(r.code === 0 && r.data.id === momentId, '幂等重放应返回原动态');
});

test(s11, 'POST /moments 拒绝幂等键复用与非 CUID 媒体', async () => {
  const reused = await api.expectStatus('/moments', 'POST', {
    title: `E2E 动态变更 ${RUN_ID.slice(-6)}`,
    content: '动态收藏夹端到端验证',
    mediaIds: [],
    clientRequestId: momentClientRequestId,
  });
  assert(reused.status === 409, `幂等键复用应返回 409，实际 ${reused.status}`);
  assert((reused.json as { code?: number }).code === 40912, '幂等键复用应返回 40912');

  const invalidMedia = await api.expectStatus('/moments', 'POST', {
    title: 'E2E 非法媒体',
    mediaIds: ['not-a-cuid'],
    clientRequestId: crypto.randomUUID(),
  });
  assert(invalidMedia.status === 400, `非 CUID 媒体应返回 400，实际 ${invalidMedia.status}`);
});

test(s11, 'GET /moments 与搜索可见新动态', async () => {
  const feed = await api.get('/moments?feed=DISCOVER&limit=50');
  assert(feed.code === 0, `发现流应成功 (got: ${feed.code})`);
  assert(
    feed.data.some((moment: { id?: string }) => moment.id === momentId),
    '发现流应包含新动态',
  );

  const query = encodeURIComponent(`E2E 动态 ${RUN_ID.slice(-6)}`);
  const searched = await api.get(`/search/moments?q=${query}`);
  assert(searched.code === 0, `动态搜索应成功 (got: ${searched.code})`);
  assert(
    searched.data.some((moment: { id?: string }) => moment.id === momentId),
    '动态搜索应包含新动态',
  );
});

test(s11, '动态点赞与评论下游计数可一致回收', async () => {
  const liked = await api.post(`/moments/${momentId}/like`);
  assert(liked.code === 0 && liked.data.active === true, '点赞应成功');

  const commented = await api.post(`/moments/${momentId}/comments`, {
    content: 'E2E 动态评论',
    clientRequestId: momentCommentClientRequestId,
  });
  assert(commented.code === 0, `发表评论应成功 (got: ${commented.code})`);
  momentCommentId = commented.data.id;

  const replayed = await api.post(`/moments/${momentId}/comments`, {
    content: 'E2E 动态评论',
    clientRequestId: momentCommentClientRequestId,
  });
  assert(replayed.data.id === momentCommentId, '评论幂等重放应返回原评论');

  const detail = await api.get(`/moments/${momentId}`);
  assert(detail.data.likeCount === 1, '动态点赞计数应为 1');
  assert(detail.data.commentCount === 1, '重放后评论计数仍应为 1');

  const removedComment = await api.del(`/moments/${momentId}/comments/${momentCommentId}`);
  assert(removedComment.code === 0, '删除评论应成功');
  const unliked = await api.del(`/moments/${momentId}/like`);
  assert(unliked.code === 0 && unliked.data.active === false, '取消点赞应成功');

  const cleaned = await api.get(`/moments/${momentId}`);
  assert(cleaned.data.likeCount === 0, '取消点赞后计数应归零');
  assert(cleaned.data.commentCount === 0, '删除评论后计数应归零');
});

test(s11, 'POST /moments/:id/bookmark 收藏到指定收藏夹', async () => {
  const r = await api.post(`/moments/${momentId}/bookmark`, { folderId: momentFolderId });
  assert(r.code === 0 && r.data.active === true, '动态收藏应成功');
});

test(s11, 'GET /moments/bookmarks 按收藏夹筛选并返回私有归属', async () => {
  const r = await api.get(`/moments/bookmarks?folderId=${momentFolderId}`);
  const bookmarked = r.data.find((moment: { id?: string }) => moment.id === momentId);
  assert(!!bookmarked, '指定收藏夹应包含新动态');
  assert(bookmarked.bookmarkFolderId === momentFolderId, '应返回当前用户的收藏夹归属');
});

test(s11, 'PATCH /moments/:id/bookmark 移动到默认收藏夹', async () => {
  const r = await api.patch(`/moments/${momentId}/bookmark`, {
    folderId: defaultBookmarkFolderId,
  });
  assert(r.code === 0, `移动收藏应成功 (got: ${r.code} ${r.message})`);
  assert(r.data.folderId === defaultBookmarkFolderId, '应移动到默认收藏夹');
});

test(s11, 'GET /users/:id/moment-bookmarks 公开动态收藏不泄露分类', async () => {
  const r = await api.get(`/users/${currentUserId}/moment-bookmarks`);
  const bookmarked = r.data.find((moment: { id?: string }) => moment.id === momentId);
  assert(!!bookmarked, '公开动态收藏应包含新动态');
  assert(!('bookmarkFolderId' in bookmarked), '公开响应不应泄露私有收藏夹 ID');
});

test(s11, 'DELETE /moments/:id/bookmark 取消动态收藏', async () => {
  const r = await api.del(`/moments/${momentId}/bookmark`);
  assert(r.code === 0 && r.data.active === false, '取消动态收藏应成功');
});

// ═══════════════════════════════════════════════════════════════
// 12. 标签
// ═══════════════════════════════════════════════════════════════

const s12 = suite('标签');

test(s12, 'POST /tags 创建标签', async () => {
  const name = `${TEST_TAG_PREFIX}p`;
  const r = await api.post('/tags', { name, color: '#FF5722' });
  assert(r.code === 0, `创建标签应成功 (got: ${r.code} ${r.message})`);
  tagId = r.data.id;
});

test(s12, 'GET /tags/:id 标签详情', async () => {
  const r = await api.get(`/tags/${tagId}`, apiResponse(z.any()));
  assert(r.data.id === tagId, 'ID 应匹配');
});

test(s12, 'POST /threads/:id/tags 为主题帖添加标签', async () => {
  const name = `${TEST_TAG_PREFIX}t`;
  const r = await api.post(`/threads/${threadId}/tags`, { name });
  assert(r.code === 0, `添加标签应成功 (got: ${r.code} ${r.message})`);
});

test(s12, 'GET /threads/:id/tags 帖标签列表', async () => {
  const r = await api.get(`/threads/${threadId}/tags`);
  assert(r.code === 0, `获取标签应成功 (got: ${r.code})`);
});

test(s12, 'DELETE /threads/:id/tags/:tagId 移除标签', async () => {
  const r = await api.del(`/threads/${threadId}/tags/${tagId}`);
  // 标签可能已经被自动删除，允许非 0
  assert([0, 40400].includes(r.code), `移除标签 (got: ${r.code} ${r.message})`);
});

// ═══════════════════════════════════════════════════════════════
// 13. 参数校验 & 错误码
// ═══════════════════════════════════════════════════════════════

const s13 = suite('参数校验 & 错误码');

test(s13, 'POST /auth/login 短密码 → 400', async () => {
  const { status } = await api.expectStatus('/auth/login', 'POST', {
    account: TEST_EMAIL,
    password: '12',
  });
  assert(status === 400, `期望 400, 实际 ${status}`);
});

test(s13, 'POST /threads 超长标题 → 400', async () => {
  const { status } = await api.expectStatus('/threads', 'POST', {
    title: 'a'.repeat(101),
    category: activeCategorySlug,
  });
  assert(status === 400, `期望 400, 实际 ${status}`);
});

test(s13, 'POST /subthreads/:id/posts 空内容 → 400', async () => {
  const { status } = await api.expectStatus(`/subthreads/${subthreadId}/posts`, 'POST', {
    content: '',
  });
  assert(status === 400, `期望 400, 实际 ${status}`);
});

test(s13, 'POST /subthreads/:id/posts replyTo 缺少 parent → 400', async () => {
  const { status } = await api.expectStatus(`/subthreads/${subthreadId}/posts`, 'POST', {
    content: '缺少父楼层的非法回复',
    replyToPostId: postId,
    clientRequestId: crypto.randomUUID(),
  });
  assert(status === 400, `replyTo 缺少 parent 期望 400, 实际 ${status}`);
});

test(s13, 'POST /subthreads/:id/posts 跨主楼层 replyTo → 400', async () => {
  const otherRoot = await api.post(`/subthreads/${subthreadId}/posts`, {
    content: '另一主楼层',
    clientRequestId: crypto.randomUUID(),
  });
  const { status } = await api.expectStatus(`/subthreads/${subthreadId}/posts`, 'POST', {
    content: '跨主楼层非法回复',
    parentPostId: postId,
    replyToPostId: otherRoot.data.id,
    clientRequestId: crypto.randomUUID(),
  });
  assert(status === 400, `跨主楼层 replyTo 期望 400, 实际 ${status}`);
});

test(s13, '普通用户不能调用前台管理员隐藏接口 → 403', async () => {
  const { status, json } = await api.expectStatus(
    `/moderation/content/thread/${threadId}/hide`,
    'POST',
    { reason: '普通用户越权请求' },
  );
  assert(status === 403, `期望 403, 实际 ${status}`);
  assert(
    (json as { code?: number }).code === 40308,
    `期望 ADMIN_REQUIRED(40308), 实际 ${(json as { code?: number }).code}`,
  );
});

test(s13, 'GET /threads/:id 不存在 → 404', async () => {
  const { status } = await api.expectStatus('/threads/nonexistent-id-x', 'GET');
  assert(status === 404, `期望 404, 实际 ${status}`);
});

test(s13, 'POST /threads 最小草稿载荷可创建', async () => {
  const { status } = await api.expectStatus('/threads', 'POST', {});
  assert([200, 201].includes(status), `期望成功, 实际 ${status}`);
});

// ═══════════════════════════════════════════════════════════════
// 14. 清理
// ═══════════════════════════════════════════════════════════════

const s14 = suite('清理');

test(s14, 'DELETE /moments/:id 软删除动态', async () => {
  const r = await api.del(`/moments/${momentId}`);
  assert(r.code === 0, `软删除动态应成功 (got: ${r.code} ${r.message})`);
});

test(s14, 'DELETE /posts/:id 软删除帖子', async () => {
  const r = await api.del(`/posts/${postId}`);
  assert(r.code === 0, `软删除应成功 (got: ${r.code} ${r.message})`);
});

test(s14, 'DELETE /threads/:id 软删除主题帖', async () => {
  const r = await api.del(`/threads/${threadId}`);
  assert(r.code === 0, `软删除应成功 (got: ${r.code} ${r.message})`);
});

test(s14, 'POST /auth/logout 登出', async () => {
  const accessToken = api.token;
  const refreshToken = api.cookies.get('refreshToken');
  assert(!!refreshToken, '登出前应存在 refresh token Cookie');
  const r = await api.post('/auth/logout');
  assert(r.code === 0, `登出应成功 (got: ${r.code} ${r.message})`);
  const refreshResult = await api.expectStatus('/auth/refresh', 'POST', { refreshToken });
  assert(refreshResult.status === 401, `登出后 refresh token 应失效，实际 ${refreshResult.status}`);
  api.token = accessToken;
  const accessResult = await api.expectStatus('/users/me', 'GET');
  assert(
    accessResult.status === 401,
    `登出后 access token 对应终端应失效，实际 ${accessResult.status}`,
  );
});

// ═══════════════════════════════════════════════════════════════
// 启动
// ═══════════════════════════════════════════════════════════════

void (async () => {
  let succeeded = false;
  try {
    succeeded = await run();
  } catch (error) {
    console.error(pc.red(error instanceof Error ? error.message : String(error)));
  } finally {
    try {
      await cleanupTestData();
      console.log(pc.dim('E2E 测试数据已清理'));
    } catch (error) {
      succeeded = false;
      console.error(
        pc.red(`E2E 测试数据清理失败: ${error instanceof Error ? error.message : String(error)}`),
      );
    }
    await e2ePrisma.$disconnect();
  }
  process.exitCode = succeeded ? 0 : 1;
})();
